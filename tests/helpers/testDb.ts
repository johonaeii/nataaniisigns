// In-process Postgres (PGlite) loaded with the real Supabase migrations, so the
// SQL functions, constraints, grants, and RLS policies are tested for real.
// Minimal stand-ins for Supabase's roles, auth schema, and storage schema are
// created first.
//
// Supabase projects differ in default privileges: older projects automatically
// grant every new public table to anon/authenticated/service_role ("legacy");
// newer ones grant nothing ("strict"). The migrations must work under both, so
// tests default to strict and tests/db/grants.test.ts compares the two.

import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DbError, type RpcClient } from '../../server/db';
import type { Sign } from '../../shared/types';

const SUPABASE_STUBS = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
`;

function migrationSql(): string {
  const dir = join(import.meta.dirname, '../../supabase/migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

const LEGACY_DEFAULT_PRIVILEGES = `
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type DefaultPrivileges = 'strict' | 'legacy';

const templates = new Map<DefaultPrivileges, Promise<PGlite>>();

/** Build the schema once per test file and mode, then clone it for each test (fast, isolated). */
async function getTemplate(mode: DefaultPrivileges): Promise<PGlite> {
  let template = templates.get(mode);
  if (!template) {
    template = (async () => {
      const db = await PGlite.create();
      await db.exec(SUPABASE_STUBS);
      if (mode === 'legacy') await db.exec(LEGACY_DEFAULT_PRIVILEGES);
      await db.exec(migrationSql());
      return db;
    })();
    templates.set(mode, template);
  }
  return template;
}

export type Role = 'anon' | 'authenticated' | 'service_role';

export interface TestDb {
  db: PGlite;
  /** Calls functions as the service role, like the Netlify functions do through Supabase. */
  rpc: RpcClient;
  /** Run queries as a Supabase role, optionally with a JWT subject (auth.uid()). */
  as<T>(role: Role, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T>;
  insertSign(fields?: Partial<Sign>): Promise<Sign>;
  getSign(id: string): Promise<Sign>;
  createUser(email: string, options?: { admin?: boolean }): Promise<string>;
  close(): Promise<void>;
}

export async function createTestDb(options: { defaults?: DefaultPrivileges } = {}): Promise<TestDb> {
  const db = (await (await getTemplate(options.defaults ?? 'strict')).clone()) as PGlite;

  const as: TestDb['as'] = (role, userId, fn) =>
    db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      if (userId) {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      }
      return fn(tx);
    });

  const rpc: RpcClient = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const keys = Object.keys(args);
    const values = keys.map((key) => {
      const value = args[key];
      if (value === undefined || value === null) return null;
      // Arrays of strings are Postgres arrays (e.g. text[]); other objects are jsonb.
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value;
      return typeof value === 'object' ? JSON.stringify(value) : value;
    });
    const sql = `select public.${fn}(${keys.map((key, i) => `${key} => $${i + 1}`).join(', ')}) as result`;
    try {
      return await as('service_role', null, async (tx) => {
        const result = await tx.query<{ result: T }>(sql, values);
        return result.rows[0].result;
      });
    } catch (error) {
      const e = error as { message: string; code?: string; detail?: string };
      throw new DbError(e.message, e.code, e.detail);
    }
  };

  let signCounter = 0;

  return {
    db,
    rpc,
    as,
    async insertSign(fields = {}) {
      signCounter += 1;
      const result = await db.query<Sign>(
        `insert into public.signs (name, description, price_cents, quantity_available, is_listed, image_paths)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [
          fields.name ?? `Sign ${signCounter}`,
          fields.description ?? '',
          fields.price_cents ?? 2500,
          fields.quantity_available ?? 1,
          fields.is_listed ?? true,
          fields.image_paths ?? [],
        ],
      );
      return result.rows[0];
    },
    async getSign(id) {
      const result = await db.query<Sign>('select * from public.signs where id = $1', [id]);
      return result.rows[0];
    },
    async createUser(email, options = {}) {
      const result = await db.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
      const id = result.rows[0].id;
      if (options.admin) await db.query('insert into public.admins (user_id) values ($1)', [id]);
      return id;
    },
    close: () => db.close(),
  };
}
