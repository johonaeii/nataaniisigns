import { ApiError, api } from './api';
import { orderPath, pendingCheckout } from './recentOrder';

/**
 * If this browser left for Stripe Checkout and came back some other way than
 * Stripe's cancel link (e.g. the browser Back button), its own checkout is still
 * holding the signs. Release it before showing availability, or the shopper would
 * be told their own signs were "reserved by someone else".
 *
 * The server only releases after Stripe confirms the session is expired, so a
 * completed payment is never undone. In that case we send them to their order.
 */
export async function releasePendingCheckout(): Promise<{ redirectTo?: string }> {
  const pending = pendingCheckout.get();
  if (!pending) return {};
  try {
    const order = await api.cancelCheckout(pending.orderId, pending.token);
    if (order.payment_status === 'paid' || order.status === 'checkout_pending') {
      return { redirectTo: `${orderPath(pending)}&from=checkout` };
    }
    pendingCheckout.clear();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) pendingCheckout.clear();
    // Otherwise keep it and retry next time; the hold also expires on its own.
  }
  return {};
}
