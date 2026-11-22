import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCustomRequestRepo, type CustomRequestRepo } from '../../server/customRequests';
import { DbError } from '../../server/db';
import { createTestDb, type TestDb } from '../helpers/testDb';

let t: TestDb;
let repo: CustomRequestRepo;
let adminId: string;
let userId: string;

const input = (overrides: Partial<Parameters<CustomRequestRepo['create']>[0]> = {}) => ({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: null,
  description: 'A cedar sign that says "The Lovelace Family", about 3 feet wide.',
  clientKey: 'client-a',
  ...overrides,
});

beforeEach(async () => {
  t = await createTestDb();
  repo = createCustomRequestRepo(t.rpc);
  adminId = await t.createUser('owner@example.com', { admin: true });
  userId = await t.createUser('someone@example.com');
});

afterEach(async () => {
  await t.close();
});

async function dbError(promise: Promise<unknown>): Promise<DbError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DbError);
  return error as DbError;
}

describe('creating custom requests', () => {
  it('stores a request with a friendly number', async () => {
    const request = await repo.create(input({ email: '  ADA@Example.com ' }));
    expect(request).toMatchObject({ request_number: 101, status: 'new', customer_email: 'ada@example.com', photo_paths: [] });
  });

  it('requires contact details and a real description', async () => {
    expect((await dbError(repo.create(input({ email: null, phone: null })))).code).toBe('23514');
    expect((await dbError(repo.create(input({ description: 'sign' })))).code).toBe('23514');
  });

  it('rate-limits each visitor to 5 requests an hour', async () => {
    for (let i = 0; i < 5; i += 1) await repo.create(input());
    expect((await dbError(repo.create(input()))).message).toBe('RATE_LIMITED');
    await expect(repo.create(input({ clientKey: 'client-b' }))).resolves.toBeTruthy();
  });

  it('caps total submissions at 50 a day', async () => {
    await t.db.query(
      `insert into public.custom_requests (customer_name, customer_email, description, client_key)
       select 'Spam', 'x@example.com', 'Lorem ipsum dolor sit amet', 'k' || g from generate_series(1, 50) g`,
    );
    expect((await dbError(repo.create(input({ clientKey: 'fresh' })))).message).toBe('RATE_LIMITED');
  });

  it('attaches photos once, up to 4', async () => {
    const request = await repo.create(input());
    await repo.attachPhotos(request.id, ['a/1.jpg', 'a/2.jpg']);
    expect((await dbError(repo.attachPhotos(request.id, ['a/3.jpg']))).message).toBe('INVALID_STATE');

    const other = await repo.create(input());
    expect((await dbError(repo.attachPhotos(other.id, ['1', '2', '3', '4', '5']))).code).toBe('23514');
  });

  it('can discard a request whose upload failed', async () => {
    const request = await repo.create(input());
    await repo.discard(request.id);
    const rows = await t.db.query('select 1 from public.custom_requests');
    expect(rows.rows).toEqual([]);
  });
});

describe('privacy and permissions', () => {
  let requestId: string;
  beforeEach(async () => {
    requestId = (await repo.create(input())).id;
  });

  it('visitors cannot read, write, or call the functions', async () => {
    await expect(t.as('anon', null, (tx) => tx.query('select * from public.custom_requests'))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      t.as('anon', null, (tx) =>
        tx.query(`select public.create_custom_request('x', 'x@example.com', null, 'long enough text', null)`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('signed-in users who are not admins see and change nothing', async () => {
    const read = await t.as('authenticated', userId, (tx) => tx.query('select * from public.custom_requests'));
    expect(read.rows).toEqual([]);
    const updated = await t.as('authenticated', userId, (tx) =>
      tx.query(`update public.custom_requests set status = 'declined' returning id`),
    );
    expect(updated.rows).toEqual([]);
    const deleted = await t.as('authenticated', userId, (tx) => tx.query('delete from public.custom_requests returning id'));
    expect(deleted.rows).toEqual([]);
  });

  it('admins can read, change the status, and delete', async () => {
    const read = await t.as('authenticated', adminId, (tx) =>
      tx.query<{ description: string }>('select description from public.custom_requests'),
    );
    expect(read.rows).toHaveLength(1);

    const updated = await t.as('authenticated', adminId, (tx) =>
      tx.query<{ status: string }>(`update public.custom_requests set status = 'in_progress' where id = $1 returning status`, [
        requestId,
      ]),
    );
    expect(updated.rows).toEqual([{ status: 'in_progress' }]);

    const deleted = await t.as('authenticated', adminId, (tx) =>
      tx.query('delete from public.custom_requests where id = $1 returning id', [requestId]),
    );
    expect(deleted.rows).toHaveLength(1);
  });

  it("admins cannot rewrite a customer's description or contact details", async () => {
    await expect(
      t.as('authenticated', adminId, (tx) => tx.query(`update public.custom_requests set description = 'changed'`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('photos are private: only the server uploads, only admins can view', async () => {
    const insertPhoto = `insert into storage.objects (bucket_id, name) values ('custom-request-photos', 'x/1.jpg')`;
    await expect(t.as('anon', null, (tx) => tx.query(insertPhoto))).rejects.toThrow(/row-level security/);
    await expect(t.as('authenticated', adminId, (tx) => tx.query(insertPhoto))).rejects.toThrow(/row-level security/);

    await t.db.query(insertPhoto); // as the server would
    const asUser = await t.as('authenticated', userId, (tx) =>
      tx.query(`select name from storage.objects where bucket_id = 'custom-request-photos'`),
    );
    const asAdmin = await t.as('authenticated', adminId, (tx) =>
      tx.query(`select name from storage.objects where bucket_id = 'custom-request-photos'`),
    );
    expect(asUser.rows).toEqual([]);
    expect(asAdmin.rows).toEqual([{ name: 'x/1.jpg' }]);

    const bucket = await t.db.query<{ public: boolean }>(`select public from storage.buckets where id = 'custom-request-photos'`);
    expect(bucket.rows[0].public).toBe(false);
  });
});
