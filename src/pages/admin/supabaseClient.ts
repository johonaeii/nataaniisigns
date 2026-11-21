// Browser Supabase client for the admin area. Uses only the public anon key;
// what a signed-in user can do is decided by RLS policies in the database.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../config';

export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sign-shop-admin-auth' },
      })
    : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

export const ADMIN_ORDER_COLUMNS =
  'id, order_number, status, status_reason, payment_choice, payment_status, paid_via, paid_at, ' +
  'customer_name, customer_email, customer_phone, pickup_method, customer_notes, subtotal_cents, currency, ' +
  'hold_expires_at, stripe_checkout_session_id, amount_paid_cents, attention_reason, created_at, updated_at, ' +
  'confirmed_at, canceled_at, completed_at, order_items(sign_id, sign_name, unit_price_cents, quantity)';
