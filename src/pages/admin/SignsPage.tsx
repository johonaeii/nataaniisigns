import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { formatCents } from '../../../shared/money';
import { HOLDING_STATUSES } from '../../../shared/orderStatus';
import type { Sign } from '../../../shared/types';
import { Notice, SignImage, Spinner, useDocumentTitle } from '../../components/ui';
import { requireSupabase } from './supabaseClient';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; signs: Sign[]; holds: Map<string, number> };

/** Units of each sign held by open orders (requested, confirmed, or mid-checkout). */
export async function fetchHolds(signId?: string): Promise<Map<string, number>> {
  let query = requireSupabase()
    .from('order_items')
    .select('sign_id, quantity, orders!inner(status)')
    .in('orders.status', [...HOLDING_STATUSES]);
  if (signId) query = query.eq('sign_id', signId);
  const { data, error } = await query;
  if (error) throw error;
  const holds = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ sign_id: string; quantity: number }>) {
    holds.set(row.sign_id, (holds.get(row.sign_id) ?? 0) + row.quantity);
  }
  return holds;
}

async function fetchSignsWithHolds(): Promise<State> {
  try {
    const [{ data, error }, holds] = await Promise.all([
      requireSupabase().from('signs').select('*').order('created_at', { ascending: false }),
      fetchHolds(),
    ]);
    if (error) throw error;
    return { status: 'ready', signs: (data ?? []) as Sign[], holds };
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }
}

export function SignsPage() {
  useDocumentTitle('Signs');
  const location = useLocation();
  const flash = (location.state as { message?: string } | null)?.message;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [toggleError, setToggleError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((n) => n + 1);

  useEffect(() => {
    let active = true;
    fetchSignsWithHolds().then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, [reloadKey]);

  async function toggleListed(sign: Sign) {
    setToggleError(null);
    const { data, error } = await requireSupabase()
      .from('signs')
      .update({ is_listed: !sign.is_listed })
      .eq('id', sign.id)
      .eq('version', sign.version)
      .select('id');
    if (error) setToggleError(error.message);
    else if (!data?.length) setToggleError(`"${sign.name}" changed in the meantime. The list has been refreshed; try again.`);
    reload();
  }

  return (
    <>
      <div className="page-title-row">
        <h1>Signs</h1>
        <Link to="/admin/signs/new" className="button">
          + Add a sign
        </Link>
      </div>
      {flash && <Notice tone="success">{flash}</Notice>}
      {toggleError && <Notice tone="error">{toggleError}</Notice>}
      {state.status === 'loading' && <Spinner label="Loading signs…" />}
      {state.status === 'error' && <Notice tone="error" title="Couldn't load signs">{state.message}</Notice>}
      {state.status === 'ready' && state.signs.length === 0 && (
        <div className="empty-state">
          <p>No signs yet.</p>
          <Link to="/admin/signs/new" className="button">
            Add your first sign
          </Link>
        </div>
      )}
      {state.status === 'ready' && state.signs.length > 0 && (
        <ul className="admin-list">
          {state.signs.map((sign) => {
            const held = state.holds.get(sign.id) ?? 0;
            return (
              <li key={sign.id} className="sign-row">
                <SignImage path={sign.image_paths[0]} alt="" className="cart-thumb" />
                <div className="sign-row-info">
                  <Link to={`/admin/signs/${sign.id}`} className="sign-row-name">
                    {sign.name}
                  </Link>
                  <p className="muted small">
                    {formatCents(sign.price_cents)} · {sign.quantity_available} available
                    {held > 0 && ` · ${held} on hold`}
                  </p>
                  <div className="badges">
                    {sign.is_listed ? (
                      sign.quantity_available > 0 ? (
                        <span className="badge badge-good">In shop</span>
                      ) : (
                        <span className="badge badge-muted">{held > 0 ? 'Held / sold out' : 'Sold out'}</span>
                      )
                    ) : (
                      <span className="badge badge-outline">Hidden</span>
                    )}
                  </div>
                </div>
                <div className="sign-row-actions">
                  <Link to={`/admin/signs/${sign.id}`} className="button button-secondary button-small">
                    Edit
                  </Link>
                  <button type="button" className="link-button" onClick={() => void toggleListed(sign)}>
                    {sign.is_listed ? 'Hide' : 'Show'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
