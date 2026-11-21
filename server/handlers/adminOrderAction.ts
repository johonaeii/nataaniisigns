import { adminActionSchema } from '../../shared/validation';
import { DbError } from '../db';
import type { AppDeps } from '../deps';
import { GENERIC_ERROR_MESSAGE, apiError, json, methodNotAllowed, readJson } from '../http';

/**
 * POST /api/admin-order-action { orderId, action }, with "Authorization: Bearer <Supabase access token>"
 *
 * The token is verified with Supabase Auth and the user must be in public.admins.
 * The database function re-checks admin membership and enforces allowed transitions.
 */
export async function handleAdminOrderAction(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  const auth = await deps.verifyAdmin(req.headers.get('authorization'));
  if (!auth.ok) {
    return auth.status === 401
      ? apiError(401, 'unauthorized', 'Please sign in again.')
      : apiError(403, 'forbidden', 'This account is not allowed to manage orders.');
  }

  const body = await readJson(req);
  const parsed = adminActionSchema.safeParse(body.ok ? body.value : null);
  if (!parsed.success) return apiError(400, 'invalid_request', 'Invalid order action.');
  const { orderId, action } = parsed.data;

  try {
    const result = await deps.repo.adminUpdateOrder(orderId, action, auth.userId);
    deps.log.info('admin_order_action', { orderId, action, userId: auth.userId });
    if (result.changed) await deps.notify.ownerAction(result.order, action);
    return json(200, { order: result.order });
  } catch (error) {
    if (error instanceof DbError) {
      if (error.message === 'INVALID_TRANSITION' || error.message === 'INVALID_ACTION') {
        return apiError(409, 'invalid_transition', 'This order has changed since you loaded it. Refresh to see its current state.');
      }
      if (error.message === 'ORDER_NOT_FOUND') return apiError(404, 'not_found', 'Order not found.');
      if (error.message === 'NOT_ADMIN') return apiError(403, 'forbidden', 'This account is not allowed to manage orders.');
    }
    deps.log.error('admin_order_action_failed', { orderId, action, error: String(error) });
    return apiError(500, 'server_error', GENERIC_ERROR_MESSAGE);
  }
}
