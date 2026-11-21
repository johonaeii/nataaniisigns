import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatCents } from '../../../shared/money';
import { PICKUP_LABEL } from '../../../shared/orderStatus';
import type { AdminOrderRow } from '../../../shared/types';
import { Notice, OrderStatusBadge, PaymentBadge, Spinner, formatDateTime, useDocumentTitle } from '../../components/ui';
import { ADMIN_ORDER_COLUMNS, requireSupabase } from './supabaseClient';

const TABS = {
  action: { label: 'Needs action', empty: 'Nothing needs your attention right now.' },
  open: { label: 'Open', empty: 'No open orders or requests.' },
  closed: { label: 'Closed', empty: 'No closed orders yet.' },
  all: { label: 'All', empty: 'No orders yet.' },
} as const;
type Tab = keyof typeof TABS;

function ordersQuery(tab: Tab) {
  const base = requireSupabase().from('orders').select(ADMIN_ORDER_COLUMNS).order('created_at', { ascending: false });
  switch (tab) {
    case 'action':
      return base.or('status.eq.requested,attention_reason.not.is.null').limit(200);
    case 'open':
      return base.in('status', ['checkout_pending', 'requested', 'confirmed']).limit(200);
    case 'closed':
      return base.in('status', ['completed', 'canceled', 'expired']).limit(100);
    case 'all':
      return base.limit(200);
  }
}

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; orders: AdminOrderRow[] };

export function OrdersPage() {
  useDocumentTitle('Orders');
  const [params, setParams] = useSearchParams();
  const tab: Tab = (params.get('tab') as Tab) in TABS ? (params.get('tab') as Tab) : 'action';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [actionCount, setActionCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [{ data, error }, count] = await Promise.all([
      ordersQuery(tab),
      requireSupabase()
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .or('status.eq.requested,attention_reason.not.is.null'),
    ]);
    if (error) setState({ status: 'error', message: error.message });
    else setState({ status: 'ready', orders: data as unknown as AdminOrderRow[] });
    setActionCount(count.count ?? null);
  }, [tab]);

  useEffect(() => {
    let active = true;
    const run = () => active && void load();
    run();
    // Refresh when the owner comes back to the tab (e.g. after a new request email).
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return (
    <>
      <div className="page-title-row">
        <h1>Orders</h1>
        <button type="button" className="button button-secondary button-small" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="tabs" role="tablist" aria-label="Filter orders">
        {(Object.keys(TABS) as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'tab active' : 'tab'}
            onClick={() => {
              setState({ status: 'loading' });
              setParams(key === 'action' ? {} : { tab: key });
            }}
          >
            {TABS[key].label}
            {key === 'action' && actionCount ? <span className="tab-count">{actionCount}</span> : null}
          </button>
        ))}
      </div>

      {state.status === 'loading' && <Spinner label="Loading orders…" />}
      {state.status === 'error' && <Notice tone="error" title="Couldn't load orders">{state.message}</Notice>}
      {state.status === 'ready' && state.orders.length === 0 && <p className="empty-inline">{TABS[tab].empty}</p>}
      {state.status === 'ready' && state.orders.length > 0 && (
        <ul className="admin-list">
          {state.orders.map((order) => (
            <li key={order.id}>
              <Link to={`/admin/orders/${order.id}`} className={order.attention_reason ? 'order-row attention' : 'order-row'}>
                <div className="order-row-top">
                  <strong>#{order.order_number}</strong>
                  <span>{order.customer_name}</span>
                  <span className="order-row-total">{formatCents(order.subtotal_cents, order.currency)}</span>
                </div>
                <div className="badges">
                  {order.attention_reason && <span className="badge badge-danger">Needs review</span>}
                  <OrderStatusBadge status={order.status} />
                  <PaymentBadge status={order.payment_status} />
                </div>
                <p className="muted small">
                  {order.order_items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.sign_name}`).join(', ')}
                </p>
                <p className="muted small">
                  {PICKUP_LABEL[order.pickup_method]} · {order.payment_choice === 'online' ? 'Chose online payment' : 'Pay later'} ·{' '}
                  {formatDateTime(order.created_at)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
