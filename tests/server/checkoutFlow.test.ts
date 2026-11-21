// End-to-end server flows: browser request -> Netlify handler -> real SQL, with
// Stripe replaced by a fake whose webhook signatures are verified for real.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleCheckoutCancel } from '../../server/handlers/checkoutCancel';
import { checkoutExpirySeconds, handleCreateOrder } from '../../server/handlers/createOrder';
import { handleOrderStatus } from '../../server/handlers/orderStatus';
import { runReconciliation } from '../../server/handlers/reconcile';
import { handleStripeWebhook } from '../../server/handlers/stripeWebhook';
import type { CreateOrderResponse, CustomerOrder, Sign } from '../../shared/types';
import { buildDeps, createFakePayments, postJson, signedWebhookRequest, stripeEvent, type FakePayments, type TestDeps } from '../helpers/appDeps';
import { orderRequest } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let t: TestDb;
let deps: TestDeps;
let payments: FakePayments;
let sign: Sign;

beforeEach(async () => {
  t = await createTestDb();
  payments = createFakePayments();
  deps = buildDeps(t, { payments });
  sign = await t.insertSign({ name: 'Open Late', price_cents: 4200, image_paths: ['signs/open-late.webp'] });
});

afterEach(async () => {
  await t.close();
});

async function placeOrder(body: Record<string, unknown>) {
  const response = await handleCreateOrder(postJson('/api/orders', orderRequest(body)), deps);
  return { response, body: (await response.json()) as CreateOrderResponse & { error?: string; signId?: string } };
}

async function status(orderId: string, token: string): Promise<CustomerOrder> {
  const response = await handleOrderStatus(
    new Request(`https://shop.test/api/order-status?id=${orderId}&t=${encodeURIComponent(token)}`),
    deps,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { order: CustomerOrder }).order;
}

const oneSign = () => [{ signId: sign.id, quantity: 1 }];

describe('pay-later request', () => {
  it('holds the sign, confirms submission, and notifies', async () => {
    const { response, body } = await placeOrder({ items: oneSign(), paymentChoice: 'pay_later' });

    expect(response.status).toBe(201);
    expect(body.status).toBe('requested');
    expect(body.checkoutUrl).toBeUndefined();
    expect((await t.getSign(sign.id)).quantity_available).toBe(0);

    const order = await status(body.orderId, body.token);
    expect(order.status).toBe('requested');
    expect(order.payment_status).toBe('unpaid');

    expect(deps.notify.sent).toEqual([
      {
        kind: 'requestSubmitted',
        orderId: body.orderId,
        detail: `https://shop.test/order/${body.orderId}?t=${encodeURIComponent(body.token)}`,
      },
    ]);
  });

  it('only one of two simultaneous requests for a one-of-a-kind sign succeeds', async () => {
    const results = await Promise.all([
      placeOrder({ items: oneSign(), paymentChoice: 'pay_later' }),
      placeOrder({ items: oneSign(), paymentChoice: 'online' }),
      placeOrder({ items: oneSign(), paymentChoice: 'pay_later' }),
    ]);
    const statuses = results.map((r) => r.response.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    expect(results.filter((r) => r.response.status === 409).every((r) => r.body.signId === sign.id)).toBe(true);
    expect((await t.getSign(sign.id)).quantity_available).toBe(0);
  });
});

describe('validation and abuse protection', () => {
  it('returns field errors for missing contact details', async () => {
    const { response, body } = await placeOrder({
      items: oneSign(),
      customer: { name: 'Ada', email: '', phone: '' },
    });
    expect(response.status).toBe(400);
    expect((body as unknown as { fieldErrors: Record<string, string> }).fieldErrors['customer.email']).toMatch(
      /email address or phone/,
    );
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);
  });

  it('ignores any price sent by the browser', async () => {
    const response = await handleCreateOrder(
      postJson('/api/orders', {
        ...orderRequest({ items: oneSign(), paymentChoice: 'online' }),
        items: [{ signId: sign.id, quantity: 1, price_cents: 1, unit_amount: 1 }],
        subtotal_cents: 1,
      }),
      deps,
    );
    expect(response.status).toBe(201);
    expect(payments.created[0].params.line_items![0].price_data!.unit_amount).toBe(4200);
  });

  it('rejects bots that fill the honeypot', async () => {
    const { response } = await placeOrder({ items: oneSign(), website: 'http://spam.example' });
    expect(response.status).toBe(400);
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);
  });

  it('reports a price change instead of charging a different amount', async () => {
    const { response, body } = await placeOrder({ items: oneSign(), expectedSubtotalCents: 4000 });
    expect(response.status).toBe(409);
    expect(body.error).toBe('price_changed');
  });

  it('rejects non-POST requests', async () => {
    const response = await handleCreateOrder(new Request('https://shop.test/api/orders'), deps);
    expect(response.status).toBe(405);
  });
});

describe('online checkout', () => {
  async function startCheckout() {
    const { response, body } = await placeOrder({ items: oneSign(), paymentChoice: 'online' });
    expect(response.status).toBe(201);
    const sessionId = payments.created.length ? [...payments.sessions.keys()].at(-1)! : '';
    return { ...body, sessionId };
  }

  it('creates a Stripe Checkout Session from database prices', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { checkoutUrl, orderId, token } = await startCheckout();

    expect(checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const { params, idempotencyKey } = payments.created[0];
    expect(idempotencyKey).toBe(`checkout-${orderId}`);
    expect(params.mode).toBe('payment');
    expect(params.allowed_payment_method_types).toEqual(['card']);
    expect(params.metadata).toMatchObject({ order_id: orderId });
    expect(params.client_reference_id).toBe(orderId);
    expect(params.customer_email).toBe('ada@example.com');
    expect(params.line_items).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: 4200,
          product_data: {
            name: 'Open Late',
            images: ['https://project.supabase.test/storage/v1/object/public/sign-photos/signs/open-late.webp'],
          },
        },
      },
    ]);
    expect(params.expires_at! - before).toBeGreaterThanOrEqual(30 * 60);
    expect(params.success_url).toBe(`https://shop.test/order/${orderId}?t=${encodeURIComponent(token)}&from=checkout`);
    expect(params.cancel_url).toContain('&canceled=1');
  });

  it('returning from Stripe does not by itself mark the order paid', async () => {
    const { orderId, token, sessionId } = await startCheckout();
    payments.complete(sessionId); // customer paid on Stripe and got redirected back...

    const order = await status(orderId, token); // ...but no verified webhook yet
    expect(order.status).toBe('checkout_pending');
    expect(order.payment_status).toBe('unpaid');
  });

  it('a verified webhook marks the order paid, once', async () => {
    const { orderId, token, sessionId } = await startCheckout();
    const event = stripeEvent('checkout.session.completed', payments.complete(sessionId));

    expect((await handleStripeWebhook(signedWebhookRequest(event), deps)).status).toBe(200);
    expect((await handleStripeWebhook(signedWebhookRequest(event), deps)).status).toBe(200); // redelivery

    const order = await status(orderId, token);
    expect(order.status).toBe('confirmed');
    expect(order.payment_status).toBe('paid');
    expect(deps.notify.sent.filter((n) => n.kind === 'paymentReceived')).toHaveLength(1);
  });

  it('rejects webhooks with a bad signature', async () => {
    const { orderId, token, sessionId } = await startCheckout();
    const event = stripeEvent('checkout.session.completed', payments.complete(sessionId));

    const forged = await handleStripeWebhook(signedWebhookRequest(event, 'whsec_attacker'), deps);
    expect(forged.status).toBe(400);

    const unsigned = await handleStripeWebhook(
      new Request('https://shop.test/api/stripe-webhook', { method: 'POST', body: JSON.stringify(event) }),
      deps,
    );
    expect(unsigned.status).toBe(400);
    expect((await status(orderId, token)).payment_status).toBe('unpaid');
  });

  it('keeps holding when Stripe reports the payment as still processing', async () => {
    const { orderId, token, sessionId } = await startCheckout();
    const event = stripeEvent('checkout.session.completed', payments.complete(sessionId, 'unpaid'));
    await handleStripeWebhook(signedWebhookRequest(event), deps);

    expect((await status(orderId, token)).status).toBe('checkout_pending');
    expect((await t.getSign(sign.id)).quantity_available).toBe(0);

    const succeeded = stripeEvent('checkout.session.async_payment_succeeded', payments.complete(sessionId, 'paid'));
    await handleStripeWebhook(signedWebhookRequest(succeeded), deps);
    expect((await status(orderId, token)).payment_status).toBe('paid');
  });

  it.each([
    ['checkout.session.expired', 'expired'],
    ['checkout.session.async_payment_failed', 'expired'],
  ])('%s releases the sign for other customers', async (type, expected) => {
    const { orderId, token, sessionId } = await startCheckout();
    const session = { ...(await payments.retrieveCheckoutSession(sessionId)), status: 'expired' };
    await handleStripeWebhook(signedWebhookRequest(stripeEvent(type, session)), deps);

    const order = await status(orderId, token);
    expect(order.status).toBe(expected);
    expect(order.payment_status).toBe('unpaid');
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);
  });

  it('acknowledges unrelated events and sessions from elsewhere', async () => {
    const other = await handleStripeWebhook(signedWebhookRequest(stripeEvent('customer.created', { id: 'cus_1' })), deps);
    expect(other.status).toBe(200);

    const foreign = stripeEvent('checkout.session.completed', {
      id: 'cs_foreign',
      object: 'checkout.session',
      payment_status: 'paid',
      status: 'complete',
      metadata: {},
      client_reference_id: null,
    });
    expect((await handleStripeWebhook(signedWebhookRequest(foreign), deps)).status).toBe(200);
  });

  it('asks Stripe to retry when the database is unavailable', async () => {
    const { sessionId } = await startCheckout();
    const event = stripeEvent('checkout.session.completed', payments.complete(sessionId));
    const failing = {
      ...deps,
      repo: { ...deps.repo, markPaidStripe: () => Promise.reject(new Error('connection reset')) },
    };
    expect((await handleStripeWebhook(signedWebhookRequest(event), failing)).status).toBe(500);
  });

  it('releases the hold if Stripe cannot create the session', async () => {
    payments.failNextCreate = true;
    const { response, body } = await placeOrder({ items: oneSign(), paymentChoice: 'online' });

    expect(response.status).toBe(502);
    expect(body.error).toBe('payment_start_failed');
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);
  });

  it('refuses online payment when Stripe is not configured', async () => {
    const noStripe = buildDeps(t, { payments: null });
    const response = await handleCreateOrder(
      postJson('/api/orders', orderRequest({ items: oneSign(), paymentChoice: 'online' })),
      noStripe,
    );
    expect(response.status).toBe(503);
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);
  });

  it('keeps Checkout Session expiry within Stripe limits', () => {
    expect(checkoutExpirySeconds(30)).toBe(31 * 60);
    expect(checkoutExpirySeconds(1440)).toBe(24 * 3600 - 60);
  });
});

describe('customer backs out of Stripe Checkout', () => {
  async function startCheckout() {
    const { body } = await placeOrder({ items: oneSign(), paymentChoice: 'online' });
    return { ...body, sessionId: [...payments.sessions.keys()].at(-1)! };
  }

  it('expires the session and releases the sign immediately', async () => {
    const { orderId, token, sessionId } = await startCheckout();
    const response = await handleCheckoutCancel(postJson('/api/checkout-cancel', { orderId, token }), deps);

    expect(response.status).toBe(200);
    expect(((await response.json()) as { order: CustomerOrder }).order.status).toBe('canceled');
    expect(payments.expired).toEqual([sessionId]);
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);
  });

  it('does not release if the customer actually completed payment', async () => {
    const { orderId, token, sessionId } = await startCheckout();
    payments.complete(sessionId);

    const response = await handleCheckoutCancel(postJson('/api/checkout-cancel', { orderId, token }), deps);
    expect(((await response.json()) as { order: CustomerOrder }).order.status).toBe('checkout_pending');
    expect((await t.getSign(sign.id)).quantity_available).toBe(0);
  });

  it('requires the order token', async () => {
    const { orderId } = await startCheckout();
    const response = await handleCheckoutCancel(
      postJson('/api/checkout-cancel', { orderId, token: 'not-the-right-token-xxxxxxxx' }),
      deps,
    );
    expect(response.status).toBe(404);
    expect((await t.getSign(sign.id)).quantity_available).toBe(0);
  });
});

describe('order status lookup', () => {
  it('returns 404 for a wrong token without revealing the order exists', async () => {
    const { body } = await placeOrder({ items: oneSign() });
    const response = await handleOrderStatus(
      new Request(`https://shop.test/api/order-status?id=${body.orderId}&t=wrong-token-xxxxxxxxxxxx`),
      deps,
    );
    expect(response.status).toBe(404);
  });
});

describe('scheduled reconciliation', () => {
  async function staleCheckout() {
    const { body } = await placeOrder({ items: oneSign(), paymentChoice: 'online' });
    await t.db.query(`update public.orders set hold_expires_at = now() - interval '10 minutes' where id = $1`, [
      body.orderId,
    ]);
    return { ...body, sessionId: [...payments.sessions.keys()].at(-1)! };
  }

  it('records a payment whose webhook never arrived', async () => {
    const { orderId, token, sessionId } = await staleCheckout();
    payments.complete(sessionId);

    const summary = await runReconciliation(deps);

    expect(summary).toMatchObject({ checked: 1, paid: 1, released: 0, errors: 0 });
    expect((await status(orderId, token)).payment_status).toBe('paid');
    expect(deps.notify.sent.some((n) => n.kind === 'paymentReceived')).toBe(true);
  });

  it('expires an abandoned session at Stripe before releasing the sign', async () => {
    const { orderId, token, sessionId } = await staleCheckout();

    const summary = await runReconciliation(deps);

    expect(summary).toMatchObject({ checked: 1, released: 1 });
    expect(payments.expired).toEqual([sessionId]);
    expect((await status(orderId, token)).status).toBe('expired');
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);
  });

  it('leaves pay-later requests alone by default', async () => {
    const { body } = await placeOrder({ items: oneSign() });
    await t.db.query(`update public.orders set created_at = now() - interval '30 days' where id = $1`, [body.orderId]);

    const summary = await runReconciliation(deps);

    expect(summary.requestsReleased).toBe(0);
    expect((await status(body.orderId, body.token)).status).toBe('requested');
  });

  it('auto-releases old unconfirmed requests only when configured', async () => {
    const configured = buildDeps(t, { payments, config: { requestAutoReleaseHours: 48 } });
    const { body } = await placeOrder({ items: oneSign() });
    await t.db.query(`update public.orders set created_at = now() - interval '3 days' where id = $1`, [body.orderId]);

    const summary = await runReconciliation(configured);

    expect(summary.requestsReleased).toBe(1);
    expect(configured.notify.sent).toEqual([{ kind: 'requestAutoReleased', orderId: body.orderId }]);
    expect((await t.getSign(sign.id)).quantity_available).toBe(1);
  });
});
