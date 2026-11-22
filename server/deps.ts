import type { ServerConfig } from './config';
import type { CustomRequestRepo } from './customRequests';
import type { Logger } from './log';
import type { Notifier } from './notifications';
import type { OrderRepo } from './orders';
import type { PaymentGateway } from './payments';
import type { PhotoStore } from './photoStore';

export type AdminAuthResult = { ok: true; userId: string } | { ok: false; status: 401 | 403 };

/** Everything a request handler needs. Built from env in production, faked in tests. */
export interface AppDeps {
  config: ServerConfig;
  repo: OrderRepo;
  /** null when online payments are not configured. */
  payments: PaymentGateway | null;
  notify: Notifier;
  customRequests: CustomRequestRepo;
  /** Private storage for photos attached to custom sign requests. */
  customPhotos: PhotoStore;
  verifyAdmin(authorizationHeader: string | null): Promise<AdminAuthResult>;
  log: Logger;
}
