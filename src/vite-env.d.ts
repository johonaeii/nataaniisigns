/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SHOP_NAME?: string;
  readonly VITE_SHOP_TAGLINE?: string;
  readonly VITE_MARKET_PICKUP_DETAILS?: string;
  readonly VITE_CONTACT_EMAIL?: string;
  readonly VITE_ONLINE_PAYMENTS_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
