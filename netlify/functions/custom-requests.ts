// POST /api/custom-requests — submit a custom sign request with optional photos.
import { withDeps } from '../../server/context';
import { handleCreateCustomRequest } from '../../server/handlers/createCustomRequest';

export default withDeps(handleCreateCustomRequest);
