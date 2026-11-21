// Public catalog reads straight from Supabase's REST API with the public anon key.
// RLS only lets anonymous visitors see listed signs. Using fetch here (instead of
// the Supabase JS client) keeps the shopper-facing bundle small.

import type { Sign } from '../../shared/types';
import { PHOTO_BUCKET, SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';

export type PublicSign = Pick<
  Sign,
  'id' | 'name' | 'description' | 'price_cents' | 'quantity_available' | 'image_paths'
>;

const COLUMNS = 'id,name,description,price_cents,quantity_available,image_paths';

export class CatalogError extends Error {}

async function query(params: URLSearchParams, signal?: AbortSignal): Promise<PublicSign[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new CatalogError('The shop is not set up yet.');
  }
  params.set('select', COLUMNS);
  params.set('is_listed', 'eq.true');
  // Legacy anon keys are JWTs and go in both headers; newer publishable keys
  // (sb_publishable_...) are not JWTs and belong only in the apikey header.
  const headers: Record<string, string> = { apikey: SUPABASE_ANON_KEY, Accept: 'application/json' };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;

  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/signs?${params}`, { headers, signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new CatalogError("Couldn't reach the shop. Check your connection and try again.");
  }
  if (!response.ok) throw new CatalogError("Couldn't load signs right now. Please try again.");
  return (await response.json()) as PublicSign[];
}

/** Signs that are listed and in stock, newest first. */
export function fetchAvailableSigns(signal?: AbortSignal): Promise<PublicSign[]> {
  return query(new URLSearchParams({ quantity_available: 'gt.0', order: 'created_at.desc' }), signal);
}

export async function fetchSign(id: string, signal?: AbortSignal): Promise<PublicSign | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await query(new URLSearchParams({ id: `eq.${id}` }), signal);
  return rows[0] ?? null;
}

/** Current data for the signs in a cart (including sold-out ones, so we can say so). */
export function fetchSignsByIds(ids: string[], signal?: AbortSignal): Promise<PublicSign[]> {
  const safe = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (safe.length === 0) return Promise.resolve([]);
  return query(new URLSearchParams({ id: `in.(${safe.join(',')})` }), signal);
}

export function photoUrl(path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${encoded}`;
}
