// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrderPage } from '../../src/pages/OrderPage';
import { customerOrder, jsonResponse, mockFetch, renderRoutes } from './helpers';

const ID = '00000000-0000-4000-8000-000000000001';
const routes = [{ path: '/order/:orderId', element: <OrderPage /> }];

describe('order confirmation page', () => {
  it('does not claim payment succeeded just because Stripe redirected back', async () => {
    let paid = false;
    mockFetch(() =>
      jsonResponse({
        order: customerOrder({
          payment_choice: 'online',
          status: paid ? 'confirmed' : 'checkout_pending',
          payment_status: paid ? 'paid' : 'unpaid',
          hold_expires_at: '2026-11-21T12:31:00Z',
        }),
      }),
    );

    renderRoutes(routes, `/order/${ID}?t=secret-token-123456789012&from=checkout`);

    expect(await screen.findByRole('heading', { name: /confirming your payment/i })).toBeTruthy();
    expect(screen.queryByText(/payment received/i)).toBeNull();
    expect(screen.getByText('Not paid')).toBeTruthy();

    paid = true; // the verified webhook has now recorded the payment on the server
    expect(await screen.findByRole('heading', { name: /payment received/i }, { timeout: 5000 })).toBeTruthy();
  });

  it('confirms a pay-later request without implying payment', async () => {
    mockFetch(() => jsonResponse({ order: customerOrder() }));
    renderRoutes(routes, `/order/${ID}?t=secret-token-123456789012`);

    expect(await screen.findByRole('heading', { name: /request submitted/i })).toBeTruthy();
    expect(screen.getByText(/nothing has been charged/i)).toBeTruthy();
    expect(screen.queryByText(/payment received/i)).toBeNull();
  });

  it('releases the hold when the customer backs out of Stripe', async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({
        order: customerOrder({ payment_choice: 'online', status: 'canceled', status_reason: 'customer_canceled' }),
      }),
    );
    renderRoutes(routes, `/order/${ID}?t=secret-token-123456789012&canceled=1`);

    expect(await screen.findByRole('heading', { name: /checkout canceled/i })).toBeTruthy();
    expect(screen.getByText(/you weren't charged/i)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/checkout-cancel');
    expect(init?.method).toBe('POST');
  });

  it('clears the cart once the online checkout for it is paid', async () => {
    localStorage.setItem(
      'sign-shop:cart:v1',
      JSON.stringify({ lines: [{ signId: 's1', quantity: 1, name: 'A', priceCents: 4500, imagePath: null }] }),
    );
    localStorage.setItem(
      'sign-shop:pending-checkout:v1',
      JSON.stringify({ orderId: ID, token: 'secret-token-123456789012', orderNumber: 1042 }),
    );
    mockFetch(() => jsonResponse({ order: customerOrder({ status: 'confirmed', payment_status: 'paid', paid_via: 'stripe' }) }));

    renderRoutes(routes, `/order/${ID}?t=secret-token-123456789012&from=checkout`);

    await screen.findByRole('heading', { name: /payment received/i });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('sign-shop:cart:v1')!).lines).toEqual([]));
  });

  it('shows a clear message for a bad link', async () => {
    mockFetch(() => jsonResponse({ error: 'not_found', message: 'We could not find that order.' }, 404));
    renderRoutes(routes, `/order/${ID}?t=wrong`);
    expect(await screen.findByText(/order not found/i)).toBeTruthy();
  });
});
