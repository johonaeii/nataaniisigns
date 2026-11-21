// Visitors must not be able to edit inventory, read other customers' data, or
// call the privileged order functions. These run as the real Supabase roles.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOrderRepo } from '../../server/orders';
import { createInput } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let t: TestDb;
let adminId: string;
let userId: string;
let orderId: string;
let listedId: string;
let hiddenId: string;

beforeEach(async () => {
  t = await createTestDb();
  adminId = await t.createUser('owner@example.com', { admin: true });
  userId = await t.createUser('someone@example.com');
  listedId = (await t.insertSign({ name: 'Listed', quantity_available: 2 })).id;
  hiddenId = (await t.insertSign({ name: 'Hidden', is_listed: false })).id;
  orderId = (await createOrderRepo(t.rpc).createOrder(createInput([listedId]))).id;
});

afterEach(async () => {
  await t.close();
});

const PRIVATE_TABLES = ['orders', 'order_items', 'order_events', 'admins'] as const;

describe('anonymous visitors', () => {
  it('see only listed signs', async () => {
    const rows = await t.as('anon', null, (tx) => tx.query<{ name: string }>('select name from public.signs'));
    expect(rows.rows.map((r) => r.name)).toEqual(['Listed']);
  });

  it('cannot add, edit, or delete signs', async () => {
    await expect(
      t.as('anon', null, (tx) => tx.query(`insert into public.signs (name, price_cents) values ('x', 100)`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      t.as('anon', null, (tx) => tx.query('update public.signs set price_cents = 50 where id = $1', [listedId])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      t.as('anon', null, (tx) => tx.query('delete from public.signs where id = $1', [listedId])),
    ).rejects.toThrow(/permission denied/);
  });

  it.each(PRIVATE_TABLES)('cannot read %s', async (table) => {
    await expect(t.as('anon', null, (tx) => tx.query(`select * from public.${table}`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('cannot call privileged order functions', async () => {
    const calls = [
      `select public.create_order('[]'::jsonb, 'x', 'x@example.com', null, 'market', '', 'pay_later', repeat('a', 64))`,
      `select public.mark_order_paid_stripe('${orderId}', 'cs_x', 'pi_x', 100, 'usd')`,
      `select public.release_checkout('${orderId}', null, 'canceled', 'customer', 'x')`,
      `select public.admin_update_order('${orderId}', 'cancel', '${adminId}')`,
      `select public.get_order('${orderId}')`,
      `select public.get_order_for_customer('${orderId}', repeat('a', 64))`,
      `select public.release_stale_requests(1)`,
      `select public.order_json('${orderId}', true)`,
    ];
    for (const sql of calls) {
      await expect(t.as('anon', null, (tx) => tx.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });

  it('cannot upload photos', async () => {
    await expect(
      t.as('anon', null, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name) values ('sign-photos', 'signs/x.webp')`),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('signed-in users who are not admins', () => {
  it('cannot read orders or order items', async () => {
    const orders = await t.as('authenticated', userId, (tx) => tx.query('select * from public.orders'));
    const items = await t.as('authenticated', userId, (tx) => tx.query('select * from public.order_items'));
    expect(orders.rows).toEqual([]);
    expect(items.rows).toEqual([]);
  });

  it('cannot see hidden signs or change any sign', async () => {
    const visible = await t.as('authenticated', userId, (tx) => tx.query('select id from public.signs'));
    expect(visible.rows).toEqual([{ id: listedId }]);

    const updated = await t.as('authenticated', userId, (tx) =>
      tx.query('update public.signs set price_cents = 50 where id = $1 returning id', [listedId]),
    );
    expect(updated.rows).toEqual([]);

    await expect(
      t.as('authenticated', userId, (tx) => tx.query(`insert into public.signs (name, price_cents) values ('x', 100)`)),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot make themselves an admin', async () => {
    await expect(
      t.as('authenticated', userId, (tx) => tx.query('insert into public.admins (user_id) values ($1)', [userId])),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot write orders directly', async () => {
    await expect(
      t.as('authenticated', userId, (tx) =>
        tx.query(`update public.orders set payment_status = 'paid' where id = $1`, [orderId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot call privileged order functions', async () => {
    await expect(
      t.as('authenticated', userId, (tx) =>
        tx.query(`select public.admin_update_order($1, 'cancel', $2)`, [orderId, adminId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('is_admin() is false', async () => {
    const result = await t.as('authenticated', userId, (tx) => tx.query<{ is_admin: boolean }>('select public.is_admin()'));
    expect(result.rows[0].is_admin).toBe(false);
  });
});

describe('admins', () => {
  it('can read orders with contact details', async () => {
    const result = await t.as('authenticated', adminId, (tx) =>
      tx.query<{ customer_email: string }>('select customer_email from public.orders'),
    );
    expect(result.rows).toEqual([{ customer_email: 'ada@example.com' }]);
  });

  it('can see hidden signs and edit inventory', async () => {
    const visible = await t.as('authenticated', adminId, (tx) => tx.query('select id from public.signs'));
    expect(visible.rows).toHaveLength(2);

    const updated = await t.as('authenticated', adminId, (tx) =>
      tx.query<{ version: number; price_cents: number }>(
        'update public.signs set price_cents = 9900 where id = $1 returning version, price_cents',
        [hiddenId],
      ),
    );
    expect(updated.rows[0]).toEqual({ version: 2, price_cents: 9900 });
  });

  it('still cannot write orders directly (only through the server)', async () => {
    await expect(
      t.as('authenticated', adminId, (tx) =>
        tx.query(`update public.orders set payment_status = 'paid' where id = $1`, [orderId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('can upload photos to the sign-photos bucket only', async () => {
    await t.as('authenticated', adminId, (tx) =>
      tx.query(`insert into storage.objects (bucket_id, name) values ('sign-photos', 'signs/x.webp')`),
    );
    await t.db.query(`insert into storage.buckets (id, name) values ('other', 'other')`);
    await expect(
      t.as('authenticated', adminId, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name) values ('other', 'x.webp')`),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('sign edits from a stale form are detectable by version', async () => {
    const before = await t.getSign(listedId);
    // A customer reserves the sign after the admin opened the edit form.
    await createOrderRepo(t.rpc).createOrder(createInput([listedId], {}, 'another-token-xxxxxxxxxxxxxxx'));
    const staleUpdate = await t.as('authenticated', adminId, (tx) =>
      tx.query('update public.signs set quantity_available = 2 where id = $1 and version = $2 returning id', [
        listedId,
        before.version,
      ]),
    );
    expect(staleUpdate.rows).toEqual([]);
    expect((await t.getSign(listedId)).quantity_available).toBe(0);
  });
});

describe('database constraints on sign data', () => {
  it.each([
    ['empty name', `insert into public.signs (name, price_cents) values ('   ', 1000)`],
    ['price below Stripe minimum', `insert into public.signs (name, price_cents) values ('x', 10)`],
    ['negative stock', `insert into public.signs (name, price_cents, quantity_available) values ('x', 1000, -1)`],
    ['too many photos', `insert into public.signs (name, price_cents, image_paths) values ('x', 1000, array['1','2','3','4','5','6','7','8','9'])`],
  ])('rejects %s', async (_label, sql) => {
    await expect(t.db.query(sql)).rejects.toThrow(/check constraint/);
  });

  it('will not delete a sign that is part of an order', async () => {
    await expect(t.db.query('delete from public.signs where id = $1', [listedId])).rejects.toThrow(/foreign key/);
  });
});
