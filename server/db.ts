import type { SupabaseClient } from '@supabase/supabase-js';

/** A database error with the Postgres SQLSTATE code and detail, when available. */
export class DbError extends Error {
  readonly code: string | undefined;
  readonly detail: string | undefined;

  constructor(message: string, code?: string, detail?: string) {
    super(message);
    this.name = 'DbError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Calls a Postgres function by name with named arguments and returns its result.
 * Production uses Supabase (PostgREST); tests use an in-process Postgres.
 */
export type RpcClient = <T>(fn: string, args: Record<string, unknown>) => Promise<T>;

export function supabaseRpc(client: SupabaseClient): RpcClient {
  return async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new DbError(error.message, error.code, error.details ?? undefined);
    return data as T;
  };
}

export function isDbError(error: unknown, message?: string): error is DbError {
  return error instanceof DbError && (message === undefined || error.message === message);
}
