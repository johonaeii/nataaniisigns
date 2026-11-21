import { describe, expect, it } from 'vitest';
import {
  cartCount,
  cartReducer,
  cartSubtotal,
  emptyCart,
  findCartProblems,
  parseStoredCart,
  type CartSignInfo,
  type CartState,
} from '../../src/lib/cart';

const sign = (id: string, overrides: Partial<CartSignInfo> = {}): CartSignInfo => ({
  id,
  name: `Sign ${id}`,
  price_cents: 1000,
  quantity_available: 1,
  image_paths: [],
  ...overrides,
});

describe('cart reducer', () => {
  it('adds signs and totals them', () => {
    let cart = cartReducer(emptyCart, { type: 'add', sign: sign('a', { price_cents: 4500 }) });
    cart = cartReducer(cart, { type: 'add', sign: sign('b', { price_cents: 1250, quantity_available: 5 }) });
    cart = cartReducer(cart, { type: 'add', sign: sign('b', { price_cents: 1250, quantity_available: 5 }) });
    expect(cartCount(cart)).toBe(3);
    expect(cartSubtotal(cart)).toBe(4500 + 2 * 1250);
  });

  it('does not add more of a sign than is available', () => {
    let cart = cartReducer(emptyCart, { type: 'add', sign: sign('a') });
    cart = cartReducer(cart, { type: 'add', sign: sign('a') });
    expect(cartCount(cart)).toBe(1);
    expect(cartReducer(emptyCart, { type: 'add', sign: sign('x', { quantity_available: 0 }) })).toBe(emptyCart);
  });

  it('removes lines, including by setting quantity to zero', () => {
    let cart = cartReducer(emptyCart, { type: 'add', sign: sign('a') });
    cart = cartReducer(cart, { type: 'add', sign: sign('b') });
    cart = cartReducer(cart, { type: 'remove', signId: 'a' });
    expect(cart.lines.map((l) => l.signId)).toEqual(['b']);
    cart = cartReducer(cart, { type: 'setQuantity', signId: 'b', quantity: 0, max: 1 });
    expect(cart.lines).toEqual([]);
  });

  it('caps quantity changes at what is available', () => {
    let cart = cartReducer(emptyCart, { type: 'add', sign: sign('a', { quantity_available: 3 }) });
    cart = cartReducer(cart, { type: 'setQuantity', signId: 'a', quantity: 10, max: 3 });
    expect(cart.lines[0].quantity).toBe(3);
  });

  it('refreshes names and prices from the database', () => {
    let cart = cartReducer(emptyCart, { type: 'add', sign: sign('a', { price_cents: 1000 }) });
    cart = cartReducer(cart, { type: 'refresh', signs: [sign('a', { price_cents: 1500, name: 'Renamed' })] });
    expect(cart.lines[0]).toMatchObject({ name: 'Renamed', priceCents: 1500 });
  });
});

describe('cart problems', () => {
  const cart: CartState = {
    lines: [
      { signId: 'a', quantity: 1, name: 'A', priceCents: 100, imagePath: null },
      { signId: 'b', quantity: 3, name: 'B', priceCents: 100, imagePath: null },
      { signId: 'c', quantity: 1, name: 'C', priceCents: 100, imagePath: null },
    ],
  };

  it('flags sold-out, missing, and short lines', () => {
    const problems = findCartProblems(cart, [sign('a', { quantity_available: 0 }), sign('b', { quantity_available: 2 })]);
    expect(problems.get('a')).toEqual({ kind: 'unavailable' });
    expect(problems.get('b')).toEqual({ kind: 'not_enough', available: 2 });
    expect(problems.get('c')).toEqual({ kind: 'unavailable' }); // unlisted or deleted
  });
});

describe('stored cart parsing', () => {
  it('ignores corrupt or tampered data', () => {
    expect(parseStoredCart('not json')).toEqual(emptyCart);
    expect(parseStoredCart('{"lines": "nope"}')).toEqual(emptyCart);
    const parsed = parseStoredCart(
      JSON.stringify({
        lines: [
          { signId: 'a', quantity: 1, name: 'A', priceCents: 100, imagePath: null },
          { signId: 'b', quantity: -4, name: 'B', priceCents: 100, imagePath: null },
          { signId: 'c', quantity: 1, name: 'C', priceCents: 'free', imagePath: null },
        ],
      }),
    );
    expect(parsed.lines.map((l) => l.signId)).toEqual(['a']);
  });
});
