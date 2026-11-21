import type Stripe from 'stripe';
import { recordCompletedSession, releaseSessionHold } from '../checkoutSync';
import type { AppDeps } from '../deps';
import { apiError, json, methodNotAllowed } from '../http';

/**
 * POST /api/stripe-webhook
 *
 * The only place a browser-initiated payment becomes "paid". The signature is
 * verified against STRIPE_WEBHOOK_SECRET before anything is read. Database
 * changes are idempotent, so Stripe's retries and duplicate deliveries are safe.
 * Returning 5xx makes Stripe retry later.
 */
export async function handleStripeWebhook(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);
  if (!deps.payments) return apiError(503, 'stripe_not_configured', 'Stripe is not configured.');

  const signature = req.headers.get('stripe-signature');
  if (!signature) return apiError(400, 'missing_signature', 'Missing Stripe-Signature header.');

  // Signature verification needs the exact raw body.
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = deps.payments.constructWebhookEvent(payload, signature);
  } catch (error) {
    deps.log.warn('stripe_webhook_bad_signature', { error: String(error) });
    return apiError(400, 'invalid_signature', 'Invalid signature.');
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const outcome = await recordCompletedSession(event.data.object, deps);
        deps.log.info('stripe_webhook_processed', { type: event.type, id: event.id, outcome });
        break;
      }
      case 'checkout.session.async_payment_failed':
        await releaseSessionHold(event.data.object, 'payment_failed', 'stripe', deps);
        break;
      case 'checkout.session.expired':
        await releaseSessionHold(event.data.object, 'checkout_expired', 'stripe', deps);
        break;
      default:
        // Not an event this app subscribes to; acknowledge so Stripe doesn't retry.
        break;
    }
  } catch (error) {
    deps.log.error('stripe_webhook_failed', { type: event.type, id: event.id, error: String(error) });
    return apiError(500, 'processing_failed', 'Webhook processing failed; Stripe will retry.');
  }

  return json(200, { received: true });
}
