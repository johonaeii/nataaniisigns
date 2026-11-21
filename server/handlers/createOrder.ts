import type Stripe from 'stripe';
import type { CreateOrderResponse, PrivateOrder } from '../../shared/types';
import { fieldErrorsFromZod, orderRequestSchema } from '../../shared/validation';
import { DbError } from '../db';
import type { AppDeps } from '../deps';
import { GENERIC_ERROR_MESSAGE, apiError, json, methodNotAllowed, readJson } from '../http';
import { generateAccessToken, hashToken } from '../tokens';

/**
 * POST /api/orders
 *
 * Creates an order and holds its signs. For pay-later requests that's the whole
 * job. For online payment it then creates a Stripe Checkout Session using prices
 * from the database (never from the browser) and returns its URL.
 */
export async function handleCreateOrder(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  const body = await readJson(req);
  if (!body.ok) return apiError(400, 'invalid_json', 'The request could not be read.');

  const parsed = orderRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'Please check the highlighted fields.', {
      fieldErrors: fieldErrorsFromZod(parsed.error),
    });
  }
  const request = parsed.data;

  if (request.website) {
    // Honeypot filled in: almost certainly a bot.
    deps.log.warn('order_honeypot_triggered');
    return apiError(400, 'invalid_request', 'The request could not be processed.');
  }

  if (request.paymentChoice === 'online' && !deps.payments) {
    return apiError(
      503,
      'online_payments_unavailable',
      "Online payment isn't available right now. You can still request your signs and pay in person.",
    );
  }

  const token = generateAccessToken();
  let order: PrivateOrder;
  try {
    order = await deps.repo.createOrder({
      request,
      accessTokenHash: hashToken(token),
      holdMinutes: deps.config.checkoutHoldMinutes,
    });
  } catch (error) {
    return createOrderErrorResponse(error, deps);
  }

  const siteUrl = deps.config.siteUrl ?? new URL(req.url).origin;
  const orderLink = `${siteUrl}/order/${order.id}?t=${encodeURIComponent(token)}`;

  if (request.paymentChoice === 'pay_later') {
    deps.log.info('request_submitted', { orderId: order.id, orderNumber: order.order_number });
    await deps.notify.requestSubmitted(order, orderLink);
    return json(201, {
      orderId: order.id,
      orderNumber: order.order_number,
      token,
      status: order.status,
    } satisfies CreateOrderResponse);
  }

  return startOnlineCheckout(order, token, orderLink, deps);
}

async function startOnlineCheckout(
  order: PrivateOrder,
  token: string,
  orderLink: string,
  deps: AppDeps,
): Promise<Response> {
  const payments = deps.payments!;
  const failure = () =>
    apiError(
      502,
      'payment_start_failed',
      "We couldn't start the online payment, and you have not been charged. Please try again, or choose to pay in person.",
    );

  let session: Stripe.Checkout.Session;
  try {
    session = await payments.createCheckoutSession(buildCheckoutParams(order, orderLink, deps), {
      idempotencyKey: `checkout-${order.id}`,
    });
    if (!session.url) throw new Error('Checkout Session has no URL');
  } catch (error) {
    deps.log.error('checkout_create_failed', { orderId: order.id, error: String(error) });
    await releaseQuietly(order.id, null, deps);
    return failure();
  }

  try {
    await deps.repo.setCheckoutSession(order.id, session.id, new Date(session.expires_at * 1000));
  } catch (error) {
    // The customer never receives this session's URL, but expire it anyway.
    deps.log.error('checkout_record_failed', { orderId: order.id, error: String(error) });
    await payments.expireCheckoutSession(session.id).catch(() => undefined);
    await releaseQuietly(order.id, session.id, deps);
    return failure();
  }

  deps.log.info('checkout_started', { orderId: order.id, orderNumber: order.order_number, sessionId: session.id });
  return json(201, {
    orderId: order.id,
    orderNumber: order.order_number,
    token,
    status: order.status,
    checkoutUrl: session.url,
  } satisfies CreateOrderResponse);
}

/** Seconds until the Checkout Session expires. Stripe requires 30 minutes to 24 hours. */
export function checkoutExpirySeconds(holdMinutes: number): number {
  const requested = holdMinutes * 60 + 60; // +60s so the session is never under Stripe's minimum
  return Math.min(24 * 3600 - 60, Math.max(30 * 60 + 60, requested));
}

export function buildCheckoutParams(
  order: PrivateOrder,
  orderLink: string,
  deps: Pick<AppDeps, 'config'>,
): Stripe.Checkout.SessionCreateParams {
  const { config } = deps;
  const imageUrl = (path: string | null) =>
    path && config.supabaseUrl
      ? `${config.supabaseUrl}/storage/v1/object/public/sign-photos/${path.split('/').map(encodeURIComponent).join('/')}`
      : null;
  const metadata = { order_id: order.id, order_number: String(order.order_number) };

  return {
    mode: 'payment',
    allowed_payment_method_types: ['card'],
    line_items: order.items.map((item) => {
      const image = imageUrl(item.image_path);
      return {
        quantity: item.quantity,
        price_data: {
          currency: order.currency,
          unit_amount: item.unit_price_cents, // from the database snapshot, not the browser
          product_data: { name: item.sign_name, ...(image ? { images: [image] } : {}) },
        },
      };
    }),
    ...(order.customer_email ? { customer_email: order.customer_email } : {}),
    client_reference_id: order.id,
    metadata,
    payment_intent_data: {
      metadata,
      description: `${config.shopName} order #${order.order_number}`,
    },
    expires_at: Math.floor(Date.now() / 1000) + checkoutExpirySeconds(config.checkoutHoldMinutes),
    success_url: `${orderLink}&from=checkout`,
    cancel_url: `${orderLink}&canceled=1`,
  };
}

async function releaseQuietly(orderId: string, sessionId: string | null, deps: AppDeps) {
  try {
    await deps.repo.releaseCheckout({
      orderId,
      sessionId,
      to: 'expired',
      actor: 'system',
      reason: 'checkout_start_failed',
    });
  } catch (error) {
    // The reconciliation job will release it once the hold time passes.
    deps.log.error('checkout_release_failed', { orderId, error: String(error) });
  }
}

function createOrderErrorResponse(error: unknown, deps: AppDeps): Response {
  if (error instanceof DbError) {
    switch (error.message) {
      case 'SIGN_UNAVAILABLE':
        return apiError(
          409,
          'sign_unavailable',
          'Sorry, a sign in your cart was just reserved by someone else or is no longer available.',
          error.detail ? { signId: error.detail } : {},
        );
      case 'PRICE_CHANGED':
        return apiError(409, 'price_changed', 'Prices changed since you loaded the page. Please review your cart.', {
          subtotalCents: Number(error.detail),
        });
      case 'EMPTY_CART':
        return apiError(400, 'invalid_request', 'Your cart is empty.');
      case 'TOO_MANY_ITEMS':
      case 'INVALID_QUANTITY':
        return apiError(400, 'invalid_request', 'Please check the quantities in your cart.');
    }
    // 23514 check_violation, 22P02 invalid_text_representation, 22001 string too long
    if (error.code === '23514' || error.code === '22P02' || error.code === '22001') {
      return apiError(400, 'invalid_request', 'Please check your details and try again.');
    }
  }
  deps.log.error('create_order_failed', { error: String(error) });
  return apiError(500, 'server_error', GENERIC_ERROR_MESSAGE);
}
