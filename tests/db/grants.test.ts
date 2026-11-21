// The migrations must produce the same privileges whether the Supabase project
// auto-grants new tables (older projects) or grants nothing (newer projects).

import { describe, expect, it } from 'vitest';
import { createTestDb, type DefaultPrivileges } from '../helpers/testDb';

async function tableGrants(defaults: DefaultPrivileges) {
  const t = await createTestDb({ defaults });
  try {
    const result = await t.db.query<{ grantee: string; table_name: string; privilege_type: string }>(
      `select grantee, table_name, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
        order by 1, 2, 3`,
    );
    const grouped: Record<string, string[]> = {};
    for (const row of result.rows) {
      (grouped[`${row.grantee}.${row.table_name}`] ??= []).push(row.privilege_type);
    }
    return grouped;
  } finally {
    await t.close();
  }
}

const CRUD = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];

describe('table privileges', () => {
  it.each<DefaultPrivileges>(['strict', 'legacy'])('are exactly what the app needs (%s defaults)', async (mode) => {
    const grants = await tableGrants(mode);
    const browserRoles = Object.fromEntries(
      Object.entries(grants).filter(([key]) => !key.startsWith('service_role.')),
    );

    expect(browserRoles).toEqual({
      'anon.signs': ['SELECT'],
      'authenticated.admins': ['SELECT'],
      'authenticated.order_events': ['SELECT'],
      'authenticated.order_items': ['SELECT'],
      'authenticated.orders': ['SELECT'],
      'authenticated.signs': CRUD,
    });

    for (const table of ['signs', 'orders', 'order_items', 'order_events', 'admins']) {
      expect(grants[`service_role.${table}`]).toEqual(expect.arrayContaining(CRUD));
    }
  });
});
