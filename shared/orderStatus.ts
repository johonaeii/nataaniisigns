import type { AdminAction, OrderStatus, PaymentStatus, PickupMethod } from './types';

/** Statuses in which an order is holding signs (they are unavailable to others). */
export const HOLDING_STATUSES: readonly OrderStatus[] = ['checkout_pending', 'requested', 'confirmed'];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  checkout_pending: 'Awaiting online payment',
  requested: 'Request received',
  confirmed: 'Confirmed',
  completed: 'Picked up',
  canceled: 'Canceled',
  expired: 'Checkout expired',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'Not paid',
  paid: 'Paid',
};

export const PICKUP_LABEL: Record<PickupMethod, string> = {
  market: 'Pick up at the market booth',
  local: 'Arrange a local pickup',
};

export const ADMIN_ACTION_LABEL: Record<AdminAction, string> = {
  confirm: 'Confirm request',
  mark_paid: 'Mark paid (in person)',
  complete: 'Mark picked up',
  cancel: 'Cancel order',
  clear_attention: 'Dismiss warning',
};

export const STATUS_REASON_LABEL: Record<string, string> = {
  checkout_expired: 'The online checkout timed out before payment.',
  checkout_not_started: 'The online checkout could not be started.',
  checkout_start_failed: 'The online checkout could not be started.',
  payment_failed: 'The payment did not go through.',
  customer_canceled: 'The checkout was canceled.',
  canceled_by_owner: 'Canceled by the seller.',
  request_expired: 'The request was released after it was not confirmed in time.',
};

interface ActionableOrder {
  status: OrderStatus;
  payment_status: PaymentStatus;
  attention_reason?: string | null;
}

/**
 * Actions the owner may take on an order. This mirrors admin_update_order() in
 * the database, which is the real enforcement point; the UI uses this only to
 * decide which buttons to show. A test checks the two stay in sync.
 */
export function allowedAdminActions(order: ActionableOrder): AdminAction[] {
  const actions: AdminAction[] = [];
  const { status, payment_status: payment } = order;

  if (status === 'requested') actions.push('confirm');
  if ((status === 'requested' || status === 'confirmed') && payment === 'unpaid') actions.push('mark_paid');
  if (status === 'confirmed' && payment === 'paid') actions.push('complete');
  if (status === 'requested' || status === 'confirmed') actions.push('cancel');
  if (order.attention_reason) actions.push('clear_attention');

  return actions;
}

export function isHolding(status: OrderStatus): boolean {
  return HOLDING_STATUSES.includes(status);
}
