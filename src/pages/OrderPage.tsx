import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { formatCents } from '../../shared/money';
import { PICKUP_LABEL, STATUS_REASON_LABEL } from '../../shared/orderStatus';
import type { CustomerOrder } from '../../shared/types';
import {
  Notice,
  OrderStatusBadge,
  PaymentBadge,
  SignImage,
  Spinner,
  formatDateTime,
  formatTime,
  useDocumentTitle,
} from '../components/ui';
import { CONTACT_EMAIL } from '../config';
import { ApiError, api } from '../lib/api';
import { useCart } from '../lib/CartContext';
import { pendingCheckout } from '../lib/recentOrder';

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // about one minute

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; notFound: boolean }
  | { status: 'ready'; order: CustomerOrder };

export function OrderPage() {
  const { orderId = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const fromCheckout = params.get('from') === 'checkout';
  const canceledCheckout = params.get('canceled') === '1';
  const { dispatch } = useCart();

  const [state, setState] = useState<State>({ status: 'loading' });
  const [polls, setPolls] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  useDocumentTitle(state.status === 'ready' ? `Order #${state.order.order_number}` : 'Your order');

  // Initial load. Returning via Stripe's "back" link asks the server to release the hold.
  useEffect(() => {
    let active = true;
    const load = canceledCheckout ? api.cancelCheckout(orderId, token) : api.orderStatus(orderId, token);
    load
      .then((order) => active && setState({ status: 'ready', order }))
      .catch((error: unknown) => {
        if (!active) return;
        const apiError = error instanceof ApiError ? error : null;
        setState({
          status: 'error',
          message: apiError?.body.message ?? "Couldn't load your order.",
          notFound: apiError?.status === 404,
        });
      });
    return () => {
      active = false;
    };
  }, [orderId, token, canceledCheckout, refreshKey]);

  // After returning from Stripe, poll until the server has a verified payment.
  const order = state.status === 'ready' ? state.order : null;
  const awaitingWebhook = Boolean(order && fromCheckout && order.status === 'checkout_pending');
  const timedOut = polls >= MAX_POLLS;

  useEffect(() => {
    if (!awaitingWebhook || timedOut) return;
    const timer = window.setTimeout(() => {
      api
        .orderStatus(orderId, token)
        .then((next) => setState({ status: 'ready', order: next }))
        .catch(() => undefined) // keep showing the last known state; next poll retries
        .finally(() => setPolls((n) => n + 1));
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [awaitingWebhook, timedOut, polls, orderId, token]);

  // Clear the cart once an online checkout for it has been paid (or forget the
  // pending checkout if it ended without payment, keeping the cart).
  useEffect(() => {
    if (!order || pendingCheckout.get()?.orderId !== order.id) return;
    if (order.payment_status === 'paid') {
      dispatch({ type: 'clear' });
      pendingCheckout.clear();
    } else if (order.status === 'canceled' || order.status === 'expired') {
      pendingCheckout.clear();
    }
  }, [order, dispatch]);

  if (state.status === 'loading') {
    return <Spinner label={canceledCheckout ? 'Canceling checkout…' : 'Loading your order…'} />;
  }

  if (state.status === 'error') {
    return (
      <Notice
        tone="error"
        title={state.notFound ? 'Order not found' : "Couldn't load your order"}
        action={
          !state.notFound && (
            <button type="button" className="button button-secondary" onClick={() => setRefreshKey((n) => n + 1)}>
              Try again
            </button>
          )
        }
      >
        {state.message}
      </Notice>
    );
  }

  const o = state.order;
  const headline = describeOrder(o, { fromCheckout, timedOut });

  return (
    <>
      <div className={`order-hero order-hero-${headline.tone}`} role="status" aria-live="polite">
        <p className="order-hero-icon" aria-hidden="true">
          {headline.icon}
        </p>
        <h1>{headline.title}</h1>
        <div className="order-hero-body">{headline.body}</div>
        {headline.tone === 'pending' && <span className="spinner" aria-hidden="true" />}
        {headline.action}
      </div>

      <section className="order-details" aria-labelledby="order-details-heading">
        <h2 id="order-details-heading">Order #{o.order_number}</h2>
        <div className="badges">
          <OrderStatusBadge status={o.status} />
          <PaymentBadge status={o.payment_status} />
        </div>
        <dl className="details-list">
          <div>
            <dt>Placed</dt>
            <dd>{formatDateTime(o.created_at)}</dd>
          </div>
          <div>
            <dt>Pickup</dt>
            <dd>{PICKUP_LABEL[o.pickup_method]}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>
              {o.payment_status === 'paid'
                ? `Paid ${o.paid_via === 'stripe' ? 'online' : 'in person'}${o.paid_at ? `, ${formatDateTime(o.paid_at)}` : ''}`
                : o.payment_choice === 'online'
                  ? 'Online (not completed)'
                  : 'In person at pickup'}
            </dd>
          </div>
        </dl>

        <ul className="order-items">
          {o.items.map((item) => (
            <li key={item.sign_id}>
              <SignImage path={item.image_path} alt="" className="cart-thumb" />
              <span className="order-item-name">
                {item.quantity} × {item.sign_name}
              </span>
              <span>{formatCents(item.unit_price_cents * item.quantity, o.currency)}</span>
            </li>
          ))}
        </ul>
        <p className="summary-row">
          <span>Total</span>
          <strong>{formatCents(o.subtotal_cents, o.currency)}</strong>
        </p>
      </section>

      <p className="hint center">
        Bookmark this page to check on your order later.
        {CONTACT_EMAIL && (
          <>
            {' '}
            Questions? <a href={`mailto:${CONTACT_EMAIL}?subject=Order%20%23${o.order_number}`}>Email us</a>.
          </>
        )}
      </p>
      <p className="center">
        <Link to="/">Back to the shop</Link>
      </p>
    </>
  );
}

interface Headline {
  tone: 'success' | 'pending' | 'info' | 'warning';
  icon: string;
  title: string;
  body: ReactNode;
  action?: ReactNode;
}

function describeOrder(o: CustomerOrder, ctx: { fromCheckout: boolean; timedOut: boolean }): Headline {

  if (o.status === 'canceled' || o.status === 'expired') {
    if (o.payment_status === 'paid') {
      return {
        tone: 'warning',
        icon: '!',
        title: 'This order was canceled after payment',
        body: <p>We'll be in touch about a refund. Please contact us if you have any questions.</p>,
      };
    }
    if (o.status_reason === 'customer_canceled') {
      return {
        tone: 'info',
        icon: '↩',
        title: 'Checkout canceled',
        body: <p>You weren't charged, and the signs were released. Your cart is still saved if you'd like to try again.</p>,
        action: (
          <Link to="/cart" className="button">
            Back to cart
          </Link>
        ),
      };
    }
    return {
      tone: 'info',
      icon: 'ℹ',
      title: o.status === 'expired' ? 'Checkout expired' : 'Order canceled',
      body: (
        <p>
          {(o.status_reason && STATUS_REASON_LABEL[o.status_reason]) || ''} Nothing was charged.
        </p>
      ),
      action: (
        <Link to="/" className="button button-secondary">
          See what's in stock
        </Link>
      ),
    };
  }

  if (o.payment_status === 'paid') {
    return {
      tone: 'success',
      icon: '✓',
      title: o.status === 'completed' ? 'Picked up. Thank you!' : 'Payment received. Thank you!',
      body: (
        <p>
          {o.status === 'completed'
            ? 'Enjoy your signs!'
            : `Your signs are reserved for you, ${o.customer_first_name}. Show your order number at pickup.`}
        </p>
      ),
    };
  }

  if (o.status === 'requested') {
    return {
      tone: 'success',
      icon: '✓',
      title: 'Request submitted',
      body: (
        <>
          <p>
            Thanks, {o.customer_first_name}! Your signs are held for you. <strong>Nothing has been charged.</strong>
          </p>
          <p>We'll contact you to confirm and arrange payment and pickup.</p>
        </>
      ),
    };
  }

  if (o.status === 'confirmed') {
    return {
      tone: 'success',
      icon: '✓',
      title: 'Request confirmed',
      body: <p>Your signs are set aside for you. Pay in person at pickup.</p>,
    };
  }

  // checkout_pending
  if (ctx.fromCheckout && !ctx.timedOut) {
    return {
      tone: 'pending',
      icon: '…',
      title: 'Confirming your payment',
      body: <p>Waiting for Stripe to confirm your payment. This usually takes a few seconds. Please don't pay again.</p>,
    };
  }
  if (ctx.fromCheckout) {
    return {
      tone: 'warning',
      icon: '…',
      title: 'Still waiting for payment confirmation',
      body: (
        <p>
          If you completed payment, it will show here shortly. Your signs stay held until{' '}
          {formatTime(o.hold_expires_at)}. Please don't pay twice.
        </p>
      ),
      action: (
        <button type="button" className="button button-secondary" onClick={() => window.location.reload()}>
          Refresh
        </button>
      ),
    };
  }
  return {
    tone: 'info',
    icon: '…',
    title: 'Waiting for online payment',
    body: (
      <p>
        This checkout is open until {formatTime(o.hold_expires_at)}. If payment isn't completed by then, the signs
        are released and nothing is charged.
      </p>
    ),
  };
}
