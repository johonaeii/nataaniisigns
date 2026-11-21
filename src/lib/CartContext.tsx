import { createContext, use, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import {
  CART_STORAGE_KEY,
  cartCount,
  cartReducer,
  cartSubtotal,
  loadCart,
  parseStoredCart,
  saveCart,
  type CartAction,
  type CartState,
} from './cart';

interface CartContextValue {
  cart: CartState;
  count: number;
  subtotalCents: number;
  dispatch: (action: CartAction) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, dispatch] = useReducer(cartReducer, undefined, loadCart);

  useEffect(() => saveCart(cart), [cart]);

  // Keep several open tabs in sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY) dispatch({ type: 'replace', state: parseStoredCart(event.newValue) });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(
    () => ({ cart, dispatch, count: cartCount(cart), subtotalCents: cartSubtotal(cart) }),
    [cart],
  );
  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart(): CartContextValue {
  const value = use(CartContext);
  if (!value) throw new Error('useCart must be used inside <CartProvider>');
  return value;
}
