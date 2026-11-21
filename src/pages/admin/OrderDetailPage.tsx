import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatCents } from '../../../shared/money';
import { ADMIN_ACTION_LABEL, PICKUP_LABEL, STATUS_REASON_LABEL, allowedAdminActions } from '../../../shared/orderStatus';
import type { AdminAction, AdminOrderRow, OrderEventRow } from '../../../shared/types';
import {
  Notice,
  OrderStatusBadge,
  PaymentBadge,
  Spinner,
  formatDateTime,
  formatTime,
  useDocumentTitle,
} from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { useAdminAuth } from './AdminAuth';
import { ADMIN_ORDER_COLUMNS, requireSupabase } from './supabaseClient';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; order: AdminOrderRow; events: OrderEventRow[] };

const EVENT_LABEL: Record<string, string> = {
  request_submitted: 'Customer submitted a pay-later request',
  checkout_started: 'Customer started online checkout',
  payment_received: 'Stripe confirmed the online payment',
  checkout_released: 'Online checkout ended without payment; signs released',
  confirm: 'You confirmed the request',
  mark_paid: 'You recorded an in-person payment',
  complete: 'You marked it picked up',
  cancel: 'You canceled the order; signs released',
  clear_attention: 'You dismissed the warning',
  request_auto_released: 'Request released automatically (not confirmed in time)',
};

const ACTION_DONE: Record<AdminAction, string> = {
  confirm: 'Request confirmed. The customer was notified if they gave an email.',
  mark_paid: 'Payment recorded.',
  complete: 'Marked as picked up.',
  cancel: 'Order canceled and signs released.',
  clear_attention: 'Warning dismissed.',
};

async function fetchOrder(orderId: string): Promise<State> {
  const supabase = requireSupabase();
  const [orderResult, eventsResult] = await Promise.all([
    supabase.from('orders').select(ADMIN_ORDER_COLUMNS).eq('id', orderId).maybeSingle(),
    supabase.from('order_events').select('id, event, actor, detail, created_at').eq('order_id', orderId).order('created_at'),
  ]);
  if (orderResult.error) return { status: 'error', message: orderResult.error.message };
  if (!orderResult.data) return { status: 'missing' };
  return {
    status: 'ready',
    order: orderResult.data as unknown as AdminOrderRow,
    events: (eventsResult.data ?? []) as OrderEventRow[],
  };
}

export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const { getAccessToken } = useAdminAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState<AdminAction | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  useDocumentTitle(state.status === 'ready' ? `Order #${state.order.order_number}` : 'Order');

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((n) => n + 1);

  useEffect(() => {
    let active = true;
    fetchOrder(orderId).then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, [orderId, reloadKey]);

  async function run(action: AdminAction, order: AdminOrderRow) {
    if (action === 'cancel') {
      const warning =
        order.payment_status === 'paid'
          ? `Order #${order.order_number} is PAID. Canceling releases the signs but does not refund the customer. ` +
            'Refund them in your Stripe dashboard (or in person). Cancel anyway?'
          : `Cancel order #${order.order_number} and release its signs back into the shop?`;
      if (!window.confirm(warning)) return;
    }
    setBusy(action);
    setMessage(null);
    try {
      await api.adminOrderAction(order.id, action, await getAccessToken());
      setMessage({ tone: 'success', text: ACTION_DONE[action] });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof ApiError ? error.body.message : 'That action failed.' });
    } finally {
      setBusy(null);
      reload();
    }
  }

  if (state.status === 'loading') return <Spinner label="Loading order…" />;
  if (state.status === 'error') return <Notice tone="error" title="Couldn't load the order">{state.message}</Notice>;
  if (state.status === 'missing') return <Notice title="Order not found" action={<Link to="/admin">Back to orders</Link>} />;

  const { order, events } = state;
  const actions = allowedAdminActions(order);

  return (
    <>
      <p className="back-link">
        <Link to="/admin">← All orders</Link>
      </p>
      <div className="page-title-row">
        <h1>Order #{order.order_number}</h1>
        <span className="order-row-total">{formatCents(order.subtotal_cents, order.currency)}</span>
      </div>
      <div className="badges">
        <OrderStatusBadge status={order.status} />
        <PaymentBadge status={order.payment_status} />
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {order.attention_reason && (
        <Notice tone="error" title="Needs your review">
          {order.attention_reason}
        </Notice>
      )}

      {order.status === 'checkout_pending' && (
        <Notice tone="info" title="Customer is paying online">
          These signs are held until {formatTime(order.hold_expires_at)}. If Stripe doesn't confirm payment by then, the
          signs are released automatically.
        </Notice>
      )}

      {actions.length > 0 && (
        <div className="action-bar">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className={
                action === 'cancel'
                  ? 'button button-danger'
                  : action === 'clear_attention'
                    ? 'button button-secondary'
                    : 'button'
              }
              disabled={busy !== null}
              onClick={() => void run(action, order)}
            >
              {busy === action ? 'Working…' : ADMIN_ACTION_LABEL[action]}
            </button>
          ))}
        </div>
      )}

      <section className="card">
        <h2 className="h3">Customer</h2>
        <dl className="details-list">
          <div>
            <dt>Name</dt>
            <dd>{order.customer_name}</dd>
          </div>
          {order.customer_email && (
            <div>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${order.customer_email}?subject=Order%20%23${order.order_number}`}>{order.customer_email}</a>
              </dd>
            </div>
          )}
          {order.customer_phone && (
            <div>
              <dt>Phone</dt>
              <dd>
                <a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a> ·{' '}
                <a href={`sms:${order.customer_phone}`}>Text</a>
              </dd>
            </div>
          )}
          <div>
            <dt>Pickup</dt>
            <dd>{PICKUP_LABEL[order.pickup_method]}</dd>
          </div>
          {order.customer_notes && (
            <div>
              <dt>Notes</dt>
              <dd className="pre-wrap">{order.customer_notes}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="card">
        <h2 className="h3">Signs</h2>
        <ul className="order-items plain">
          {order.order_items.map((item) => (
            <li key={item.sign_id}>
              <Link to={`/admin/signs/${item.sign_id}`} className="order-item-name">
                {item.quantity} × {item.sign_name}
              </Link>
              <span>{formatCents(item.unit_price_cents * item.quantity, order.currency)}</span>
            </li>
          ))}
        </ul>
        <p className="summary-row">
          <span>Total</span>
          <strong>{formatCents(order.subtotal_cents, order.currency)}</strong>
        </p>
      </section>

      <section className="card">
        <h2 className="h3">Payment</h2>
        <dl className="details-list">
          <div>
            <dt>Customer chose</dt>
            <dd>{order.payment_choice === 'online' ? 'Pay online (Stripe)' : 'Pay later / in person'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              {order.payment_status === 'paid'
                ? `Paid ${order.paid_via === 'stripe' ? 'online via Stripe' : 'in person'}, ${formatDateTime(order.paid_at)}`
                : 'Not paid'}
            </dd>
          </div>
          {order.amount_paid_cents !== null && (
            <div>
              <dt>Amount received</dt>
              <dd>{formatCents(order.amount_paid_cents, order.currency)}</dd>
            </div>
          )}
          {order.stripe_checkout_session_id && (
            <div>
              <dt>Stripe session</dt>
              <dd className="mono small">{order.stripe_checkout_session_id}</dd>
            </div>
          )}
          {order.status_reason && (
            <div>
              <dt>Reason</dt>
              <dd>{STATUS_REASON_LABEL[order.status_reason] ?? order.status_reason}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="card">
        <h2 className="h3">History</h2>
        <ol className="timeline">
          {events.map((event) => (
            <li key={event.id}>
              <time dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
              <span>{EVENT_LABEL[event.event] ?? event.event}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
