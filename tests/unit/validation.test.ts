import { describe, expect, it } from 'vitest';
import { fieldErrorsFromZod, orderRequestSchema } from '../../shared/validation';
import { orderRequest } from '../helpers/fixtures';

const SIGN = '7b0f5a8e-4c2d-4e6f-9a1b-2c3d4e5f6a7b';
const items = [{ signId: SIGN, quantity: 1 }];

function errors(overrides: Parameters<typeof orderRequest>[0]) {
  const result = orderRequestSchema.safeParse(orderRequest({ items, ...overrides }));
  return result.success ? {} : fieldErrorsFromZod(result.error);
}

describe('order request validation', () => {
  it('accepts a valid request and normalizes contact details', () => {
    const parsed = orderRequestSchema.parse(
      orderRequest({ items, customer: { name: '  Ada  ', email: ' ADA@Example.com ', phone: '' } }),
    );
    expect(parsed.customer).toEqual({ name: 'Ada', email: 'ada@example.com', phone: undefined });
  });

  it('accepts phone-only contact', () => {
    expect(errors({ customer: { name: 'Ada', email: '', phone: '(505) 555-0142' } })).toEqual({});
  });

  it('requires an email or a phone', () => {
    expect(errors({ customer: { name: 'Ada', email: '', phone: '' } })).toEqual({
      'customer.email': 'Enter an email address or phone number so we can reach you.',
    });
  });

  it('rejects malformed contact details', () => {
    expect(errors({ customer: { name: '', email: 'not-an-email', phone: '12' } })).toMatchObject({
      'customer.name': 'Enter your name.',
      'customer.email': 'Enter a valid email address.',
      'customer.phone': 'Enter a valid phone number.',
    });
  });

  it('rejects an empty cart, bad ids, and silly quantities', () => {
    expect(errors({ items: [] })).toHaveProperty('items');
    expect(errors({ items: [{ signId: 'nope', quantity: 1 }] })).toHaveProperty(['items.0.signId']);
    expect(errors({ items: [{ signId: SIGN, quantity: 0 }] })).toHaveProperty(['items.0.quantity']);
    expect(errors({ items: [{ signId: SIGN, quantity: 1.5 }] })).toHaveProperty(['items.0.quantity']);
  });

  it('only allows known pickup and payment options (no shipping)', () => {
    expect(errors({ pickupMethod: 'shipping' as never })).toHaveProperty('pickupMethod');
    expect(errors({ paymentChoice: 'crypto' as never })).toHaveProperty('paymentChoice');
  });

  it('drops unknown fields such as a client-supplied price', () => {
    const parsed = orderRequestSchema.parse({
      ...orderRequest({ items }),
      total_cents: 1,
      items: [{ signId: SIGN, quantity: 1, price_cents: 1 }],
    });
    expect(parsed).not.toHaveProperty('total_cents');
    expect(parsed.items[0]).toEqual({ signId: SIGN, quantity: 1 });
  });
});
