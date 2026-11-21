-- =============================================================================
-- Sign shop: inventory, orders/reservations, admin access, and photo storage.
-- =============================================================================
--
-- Three separate pieces of state, deliberately kept apart:
--
--   signs.quantity_available   INVENTORY. How many more units can be ordered.
--                              Taken atomically when an order holds a sign and
--                              given back only when that hold is released.
--   orders.status              RESERVATION / REQUEST lifecycle (enum below).
--   orders.payment_status      MONEY. 'unpaid' or 'paid', nothing else.
--
-- Every order state change happens inside one of the functions in this file,
-- and each call is a single transaction. Those functions can be executed only
-- by the service role (the Netlify functions). Browsers cannot call them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------

create type public.order_status as enum (
  'checkout_pending', -- Online checkout started. Signs are held until Stripe reports the
                      -- Checkout Session as paid (-> confirmed) or expired (-> expired).
  'requested',        -- Pay-later request submitted. Signs are held for the customer.
  'confirmed',        -- Owner confirmed the request, or the online payment succeeded.
                      -- Signs are still held, waiting for pickup.
  'completed',        -- Picked up. Done.
  'canceled',         -- Canceled by the owner or the customer. Signs were released.
  'expired'           -- Online checkout was abandoned or failed. Signs were released.
);

create type public.payment_status as enum ('unpaid', 'paid');
create type public.payment_choice as enum ('online', 'pay_later');
create type public.paid_via as enum ('stripe', 'in_person');
create type public.pickup_method as enum ('market', 'local');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.signs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  -- Stripe's minimum charge in USD is $0.50.
  price_cents integer not null check (price_cents between 50 and 10000000),
  quantity_available integer not null default 1 check (quantity_available between 0 and 100000),
  is_listed boolean not null default true,
  -- Object paths inside the "sign-photos" storage bucket. The first one is the main photo.
  image_paths text[] not null default '{}' check (cardinality(image_paths) <= 8),
  -- Bumped on every update; the admin UI uses it for optimistic concurrency so an
  -- edit made from a stale form cannot overwrite a reservation that happened since.
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index signs_listed_idx on public.signs (is_listed, created_at desc);

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity (start with 1001) unique,
  -- SHA-256 (hex) of the secret token in the customer's order link. The raw token is never stored.
  access_token_hash text not null check (access_token_hash ~ '^[0-9a-f]{64}$'),

  status public.order_status not null,
  status_reason text,
  payment_choice public.payment_choice not null,
  payment_status public.payment_status not null default 'unpaid',
  paid_via public.paid_via,
  paid_at timestamptz,

  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 100),
  customer_email text check (
    customer_email is null
    or (char_length(customer_email) <= 254 and customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  customer_phone text check (
    customer_phone is null
    or (customer_phone ~ '^[0-9+()\-. ]{7,25}$'
        and char_length(regexp_replace(customer_phone, '[^0-9]', '', 'g')) >= 7)
  ),
  pickup_method public.pickup_method not null,
  customer_notes text not null default '' check (char_length(customer_notes) <= 1000),

  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  currency text not null default 'usd',

  -- For checkout_pending orders: when the hold ends (matches the Stripe session expiry).
  hold_expires_at timestamptz,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  amount_paid_cents integer,

  -- Set when something needs the owner's manual review (for example, a payment that
  -- arrived after the signs were already released). Shown prominently in the admin area.
  attention_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  canceled_at timestamptz,
  completed_at timestamptz,

  constraint orders_contact_required check (customer_email is not null or customer_phone is not null),
  constraint orders_paid_fields check (
    (payment_status = 'paid') = (paid_at is not null and paid_via is not null)
  )
);

create index orders_status_created_idx on public.orders (status, created_at desc);
create index orders_created_idx on public.orders (created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  -- RESTRICT: a sign that appears in an order cannot be deleted; hide it instead.
  sign_id uuid not null references public.signs (id) on delete restrict,
  -- Snapshot of name and price at order time, so later edits don't rewrite history.
  sign_name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity between 1 and 99),
  unique (order_id, sign_id)
);

create index order_items_sign_idx on public.order_items (sign_id);

-- Audit trail of order changes (who did what, when).
create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  event text not null,
  actor text not null, -- 'customer' | 'stripe' | 'admin' | 'system'
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, created_at);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create function public.signs_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger signs_before_update
before update on public.signs
for each row execute function public.signs_before_update();

create function public.orders_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_before_update
before update on public.orders
for each row execute function public.orders_before_update();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- True when the current authenticated user is listed in public.admins.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

-- JSON representation of an order. Without p_include_private, contact details,
-- notes, and payment references are left out (used for the customer status page).
create function public.order_json(p_order_id uuid, p_include_private boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select
    jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'status', o.status,
      'status_reason', o.status_reason,
      'payment_choice', o.payment_choice,
      'payment_status', o.payment_status,
      'paid_via', o.paid_via,
      'paid_at', o.paid_at,
      'pickup_method', o.pickup_method,
      'subtotal_cents', o.subtotal_cents,
      'currency', o.currency,
      'hold_expires_at', o.hold_expires_at,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'customer_first_name', split_part(btrim(o.customer_name), ' ', 1),
      'has_email', o.customer_email is not null,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'sign_id', i.sign_id,
            'sign_name', i.sign_name,
            'unit_price_cents', i.unit_price_cents,
            'quantity', i.quantity,
            'image_path', s.image_paths[1]
          )
          order by i.sign_name
        )
        from public.order_items i
        left join public.signs s on s.id = i.sign_id
        where i.order_id = o.id
      ), '[]'::jsonb)
    )
    || case
      when p_include_private then jsonb_build_object(
        'customer_name', o.customer_name,
        'customer_email', o.customer_email,
        'customer_phone', o.customer_phone,
        'customer_notes', o.customer_notes,
        'stripe_checkout_session_id', o.stripe_checkout_session_id,
        'stripe_payment_intent_id', o.stripe_payment_intent_id,
        'amount_paid_cents', o.amount_paid_cents,
        'attention_reason', o.attention_reason,
        'confirmed_at', o.confirmed_at,
        'canceled_at', o.canceled_at,
        'completed_at', o.completed_at
      )
      else '{}'::jsonb
    end
  from public.orders o
  where o.id = p_order_id;
$$;

-- Give back the stock an order was holding. Rows are locked in sign-id order,
-- the same order create_order uses, so concurrent calls cannot deadlock.
create function public.restore_order_stock(p_order_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
begin
  for v_item in
    select sign_id, quantity from public.order_items where order_id = p_order_id order by sign_id
  loop
    update public.signs
       set quantity_available = quantity_available + v_item.quantity
     where id = v_item.sign_id;
  end loop;
end;
$$;

create function public.log_order_event(p_order_id uuid, p_event text, p_actor text, p_detail jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.order_events (order_id, event, actor, detail)
  values (p_order_id, p_event, p_actor, coalesce(p_detail, '{}'::jsonb));
$$;

-- -----------------------------------------------------------------------------
-- Order operations (service role only)
-- -----------------------------------------------------------------------------

-- Create an order and hold its signs, all in one transaction.
--
-- For each sign, a single UPDATE decrements quantity_available only if enough
-- is available. Under concurrency, Postgres row locks make the second
-- transaction wait and then re-check the WHERE clause against the committed
-- row, so two customers can never both take the last unit. Any failure raises,
-- which rolls back the whole order (no partial holds). The CHECK constraint
-- quantity_available >= 0 is a final backstop.
--
-- Errors (SQLSTATE P0001, message): EMPTY_CART, TOO_MANY_ITEMS, INVALID_QUANTITY,
-- SIGN_UNAVAILABLE (detail = sign id), PRICE_CHANGED (detail = server subtotal).
create function public.create_order(
  p_items jsonb,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_pickup_method public.pickup_method,
  p_customer_notes text,
  p_payment_choice public.payment_choice,
  p_access_token_hash text,
  p_hold_minutes integer default 30,
  p_expected_subtotal_cents integer default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_item record;
  v_sign record;
  v_subtotal integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'EMPTY_CART';
  end if;
  if jsonb_array_length(p_items) > 25 then
    raise exception using errcode = 'P0001', message = 'TOO_MANY_ITEMS';
  end if;
  if p_hold_minutes is null or p_hold_minutes not between 1 and 1440 then
    raise exception using errcode = 'P0001', message = 'INVALID_HOLD';
  end if;

  insert into public.orders (
    access_token_hash, status, payment_choice, customer_name, customer_email,
    customer_phone, pickup_method, customer_notes, hold_expires_at
  )
  values (
    p_access_token_hash,
    case when p_payment_choice = 'online' then 'checkout_pending' else 'requested' end::public.order_status,
    p_payment_choice,
    btrim(p_customer_name),
    nullif(lower(btrim(coalesce(p_customer_email, ''))), ''),
    nullif(btrim(coalesce(p_customer_phone, '')), ''),
    p_pickup_method,
    btrim(coalesce(p_customer_notes, '')),
    case when p_payment_choice = 'online' then now() + make_interval(mins => p_hold_minutes) end
  )
  returning id into v_order_id;

  -- Merge duplicate lines and lock signs in a consistent order (by id) to avoid deadlocks.
  for v_item in
    select (e ->> 'sign_id')::uuid as sign_id, sum((e ->> 'quantity')::integer) as quantity
    from jsonb_array_elements(p_items) as e
    group by 1
    order by 1
  loop
    if v_item.quantity is null or v_item.quantity < 1 or v_item.quantity > 99 then
      raise exception using errcode = 'P0001', message = 'INVALID_QUANTITY';
    end if;

    update public.signs
       set quantity_available = quantity_available - v_item.quantity
     where id = v_item.sign_id
       and is_listed
       and quantity_available >= v_item.quantity
    returning id, name, price_cents into v_sign;

    if not found then
      raise exception using errcode = 'P0001', message = 'SIGN_UNAVAILABLE', detail = v_item.sign_id::text;
    end if;

    insert into public.order_items (order_id, sign_id, sign_name, unit_price_cents, quantity)
    values (v_order_id, v_sign.id, v_sign.name, v_sign.price_cents, v_item.quantity);

    v_subtotal := v_subtotal + v_sign.price_cents * v_item.quantity;
  end loop;

  if p_expected_subtotal_cents is not null and p_expected_subtotal_cents <> v_subtotal then
    raise exception using errcode = 'P0001', message = 'PRICE_CHANGED', detail = v_subtotal::text;
  end if;

  update public.orders set subtotal_cents = v_subtotal where id = v_order_id;

  perform public.log_order_event(
    v_order_id,
    case when p_payment_choice = 'online' then 'checkout_started' else 'request_submitted' end,
    'customer',
    jsonb_build_object('subtotal_cents', v_subtotal)
  );

  return public.order_json(v_order_id, true);
end;
$$;

-- Record the Stripe Checkout Session created for an online order.
create function public.set_checkout_session(
  p_order_id uuid,
  p_session_id text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  update public.orders
     set stripe_checkout_session_id = p_session_id,
         hold_expires_at = p_expires_at
   where id = p_order_id
     and status = 'checkout_pending'
     and stripe_checkout_session_id is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;

  return public.order_json(p_order_id, true);
end;
$$;

-- Record a payment that Stripe has confirmed. Called only from the verified
-- webhook and from the reconciliation job (which asks Stripe directly).
-- Never called with browser input. Idempotent: repeat calls change nothing.
--
-- If the hold had already been released (expired/canceled), it tries to take
-- the signs back. If they are gone, the payment is still recorded and the order
-- is flagged for the owner (refund needed). Nothing is ever oversold.
create function public.mark_order_paid_stripe(
  p_order_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_currency text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v public.orders;
  v_new_status public.order_status;
  v_attention text;
  v_item record;
begin
  select * into v from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  if v.payment_status = 'paid' then
    return jsonb_build_object('changed', false, 'order', public.order_json(v.id, true));
  end if;

  v_new_status := v.status;

  if v.payment_choice <> 'online' then
    v_attention := concat_ws(' ', v_attention,
      'Stripe reported a payment for a pay-later request.');
  end if;
  if v.stripe_checkout_session_id is not null and v.stripe_checkout_session_id <> p_session_id then
    v_attention := concat_ws(' ', v_attention,
      format('Payment came from an unexpected Checkout Session (%s).', p_session_id));
  end if;
  if p_amount_cents is distinct from v.subtotal_cents or lower(coalesce(p_currency, '')) <> v.currency then
    v_attention := concat_ws(' ', v_attention,
      format('Amount paid (%s %s) differs from the order total (%s %s).',
        coalesce(p_amount_cents::text, '?'), upper(coalesce(p_currency, '?')),
        v.subtotal_cents, upper(v.currency)));
  end if;

  if v.status = 'checkout_pending' then
    v_new_status := 'confirmed';
  elsif v.status in ('canceled', 'expired') then
    -- The hold was released before the payment arrived. Try to re-take the stock.
    begin
      for v_item in
        select sign_id, quantity from public.order_items where order_id = v.id order by sign_id
      loop
        update public.signs
           set quantity_available = quantity_available - v_item.quantity
         where id = v_item.sign_id and quantity_available >= v_item.quantity;
        if not found then
          raise exception using errcode = 'P0001', message = 'SIGN_UNAVAILABLE';
        end if;
      end loop;
      v_new_status := 'confirmed';
    exception
      when raise_exception then
        -- The block's partial updates are rolled back; status stays released.
        v_attention := concat_ws(' ', v_attention,
          'Paid after the hold was released, and at least one sign is no longer available. '
          || 'Refund the customer in Stripe or arrange a substitute.');
    end;
  end if;

  update public.orders
     set payment_status = 'paid',
         paid_via = 'stripe',
         paid_at = now(),
         stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id),
         stripe_payment_intent_id = p_payment_intent_id,
         amount_paid_cents = p_amount_cents,
         status = v_new_status,
         confirmed_at = case when v_new_status = 'confirmed' and v.status <> 'confirmed' then now() else confirmed_at end,
         hold_expires_at = null,
         attention_reason = nullif(concat_ws(' ', attention_reason, v_attention), '')
   where id = v.id;

  perform public.log_order_event(v.id, 'payment_received', 'stripe', jsonb_build_object(
    'session_id', p_session_id,
    'amount_cents', p_amount_cents,
    'previous_status', v.status,
    'attention', v_attention
  ));

  return jsonb_build_object(
    'changed', true,
    'attention', v_attention is not null,
    'order', public.order_json(v.id, true)
  );
end;
$$;

-- Release the hold of an unpaid online checkout: the session expired, payment
-- failed, or the customer backed out. Only touches checkout_pending + unpaid
-- orders. Idempotent: returns changed=false when there is nothing to do, so
-- duplicate webhooks cannot release stock twice.
create function public.release_checkout(
  p_order_id uuid,
  p_session_id text,
  p_to public.order_status,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v public.orders;
begin
  if p_to not in ('expired', 'canceled') then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT';
  end if;

  select * into v from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  if v.status <> 'checkout_pending'
     or v.payment_status = 'paid'
     or (p_session_id is not null
         and v.stripe_checkout_session_id is not null
         and v.stripe_checkout_session_id <> p_session_id) then
    return jsonb_build_object('changed', false, 'order', public.order_json(v.id, true));
  end if;

  perform public.restore_order_stock(v.id);

  update public.orders
     set status = p_to,
         status_reason = p_reason,
         hold_expires_at = null,
         canceled_at = now()
   where id = v.id;

  perform public.log_order_event(v.id, 'checkout_released', p_actor,
    jsonb_build_object('to', p_to, 'reason', p_reason));

  return jsonb_build_object('changed', true, 'order', public.order_json(v.id, true));
end;
$$;

-- Owner actions. The Netlify function verifies the caller's Supabase session
-- first; this re-checks that the user id is an admin as defense in depth.
--
-- Allowed transitions (mirrored in shared/orderStatus.ts for the UI):
--   confirm          requested                    -> confirmed
--   mark_paid        requested|confirmed, unpaid  -> confirmed, paid (in person)
--   complete         confirmed, paid              -> completed (picked up)
--   cancel           requested|confirmed          -> canceled (signs released)
--   clear_attention  any order with attention_reason set
-- Online checkouts in progress cannot be canceled here; Stripe expires them.
create function public.admin_update_order(
  p_order_id uuid,
  p_action text,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v public.orders;
begin
  if p_admin_user_id is null
     or not exists (select 1 from public.admins where user_id = p_admin_user_id) then
    raise exception using errcode = '42501', message = 'NOT_ADMIN';
  end if;

  select * into v from public.orders where id = p_order_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  if p_action = 'confirm' then
    if v.status <> 'requested' then
      raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    update public.orders set status = 'confirmed', confirmed_at = now() where id = v.id;

  elsif p_action = 'mark_paid' then
    if v.status not in ('requested', 'confirmed') or v.payment_status = 'paid' then
      raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    update public.orders
       set payment_status = 'paid',
           paid_via = 'in_person',
           paid_at = now(),
           status = 'confirmed',
           confirmed_at = coalesce(confirmed_at, now())
     where id = v.id;

  elsif p_action = 'complete' then
    if v.status <> 'confirmed' or v.payment_status <> 'paid' then
      raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    update public.orders set status = 'completed', completed_at = now() where id = v.id;

  elsif p_action = 'cancel' then
    if v.status not in ('requested', 'confirmed') then
      raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    perform public.restore_order_stock(v.id);
    update public.orders
       set status = 'canceled',
           status_reason = 'canceled_by_owner',
           canceled_at = now()
     where id = v.id;

  elsif p_action = 'clear_attention' then
    if v.attention_reason is null then
      raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION';
    end if;
    update public.orders set attention_reason = null where id = v.id;

  else
    raise exception using errcode = 'P0001', message = 'INVALID_ACTION';
  end if;

  perform public.log_order_event(v.id, p_action, 'admin',
    jsonb_build_object('user_id', p_admin_user_id, 'previous_status', v.status));

  return jsonb_build_object('changed', true, 'order', public.order_json(v.id, true));
end;
$$;

-- Online checkouts whose hold ended more than p_grace_minutes ago and that are
-- still pending. The reconciliation job asks Stripe about each one.
create function public.list_stale_checkouts(p_grace_minutes integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'stripe_checkout_session_id', s.stripe_checkout_session_id,
    'hold_expires_at', s.hold_expires_at
  )), '[]'::jsonb)
  from (
    select o.id, o.stripe_checkout_session_id, o.hold_expires_at
    from public.orders o
    where o.status = 'checkout_pending'
      and o.payment_status = 'unpaid'
      and coalesce(o.hold_expires_at, o.created_at + interval '30 minutes')
          < now() - make_interval(mins => greatest(p_grace_minutes, 0))
    order by o.created_at
    limit 50
  ) s;
$$;

-- Optional automatic release of unconfirmed pay-later requests. Disabled by
-- default (see REQUEST_AUTO_RELEASE_HOURS in the README). Confirmed requests are
-- never auto-released: the owner has explicitly agreed to them.
create function public.release_stale_requests(p_older_than_hours integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v public.orders;
  v_released jsonb := '[]'::jsonb;
begin
  if p_older_than_hours is null or p_older_than_hours < 1 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT';
  end if;

  for v in
    select * from public.orders
    where status = 'requested'
      and payment_status = 'unpaid'
      and created_at < now() - make_interval(hours => p_older_than_hours)
    order by created_at
    limit 100
    for update skip locked
  loop
    perform public.restore_order_stock(v.id);
    update public.orders
       set status = 'canceled', status_reason = 'request_expired', canceled_at = now()
     where id = v.id;
    perform public.log_order_event(v.id, 'request_auto_released', 'system',
      jsonb_build_object('older_than_hours', p_older_than_hours));
    v_released := v_released || jsonb_build_array(public.order_json(v.id, true));
  end loop;

  return v_released;
end;
$$;

-- Customer status lookup. Returns null unless the token hash matches.
-- Contact details are not included.
create function public.get_order_for_customer(p_order_id uuid, p_access_token_hash text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.order_json(o.id, false)
  from public.orders o
  where o.id = p_order_id and o.access_token_hash = p_access_token_hash;
$$;

-- Full order (including contact details) for server-side use, such as emails.
create function public.get_order(p_order_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.order_json(p_order_id, true);
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
-- Supabase grants anon/authenticated broad privileges on new objects by
-- default. Narrow them so that RLS is not the only line of defense.

revoke all on public.orders, public.order_items, public.order_events, public.admins from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.orders, public.order_items, public.order_events, public.admins from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.signs from anon;
revoke truncate, references, trigger on public.signs from authenticated;

revoke execute on function
  public.signs_before_update(),
  public.orders_before_update(),
  public.order_json(uuid, boolean),
  public.restore_order_stock(uuid),
  public.log_order_event(uuid, text, text, jsonb),
  public.create_order(jsonb, text, text, text, public.pickup_method, text, public.payment_choice, text, integer, integer),
  public.set_checkout_session(uuid, text, timestamptz),
  public.mark_order_paid_stripe(uuid, text, text, integer, text),
  public.release_checkout(uuid, text, public.order_status, text, text),
  public.admin_update_order(uuid, text, uuid),
  public.list_stale_checkouts(integer),
  public.release_stale_requests(integer),
  public.get_order_for_customer(uuid, text),
  public.get_order(uuid)
from public, anon, authenticated;

grant execute on function
  public.order_json(uuid, boolean),
  public.restore_order_stock(uuid),
  public.log_order_event(uuid, text, text, jsonb),
  public.create_order(jsonb, text, text, text, public.pickup_method, text, public.payment_choice, text, integer, integer),
  public.set_checkout_session(uuid, text, timestamptz),
  public.mark_order_paid_stripe(uuid, text, text, integer, text),
  public.release_checkout(uuid, text, public.order_status, text, text),
  public.admin_update_order(uuid, text, uuid),
  public.list_stale_checkouts(integer),
  public.release_stale_requests(integer),
  public.get_order_for_customer(uuid, text),
  public.get_order(uuid)
to service_role;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------

alter table public.signs enable row level security;
alter table public.admins enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;

create policy "Listed signs are visible to everyone"
  on public.signs for select
  to anon, authenticated
  using (is_listed or (select public.is_admin()));

create policy "Admins can add signs"
  on public.signs for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "Admins can edit signs"
  on public.signs for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins can delete signs"
  on public.signs for delete
  to authenticated
  using ((select public.is_admin()));

create policy "Users can see their own admin membership"
  on public.admins for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Admins can read orders"
  on public.orders for select
  to authenticated
  using ((select public.is_admin()));

create policy "Admins can read order items"
  on public.order_items for select
  to authenticated
  using ((select public.is_admin()));

create policy "Admins can read order events"
  on public.order_events for select
  to authenticated
  using ((select public.is_admin()));

-- No insert/update/delete policies exist for orders, order_items, order_events,
-- or admins: only the service role (which bypasses RLS) can write them.

-- -----------------------------------------------------------------------------
-- Photo storage
-- -----------------------------------------------------------------------------
-- Public bucket: anyone can view a photo by its URL. Only admins can upload,
-- replace, delete, or list photos.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sign-photos', 'sign-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Admins can upload sign photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'sign-photos' and (select public.is_admin()));

create policy "Admins can replace sign photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'sign-photos' and (select public.is_admin()))
  with check (bucket_id = 'sign-photos' and (select public.is_admin()));

create policy "Admins can delete sign photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'sign-photos' and (select public.is_admin()));

create policy "Admins can browse sign photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'sign-photos' and (select public.is_admin()));
