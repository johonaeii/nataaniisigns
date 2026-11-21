import Stripe from 'stripe';

/**
 * The slice of Stripe this app uses. Handlers depend on this interface so tests
 * can substitute a fake without network access.
 */
export interface PaymentGateway {
  createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
    options: { idempotencyKey: string },
  ): Promise<Stripe.Checkout.Session>;
  retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session>;
  expireCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session>;
  /** Verifies the Stripe-Signature header and parses the event. Throws if invalid. */
  constructWebhookEvent(payload: string, signature: string): Stripe.Event;
}

export function createStripeGateway(secretKey: string, webhookSecret: string): PaymentGateway {
  const stripe = new Stripe(secretKey, {
    maxNetworkRetries: 2,
    appInfo: { name: 'sign-shop' },
  });

  return {
    createCheckoutSession: (params, { idempotencyKey }) =>
      stripe.checkout.sessions.create(params, { idempotencyKey }),
    retrieveCheckoutSession: (sessionId) => stripe.checkout.sessions.retrieve(sessionId),
    expireCheckoutSession: (sessionId) => stripe.checkout.sessions.expire(sessionId),
    constructWebhookEvent: (payload, signature) =>
      stripe.webhooks.constructEvent(payload, signature, webhookSecret),
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The order id this app attached to a Checkout Session, or null if the session isn't ours. */
export function orderIdFromSession(session: Stripe.Checkout.Session): string | null {
  const candidate = session.metadata?.order_id ?? session.client_reference_id ?? null;
  return candidate && UUID_PATTERN.test(candidate) ? candidate : null;
}

export function paymentIntentId(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (!pi) return null;
  return typeof pi === 'string' ? pi : pi.id;
}
