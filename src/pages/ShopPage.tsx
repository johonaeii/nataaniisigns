import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { formatCents } from '../../shared/money';
import { AddToCartButton } from '../components/AddToCartButton';
import { Notice, SignImage, useDocumentTitle } from '../components/ui';
import { CONTACT_EMAIL, IS_CONFIGURED, ONLINE_PAYMENTS_ENABLED, SHOP_TAGLINE } from '../config';
import { CatalogError, fetchAvailableSigns, type PublicSign } from '../lib/catalog';
import { orderPath, recentOrder } from '../lib/recentOrder';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; signs: PublicSign[] };

export function ShopPage() {
  useDocumentTitle(null);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [recent] = useState(() => recentOrder.get());

  useEffect(() => {
    const controller = new AbortController();
    fetchAvailableSigns(controller.signal)
      .then((signs) => setState({ status: 'ready', signs }))
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return;
        setState({
          status: 'error',
          message: error instanceof CatalogError ? error.message : "Couldn't load signs right now.",
        });
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <>
      <section className="intro" aria-labelledby="shop-heading">
        <h1 id="shop-heading">Signs in stock</h1>
        <p className="lead">{SHOP_TAGLINE}</p>
        <ol className="how-it-works">
          <li>Add signs to your cart.</li>
          <li>{ONLINE_PAYMENTS_ENABLED ? 'Pay online, or request them and pay in person.' : 'Request them. No payment needed now.'}</li>
          <li>Pick up at the market or arrange a local pickup.</li>
        </ol>
        <p className="custom-callout">
          Want something made just for you? <Link to="/custom">Request a custom sign →</Link>
        </p>
        {recent && (
          <p className="recent-order">
            <Link to={orderPath(recent)}>View your recent order #{recent.orderNumber}</Link>
          </p>
        )}
      </section>

      {!IS_CONFIGURED && (
        <Notice tone="warning" title="Shop not configured">
          Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to load inventory. See the README.
        </Notice>
      )}

      {state.status === 'loading' && (
        <div className="sign-grid" aria-busy="true" aria-label="Loading signs">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="sign-card skeleton" aria-hidden="true">
              <div className="sign-image placeholder" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          ))}
        </div>
      )}

      {state.status === 'error' && IS_CONFIGURED && (
        <Notice
          tone="error"
          title="Couldn't load signs"
          action={
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          }
        >
          {state.message}
        </Notice>
      )}

      {state.status === 'ready' && state.signs.length === 0 && (
        <div className="empty-state">
          <p className="empty-icon" aria-hidden="true">
            🪧
          </p>
          <h2>Everything's sold out right now</h2>
          <p>New signs are on the way. Check back soon or come see us at the market.</p>
          <p>
            <Link to="/custom" className="button">
              Request a custom sign
            </Link>
          </p>
          {CONTACT_EMAIL && (
            <p>
              Looking for something specific? <a href={`mailto:${CONTACT_EMAIL}`}>Email us</a>.
            </p>
          )}
        </div>
      )}

      {state.status === 'ready' && state.signs.length > 0 && (
        <ul className="sign-grid" aria-label="Available signs">
          {state.signs.map((sign, index) => (
            <li key={sign.id} className="sign-card">
              <Link to={`/signs/${sign.id}`} className="sign-card-link">
                <SignImage path={sign.image_paths[0]} alt={sign.name} eager={index < 4} />
                <h2 className="sign-name">{sign.name}</h2>
              </Link>
              <p className="sign-price">
                {formatCents(sign.price_cents)}
                {sign.quantity_available > 1 && <span className="stock-note"> · {sign.quantity_available} available</span>}
              </p>
              {sign.description && <p className="sign-desc">{sign.description}</p>}
              <AddToCartButton sign={sign} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
