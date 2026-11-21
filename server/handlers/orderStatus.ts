import { orderLookupSchema } from '../../shared/validation';
import type { AppDeps } from '../deps';
import { GENERIC_ERROR_MESSAGE, apiError, json, methodNotAllowed } from '../http';
import { hashToken } from '../tokens';

const NOT_FOUND_MESSAGE = 'We could not find that order. Please check the link.';

/** GET /api/order-status?id=<order id>&t=<token>. Read-only status for the customer's link. */
export async function handleOrderStatus(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'GET') return methodNotAllowed(['GET']);

  const url = new URL(req.url);
  const parsed = orderLookupSchema.safeParse({
    orderId: url.searchParams.get('id'),
    token: url.searchParams.get('t'),
  });
  if (!parsed.success) return apiError(404, 'not_found', NOT_FOUND_MESSAGE);

  try {
    const order = await deps.repo.getOrderForCustomer(parsed.data.orderId, hashToken(parsed.data.token));
    if (!order) return apiError(404, 'not_found', NOT_FOUND_MESSAGE);
    return json(200, { order });
  } catch (error) {
    deps.log.error('order_status_failed', { error: String(error) });
    return apiError(500, 'server_error', GENERIC_ERROR_MESSAGE);
  }
}
