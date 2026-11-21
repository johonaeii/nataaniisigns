import type Stripe from 'stripe';
import { orderLookupSchema } from '../../shared/validation';
import type { AppDeps } from '../deps';
import { GENERIC_ERROR_MESSAGE, apiError, json, methodNotAllowed, readJson } from '../http';
import { hashToken } from '../tokens';

/**
 * POST /api/checkout-cancel { orderId, token }
 *
 * Called when the customer returns from Stripe via "back". Releases the hold
 * right away instead of waiting for the session to time out, but only after
 * Stripe confirms the session is expired, so a payment can never be lost.
 */
export async function handleCheckoutCancel(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  const body = await readJson(req);
  const parsed = orderLookupSchema.safeParse(body.ok ? body.value : null);
  if (!parsed.success) return apiError(404, 'not_found', 'We could not find that order.');
  const { orderId, token } = parsed.data;
  const tokenHash = hashToken(token);

  try {
    const order = await deps.repo.getOrderForCustomer(orderId, tokenHash);
    if (!order) return apiError(404, 'not_found', 'We could not find that order.');
    if (order.status !== 'checkout_pending' || order.payment_status === 'paid') return json(200, { order });

    const full = await deps.repo.getOrder(orderId);
    const sessionId = full?.stripe_checkout_session_id ?? null;

    if (sessionId) {
      if (!deps.payments) return json(200, { order }); // can't confirm with Stripe; leave the hold alone
      const session = await expireIfOpen(sessionId, deps);
      if (session.status !== 'expired') {
        // Complete (paid or processing): the webhook will record it. Do not release.
        return json(200, { order: await deps.repo.getOrderForCustomer(orderId, tokenHash) });
      }
    }

    await deps.repo.releaseCheckout({
      orderId,
      sessionId,
      to: 'canceled',
      actor: 'customer',
      reason: 'customer_canceled',
    });
    return json(200, { order: await deps.repo.getOrderForCustomer(orderId, tokenHash) });
  } catch (error) {
    deps.log.error('checkout_cancel_failed', { orderId, error: String(error) });
    return apiError(500, 'server_error', GENERIC_ERROR_MESSAGE);
  }
}

/** Expire a session if it's still open. Returns Stripe's view of the session afterwards. */
export async function expireIfOpen(sessionId: string, deps: AppDeps): Promise<Stripe.Checkout.Session> {
  const payments = deps.payments!;
  const session = await payments.retrieveCheckoutSession(sessionId);
  if (session.status !== 'open') return session;
  try {
    return await payments.expireCheckoutSession(sessionId);
  } catch {
    // Most likely the customer completed payment in the meantime. Ask again.
    return payments.retrieveCheckoutSession(sessionId);
  }
}
