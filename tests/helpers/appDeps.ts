import Stripe from 'stripe';
import { loadConfig, type ServerConfig } from '../../server/config';
import type { AppDeps } from '../../server/deps';
import { silentLogger } from '../../server/log';
import type { Notifier } from '../../server/notifications';
import { createOrderRepo } from '../../server/orders';
import type { PaymentGateway } from '../../server/payments';
import type { TestDb } from './testDb';

export const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests';
const stripeForSigning = new Stripe('sk_test_signing_only');

export interface FakePayments extends PaymentGateway {
  sessions: Map<string, Stripe.Checkout.Session>;
  created: Array<{ params: Stripe.Checkout.SessionCreateParams; idempotencyKey: string }>;
  expired: string[];
  failNextCreate: boolean;
  /** Simulate the customer paying on Stripe's page. */
  complete(sessionId: string, paymentStatus?: 'paid' | 'unpaid'): Stripe.Checkout.Session;
}

/** In-memory stand-in for Stripe. Webhook signatures are verified with Stripe's real code. */
export function createFakePayments(): FakePayments {
  let counter = 0;
  const fake: FakePayments = {
    sessions: new Map(),
    created: [],
    expired: [],
    failNextCreate: false,

    async createCheckoutSession(params, { idempotencyKey }) {
      fake.created.push({ params, idempotencyKey });
      if (fake.failNextCreate) {
        fake.failNextCreate = false;
        throw new Error('Stripe is unavailable');
      }
      counter += 1;
      const id = `cs_test_${counter}`;
      const amount = (params.line_items ?? []).reduce(
        (sum, li) => sum + (li.price_data?.unit_amount ?? 0) * (li.quantity ?? 1),
        0,
      );
      const session = {
        id,
        object: 'checkout.session',
        status: 'open',
        payment_status: 'unpaid',
        url: `https://checkout.stripe.test/${id}`,
        expires_at: params.expires_at,
        amount_total: amount,
        currency: 'usd',
        metadata: params.metadata ?? {},
        client_reference_id: params.client_reference_id ?? null,
        payment_intent: null,
      } as unknown as Stripe.Checkout.Session;
      fake.sessions.set(id, session);
      return { ...session };
    },

    async retrieveCheckoutSession(id) {
      const session = fake.sessions.get(id);
      if (!session) throw new Error(`No such checkout.session: ${id}`);
      return { ...session };
    },

    async expireCheckoutSession(id) {
      const session = fake.sessions.get(id);
      if (!session) throw new Error(`No such checkout.session: ${id}`);
      if (session.status !== 'open') throw new Error('Only open sessions can be expired');
      session.status = 'expired';
      fake.expired.push(id);
      return { ...session };
    },

    constructWebhookEvent(payload, signature) {
      return stripeForSigning.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET);
    },

    complete(sessionId, paymentStatus = 'paid') {
      const session = fake.sessions.get(sessionId)!;
      session.status = 'complete';
      session.payment_status = paymentStatus;
      session.payment_intent = `pi_for_${sessionId}`;
      return { ...session };
    },
  };
  return fake;
}

let eventCounter = 0;

export function stripeEvent(type: string, object: unknown): Record<string, unknown> {
  eventCounter += 1;
  return {
    id: `evt_test_${eventCounter}`,
    object: 'event',
    api_version: '2026-01-01',
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  };
}

export function signedWebhookRequest(event: unknown, secret = WEBHOOK_SECRET): Request {
  const payload = JSON.stringify(event);
  const signature = stripeForSigning.webhooks.generateTestHeaderString({ payload, secret });
  return new Request('https://shop.test/api/stripe-webhook', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body: payload,
  });
}

export type Notification = { kind: keyof Notifier; orderId: string; detail?: string };

export function createRecordingNotifier(): Notifier & { sent: Notification[] } {
  const sent: Notification[] = [];
  return {
    sent,
    requestSubmitted: async (order, link) => void sent.push({ kind: 'requestSubmitted', orderId: order.id, detail: link }),
    paymentReceived: async (order) => void sent.push({ kind: 'paymentReceived', orderId: order.id }),
    ownerAction: async (order, action) => void sent.push({ kind: 'ownerAction', orderId: order.id, detail: action }),
    requestAutoReleased: async (order) => void sent.push({ kind: 'requestAutoReleased', orderId: order.id }),
    attentionNeeded: async (order) => void sent.push({ kind: 'attentionNeeded', orderId: order.id }),
  };
}

export const TEST_ENV = {
  SITE_URL: 'https://shop.test',
  SUPABASE_URL: 'https://project.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

export interface TestDeps extends AppDeps {
  payments: FakePayments | null;
  notify: ReturnType<typeof createRecordingNotifier>;
}

export function buildDeps(
  t: TestDb,
  options: { adminId?: string; payments?: FakePayments | null; config?: Partial<ServerConfig> } = {},
): TestDeps {
  return {
    config: { ...loadConfig(TEST_ENV), ...options.config },
    repo: createOrderRepo(t.rpc),
    payments: options.payments === undefined ? createFakePayments() : options.payments,
    notify: createRecordingNotifier(),
    log: silentLogger,
    async verifyAdmin(header) {
      if (header === 'Bearer admin-token' && options.adminId) return { ok: true, userId: options.adminId };
      if (header === 'Bearer user-token') return { ok: false, status: 403 };
      return { ok: false, status: 401 };
    },
  };
}

export function postJson(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://shop.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
