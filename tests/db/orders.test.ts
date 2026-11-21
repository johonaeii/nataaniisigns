import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbError } from '../../server/db';
import { createOrderRepo, type OrderRepo } from '../../server/orders';
import { hashToken } from '../../server/tokens';
import { allowedAdminActions } from '../../shared/orderStatus';
import { ADMIN_ACTIONS, ORDER_STATUSES, PAYMENT_STATUSES, type AdminAction } from '../../shared/types';
import { createInput, TEST_TOKEN } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let t: TestDb;
let repo: OrderRepo;
let adminId: string;

beforeEach(async () => {
  t = await createTestDb();
  repo = createOrderRepo(t.rpc);
  adminId = await t.createUser('owner@example.com', { admin: true });
});

afterEach(async () => {
  await t.close();
});

async function expectDbError(promise: Promise<unknown>, message: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DbError);
  expect((error as DbError).message).toBe(message);
  return error as DbError;
}

async function countOrders() {
  const result = await t.db.query<{ n: number }>('select count(*)::int as n from public.orders');
  return result.rows[0].n;
}

/** Simulates Stripe confirming payment for an online order. */
async function payOnline(orderId: string, sessionId = 'cs_test_1', amount?: number) {
  const order = (await repo.getOrder(orderId))!;
  return repo.markPaidStripe({
    orderId,
    sessionId,
    paymentIntentId: 'pi_test_1',
    amountCents: amount ?? order.subtotal_cents,
    currency: 'usd',
  });
}

describe('creating orders', () => {
  it('holds the signs and snapshots server-side prices', async () => {
    const a = await t.insertSign({ name: 'Coffee', price_cents: 3500 });
    const b = await t.insertSign({ name: 'Route 66', price_cents: 1250, quantity_available: 3 });

    const order = await repo.createOrder(createInput([a.id, { id: b.id, quantity: 2 }]));

    expect(order.status).toBe('requested');
    expect(order.payment_status).toBe('unpaid');
    expect(order.subtotal_cents).toBe(3500 + 2 * 1250);
    expect(order.items).toHaveLength(2);
    expect((await t.getSign(a.id)).quantity_available).toBe(0);
    expect((await t.getSign(b.id)).quantity_available).toBe(1);
  });

  it('starts online orders as checkout_pending with a hold expiry', async () => {
    const a = await t.insertSign();
    const order = await repo.createOrder(createInput([a.id], { paymentChoice: 'online' }));
    expect(order.status).toBe('checkout_pending');
    expect(order.hold_expires_at).not.toBeNull();
    expect((await t.getSign(a.id)).quantity_available).toBe(0);
  });

  it('prevents a second customer from reserving a one-of-a-kind sign', async () => {
    const sign = await t.insertSign({ quantity_available: 1 });

    await repo.createOrder(createInput([sign.id]));
    const error = await expectDbError(
      repo.createOrder(createInput([sign.id], { paymentChoice: 'online' }, 'second-customer-token-xxxxxxxx')),
      'SIGN_UNAVAILABLE',
    );

    expect(error.detail).toBe(sign.id);
    expect(await countOrders()).toBe(1);
    expect((await t.getSign(sign.id)).quantity_available).toBe(0);
  });

  it('is all-or-nothing: one unavailable sign leaves no partial hold', async () => {
    const available = await t.insertSign({ quantity_available: 1 });
    const taken = await t.insertSign({ quantity_available: 0 });

    await expectDbError(repo.createOrder(createInput([available.id, taken.id])), 'SIGN_UNAVAILABLE');

    expect(await countOrders()).toBe(0);
    expect((await t.getSign(available.id)).quantity_available).toBe(1);
  });

  it('rejects asking for more than is available', async () => {
    const sign = await t.insertSign({ quantity_available: 2 });
    await expectDbError(repo.createOrder(createInput([{ id: sign.id, quantity: 3 }])), 'SIGN_UNAVAILABLE');
    expect((await t.getSign(sign.id)).quantity_available).toBe(2);
  });

  it('merges duplicate cart lines before checking stock', async () => {
    const sign = await t.insertSign({ quantity_available: 1 });
    await expectDbError(
      repo.createOrder(createInput([sign.id, sign.id])), // 2 of a sign that has 1
      'SIGN_UNAVAILABLE',
    );
  });

  it('does not sell unlisted signs', async () => {
    const hidden = await t.insertSign({ is_listed: false });
    await expectDbError(repo.createOrder(createInput([hidden.id])), 'SIGN_UNAVAILABLE');
  });

  it('refuses when the price changed since the customer saw it', async () => {
    const sign = await t.insertSign({ price_cents: 2000 });
    const error = await expectDbError(
      repo.createOrder(createInput([sign.id], { expectedSubtotalCents: 1500 })),
      'PRICE_CHANGED',
    );
    expect(error.detail).toBe('2000');
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);
  });

  it('enforces contact details in the database too', async () => {
    const sign = await t.insertSign();
    const input = createInput([sign.id]);
    input.request.customer.email = undefined;
    input.request.customer.phone = undefined;
    const error = await repo.createOrder(input).catch((e: DbError) => e);
    expect((error as DbError).code).toBe('23514'); // check_violation
    expect(await countOrders()).toBe(0);
  });

  it('never lets stock go negative, even with a direct write', async () => {
    const sign = await t.insertSign({ quantity_available: 0 });
    await expect(
      t.db.query('update public.signs set quantity_available = quantity_available - 1 where id = $1', [sign.id]),
    ).rejects.toThrow(/check constraint/);
  });
});

describe('online payment (Stripe) state changes', () => {
  async function onlineOrder() {
    const sign = await t.insertSign({ price_cents: 4000 });
    const order = await repo.createOrder(createInput([sign.id], { paymentChoice: 'online' }));
    await repo.setCheckoutSession(order.id, 'cs_test_1', new Date(Date.now() + 31 * 60_000));
    return { sign, order };
  }

  it('marks a pending checkout paid and confirmed', async () => {
    const { order } = await onlineOrder();
    const result = await payOnline(order.id);

    expect(result.changed).toBe(true);
    expect(result.attention).toBe(false);
    expect(result.order.status).toBe('confirmed');
    expect(result.order.payment_status).toBe('paid');
    expect(result.order.paid_via).toBe('stripe');
    expect(result.order.hold_expires_at).toBeNull();
  });

  it('is idempotent for duplicate payment events', async () => {
    const { sign, order } = await onlineOrder();
    await payOnline(order.id);
    const again = await payOnline(order.id);

    expect(again.changed).toBe(false);
    expect((await t.getSign(sign.id)).quantity_available).toBe(0);
  });

  it('releases the hold when the checkout expires, exactly once', async () => {
    const { sign, order } = await onlineOrder();
    const release = () =>
      repo.releaseCheckout({ orderId: order.id, sessionId: 'cs_test_1', to: 'expired', actor: 'stripe', reason: 'checkout_expired' });

    expect((await release()).changed).toBe(true);
    expect((await release()).changed).toBe(false); // duplicate webhook
    const after = (await repo.getOrder(order.id))!;
    expect(after.status).toBe('expired');
    expect(after.payment_status).toBe('unpaid');
    expect((await t.getSign(sign.id)).quantity_available).toBe(1); // restored once, not twice
  });

  it('never releases a paid order', async () => {
    const { sign, order } = await onlineOrder();
    await payOnline(order.id);
    const result = await repo.releaseCheckout({
      orderId: order.id,
      sessionId: 'cs_test_1',
      to: 'expired',
      actor: 'stripe',
      reason: 'checkout_expired',
    });
    expect(result.changed).toBe(false);
    expect((await t.getSign(sign.id)).quantity_available).toBe(0);
  });

  it('ignores an expiry for a different Checkout Session', async () => {
    const { order } = await onlineOrder();
    const result = await repo.releaseCheckout({
      orderId: order.id,
      sessionId: 'cs_test_other',
      to: 'expired',
      actor: 'stripe',
      reason: 'checkout_expired',
    });
    expect(result.changed).toBe(false);
    expect((await repo.getOrder(order.id))!.status).toBe('checkout_pending');
  });

  it('flags an amount mismatch for the owner', async () => {
    const { order } = await onlineOrder();
    const result = await payOnline(order.id, 'cs_test_1', 100);
    expect(result.attention).toBe(true);
    expect(result.order.attention_reason).toMatch(/differs from the order total/);
    expect(result.order.payment_status).toBe('paid');
  });

  it('re-takes stock when payment arrives after release, if still available', async () => {
    const { sign, order } = await onlineOrder();
    await repo.releaseCheckout({ orderId: order.id, sessionId: 'cs_test_1', to: 'expired', actor: 'system', reason: 'checkout_expired' });
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);

    const result = await payOnline(order.id);
    expect(result.order.status).toBe('confirmed');
    expect(result.attention).toBe(false);
    expect((await t.getSign(sign.id)).quantity_available).toBe(0);
  });

  it('does not oversell when a late payment arrives after someone else bought the sign', async () => {
    const { sign, order } = await onlineOrder();
    await repo.releaseCheckout({ orderId: order.id, sessionId: 'cs_test_1', to: 'expired', actor: 'system', reason: 'checkout_expired' });
    await repo.createOrder(createInput([sign.id], {}, 'someone-else-token-xxxxxxxxxx'));

    const result = await payOnline(order.id);

    expect(result.order.payment_status).toBe('paid'); // money is recorded...
    expect(result.order.status).toBe('expired'); // ...but the order does not take the sign
    expect(result.attention).toBe(true);
    expect(result.order.attention_reason).toMatch(/no longer available/);
    expect((await t.getSign(sign.id)).quantity_available).toBe(0);
  });
});

describe('pay-later requests and owner actions', () => {
  async function request() {
    const sign = await t.insertSign({ price_cents: 2500 });
    const order = await repo.createOrder(createInput([sign.id]));
    return { sign, order };
  }

  it('supports confirm -> mark paid in person -> picked up', async () => {
    const { order } = await request();

    const confirmed = await repo.adminUpdateOrder(order.id, 'confirm', adminId);
    expect(confirmed.order.status).toBe('confirmed');
    expect(confirmed.order.payment_status).toBe('unpaid');

    const paid = await repo.adminUpdateOrder(order.id, 'mark_paid', adminId);
    expect(paid.order.payment_status).toBe('paid');
    expect(paid.order.paid_via).toBe('in_person');

    const done = await repo.adminUpdateOrder(order.id, 'complete', adminId);
    expect(done.order.status).toBe('completed');
  });

  it('marking a request paid also confirms it', async () => {
    const { order } = await request();
    const paid = await repo.adminUpdateOrder(order.id, 'mark_paid', adminId);
    expect(paid.order.status).toBe('confirmed');
    expect(paid.order.payment_status).toBe('paid');
  });

  it('canceling releases the signs once; a second cancel is rejected', async () => {
    const { sign, order } = await request();
    await repo.adminUpdateOrder(order.id, 'cancel', adminId);
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);

    await expectDbError(repo.adminUpdateOrder(order.id, 'cancel', adminId), 'INVALID_TRANSITION');
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);
  });

  it('a released sign can be reserved by the next customer', async () => {
    const { sign, order } = await request();
    await repo.adminUpdateOrder(order.id, 'cancel', adminId);
    const next = await repo.createOrder(createInput([sign.id], {}, 'next-customer-token-xxxxxxxxx'));
    expect(next.status).toBe('requested');
  });

  it('rejects users who are not admins', async () => {
    const { order } = await request();
    const stranger = await t.createUser('stranger@example.com');
    const error = await expectDbError(repo.adminUpdateOrder(order.id, 'confirm', stranger), 'NOT_ADMIN');
    expect(error.code).toBe('42501');
  });

  it('does not let the owner cancel an online checkout in progress', async () => {
    const sign = await t.insertSign();
    const order = await repo.createOrder(createInput([sign.id], { paymentChoice: 'online' }));
    await expectDbError(repo.adminUpdateOrder(order.id, 'cancel', adminId), 'INVALID_TRANSITION');
  });

  it('database rules match the UI rules for every status/payment combination', async () => {
    const sign = await t.insertSign({ quantity_available: 1000 });

    for (const status of ORDER_STATUSES) {
      for (const payment of PAYMENT_STATUSES) {
        for (const attention of [null, 'Check this']) {
          const expected = allowedAdminActions({ status, payment_status: payment, attention_reason: attention });
          for (const action of ADMIN_ACTIONS) {
            const order = await repo.createOrder(createInput([sign.id], {}, `token-${status}-${payment}-${action}-xxxxxxxx`));
            await t.db.query(
              `update public.orders set status = $2::public.order_status,
                 payment_status = $3::public.payment_status, attention_reason = $4,
                 paid_via = case when $3::public.payment_status = 'paid' then 'in_person'::public.paid_via end,
                 paid_at = case when $3::public.payment_status = 'paid' then now() end
               where id = $1`,
              [order.id, status, payment, attention],
            );
            const allowed = await repo.adminUpdateOrder(order.id, action as AdminAction, adminId).then(
              () => true,
              () => false,
            );
            expect({ status, payment, attention, action, allowed }).toEqual({
              status,
              payment,
              attention,
              action,
              allowed: expected.includes(action),
            });
          }
        }
      }
    }
  });
});

describe('reconciliation helpers', () => {
  it('lists online checkouts whose hold has ended', async () => {
    const sign = await t.insertSign();
    const order = await repo.createOrder(createInput([sign.id], { paymentChoice: 'online' }));
    expect(await repo.listStaleCheckouts(5)).toEqual([]);

    await t.db.query(`update public.orders set hold_expires_at = now() - interval '10 minutes' where id = $1`, [order.id]);
    const stale = await repo.listStaleCheckouts(5);
    expect(stale.map((s) => s.id)).toEqual([order.id]);
  });

  it('auto-releases only old, unconfirmed, unpaid requests', async () => {
    const [a, b, c, d] = await Promise.all([t.insertSign(), t.insertSign(), t.insertSign(), t.insertSign()]);
    const old = await repo.createOrder(createInput([a.id], {}, 'token-old-xxxxxxxxxxxxxxxxxxx'));
    const oldConfirmed = await repo.createOrder(createInput([b.id], {}, 'token-oldc-xxxxxxxxxxxxxxxxxx'));
    const oldPaid = await repo.createOrder(createInput([c.id], {}, 'token-oldp-xxxxxxxxxxxxxxxxxx'));
    await repo.createOrder(createInput([d.id], {}, 'token-new-xxxxxxxxxxxxxxxxxxx'));

    await repo.adminUpdateOrder(oldConfirmed.id, 'confirm', adminId);
    await repo.adminUpdateOrder(oldPaid.id, 'mark_paid', adminId);
    await t.db.query(`update public.orders set created_at = now() - interval '3 days' where id in ($1, $2, $3)`, [
      old.id,
      oldConfirmed.id,
      oldPaid.id,
    ]);

    const released = await repo.releaseStaleRequests(48);

    expect(released.map((o) => o.id)).toEqual([old.id]);
    expect(released[0].status_reason).toBe('request_expired');
    expect((await t.getSign(a.id)).quantity_available).toBe(1);
    expect((await t.getSign(b.id)).quantity_available).toBe(0);
  });
});

describe('customer order lookup', () => {
  it('requires the right token and hides contact details', async () => {
    const sign = await t.insertSign();
    const order = await repo.createOrder(createInput([sign.id], { customer: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-123-4567' } }));

    expect(await repo.getOrderForCustomer(order.id, hashToken('wrong-token-xxxxxxxxxxxxxxx'))).toBeNull();

    const view = (await repo.getOrderForCustomer(order.id, hashToken(TEST_TOKEN)))!;
    expect(view.customer_first_name).toBe('Ada');
    expect(view.has_email).toBe(true);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('ada@example.com');
    expect(serialized).not.toContain('555-123-4567');
    expect(serialized).not.toContain('Lovelace');
  });

  it('stores only a hash of the access token', async () => {
    const sign = await t.insertSign();
    await repo.createOrder(createInput([sign.id]));
    const result = await t.db.query<{ access_token_hash: string }>('select access_token_hash from public.orders');
    expect(result.rows[0].access_token_hash).toBe(hashToken(TEST_TOKEN));
    expect(result.rows[0].access_token_hash).not.toContain(TEST_TOKEN);
  });
});
