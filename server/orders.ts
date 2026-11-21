import type { AdminAction, CustomerOrder, OrderStatus, PrivateOrder } from '../shared/types';
import type { ParsedOrderRequest } from '../shared/validation';
import type { RpcClient } from './db';

export interface CreateOrderInput {
  request: ParsedOrderRequest;
  accessTokenHash: string;
  holdMinutes: number;
}

export interface ChangeResult {
  changed: boolean;
  order: PrivateOrder;
}

export interface PaidResult extends ChangeResult {
  attention?: boolean;
}

export interface StaleCheckout {
  id: string;
  stripe_checkout_session_id: string | null;
  hold_expires_at: string | null;
}

/** Typed wrappers around the order functions defined in the Supabase migration. */
export function createOrderRepo(rpc: RpcClient) {
  return {
    createOrder({ request, accessTokenHash, holdMinutes }: CreateOrderInput): Promise<PrivateOrder> {
      return rpc<PrivateOrder>('create_order', {
        p_items: request.items.map((item) => ({ sign_id: item.signId, quantity: item.quantity })),
        p_customer_name: request.customer.name,
        p_customer_email: request.customer.email ?? null,
        p_customer_phone: request.customer.phone ?? null,
        p_pickup_method: request.pickupMethod,
        p_customer_notes: request.notes,
        p_payment_choice: request.paymentChoice,
        p_access_token_hash: accessTokenHash,
        p_hold_minutes: holdMinutes,
        p_expected_subtotal_cents: request.expectedSubtotalCents ?? null,
      });
    },

    setCheckoutSession(orderId: string, sessionId: string, expiresAt: Date): Promise<PrivateOrder> {
      return rpc<PrivateOrder>('set_checkout_session', {
        p_order_id: orderId,
        p_session_id: sessionId,
        p_expires_at: expiresAt.toISOString(),
      });
    },

    markPaidStripe(input: {
      orderId: string;
      sessionId: string;
      paymentIntentId: string | null;
      amountCents: number | null;
      currency: string | null;
    }): Promise<PaidResult> {
      return rpc<PaidResult>('mark_order_paid_stripe', {
        p_order_id: input.orderId,
        p_session_id: input.sessionId,
        p_payment_intent_id: input.paymentIntentId,
        p_amount_cents: input.amountCents,
        p_currency: input.currency,
      });
    },

    releaseCheckout(input: {
      orderId: string;
      sessionId: string | null;
      to: Extract<OrderStatus, 'expired' | 'canceled'>;
      actor: 'customer' | 'stripe' | 'system';
      reason: string;
    }): Promise<ChangeResult> {
      return rpc<ChangeResult>('release_checkout', {
        p_order_id: input.orderId,
        p_session_id: input.sessionId,
        p_to: input.to,
        p_actor: input.actor,
        p_reason: input.reason,
      });
    },

    adminUpdateOrder(orderId: string, action: AdminAction, adminUserId: string): Promise<ChangeResult> {
      return rpc<ChangeResult>('admin_update_order', {
        p_order_id: orderId,
        p_action: action,
        p_admin_user_id: adminUserId,
      });
    },

    listStaleCheckouts(graceMinutes: number): Promise<StaleCheckout[]> {
      return rpc<StaleCheckout[]>('list_stale_checkouts', { p_grace_minutes: graceMinutes });
    },

    releaseStaleRequests(olderThanHours: number): Promise<PrivateOrder[]> {
      return rpc<PrivateOrder[]>('release_stale_requests', { p_older_than_hours: olderThanHours });
    },

    getOrderForCustomer(orderId: string, accessTokenHash: string): Promise<CustomerOrder | null> {
      return rpc<CustomerOrder | null>('get_order_for_customer', {
        p_order_id: orderId,
        p_access_token_hash: accessTokenHash,
      });
    },

    getOrder(orderId: string): Promise<PrivateOrder | null> {
      return rpc<PrivateOrder | null>('get_order', { p_order_id: orderId });
    },
  };
}

export type OrderRepo = ReturnType<typeof createOrderRepo>;
