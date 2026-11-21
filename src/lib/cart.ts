// Cart state: a pure reducer (easy to test) plus localStorage persistence.
// The cart is only a wish list. Prices and availability are re-checked against
// the database before checkout, and the server decides the final amount.

import { MAX_CART_LINES, MAX_QUANTITY_PER_SIGN } from '../../shared/limits';

export interface CartLine {
  signId: string;
  quantity: number;
  /** Snapshot for display; refreshed from the database on the cart page. */
  name: string;
  priceCents: number;
  imagePath: string | null;
}

export interface CartState {
  lines: CartLine[];
}

export interface CartSignInfo {
  id: string;
  name: string;
  price_cents: number;
  quantity_available: number;
  image_paths: string[];
}

export type CartAction =
  | { type: 'add'; sign: CartSignInfo }
  | { type: 'setQuantity'; signId: string; quantity: number; max: number }
  | { type: 'remove'; signId: string }
  | { type: 'refresh'; signs: CartSignInfo[] }
  | { type: 'replace'; state: CartState }
  | { type: 'clear' };

export const emptyCart: CartState = { lines: [] };

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const { sign } = action;
      const max = Math.min(sign.quantity_available, MAX_QUANTITY_PER_SIGN);
      if (max < 1) return state;
      const existing = state.lines.find((line) => line.signId === sign.id);
      if (existing) {
        if (existing.quantity >= max) return state;
        return {
          lines: state.lines.map((line) =>
            line.signId === sign.id ? { ...line, quantity: line.quantity + 1 } : line,
          ),
        };
      }
      if (state.lines.length >= MAX_CART_LINES) return state;
      return {
        lines: [
          ...state.lines,
          {
            signId: sign.id,
            quantity: 1,
            name: sign.name,
            priceCents: sign.price_cents,
            imagePath: sign.image_paths[0] ?? null,
          },
        ],
      };
    }
    case 'setQuantity': {
      const quantity = Math.floor(action.quantity);
      if (!Number.isFinite(quantity) || quantity < 1) {
        return { lines: state.lines.filter((line) => line.signId !== action.signId) };
      }
      const capped = Math.min(quantity, Math.max(1, action.max), MAX_QUANTITY_PER_SIGN);
      return {
        lines: state.lines.map((line) => (line.signId === action.signId ? { ...line, quantity: capped } : line)),
      };
    }
    case 'remove':
      return { lines: state.lines.filter((line) => line.signId !== action.signId) };
    case 'refresh': {
      // Update display snapshots from fresh data. Unavailable lines stay so the
      // customer can see what happened; the cart page asks them to remove them.
      const byId = new Map(action.signs.map((sign) => [sign.id, sign]));
      return {
        lines: state.lines.map((line) => {
          const sign = byId.get(line.signId);
          return sign
            ? { ...line, name: sign.name, priceCents: sign.price_cents, imagePath: sign.image_paths[0] ?? null }
            : line;
        }),
      };
    }
    case 'replace':
      return action.state;
    case 'clear':
      return emptyCart;
  }
}

export function cartCount(state: CartState): number {
  return state.lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function cartSubtotal(state: CartState): number {
  return state.lines.reduce((sum, line) => sum + line.quantity * line.priceCents, 0);
}

export type LineProblem = { kind: 'unavailable' } | { kind: 'not_enough'; available: number };

/** Compare the cart to fresh data and describe any line that can't be ordered as-is. */
export function findCartProblems(state: CartState, fresh: CartSignInfo[]): Map<string, LineProblem> {
  const byId = new Map(fresh.map((sign) => [sign.id, sign]));
  const problems = new Map<string, LineProblem>();
  for (const line of state.lines) {
    const sign = byId.get(line.signId);
    if (!sign || sign.quantity_available < 1) problems.set(line.signId, { kind: 'unavailable' });
    else if (sign.quantity_available < line.quantity) {
      problems.set(line.signId, { kind: 'not_enough', available: sign.quantity_available });
    }
  }
  return problems;
}

const STORAGE_KEY = 'sign-shop:cart:v1';

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.signId === 'string' &&
    typeof v.name === 'string' &&
    Number.isInteger(v.quantity) &&
    (v.quantity as number) >= 1 &&
    Number.isInteger(v.priceCents) &&
    (v.imagePath === null || typeof v.imagePath === 'string')
  );
}

export function parseStoredCart(raw: string | null): CartState {
  if (!raw) return emptyCart;
  try {
    const parsed = JSON.parse(raw) as { lines?: unknown };
    if (!Array.isArray(parsed.lines)) return emptyCart;
    return { lines: parsed.lines.filter(isCartLine).slice(0, MAX_CART_LINES) };
  } catch {
    return emptyCart;
  }
}

export function loadCart(): CartState {
  try {
    return parseStoredCart(localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyCart; // storage disabled (e.g. some private browsing modes)
  }
}

export function saveCart(state: CartState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore: the cart still works for this page view.
  }
}

export const CART_STORAGE_KEY = STORAGE_KEY;
