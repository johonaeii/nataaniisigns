import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/config';
import type { EmailMessage, Mailer } from '../../server/email';
import { createNotifier } from '../../server/notifications';
import type { PrivateOrder } from '../../shared/types';

function recordingMailer(): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { enabled: true, sent, send: async (m) => (sent.push(m), true) };
}

const order = (overrides: Partial<PrivateOrder> = {}): PrivateOrder => ({
  id: '00000000-0000-4000-8000-000000000001',
  order_number: 1042,
  status: 'requested',
  status_reason: null,
  payment_choice: 'pay_later',
  payment_status: 'unpaid',
  paid_via: null,
  paid_at: null,
  pickup_method: 'market',
  subtotal_cents: 4500,
  currency: 'usd',
  hold_expires_at: null,
  created_at: '2026-11-21T12:00:00Z',
  updated_at: '2026-11-21T12:00:00Z',
  customer_first_name: 'Ada',
  has_email: true,
  items: [{ sign_id: 's1', sign_name: '<b>Welcome</b>', unit_price_cents: 4500, quantity: 1, image_path: null }],
  customer_name: 'Ada <script>',
  customer_email: 'ada@example.com',
  customer_phone: null,
  customer_notes: 'Saturday works',
  stripe_checkout_session_id: null,
  stripe_payment_intent_id: null,
  amount_paid_cents: null,
  attention_reason: null,
  confirmed_at: null,
  canceled_at: null,
  completed_at: null,
  ...overrides,
});

const config = loadConfig({ SITE_URL: 'https://shop.test', OWNER_EMAIL: 'owner@example.com' });

describe('notifications', () => {
  it('emails the customer (with their link) and the owner (with contact details) for a new request', async () => {
    const mailer = recordingMailer();
    await createNotifier(config, mailer).requestSubmitted(order(), 'https://shop.test/order/x?t=abc');

    const [customer, owner] = mailer.sent;
    expect(customer.to).toBe('ada@example.com');
    expect(customer.text).toContain('Nothing has been charged');
    expect(customer.text).toContain('https://shop.test/order/x?t=abc');
    expect(customer.replyTo).toBe('owner@example.com');
    expect(owner.to).toBe('owner@example.com');
    expect(owner.text).toContain('ada@example.com');
    expect(owner.text).toContain('https://shop.test/admin/orders/');
  });

  it('escapes customer-provided text in HTML emails', async () => {
    const mailer = recordingMailer();
    await createNotifier(config, mailer).requestSubmitted(order(), 'https://shop.test/o');
    for (const message of mailer.sent) {
      expect(message.html).not.toContain('<script>');
      expect(message.html).not.toContain('<b>Welcome</b>');
      expect(message.html).toContain('&lt;b&gt;Welcome&lt;/b&gt;');
    }
  });

  it('skips the customer email when only a phone number was given', async () => {
    const mailer = recordingMailer();
    await createNotifier(config, mailer).paymentReceived(order({ customer_email: null, customer_phone: '5055550142' }));
    expect(mailer.sent.map((m) => m.to)).toEqual(['owner@example.com']);
  });

  it('does not tell a paid customer "nothing was charged" when canceling', async () => {
    const mailer = recordingMailer();
    await createNotifier(config, mailer).ownerAction(order({ payment_status: 'paid' }), 'cancel');
    expect(mailer.sent[0].text).not.toContain('nothing was charged');
    expect(mailer.sent[0].text).toContain('refund');
  });
});
