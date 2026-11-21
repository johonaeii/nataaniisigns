// POST /api/orders — create an order (pay-later request or online checkout).
import { withDeps } from '../../server/context';
import { handleCreateOrder } from '../../server/handlers/createOrder';

export default withDeps(handleCreateOrder);
