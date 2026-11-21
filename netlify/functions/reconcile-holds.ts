// Scheduled: reconcile stale online checkouts with Stripe and (optionally) release old requests.
import type { Config } from '@netlify/functions';
import { getDeps } from '../../server/context';
import { runReconciliation } from '../../server/handlers/reconcile';
import { consoleLogger } from '../../server/log';

export default async (): Promise<Response> => {
  try {
    const summary = await runReconciliation(getDeps());
    consoleLogger.info('reconcile_complete', { ...summary });
    return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    consoleLogger.error('reconcile_failed', { error: String(error) });
    return new Response('reconcile failed', { status: 500 });
  }
};

export const config: Config = {
  schedule: '*/10 * * * *',
};
