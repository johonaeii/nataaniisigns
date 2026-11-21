// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CheckoutPage } from '../../src/pages/CheckoutPage';
import { jsonResponse, mockFetch, renderRoutes } from './helpers';

const SIGN_ID = '7b0f5a8e-4c2d-4e6f-9a1b-2c3d4e5f6a7b';
const routes = [{ path: '/checkout', element: <CheckoutPage /> }];

beforeEach(() => {
  localStorage.setItem(
    'sign-shop:cart:v1',
    JSON.stringify({
      lines: [{ signId: SIGN_ID, quantity: 1, name: 'Welcome, Friends', priceCents: 4500, imagePath: null }],
    }),
  );
});

function catalogAndOrders(orderResponse: () => Response) {
  return mockFetch((url) => {
    if (url.includes('/rest/v1/signs')) {
      return jsonResponse([
        { id: SIGN_ID, name: 'Welcome, Friends', description: '', price_cents: 4500, quantity_available: 1, image_paths: [] },
      ]);
    }
    if (url === '/api/orders') return orderResponse();
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function waitForReady() {
  const button = await screen.findByRole('button', { name: /submit request|continue to payment/i });
  await expect.poll(() => (button as HTMLButtonElement).disabled).toBe(false);
  return button;
}

describe('checkout page', () => {
  it('asks for contact details before submitting anything', async () => {
    const fetchMock = catalogAndOrders(() => jsonResponse({}, 500));
    renderRoutes(routes, '/checkout');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^name/i), 'Ada');
    await user.click(screen.getByLabelText(/request now, pay later/i));
    await user.click(await waitForReady());

    expect(await screen.findByText(/enter an email address or phone number/i)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/orders')).toBe(false);
  });

  it('submits a pay-later request and goes to the confirmation page', async () => {
    const fetchMock = catalogAndOrders(() =>
      jsonResponse({ orderId: 'order-1', orderNumber: 1001, token: 'tok-123', status: 'requested' }, 201),
    );
    renderRoutes(routes, '/checkout');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^name/i), 'Ada Lovelace');
    await user.type(screen.getByLabelText(/^phone/i), '505-555-0142');
    await user.click(screen.getByLabelText(/arrange a local pickup/i));
    await user.click(screen.getByLabelText(/request now, pay later/i));
    await user.click(await waitForReady());

    expect((await screen.findByTestId('location')).textContent).toBe('/order/order-1?t=tok-123');
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/orders')!;
    expect(JSON.parse(String(call[1]!.body))).toMatchObject({
      items: [{ signId: SIGN_ID, quantity: 1 }],
      customer: { name: 'Ada Lovelace', phone: '505-555-0142' },
      pickupMethod: 'local',
      paymentChoice: 'pay_later',
      expectedSubtotalCents: 4500,
    });
    expect(JSON.parse(localStorage.getItem('sign-shop:cart:v1')!).lines).toEqual([]);
  });

  it('explains when someone else reserved a sign first', async () => {
    catalogAndOrders(() =>
      jsonResponse({ error: 'sign_unavailable', message: 'Sorry', signId: SIGN_ID }, 409),
    );
    renderRoutes(routes, '/checkout');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^name/i), 'Ada');
    await user.type(screen.getByLabelText(/^email/i), 'ada@example.com');
    await user.click(screen.getByLabelText(/request now, pay later/i));
    await user.click(await waitForReady());

    expect(await screen.findByText(/"Welcome, Friends" was just reserved/)).toBeTruthy();
    expect(screen.getByText(/nothing was charged/i)).toBeTruthy();
    // The cart is kept so the customer can adjust it.
    expect(JSON.parse(localStorage.getItem('sign-shop:cart:v1')!).lines).toHaveLength(1);
  });
});

describe('returning from Stripe with the browser Back button', () => {
  const PENDING = { orderId: '00000000-0000-4000-8000-0000000000aa', token: 'pending-token-1234567890', orderNumber: 1050 };

  it("releases this browser's own unfinished checkout before checking availability", async () => {
    localStorage.setItem('sign-shop:pending-checkout:v1', JSON.stringify(PENDING));
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url.includes('/rest/v1/signs') ? 'catalog' : url);
      if (url === '/api/checkout-cancel') {
        return jsonResponse({ order: { id: PENDING.orderId, status: 'canceled', payment_status: 'unpaid' } });
      }
      return jsonResponse([
        { id: SIGN_ID, name: 'Welcome, Friends', description: '', price_cents: 4500, quantity_available: 1, image_paths: [] },
      ]);
    });

    renderRoutes(routes, '/checkout');
    await waitForReady();

    expect(calls.slice(0, 2)).toEqual(['/api/checkout-cancel', 'catalog']);
    expect(localStorage.getItem('sign-shop:pending-checkout:v1')).toBeNull();
    expect(screen.queryByText(/no longer available/i)).toBeNull();
  });

  it('sends the shopper to their order if that checkout was actually paid', async () => {
    localStorage.setItem('sign-shop:pending-checkout:v1', JSON.stringify(PENDING));
    mockFetch((url) => {
      if (url === '/api/checkout-cancel') {
        return jsonResponse({ order: { id: PENDING.orderId, status: 'confirmed', payment_status: 'paid' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    renderRoutes(routes, '/checkout');

    expect((await screen.findByTestId('location')).textContent).toBe(
      `/order/${PENDING.orderId}?t=${PENDING.token}&from=checkout`,
    );
  });
});
