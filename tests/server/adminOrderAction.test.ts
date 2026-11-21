import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleAdminOrderAction } from '../../server/handlers/adminOrderAction';
import type { PrivateOrder } from '../../shared/types';
import { buildDeps, postJson, type TestDeps } from '../helpers/appDeps';
import { createInput } from '../helpers/fixtures';
import { createTestDb, type TestDb } from '../helpers/testDb';

let t: TestDb;
let deps: TestDeps;
let orderId: string;
let signId: string;

beforeEach(async () => {
  t = await createTestDb();
  const adminId = await t.createUser('owner@example.com', { admin: true });
  deps = buildDeps(t, { adminId });
  signId = (await t.insertSign()).id;
  orderId = (await deps.repo.createOrder(createInput([signId]))).id;
});

afterEach(async () => {
  await t.close();
});

const act = (action: string, auth?: string) =>
  handleAdminOrderAction(
    postJson('/api/admin-order-action', { orderId, action }, auth ? { authorization: auth } : {}),
    deps,
  );

describe('admin order actions', () => {
  it('requires a signed-in admin', async () => {
    expect((await act('cancel')).status).toBe(401);
    expect((await act('cancel', 'Bearer user-token')).status).toBe(403);
    expect((await deps.repo.getOrder(orderId))!.status).toBe('requested');
    expect((await t.getSign(signId)).quantity_available).toBe(0);
  });

  it('confirms a request and emails the customer', async () => {
    const response = await act('confirm', 'Bearer admin-token');
    expect(response.status).toBe(200);
    const { order } = (await response.json()) as { order: PrivateOrder };
    expect(order.status).toBe('confirmed');
    expect(deps.notify.sent).toEqual([{ kind: 'ownerAction', orderId, detail: 'confirm' }]);
  });

  it('records an in-person payment', async () => {
    const response = await act('mark_paid', 'Bearer admin-token');
    const { order } = (await response.json()) as { order: PrivateOrder };
    expect(order.payment_status).toBe('paid');
    expect(order.paid_via).toBe('in_person');
  });

  it('cancels and releases the signs', async () => {
    expect((await act('cancel', 'Bearer admin-token')).status).toBe(200);
    expect((await t.getSign(signId)).quantity_available).toBe(1);
  });

  it('returns 409 for a transition that is no longer allowed', async () => {
    await act('cancel', 'Bearer admin-token');
    const again = await act('confirm', 'Bearer admin-token');
    expect(again.status).toBe(409);
  });

  it('validates the action', async () => {
    expect((await act('delete_everything', 'Bearer admin-token')).status).toBe(400);
  });
});
