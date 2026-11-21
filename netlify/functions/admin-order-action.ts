// POST /api/admin-order-action — owner confirms/cancels/marks paid. Requires an admin session.
import { withDeps } from '../../server/context';
import { handleAdminOrderAction } from '../../server/handlers/adminOrderAction';

export default withDeps(handleAdminOrderAction);
