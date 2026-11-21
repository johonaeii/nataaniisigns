// POST /api/checkout-cancel — customer backed out of Stripe Checkout; release the hold.
import { withDeps } from '../../server/context';
import { handleCheckoutCancel } from '../../server/handlers/checkoutCancel';

export default withDeps(handleCheckoutCancel);
