import { describe, expect, it } from 'vitest';
import { centsToDollarInput, formatCents, parseDollarsToCents } from '../../shared/money';

describe('money', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(4500)).toBe('$45.00');
    expect(formatCents(1999)).toBe('$19.99');
    expect(formatCents(123456)).toBe('$1,234.56');
  });

  it.each([
    ['25', 2500],
    ['24.9', 2490],
    ['24.99', 2499],
    ['$12.50', 1250],
    [' 1,200 ', 120000],
    ['0.5', 50],
  ])('parses %j as %i cents', (input, cents) => {
    expect(parseDollarsToCents(input)).toBe(cents);
  });

  it.each(['', 'abc', '12.345', '-5', '1.2.3', '$', '12,34.5x'])('rejects %j', (input) => {
    expect(parseDollarsToCents(input)).toBeNull();
  });

  it('round-trips through the admin input format', () => {
    expect(parseDollarsToCents(centsToDollarInput(2499))).toBe(2499);
  });
});
