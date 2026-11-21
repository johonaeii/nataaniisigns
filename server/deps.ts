import type { ServerConfig } from './config';
import type { Logger } from './log';
import type { Notifier } from './notifications';
import type { OrderRepo } from './orders';
import type { PaymentGateway } from './payments';

export type AdminAuthResult = { ok: true; userId: string } | { ok: false; status: 401 | 403 };

/** Everything a request handler needs. Built from env in production, faked in tests. */
export interface AppDeps {
  config: ServerConfig;
  repo: OrderRepo;
  /** null when online payments are not configured. */
  payments: PaymentGateway | null;
  notify: Notifier;
  verifyAdmin(authorizationHeader: string | null): Promise<AdminAuthResult>;
  log: Logger;
}
