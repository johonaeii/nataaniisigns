// Public, build-time settings (VITE_* variables are embedded in the browser bundle,
// so never put secrets here). Edit the defaults or set the variables in Netlify.

const env = import.meta.env;

export const SHOP_NAME = env.VITE_SHOP_NAME?.trim() || 'Nataanii Signs';

export const SHOP_TAGLINE =
  env.VITE_SHOP_TAGLINE?.trim() || 'Handmade signs. Pick your favorites, then pay online or in person.';

export const MARKET_PICKUP_DETAILS =
  env.VITE_MARKET_PICKUP_DETAILS?.trim() || 'Pick up at our booth on the next market day.';

export const LOCAL_PICKUP_DETAILS = "We'll contact you to set a time and place nearby.";

export const CONTACT_EMAIL = env.VITE_CONTACT_EMAIL?.trim() || '';

/** Show the "pay online" option. The server independently refuses if Stripe isn't configured. */
export const ONLINE_PAYMENTS_ENABLED = env.VITE_ONLINE_PAYMENTS_ENABLED === 'true';

export const SUPABASE_URL = env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '') || '';
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY?.trim() || '';
export const IS_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const PHOTO_BUCKET = 'sign-photos';
