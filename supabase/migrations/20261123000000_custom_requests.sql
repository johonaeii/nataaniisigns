-- =============================================================================
-- Custom sign requests
-- =============================================================================
-- Anyone can describe a sign they'd like made and attach reference photos or
-- sketches. Requests and photos are private: only admins can read them.
--
-- Submissions go through the server (Netlify function), which validates the
-- input and the photo files, rate-limits, and uploads photos to a PRIVATE
-- storage bucket with the service role. Browsers never write here directly.
-- =============================================================================

create type public.custom_request_status as enum ('new', 'in_progress', 'completed', 'declined');

create table public.custom_requests (
  id uuid primary key default gen_random_uuid(),
  request_number bigint generated always as identity (start with 101) unique,
  status public.custom_request_status not null default 'new',

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
  description text not null check (char_length(btrim(description)) between 10 and 3000),
  -- Object paths in the private "custom-request-photos" bucket.
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 4),
  -- Keyed hash of the submitter's IP address, used only for rate limiting.
  client_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint custom_requests_contact_required check (customer_email is not null or customer_phone is not null)
);

create index custom_requests_status_created_idx on public.custom_requests (status, created_at desc);
create index custom_requests_client_created_idx on public.custom_requests (client_key, created_at desc);

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger custom_requests_touch_updated_at
before update on public.custom_requests
for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Server-side functions (service role only)
-- -----------------------------------------------------------------------------

-- Rate limits for anonymous submissions. Change the numbers here if needed.
--   Per visitor (keyed IP hash): 5 per hour.  Overall: 50 per day.
-- Errors (SQLSTATE P0001): RATE_LIMITED.
create function public.create_custom_request(
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_description text,
  p_client_key text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v public.custom_requests;
begin
  if p_client_key is not null and (
    select count(*) from public.custom_requests
    where client_key = p_client_key and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  if (select count(*) from public.custom_requests where created_at > now() - interval '1 day') >= 50 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  insert into public.custom_requests (customer_name, customer_email, customer_phone, description, client_key)
  values (
    btrim(p_customer_name),
    nullif(lower(btrim(coalesce(p_customer_email, ''))), ''),
    nullif(btrim(coalesce(p_customer_phone, '')), ''),
    btrim(p_description),
    p_client_key
  )
  returning * into v;

  return jsonb_build_object(
    'id', v.id,
    'request_number', v.request_number,
    'status', v.status,
    'customer_name', v.customer_name,
    'customer_email', v.customer_email,
    'customer_phone', v.customer_phone,
    'description', v.description,
    'photo_paths', to_jsonb(v.photo_paths),
    'created_at', v.created_at
  );
end;
$$;

-- Record the uploaded photo paths (once, right after upload).
create function public.attach_custom_request_photos(p_request_id uuid, p_photo_paths text[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.custom_requests
     set photo_paths = p_photo_paths
   where id = p_request_id and cardinality(photo_paths) = 0;
  if not found then
    raise exception using errcode = 'P0001', message = 'INVALID_STATE';
  end if;
end;
$$;

-- Undo a submission whose photo upload failed, so the customer can retry cleanly.
create function public.discard_custom_request(p_request_id uuid)
returns void
language sql
set search_path = ''
as $$
  delete from public.custom_requests where id = p_request_id;
$$;

revoke execute on function
  public.touch_updated_at(),
  public.create_custom_request(text, text, text, text, text),
  public.attach_custom_request_photos(uuid, text[]),
  public.discard_custom_request(uuid)
from public, anon, authenticated;

grant execute on function
  public.create_custom_request(text, text, text, text, text),
  public.attach_custom_request_photos(uuid, text[]),
  public.discard_custom_request(uuid)
to service_role;

-- -----------------------------------------------------------------------------
-- Privileges and row level security
-- -----------------------------------------------------------------------------
-- Explicit grants work whether or not the project auto-grants new tables
-- (see 20261122000000_explicit_table_grants.sql).

revoke all on public.custom_requests from anon, authenticated;
-- Admins read, change the status, and delete (RLS limits all of this to admins).
grant select, delete on public.custom_requests to authenticated;
grant update (status) on public.custom_requests to authenticated;
grant select, insert, update, delete on public.custom_requests to service_role;
grant usage, select on sequence public.custom_requests_request_number_seq to service_role;

alter table public.custom_requests enable row level security;

create policy "Admins can read custom requests"
  on public.custom_requests for select
  to authenticated
  using ((select public.is_admin()));

create policy "Admins can update custom requests"
  on public.custom_requests for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins can delete custom requests"
  on public.custom_requests for delete
  to authenticated
  using ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Private photo storage
-- -----------------------------------------------------------------------------
-- Not public: photos are viewed through short-lived signed URLs, by admins only.
-- There is no insert policy: only the server (service role) uploads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custom-request-photos', 'custom-request-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Admins can view custom request photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'custom-request-photos' and (select public.is_admin()));

create policy "Admins can delete custom request photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'custom-request-photos' and (select public.is_admin()));
