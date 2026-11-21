import { formatCents } from '../shared/money';
import { PICKUP_LABEL } from '../shared/orderStatus';
import type { AdminAction, PrivateOrder } from '../shared/types';
import type { ServerConfig } from './config';
import { escapeHtml, type EmailMessage, type Mailer } from './email';

/** Customer and owner emails for order events. All methods are best-effort. */
export interface Notifier {
  requestSubmitted(order: PrivateOrder, orderLink: string): Promise<void>;
  paymentReceived(order: PrivateOrder): Promise<void>;
  ownerAction(order: PrivateOrder, action: AdminAction): Promise<void>;
  requestAutoReleased(order: PrivateOrder): Promise<void>;
  attentionNeeded(order: PrivateOrder): Promise<void>;
}

interface EmailContent {
  heading: string;
  paragraphs: string[];
  order: PrivateOrder;
  showContact?: boolean;
  link?: { href: string; label: string };
}

function render(config: ServerConfig, content: EmailContent): Pick<EmailMessage, 'text' | 'html'> {
  const { order } = content;
  const lines = order.items.map(
    (item) =>
      `${item.quantity} × ${item.sign_name} — ${formatCents(item.unit_price_cents * item.quantity, order.currency)}`,
  );
  const total = formatCents(order.subtotal_cents, order.currency);
  const contact = [
    `Name: ${order.customer_name}`,
    order.customer_email ? `Email: ${order.customer_email}` : null,
    order.customer_phone ? `Phone: ${order.customer_phone}` : null,
  ].filter((line): line is string => line !== null);
  const pickup = PICKUP_LABEL[order.pickup_method];
  const notes = order.customer_notes ? `Notes: ${order.customer_notes}` : null;

  const text = [
    content.heading,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    `Order #${order.order_number}`,
    ...lines,
    `Total: ${total}`,
    `Pickup: ${pickup}`,
    ...(notes ? [notes] : []),
    ...(content.showContact ? ['', ...contact] : []),
    ...(content.link ? ['', `${content.link.label}: ${content.link.href}`] : []),
    '',
    `— ${config.shopName}`,
  ].join('\n');

  const rows = order.items
    .map(
      (item) =>
        `<tr><td style="padding:4px 12px 4px 0">${item.quantity} × ${escapeHtml(item.sign_name)}</td>` +
        `<td style="padding:4px 0;text-align:right">${formatCents(item.unit_price_cents * item.quantity, order.currency)}</td></tr>`,
    )
    .join('');

  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f1a17;line-height:1.5;max-width:560px;margin:0 auto;padding:16px">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(content.heading)}</h1>
${content.paragraphs.map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`).join('\n')}
<h2 style="font-size:16px;margin:20px 0 8px">Order #${order.order_number}</h2>
<table style="border-collapse:collapse;width:100%">${rows}
<tr><td style="padding:8px 12px 4px 0;border-top:1px solid #ddd"><strong>Total</strong></td><td style="padding:8px 0 4px;border-top:1px solid #ddd;text-align:right"><strong>${total}</strong></td></tr></table>
<p style="margin:12px 0 0"><strong>Pickup:</strong> ${escapeHtml(pickup)}</p>
${notes ? `<p style="margin:4px 0 0"><strong>Notes:</strong> ${escapeHtml(order.customer_notes)}</p>` : ''}
${content.showContact ? `<p style="margin:12px 0 0">${contact.map(escapeHtml).join('<br>')}</p>` : ''}
${content.link ? `<p style="margin:20px 0 0"><a href="${escapeHtml(content.link.href)}" style="background:#1f5f5b;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(content.link.label)}</a></p>` : ''}
<p style="margin:24px 0 0;color:#6b625c">— ${escapeHtml(config.shopName)}</p>
</body></html>`;

  return { text, html };
}

export function createNotifier(config: ServerConfig, mailer: Mailer): Notifier {
  const adminLink = (order: PrivateOrder) =>
    config.siteUrl ? { href: `${config.siteUrl}/admin/orders/${order.id}`, label: 'Open in admin' } : undefined;

  async function toCustomer(order: PrivateOrder, subject: string, content: Omit<EmailContent, 'order'>) {
    if (!order.customer_email) return;
    await mailer.send({
      to: order.customer_email,
      subject,
      replyTo: config.ownerEmail ?? undefined,
      ...render(config, { ...content, order }),
    });
  }

  async function toOwner(order: PrivateOrder, subject: string, content: Omit<EmailContent, 'order'>) {
    if (!config.ownerEmail) return;
    await mailer.send({
      to: config.ownerEmail,
      subject,
      replyTo: order.customer_email ?? undefined,
      ...render(config, { ...content, order, showContact: true, link: adminLink(order) }),
    });
  }

  return {
    async requestSubmitted(order, orderLink) {
      await Promise.all([
        toCustomer(order, `${config.shopName}: request #${order.order_number} received`, {
          heading: `Thanks, ${order.customer_first_name}! Your request was received.`,
          paragraphs: [
            'These signs are now held for you and no one else can buy them.',
            'Nothing has been charged. We will contact you to confirm and arrange payment and pickup.',
          ],
          link: { href: orderLink, label: 'View your request' },
        }),
        toOwner(order, `New request #${order.order_number} from ${order.customer_name}`, {
          heading: 'New pay-later request',
          paragraphs: ['The signs below are held. Confirm or cancel the request in the admin area.'],
        }),
      ]);
    },

    async paymentReceived(order) {
      await Promise.all([
        toCustomer(order, `${config.shopName}: payment received for order #${order.order_number}`, {
          heading: `Thank you, ${order.customer_first_name}! Your payment was received.`,
          paragraphs: ['Your signs are reserved for you. Show this email or your order number at pickup.'],
        }),
        toOwner(order, `Paid order #${order.order_number} from ${order.customer_name}`, {
          heading: 'New paid order',
          paragraphs: ['Stripe confirmed the payment. The signs below are sold and waiting for pickup.'],
        }),
      ]);
    },

    async ownerAction(order, action) {
      const n = order.order_number;
      switch (action) {
        case 'confirm':
          await toCustomer(order, `${config.shopName}: request #${n} confirmed`, {
            heading: 'Your request is confirmed',
            paragraphs: ['Your signs are set aside for you. You can pay at pickup.'],
          });
          return;
        case 'mark_paid':
          await toCustomer(order, `${config.shopName}: payment received for order #${n}`, {
            heading: 'Payment received — thank you!',
            paragraphs: ['We recorded your in-person payment.'],
          });
          return;
        case 'cancel':
          await toCustomer(order, `${config.shopName}: order #${n} canceled`, {
            heading: 'Your order was canceled',
            paragraphs: [
              order.payment_status === 'paid'
                ? 'Your order was canceled. If you paid online, your refund will be handled separately. Reply to this email with any questions.'
                : 'Your order was canceled and nothing was charged. Reply to this email with any questions.',
            ],
          });
          return;
        default:
          return;
      }
    },

    async requestAutoReleased(order) {
      await toCustomer(order, `${config.shopName}: request #${order.order_number} released`, {
        heading: 'Your request was released',
        paragraphs: [
          'We were not able to confirm your request in time, so the signs were released. Nothing was charged.',
          'You are welcome to place a new request if the signs are still available.',
        ],
      });
    },

    async attentionNeeded(order) {
      await toOwner(order, `Action needed on order #${order.order_number}`, {
        heading: 'An order needs your attention',
        paragraphs: [order.attention_reason ?? 'Please review this order.'],
      });
    },
  };
}

/** Notifier that does nothing; useful when email isn't configured and in tests. */
export const nullNotifier: Notifier = {
  requestSubmitted: async () => {},
  paymentReceived: async () => {},
  ownerAction: async () => {},
  requestAutoReleased: async () => {},
  attentionNeeded: async () => {},
};
