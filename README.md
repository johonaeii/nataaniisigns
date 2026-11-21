# Nataanii Signs — inventory & sales site

A mobile-first shop for a small sign business. Customers (often arriving from a QR
code at a flea market) see what's in stock, add signs to a cart, and either
**pay online** with Stripe Checkout or **request the signs and pay later / in
person**. The owner manages inventory, photos, and orders in a protected admin area.

- **Frontend:** Vite + React + TypeScript (single-page app, plain CSS)
- **Hosting & server code:** Netlify (static site + Netlify Functions)
- **Database, auth, photo storage:** Supabase (Postgres + RLS, Supabase Auth, Storage)
- **Payments:** Stripe Checkout (card details never touch this site)
- **Email:** Resend (optional; skipped and logged when not configured)

---

## How it works

### Three separate kinds of state

| What | Where | Values |
| --- | --- | --- |
| **Inventory** | `signs.quantity_available`, `signs.is_listed` | How many more can be ordered; whether shown in the shop |
| **Request / reservation** | `orders.status` | `checkout_pending` → `confirmed` → `completed`, or `requested` → `confirmed` → `completed`; released orders end as `canceled` or `expired` |
| **Payment** | `orders.payment_status` (+ `paid_via`) | `unpaid` or `paid` (via `stripe` or `in_person`) |

Orders in `checkout_pending`, `requested`, or `confirmed` **hold** their signs. Held signs
are not available to anyone else. Releasing a hold (cancel/expire) gives the stock back once.

### Preventing duplicate sales

All order changes happen in Postgres functions (`supabase/migrations/…_sign_shop.sql`),
each a single transaction:

- `create_order` decrements stock with `UPDATE … WHERE quantity_available >= n`. Postgres
  row locking makes a second simultaneous buyer wait and then re-check, so only one can
  take the last unit. Any unavailable sign rolls back the whole order (no partial holds).
  A `CHECK (quantity_available >= 0)` constraint is the final backstop.
- Prices and totals come from the database. The browser only sends sign ids and quantities.
- Every release/payment function is idempotent, so duplicate webhooks or double clicks
  can't release stock twice or record a payment twice.

### Online payment flow

1. `POST /api/orders` holds the signs (`checkout_pending`) and creates a Stripe Checkout
   Session with prices from the database and an expiry (default 30 minutes).
2. The customer pays on Stripe's page and is redirected back to `/order/<id>?t=<token>`.
   **The redirect alone never marks anything paid.** The page shows "Confirming your
   payment…" and polls.
3. Stripe calls `POST /api/stripe-webhook`. The signature is verified with
   `STRIPE_WEBHOOK_SECRET`, then `checkout.session.completed` marks the order paid and
   confirmed. Only then does the page say "Payment received".
4. If the customer backs out (Stripe's back link, or the browser Back button to the cart or
   checkout), the site asks the server to expire the Stripe session and release the signs
   immediately. The server checks with Stripe first, so a completed payment is never undone.
   If they just leave, Stripe's `checkout.session.expired` webhook releases the signs when
   the session times out.
5. A scheduled function (`reconcile-holds`, every 10 minutes) is a safety net for missed
   webhooks. It asks Stripe directly about any checkout past its hold time, then records
   the payment or releases the signs.

Edge case: if a payment somehow arrives after a hold was released, the payment is recorded.
If the signs are still available they're re-reserved. If not, the order is flagged
**Needs review** in the admin area (and emailed to the owner) so they can refund. Signs are
never oversold.

### Pay later / in person flow

`POST /api/orders` with `paymentChoice: "pay_later"` immediately holds the signs
(`requested`) and shows "Request submitted — nothing has been charged". The owner then
**confirms**, **marks paid (in person)**, **marks picked up**, or **cancels** (which releases
the signs) from the admin area.

### Reservation policy (assumptions — easy to change)

| Policy | Default | Change it with |
| --- | --- | --- |
| Online checkout hold | **30 minutes** (Stripe's minimum session length) | `CHECKOUT_HOLD_MINUTES` (30–1440) |
| Pay-later requests | **Never auto-released.** The owner confirms or cancels each one. | `REQUEST_AUTO_RELEASE_HOURS` (e.g. `72`) |
| Confirmed requests | Never auto-released, even when the setting above is on | Change `release_stale_requests()` in the migration |

The conservative default means a request holds signs until the owner acts. If spam or
no-shows become a problem, set `REQUEST_AUTO_RELEASE_HOURS`. The scheduled job then cancels
**unconfirmed, unpaid** requests older than that and emails the customer.

### Security model

- **Browsers only get the Supabase anon/publishable key.** Row Level Security lets visitors read
  *listed signs only*. `orders`, `order_items`, `order_events`, and `admins` are not readable
  by visitors at all (privileges are revoked, and RLS allows admins only).
- **Admin = a Supabase Auth user listed in `public.admins`.** RLS lets admins edit signs,
  upload photos, and read orders. Order *state changes* go through
  `/api/admin-order-action`, which verifies the user's token with Supabase Auth and checks
  `admins`. The database function re-checks that the user is an admin and enforces the
  allowed transitions.
- **Service-role key, Stripe secret key, webhook secret, and Resend key exist only in Netlify
  Functions.** None use the `VITE_` prefix, so none are bundled into the site.
- The order functions can only be executed by the service role. They are revoked from
  `anon`/`authenticated` (tested).
- The customer's order link holds a random 192-bit token. Only its SHA-256 hash is stored.
  The status page shows no email or phone.
- Live Stripe keys are refused unless `STRIPE_ALLOW_LIVE=true`.
- Spam protection: a hidden honeypot field. See "Known limitations".

---

## Project layout

```
src/                 React app (shop, cart, checkout, order status, admin)
  pages/admin/       Admin area: lazy-loaded, the only place the Supabase JS client is used
shared/              Types, status rules, validation, and money helpers shared by browser and server
server/              Server logic used by Netlify Functions (handlers, Stripe, email, DB access)
netlify/functions/   Thin Netlify Function entry points (served at /api/<name>)
supabase/migrations/ Database schema, functions, RLS policies, storage bucket + policies
supabase/seed.sql    Sample signs for local development only
tests/               Vitest: SQL tests against real Postgres (PGlite), server flows, UI
```

---

## Local development

Requirements: **Node 24+** (`.nvmrc`), a Supabase project (hosted or local via the
Supabase CLI), and optionally the Stripe CLI and Netlify CLI.

```bash
npm install
cp .env.example .env        # then fill in values (see "Environment variables")
npx netlify-cli dev         # site + functions on http://localhost:8888
```

`npm run dev` (Vite alone, port 5173) is fine for UI work, but `/api/*` only works
through `netlify dev`, which runs the functions and loads `.env`.

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm test` | All tests (database, server flows, UI). No external services needed. |
| `npm run typecheck` | TypeScript for the app, server, and tests |
| `npm run lint` | ESLint |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run check` | All of the above |

The database tests run the real migration in [PGlite](https://pglite.dev) (Postgres compiled
to WebAssembly) with small stand-ins for Supabase's `auth`/`storage` schemas and roles. So
the reservation logic, constraints, grants, and RLS policies are exercised for real without
Docker.

---

## Supabase setup

1. **Create a project** at [supabase.com](https://supabase.com) (or run `npx supabase start` locally).
2. **Apply the schema**, choosing one:
   - Supabase CLI: `npx supabase init` (once; keeps the existing `supabase/migrations`), then
     `npx supabase link --project-ref <ref>` and `npx supabase db push`.
   - Or, in the dashboard's **SQL Editor**, run each file in `supabase/migrations/` **in
     order** (oldest first), each in its own new query, once:
     1. `20261121000000_sign_shop.sql`
     2. `20261122000000_explicit_table_grants.sql`

   This creates the tables, functions, RLS policies, and the public `sign-photos` storage
   bucket with admin-only upload policies.
3. **Auth settings** (Authentication → Sign In / Providers, and URL Configuration):
   - **Turn off "Allow new users to sign up"**. Only the owner needs an account. (Even if
     someone signs up, they are not an admin, but there's no reason to allow it.)
   - Set **Site URL** to your site, and add `https://<your-site>/admin` (and
     `http://localhost:8888/admin` for local dev) to **Redirect URLs** so password-reset
     links work.
4. **Create the owner account**: Authentication → Users → **Add user** (email + password).
5. **Make that user an admin**: in the SQL Editor:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'owner@example.com';
   ```
6. **Copy keys** from Project Settings → API (or API Keys):
   - Project URL → `VITE_SUPABASE_URL` and `SUPABASE_URL`
   - anon / publishable key → `VITE_SUPABASE_ANON_KEY`
   - service_role / secret key → `SUPABASE_SERVICE_ROLE_KEY` (**server only**)

For local sample data, `supabase db reset` applies `supabase/seed.sql`. Don't run the seed
against production.

---

## Netlify setup

1. Create a site from this repository. `netlify.toml` already sets the build command
   (`npm run build`), publish directory (`dist`), functions directory, Node 24, the `/api/*`
   routing, SPA fallback, and security headers.
2. Add the environment variables below under **Site configuration → Environment variables**.
   `VITE_*` values are baked into the site at build time, so **redeploy after changing them**.
3. The scheduled function `reconcile-holds` runs automatically on published deploys every
   10 minutes. Check **Logs → Functions** to see its summaries.
4. If you use a custom Supabase domain, add it to `img-src` and `connect-src` in the
   `Content-Security-Policy` header in `netlify.toml`.

---

## Stripe setup

Start in **test mode**. Live keys are refused unless `STRIPE_ALLOW_LIVE=true`.

1. Copy the test **secret key** (`sk_test_…`) into `STRIPE_SECRET_KEY`.
2. **Webhook endpoint** (Developers → Webhooks → Add endpoint):
   - URL: `https://<your-site>/api/stripe-webhook`
   - Events:
     - `checkout.session.completed`
     - `checkout.session.expired`
     - `checkout.session.async_payment_succeeded`
     - `checkout.session.async_payment_failed`
   - Copy the endpoint's **signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
3. Set `VITE_ONLINE_PAYMENTS_ENABLED=true` and redeploy to show the "Pay online" option.
   (The server separately refuses online orders if Stripe isn't configured.)
4. Optional: turn on **customer email receipts** in Stripe's settings.

**Local webhook testing** with the [Stripe CLI](https://stripe.com/docs/stripe-cli):

```bash
stripe login
stripe listen --forward-to localhost:8888/api/stripe-webhook \
  --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed
# Put the printed whsec_… into .env as STRIPE_WEBHOOK_SECRET, restart netlify dev.
```

Pay with test card `4242 4242 4242 4242` (any future date, any CVC). To test expiry
without waiting 30 minutes, back out of Checkout (the hold is released immediately), or
expire a session from the Stripe dashboard.

**Going live:** create a live webhook endpoint (its own signing secret), set the live
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` and `STRIPE_ALLOW_LIVE=true` in Netlify,
then redeploy.

---

## Email (Resend)

Optional. With `RESEND_API_KEY`, `EMAIL_FROM`, and `OWNER_EMAIL` set:

- Customers who give an email get: request received (with their order link), payment
  received, request confirmed, in-person payment recorded, order canceled, request released.
- The owner gets: new request, new paid order, and "needs review" alerts.

`EMAIL_FROM` must use a domain verified in Resend (Resend's `onboarding@resend.dev` test
sender only delivers to your own Resend account email). Without these variables, emails are
skipped and a log line is written. Orders still work. Email failures never fail an order.

---

## Environment variables

See `.env.example` for a template (placeholders only; `.env` is git-ignored).

| Variable | Where | Required | Purpose |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | browser | yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | browser | yes | Supabase anon or publishable key (public by design) |
| `VITE_ONLINE_PAYMENTS_ENABLED` | browser | no | `true` shows the "Pay online" option |
| `VITE_SHOP_NAME` | browser | no | Shop name (default "Nataanii Signs") |
| `VITE_SHOP_TAGLINE` | browser | no | Line under the shop heading |
| `VITE_MARKET_PICKUP_DETAILS` | browser | no | Market pickup text shown at checkout (e.g. days/booth) |
| `VITE_CONTACT_EMAIL` | browser | no | Public contact email in the footer and order page |
| `SUPABASE_URL` | server | yes | Supabase project URL (falls back to `VITE_SUPABASE_URL`) |
| `SUPABASE_SERVICE_ROLE_KEY` | server | yes | Service role / secret key. **Never expose.** |
| `STRIPE_SECRET_KEY` | server | for online pay | `sk_test_…` (live keys need `STRIPE_ALLOW_LIVE`) |
| `STRIPE_WEBHOOK_SECRET` | server | for online pay | Webhook signing secret `whsec_…` |
| `STRIPE_ALLOW_LIVE` | server | no | Must be `true` to accept `sk_live_` keys |
| `SITE_URL` | server | recommended | Public site URL for Stripe redirects and email links (Netlify's `URL` is used if unset) |
| `RESEND_API_KEY` | server | no | Enables email |
| `EMAIL_FROM` | server | with Resend | Verified sender, e.g. `Nataanii Signs <orders@example.com>` |
| `OWNER_EMAIL` | server | no | Receives order notifications; used as customers' reply-to |
| `SHOP_NAME` | server | no | Name used in emails (falls back to `VITE_SHOP_NAME`) |
| `CHECKOUT_HOLD_MINUTES` | server | no | Online checkout hold, 30–1440 (default 30) |
| `REQUEST_AUTO_RELEASE_HOURS` | server | no | Auto-cancel unconfirmed requests after N hours (default 0 = never) |

---

## Using the admin area

Go to `/admin` and sign in with the owner account.

- **Orders** → *Needs action* lists new requests and anything flagged for review. Open an
  order to see contact details (tap to call, text, or email), pickup choice, notes, and
  history. Then:
  - **Confirm request**, **Mark paid (in person)**, **Mark picked up**, or **Cancel order**
    (releases the signs).
  - Canceling a *paid* order does **not** refund automatically. Refund in the Stripe dashboard.
  - Online checkouts in progress can't be canceled here. They resolve within the hold time.
- **Signs** → add or edit signs: name, description, price, *available to sell*, show/hide,
  and photos (upload from your phone; photos are resized automatically), or pick from
  previously uploaded photos.
  - *Available to sell* excludes signs already held in orders. Use `1` for one-of-a-kind,
    or `0` if you sold it in person at the booth.
  - If a customer reserves a sign while you're editing it, saving is refused with a
    "reload" prompt, so you can't accidentally overwrite the stock count.
  - Signs that appear in past orders can't be deleted. Hide them instead.

Each sign has its own page (`/signs/<id>`), which works well for a per-sign QR code.

---

## Known limitations / next steps

- **Spam requests:** a bot or prankster could submit pay-later requests that hold signs.
  There's a honeypot field, and the owner can cancel requests. If it becomes a problem,
  add rate limiting (e.g. Netlify's rate-limit config, or a per-IP check) and/or
  set `REQUEST_AUTO_RELEASE_HOURS`.
- **Refunds** are done in the Stripe dashboard. The app doesn't track refund status.
- **No shipping**, taxes, or discounts in this version. If you enable Stripe Tax or similar,
  the amount paid will differ from the order total and the order is flagged for review.
- Uploaded photos that are no longer used stay in storage. Delete them from the Supabase
  Storage dashboard if needed.
