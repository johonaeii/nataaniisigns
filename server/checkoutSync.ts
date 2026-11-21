import type Stripe from 'stripe';
import { isDbError } from './db';
import type { AppDeps } from './deps';
import { orderIdFromSession, paymentIntentId } from './payments';

export type PaidSessionOutcome = 'paid' | 'already_paid' | 'not_paid_yet' | 'not_ours';

/**
 * Record a Checkout Session that Stripe reports as complete. Input must come from
 * a verified webhook event or a direct Stripe API call, never from a browser.
 */
export async function recordCompletedSession(
  session: Stripe.Checkout.Session,
  deps: AppDeps,
): Promise<PaidSessionOutcome> {
  const orderId = orderIdFromSession(session);
  if (!orderId) return 'not_ours';

  // 'unpaid' happens for delayed payment methods: keep holding until a later event.
  if (session.payment_status !== 'paid') return 'not_paid_yet';

  try {
    const result = await deps.repo.markPaidStripe({
      orderId,
      sessionId: session.id,
      paymentIntentId: paymentIntentId(session),
      amountCents: session.amount_total,
      currency: session.currency,
    });
    if (!result.changed) return 'already_paid';

    deps.log.info('payment_recorded', {
      orderId,
      orderNumber: result.order.order_number,
      attention: Boolean(result.attention),
    });
    await deps.notify.paymentReceived(result.order);
    if (result.attention) await deps.notify.attentionNeeded(result.order);
    return 'paid';
  } catch (error) {
    if (isDbError(error, 'ORDER_NOT_FOUND')) {
      deps.log.warn('payment_for_unknown_order', { orderId, sessionId: session.id });
      return 'not_ours';
    }
    throw error;
  }
}

/** Release an online checkout's hold after Stripe reports it expired or failed. */
export async function releaseSessionHold(
  session: Stripe.Checkout.Session,
  reason: 'checkout_expired' | 'payment_failed',
  actor: 'stripe' | 'system',
  deps: AppDeps,
): Promise<boolean> {
  const orderId = orderIdFromSession(session);
  if (!orderId) return false;
  try {
    const result = await deps.repo.releaseCheckout({
      orderId,
      sessionId: session.id,
      to: 'expired',
      actor,
      reason,
    });
    if (result.changed) deps.log.info('checkout_hold_released', { orderId, reason });
    return result.changed;
  } catch (error) {
    if (isDbError(error, 'ORDER_NOT_FOUND')) return false;
    throw error;
  }
}
