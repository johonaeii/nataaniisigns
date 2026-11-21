import type { ApiErrorBody } from '../shared/types';

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function apiError(
  status: number,
  error: string,
  message: string,
  extra: Omit<ApiErrorBody, 'error' | 'message'> = {},
): Response {
  return json(status, { error, message, ...extra } satisfies ApiErrorBody);
}

export function methodNotAllowed(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: 'method_not_allowed', message: 'Method not allowed.' }), {
    status: 405,
    headers: { ...BASE_HEADERS, Allow: allowed.join(', ') },
  });
}

const MAX_BODY_BYTES = 32 * 1024;

export async function readJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false };
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export const GENERIC_ERROR_MESSAGE = 'Something went wrong on our end. Please try again in a moment.';
