// Server-side configuration, read from environment variables (Netlify site settings
// in production, .env when running `netlify dev`). Nothing here is sent to browsers.

export interface ServerConfig {
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  /** 'test' | 'live' when Stripe is usable, null when online payments are disabled. */
  stripeMode: 'test' | 'live' | null;
  siteUrl: string | null;
  resendApiKey: string | null;
  emailFrom: string | null;
  ownerEmail: string | null;
  shopName: string;
  currency: 'usd';
  /** How long online checkout holds signs. Stripe allows 30 minutes to 24 hours. */
  checkoutHoldMinutes: number;
  /** Auto-cancel unconfirmed pay-later requests after this many hours. 0 = never (default). */
  requestAutoReleaseHours: number;
  /** Problems found while reading config, logged at startup. */
  warnings: string[];
}

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function readInt(env: Env, name: string, fallback: number, min: number, max: number, warnings: string[]): number {
  const raw = read(env, name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    warnings.push(`${name}="${raw}" is not a whole number; using ${fallback}.`);
    return fallback;
  }
  if (value < min || value > max) {
    const clamped = Math.min(max, Math.max(min, value));
    warnings.push(`${name}=${value} is outside ${min}-${max}; using ${clamped}.`);
    return clamped;
  }
  return value;
}

export function loadConfig(env: Env = process.env): ServerConfig {
  const warnings: string[] = [];

  let stripeSecretKey = read(env, 'STRIPE_SECRET_KEY');
  let stripeMode: ServerConfig['stripeMode'] = null;
  if (stripeSecretKey) {
    const isLive = /^(sk|rk)_live_/.test(stripeSecretKey);
    if (isLive && read(env, 'STRIPE_ALLOW_LIVE') !== 'true') {
      warnings.push(
        'STRIPE_SECRET_KEY is a live key but STRIPE_ALLOW_LIVE is not "true". Online payments are disabled.',
      );
      stripeSecretKey = null;
    } else {
      stripeMode = isLive ? 'live' : 'test';
    }
  }
  const stripeWebhookSecret = read(env, 'STRIPE_WEBHOOK_SECRET');
  if (stripeSecretKey && !stripeWebhookSecret) {
    warnings.push('STRIPE_WEBHOOK_SECRET is not set. Payments cannot be confirmed, so online payments are disabled.');
    stripeSecretKey = null;
    stripeMode = null;
  }

  return {
    supabaseUrl: read(env, 'SUPABASE_URL') ?? read(env, 'VITE_SUPABASE_URL'),
    supabaseServiceRoleKey: read(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    stripeSecretKey,
    stripeWebhookSecret,
    stripeMode,
    // SITE_URL wins; Netlify sets URL automatically for the production site.
    siteUrl: (read(env, 'SITE_URL') ?? read(env, 'URL'))?.replace(/\/+$/, '') ?? null,
    resendApiKey: read(env, 'RESEND_API_KEY'),
    emailFrom: read(env, 'EMAIL_FROM'),
    ownerEmail: read(env, 'OWNER_EMAIL'),
    shopName: read(env, 'SHOP_NAME') ?? read(env, 'VITE_SHOP_NAME') ?? 'Nataanii Signs',
    currency: 'usd',
    checkoutHoldMinutes: readInt(env, 'CHECKOUT_HOLD_MINUTES', 30, 30, 1440, warnings),
    requestAutoReleaseHours: readInt(env, 'REQUEST_AUTO_RELEASE_HOURS', 0, 0, 24 * 60, warnings),
    warnings,
  };
}
