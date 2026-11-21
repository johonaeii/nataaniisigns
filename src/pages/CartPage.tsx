import { useEffect } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { formatCents } from '../../shared/money';
import { Notice, QuantityStepper, SignImage, useDocumentTitle } from '../components/ui';
import type { LineProblem } from '../lib/cart';
import { useCart } from '../lib/CartContext';
import { loadCheckoutPage } from '../lib/lazyPages';
import { useCartAvailability } from '../lib/useCartAvailability';

export function CartPage() {
  useDocumentTitle('Your cart');
  const { cart, subtotalCents, dispatch } = useCart();
  const { state, problems, availableFor, recheck } = useCartAvailability();
  const navigate = useNavigate();
  const canCheckout = cart.lines.length > 0 && state.status === 'ready' && problems.size === 0;

  // Warm up the checkout bundle while the shopper reviews their cart.
  useEffect(() => {
    if (cart.lines.length > 0) void loadCheckoutPage().catch(() => undefined);
  }, [cart.lines.length]);

  if (state.status === 'redirect') return <Navigate to={state.to} replace />;

  if (cart.lines.length === 0) {
    return (
      <div className="empty-state">
        <h1>Your cart is empty</h1>
        <p>Browse what's in stock and add the signs you like.</p>
        <Link to="/" className="button">
          See signs
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1>Your cart</h1>

      {state.status === 'error' && (
        <Notice
          tone="error"
          title="Couldn't check availability"
          action={
            <button type="button" className="button button-secondary" onClick={recheck}>
              Try again
            </button>
          }
        >
          {state.message}
        </Notice>
      )}

      {problems.size > 0 && (
        <Notice tone="warning" title="Some signs need your attention">
          Someone else may have just reserved them. Remove or adjust the items marked below to continue.
        </Notice>
      )}

      <ul className="cart-lines" aria-label="Items in your cart">
        {cart.lines.map((line) => {
          const problem = problems.get(line.signId);
          const max = availableFor(line.signId);
          return (
            <li key={line.signId} className={problem ? 'cart-line has-problem' : 'cart-line'}>
              <SignImage path={line.imagePath} alt="" className="cart-thumb" />
              <div className="cart-line-info">
                <Link to={`/signs/${line.signId}`} className="cart-line-name">
                  {line.name}
                </Link>
                <p className="muted">{formatCents(line.priceCents)} each</p>
                {problem && <ProblemText problem={problem} />}
                <div className="cart-line-controls">
                  {max > 1 || line.quantity > 1 ? (
                    <QuantityStepper
                      value={line.quantity}
                      max={Math.max(1, max)}
                      label={`Quantity of ${line.name}`}
                      onChange={(quantity) => dispatch({ type: 'setQuantity', signId: line.signId, quantity, max })}
                    />
                  ) : (
                    <span className="muted">Qty 1</span>
                  )}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => dispatch({ type: 'remove', signId: line.signId })}
                    aria-label={`Remove ${line.name} from cart`}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="cart-line-total">{formatCents(line.priceCents * line.quantity)}</p>
            </li>
          );
        })}
      </ul>

      <div className="cart-summary">
        <p className="summary-row">
          <span>Total</span>
          <strong>{formatCents(subtotalCents)}</strong>
        </p>
        <p className="muted small">Pickup only, no shipping. You'll choose how to pay on the next step.</p>
        <button
          type="button"
          className="button button-block button-large"
          disabled={!canCheckout}
          onClick={() => navigate('/checkout')}
        >
          {state.status === 'checking' ? 'Checking availability…' : 'Continue to checkout'}
        </button>
        <Link to="/" className="button button-secondary button-block">
          Keep browsing
        </Link>
      </div>
    </>
  );
}

function ProblemText({ problem }: { problem: LineProblem }) {
  return (
    <p className="problem-text">
      {problem.kind === 'unavailable'
        ? 'No longer available. Please remove it.'
        : `Only ${problem.available} available now. Lower the quantity.`}
    </p>
  );
}
