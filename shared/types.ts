// Types shared by the browser app and the Netlify functions.
// Field names match the database (snake_case) to avoid mapping layers.

export const ORDER_STATUSES = [
  'checkout_pending',
  'requested',
  'confirmed',
  'completed',
  'canceled',
  'expired',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_CHOICES = ['online', 'pay_later'] as const;
export type PaymentChoice = (typeof PAYMENT_CHOICES)[number];

export const PICKUP_METHODS = ['market', 'local'] as const;
export type PickupMethod = (typeof PICKUP_METHODS)[number];

export type PaidVia = 'stripe' | 'in_person';

export const ADMIN_ACTIONS = ['confirm', 'mark_paid', 'complete', 'cancel', 'clear_attention'] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export interface Sign {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  quantity_available: number;
  is_listed: boolean;
  image_paths: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  sign_id: string;
  sign_name: string;
  unit_price_cents: number;
  quantity: number;
  image_path: string | null;
}

/** What the customer sees via their private order link. No contact details. */
export interface CustomerOrder {
  id: string;
  order_number: number;
  status: OrderStatus;
  status_reason: string | null;
  payment_choice: PaymentChoice;
  payment_status: PaymentStatus;
  paid_via: PaidVia | null;
  paid_at: string | null;
  pickup_method: PickupMethod;
  subtotal_cents: number;
  currency: string;
  hold_expires_at: string | null;
  created_at: string;
  updated_at: string;
  customer_first_name: string;
  has_email: boolean;
  items: OrderItem[];
}

/** Full order, server-side only (emails, admin function responses). */
export interface PrivateOrder extends CustomerOrder {
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  customer_notes: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  amount_paid_cents: number | null;
  attention_reason: string | null;
  confirmed_at: string | null;
  canceled_at: string | null;
  completed_at: string | null;
}

/** Order row as the admin UI reads it directly from Supabase (RLS: admins only). */
export interface AdminOrderRow {
  id: string;
  order_number: number;
  status: OrderStatus;
  status_reason: string | null;
  payment_choice: PaymentChoice;
  payment_status: PaymentStatus;
  paid_via: PaidVia | null;
  paid_at: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  pickup_method: PickupMethod;
  customer_notes: string;
  subtotal_cents: number;
  currency: string;
  hold_expires_at: string | null;
  stripe_checkout_session_id: string | null;
  amount_paid_cents: number | null;
  attention_reason: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  canceled_at: string | null;
  completed_at: string | null;
  order_items: Array<{
    sign_id: string;
    sign_name: string;
    unit_price_cents: number;
    quantity: number;
  }>;
}

export interface OrderEventRow {
  id: number;
  event: string;
  actor: string;
  detail: Record<string, unknown>;
  created_at: string;
}

/** Response from POST /api/orders. */
export interface CreateOrderResponse {
  orderId: string;
  orderNumber: number;
  token: string;
  status: OrderStatus;
  checkoutUrl?: string;
}

/** Error body returned by every API endpoint. */
export interface ApiErrorBody {
  error: string;
  message: string;
  fieldErrors?: Record<string, string>;
  signId?: string;
  subtotalCents?: number;
}

export const CUSTOM_REQUEST_STATUSES = ['new', 'in_progress', 'completed', 'declined'] as const;
export type CustomRequestStatus = (typeof CUSTOM_REQUEST_STATUSES)[number];

/** A custom sign request as the server creates it and the admin UI reads it. */
export interface CustomRequestRow {
  id: string;
  request_number: number;
  status: CustomRequestStatus;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  description: string;
  photo_paths: string[];
  created_at: string;
  updated_at?: string;
}

/** Response from POST /api/custom-requests. */
export interface CreateCustomRequestResponse {
  requestNumber: number;
}
