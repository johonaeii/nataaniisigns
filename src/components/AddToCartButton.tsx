import { Link } from 'react-router';
import { useCart } from '../lib/CartContext';
import type { PublicSign } from '../lib/catalog';

export function AddToCartButton({ sign, className = '' }: { sign: PublicSign; className?: string }) {
  const { cart, dispatch } = useCart();
  const inCart = cart.lines.find((line) => line.signId === sign.id)?.quantity ?? 0;
  const atMax = inCart >= sign.quantity_available;

  if (sign.quantity_available < 1) {
    return (
      <button type="button" className={`button button-block ${className}`} disabled>
        Sold out
      </button>
    );
  }

  if (atMax) {
    return (
      <Link to="/cart" className={`button button-secondary button-block ${className}`}>
        ✓ In cart · View cart
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={`button button-block ${className}`}
      onClick={() => dispatch({ type: 'add', sign })}
      aria-label={`Add ${sign.name} to cart`}
    >
      {inCart > 0 ? `Add another (${inCart} in cart)` : 'Add to cart'}
    </button>
  );
}
