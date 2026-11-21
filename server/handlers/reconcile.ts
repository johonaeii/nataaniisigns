import { recordCompletedSession } from '../checkoutSync';
import type { AppDeps } from '../deps';
import { expireIfOpen } from './checkoutCancel';

/** Minutes past a hold's end before the job steps in (gives Stripe's own webhook time to arrive). */
export const RECONCILE_GRACE_MINUTES = 5;

export interface ReconcileSummary {
  checked: number;
  paid: number;
  released: number;
  stillProcessing: number;
  skipped: number;
  requestsReleased: number;
  errors: number;
}

/**
 * Safety net, run on a schedule. Webhooks can be delayed or missed, so for every
 * online checkout still pending after its hold ended, ask Stripe what happened:
 * paid -> record it; open -> expire it; expired -> release the signs.
 *
 * Optionally (REQUEST_AUTO_RELEASE_HOURS > 0) it also releases unconfirmed
 * pay-later requests. That is off by default.
 */
export async function runReconciliation(deps: AppDeps): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    checked: 0,
    paid: 0,
    released: 0,
    stillProcessing: 0,
    skipped: 0,
    requestsReleased: 0,
    errors: 0,
  };

  const stale = await deps.repo.listStaleCheckouts(RECONCILE_GRACE_MINUTES);
  for (const checkout of stale) {
    summary.checked += 1;
    try {
      const sessionId = checkout.stripe_checkout_session_id;
      if (!sessionId) {
        // Session creation never finished, so the customer never got a payment link
        // and any session that might exist has passed its expiry too.
        const result = await deps.repo.releaseCheckout({
          orderId: checkout.id,
          sessionId: null,
          to: 'expired',
          actor: 'system',
          reason: 'checkout_not_started',
        });
        if (result.changed) summary.released += 1;
        continue;
      }

      if (!deps.payments) {
        // Without Stripe we cannot know whether it was paid, so keep holding.
        summary.skipped += 1;
        continue;
      }

      const session = await expireIfOpen(sessionId, deps);
      if (session.status === 'complete') {
        const outcome = await recordCompletedSession(session, deps);
        if (outcome === 'paid' || outcome === 'already_paid') summary.paid += 1;
        else summary.stillProcessing += 1;
      } else if (session.status === 'expired') {
        const result = await deps.repo.releaseCheckout({
          orderId: checkout.id,
          sessionId,
          to: 'expired',
          actor: 'system',
          reason: 'checkout_expired',
        });
        if (result.changed) summary.released += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      summary.errors += 1;
      deps.log.error('reconcile_checkout_failed', { orderId: checkout.id, error: String(error) });
    }
  }

  const hours = deps.config.requestAutoReleaseHours;
  if (hours > 0) {
    try {
      const released = await deps.repo.releaseStaleRequests(hours);
      summary.requestsReleased = released.length;
      for (const order of released) await deps.notify.requestAutoReleased(order);
    } catch (error) {
      summary.errors += 1;
      deps.log.error('reconcile_requests_failed', { error: String(error) });
    }
  }

  return summary;
}
