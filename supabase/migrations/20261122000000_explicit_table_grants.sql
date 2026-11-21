-- =============================================================================
-- Explicit table privileges
-- =============================================================================
-- The first migration assumed Supabase's older behavior of automatically granting
-- every new table in "public" to anon, authenticated, and service_role, and only
-- narrowed those grants. Newer Supabase projects grant nothing by default, which
-- shows up as "permission denied for table ...".
--
-- This grants exactly what the app needs, so the end result is the same on old
-- and new projects. Row level security (first migration) still decides which
-- rows each role can see or change. Safe to run more than once.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- Shoppers (anon) and signed-in users can read signs. RLS limits them to listed
-- signs (admins see all). Only admins can add/edit/delete signs (RLS).
grant select on public.signs to anon, authenticated;
grant insert, update, delete on public.signs to authenticated;

-- The admin pages read orders directly. RLS allows admins only. Nobody writes
-- orders from the browser; that happens only through the server functions.
grant select on public.orders, public.order_items, public.order_events, public.admins to authenticated;

-- The Netlify functions use the service role for all order operations.
grant select, insert, update, delete
  on public.signs, public.orders, public.order_items, public.order_events, public.admins
  to service_role;
grant usage, select on sequence public.orders_order_number_seq, public.order_events_id_seq to service_role;
