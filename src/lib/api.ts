// Calls to this site's Netlify functions (/api/*).

import type { AdminAction, ApiErrorBody, CreateOrderResponse, CustomerOrder, PrivateOrder } from '../../shared/types';
import type { OrderRequest } from '../../shared/validation';

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, {
      error: 'network',
      message: "Couldn't reach the shop. Check your connection and try again.",
    });
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON response (e.g. a platform error page).
  }

  if (!response.ok) {
    const fallback: ApiErrorBody = { error: 'server_error', message: 'Something went wrong. Please try again.' };
    const errorBody = body && typeof body === 'object' && 'message' in body ? (body as ApiErrorBody) : fallback;
    throw new ApiError(response.status, errorBody);
  }
  return body as T;
}

export const api = {
  createOrder(order: OrderRequest): Promise<CreateOrderResponse> {
    return request('/api/orders', { method: 'POST', body: JSON.stringify(order) });
  },

  async orderStatus(orderId: string, token: string, signal?: AbortSignal): Promise<CustomerOrder> {
    const params = new URLSearchParams({ id: orderId, t: token });
    const { order } = await request<{ order: CustomerOrder }>(`/api/order-status?${params}`, { signal });
    return order;
  },

  async cancelCheckout(orderId: string, token: string): Promise<CustomerOrder> {
    const { order } = await request<{ order: CustomerOrder }>('/api/checkout-cancel', {
      method: 'POST',
      body: JSON.stringify({ orderId, token }),
    });
    return order;
  },

  async adminOrderAction(orderId: string, action: AdminAction, accessToken: string): Promise<PrivateOrder> {
    const { order } = await request<{ order: PrivateOrder }>('/api/admin-order-action', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ orderId, action }),
    });
    return order;
  },
};
