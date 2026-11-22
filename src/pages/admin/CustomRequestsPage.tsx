import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { CUSTOM_STATUS_LABEL, customRequestRef } from '../../../shared/customRequests';
import type { CustomRequestRow, CustomRequestStatus } from '../../../shared/types';
import { Notice, Spinner, formatDateTime, useDocumentTitle } from '../../components/ui';
import { requireSupabase } from './supabaseClient';

export const CUSTOM_REQUEST_COLUMNS =
  'id, request_number, status, customer_name, customer_email, customer_phone, description, photo_paths, created_at, updated_at';

const TABS = {
  new: { label: 'New', statuses: ['new'], empty: 'No new requests.' },
  in_progress: { label: 'In progress', statuses: ['in_progress'], empty: 'Nothing in progress.' },
  closed: { label: 'Closed', statuses: ['completed', 'declined'], empty: 'No closed requests yet.' },
  all: { label: 'All', statuses: null, empty: 'No custom requests yet.' },
} as const satisfies Record<string, { label: string; statuses: readonly CustomRequestStatus[] | null; empty: string }>;
type Tab = keyof typeof TABS;

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; requests: CustomRequestRow[]; newCount: number };

async function fetchRequests(tab: Tab): Promise<State> {
  const supabase = requireSupabase();
  let query = supabase.from('custom_requests').select(CUSTOM_REQUEST_COLUMNS).order('created_at', { ascending: false }).limit(200);
  const statuses = TABS[tab].statuses;
  if (statuses) query = query.in('status', [...statuses]);
  const [{ data, error }, count] = await Promise.all([
    query,
    supabase.from('custom_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
  ]);
  if (error) return { status: 'error', message: error.message };
  return { status: 'ready', requests: (data ?? []) as CustomRequestRow[], newCount: count.count ?? 0 };
}

export function CustomStatusBadge({ status }: { status: CustomRequestStatus }) {
  const tone = { new: 'pending', in_progress: 'done', completed: 'good', declined: 'muted' }[status];
  return (
    <span className={`badge badge-${tone}`}>
      <span className="visually-hidden">Status: </span>
      {CUSTOM_STATUS_LABEL[status]}
    </span>
  );
}

export function CustomRequestsPage() {
  useDocumentTitle('Custom requests');
  const location = useLocation();
  const flash = (location.state as { message?: string } | null)?.message;
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = tabParam && tabParam in TABS ? (tabParam as Tab) : 'new';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetchRequests(tab).then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, [tab, reloadKey]);

  return (
    <>
      <div className="page-title-row">
        <h1>Custom requests</h1>
        <button type="button" className="button button-secondary button-small" onClick={() => setReloadKey((n) => n + 1)}>
          Refresh
        </button>
      </div>
      {flash && <Notice tone="success">{flash}</Notice>}

      <div className="tabs" role="tablist" aria-label="Filter custom requests">
        {(Object.keys(TABS) as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'tab active' : 'tab'}
            onClick={() => {
              setState({ status: 'loading' });
              setParams(key === 'new' ? {} : { tab: key });
            }}
          >
            {TABS[key].label}
            {key === 'new' && state.status === 'ready' && state.newCount > 0 && (
              <span className="tab-count">{state.newCount}</span>
            )}
          </button>
        ))}
      </div>

      {state.status === 'loading' && <Spinner label="Loading requests…" />}
      {state.status === 'error' && <Notice tone="error" title="Couldn't load requests">{state.message}</Notice>}
      {state.status === 'ready' && state.requests.length === 0 && <p className="empty-inline">{TABS[tab].empty}</p>}
      {state.status === 'ready' && state.requests.length > 0 && (
        <ul className="admin-list">
          {state.requests.map((request) => (
            <li key={request.id}>
              <Link to={`/admin/custom/${request.id}`} className="order-row">
                <div className="order-row-top">
                  <strong>{customRequestRef(request.request_number)}</strong>
                  <span>{request.customer_name}</span>
                  <span className="order-row-total muted small">{formatDateTime(request.created_at)}</span>
                </div>
                <div className="badges">
                  <CustomStatusBadge status={request.status} />
                  {request.photo_paths.length > 0 && (
                    <span className="badge badge-outline">
                      {request.photo_paths.length} photo{request.photo_paths.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <p className="muted small clamp-2">{request.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
