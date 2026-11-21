import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { vi } from 'vitest';
import type { CustomerOrder } from '../../shared/types';
import { CartProvider } from '../../src/lib/CartContext';

export function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

export function renderRoutes(routes: Array<{ path: string; element: React.ReactNode }>, url: string) {
  const router = createMemoryRouter(
    [...routes, { path: '*', element: <LocationProbe /> }],
    { initialEntries: [url] },
  );
  return { router, ...render(<CartProvider><RouterProvider router={router} /></CartProvider>) };
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

export function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function customerOrder(overrides: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    order_number: 1042,
    status: 'requested',
    status_reason: null,
    payment_choice: 'pay_later',
    payment_status: 'unpaid',
    paid_via: null,
    paid_at: null,
    pickup_method: 'market',
    subtotal_cents: 4500,
    currency: 'usd',
    hold_expires_at: null,
    created_at: '2026-11-21T12:00:00Z',
    updated_at: '2026-11-21T12:00:00Z',
    customer_first_name: 'Ada',
    has_email: true,
    items: [{ sign_id: 's1', sign_name: 'Welcome, Friends', unit_price_cents: 4500, quantity: 1, image_path: null }],
    ...overrides,
  };
}
