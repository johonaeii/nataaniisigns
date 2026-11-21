// GET /api/order-status?id=…&t=… — customer's view of their order.
import { withDeps } from '../../server/context';
import { handleOrderStatus } from '../../server/handlers/orderStatus';

export default withDeps(handleOrderStatus);
