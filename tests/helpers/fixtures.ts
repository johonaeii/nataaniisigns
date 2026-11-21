import { hashToken } from '../../server/tokens';
import { orderRequestSchema, type OrderRequest } from '../../shared/validation';
import type { CreateOrderInput } from '../../server/orders';

export const TEST_TOKEN = 'test-token-abcdefghijklmnopqrstuvwxyz';

export function orderRequest(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    items: [],
    customer: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '' },
    pickupMethod: 'market',
    notes: '',
    paymentChoice: 'pay_later',
    ...overrides,
  };
}

/** Parsed input for OrderRepo.createOrder. */
export function createInput(
  signIds: Array<string | { id: string; quantity: number }>,
  overrides: Partial<OrderRequest> = {},
  token = TEST_TOKEN,
): CreateOrderInput {
  const items = signIds.map((s) => (typeof s === 'string' ? { signId: s, quantity: 1 } : { signId: s.id, quantity: s.quantity }));
  return {
    request: orderRequestSchema.parse(orderRequest({ items, ...overrides })),
    accessTokenHash: hashToken(token),
    holdMinutes: 30,
  };
}
