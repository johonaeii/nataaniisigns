// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CustomRequestPage } from '../../src/pages/CustomRequestPage';
import { jsonResponse, mockFetch, renderRoutes } from './helpers';

const routes = [{ path: '/custom', element: <CustomRequestPage /> }];

async function fillValidForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^name/i), 'Ada Lovelace');
  await user.type(screen.getByLabelText(/^email/i), 'ada@example.com');
  await user.type(screen.getByLabelText(/describe your sign/i), 'A cedar sign that says "Lovelace Family", 3 feet wide.');
  return user;
}

describe('custom sign request page', () => {
  it('checks the form before sending anything', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}, 500));
    renderRoutes(routes, '/custom');
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^name/i), 'Ada');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(/enter an email address or phone number/i)).toBeTruthy();
    expect(screen.getByText(/tell us a little more/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the request as a multipart form and confirms it', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ requestNumber: 101 }, 201));
    renderRoutes(routes, '/custom');
    const user = await fillValidForm();

    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByRole('heading', { name: /request received/i })).toBeTruthy();
    expect(screen.getByText('C-101')).toBeTruthy();
    expect(screen.getByText(/nothing has been charged/i)).toBeTruthy();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/custom-requests');
    const body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('name')).toBe('Ada Lovelace');
    expect(body.get('email')).toBe('ada@example.com');
    expect(String(body.get('description'))).toContain('Lovelace Family');
    // The browser must set the multipart Content-Type (with its boundary) itself.
    expect(new Headers(init?.headers).get('content-type')).toBeNull();
  });

  it('shows the server explanation when rate-limited', async () => {
    mockFetch(() =>
      jsonResponse({ error: 'rate_limited', message: "We've received a lot of requests recently." }, 429),
    );
    renderRoutes(routes, '/custom');
    const user = await fillValidForm();

    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(/received a lot of requests recently/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /send request/i })).toBeTruthy(); // form kept for retry
  });

  it('shows photo problems reported by the server next to the photo picker', async () => {
    mockFetch(() =>
      jsonResponse(
        { error: 'invalid_photos', message: 'x', fieldErrors: { photos: 'Photos must be JPEG, PNG, or WebP images.' } },
        400,
      ),
    );
    renderRoutes(routes, '/custom');
    const user = await fillValidForm();

    await user.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(/photos must be jpeg, png, or webp/i)).toBeTruthy();
  });
});
