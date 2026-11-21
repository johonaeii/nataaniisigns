import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from './config';
import { supabaseRpc } from './db';
import type { AdminAuthResult, AppDeps } from './deps';
import { createDisabledMailer, createResendMailer } from './email';
import { apiError } from './http';
import { consoleLogger } from './log';
import { createNotifier } from './notifications';
import { createOrderRepo } from './orders';
import { createStripeGateway } from './payments';

let cached: AppDeps | null = null;

/** Build production dependencies from environment variables (once per function instance). */
export function getDeps(): AppDeps {
  if (cached) return cached;

  const config = loadConfig();
  const log = consoleLogger;
  for (const warning of config.warnings) log.warn('config_warning', { warning });

  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for the Netlify functions.');
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const mailer =
    config.resendApiKey && config.emailFrom
      ? createResendMailer({ apiKey: config.resendApiKey, from: config.emailFrom, log })
      : createDisabledMailer(log);

  cached = {
    config,
    log,
    repo: createOrderRepo(supabaseRpc(supabase)),
    payments:
      config.stripeSecretKey && config.stripeWebhookSecret
        ? createStripeGateway(config.stripeSecretKey, config.stripeWebhookSecret)
        : null,
    notify: createNotifier(config, mailer),
    verifyAdmin: (header) => verifySupabaseAdmin(supabase, header),
  };
  return cached;
}

/**
 * Verify a Supabase access token with Supabase Auth, then check the user is in
 * public.admins. Hiding admin UI is not security; this is.
 */
async function verifySupabaseAdmin(supabase: SupabaseClient, header: string | null): Promise<AdminAuthResult> {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { ok: false, status: 401 };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401 };

  const { data: admin, error: adminError } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (adminError || !admin) return { ok: false, status: 403 };

  return { ok: true, userId: data.user.id };
}

/** Wrap a handler so that missing server configuration becomes a clear 503. */
export function withDeps(handler: (req: Request, deps: AppDeps) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    let deps: AppDeps;
    try {
      deps = getDeps();
    } catch (error) {
      consoleLogger.error('server_not_configured', { error: String(error) });
      return apiError(503, 'not_configured', 'The shop is not fully set up yet. Please try again later.');
    }
    return handler(req, deps);
  };
}
