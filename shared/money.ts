const formatters = new Map<string, Intl.NumberFormat>();

export function formatCents(cents: number, currency = 'usd'): string {
  const key = currency.toUpperCase();
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: key });
    formatters.set(key, formatter);
  }
  return formatter.format(cents / 100);
}

/**
 * Parse a dollar amount typed by a person ("12", "12.5", "$12.50", "1,200")
 * into integer cents. Returns null for anything ambiguous or invalid.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToDollarInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
