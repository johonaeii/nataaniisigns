// POST /api/stripe-webhook — verified Stripe events; the only path that marks online orders paid.
import { withDeps } from '../../server/context';
import { handleStripeWebhook } from '../../server/handlers/stripeWebhook';

export default withDeps(handleStripeWebhook);
