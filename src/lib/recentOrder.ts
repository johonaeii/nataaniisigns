// Remembers the customer's most recent order link on this device, so they can
// find it again, and which checkout the current cart belongs to.

const RECENT_KEY = 'sign-shop:recent-order:v1';
const PENDING_KEY = 'sign-shop:pending-checkout:v1';

export interface OrderRef {
  orderId: string;
  token: string;
  orderNumber: number;
}

function read(key: string): OrderRef | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as OrderRef | null;
    return value && typeof value.orderId === 'string' && typeof value.token === 'string' ? value : null;
  } catch {
    return null;
  }
}

function write(key: string, value: OrderRef | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}

export const recentOrder = {
  get: () => read(RECENT_KEY),
  set: (ref: OrderRef) => write(RECENT_KEY, ref),
};

/** Set when the customer leaves for Stripe; the cart is cleared once that order is paid. */
export const pendingCheckout = {
  get: () => read(PENDING_KEY),
  set: (ref: OrderRef) => write(PENDING_KEY, ref),
  clear: () => write(PENDING_KEY, null),
};

export function orderPath(ref: Pick<OrderRef, 'orderId' | 'token'>): string {
  return `/order/${ref.orderId}?t=${encodeURIComponent(ref.token)}`;
}
