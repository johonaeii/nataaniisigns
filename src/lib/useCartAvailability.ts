import { useCallback, useEffect, useMemo, useState } from 'react';
import { findCartProblems, type LineProblem } from './cart';
import { useCart } from './CartContext';
import { CatalogError, fetchSignsByIds, type PublicSign } from './catalog';
import { releasePendingCheckout } from './pendingCheckoutRelease';

export type AvailabilityState =
  | { status: 'checking' }
  | { status: 'ready'; signs: PublicSign[] }
  | { status: 'error'; message: string }
  | { status: 'redirect'; to: string };

/**
 * Re-check cart lines against the live catalog: refreshes names/prices and
 * reports lines that are sold out or short. First releases any unfinished
 * online checkout from this browser. The server re-checks everything at order time.
 */
export function useCartAvailability() {
  const { cart, dispatch } = useCart();
  const [state, setState] = useState<AvailabilityState>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const idsKey = cart.lines.map((line) => line.signId).sort().join(',');

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    const controller = new AbortController();
    releasePendingCheckout()
      .then(async ({ redirectTo }) => {
        if (controller.signal.aborted) return;
        if (redirectTo) {
          setState({ status: 'redirect', to: redirectTo });
          return;
        }
        const signs = await fetchSignsByIds(ids, controller.signal);
        setState({ status: 'ready', signs });
        dispatch({ type: 'refresh', signs });
      })
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return;
        setState({
          status: 'error',
          message: error instanceof CatalogError ? error.message : "Couldn't check availability.",
        });
      });
    return () => controller.abort();
  }, [idsKey, attempt, dispatch]);

  const recheck = useCallback(() => {
    setState({ status: 'checking' });
    setAttempt((n) => n + 1);
  }, []);

  // Pages restored from the browser's back/forward cache don't re-run effects.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) recheck();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [recheck]);

  const problems = useMemo<Map<string, LineProblem>>(
    () => (state.status === 'ready' ? findCartProblems(cart, state.signs) : new Map()),
    [cart, state],
  );

  const availableFor = useCallback(
    (signId: string) =>
      state.status === 'ready' ? (state.signs.find((s) => s.id === signId)?.quantity_available ?? 0) : 1,
    [state],
  );

  return { state, problems, availableFor, recheck };
}
