import { z } from 'zod';
import { MAX_CART_LINES, MAX_QUANTITY_PER_SIGN } from './limits';
import { ADMIN_ACTIONS, PAYMENT_CHOICES, PICKUP_METHODS } from './types';

export { MAX_CART_LINES, MAX_QUANTITY_PER_SIGN };

const PHONE_PATTERN = /^[0-9+()\-. ]{7,25}$/;

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, { error: 'That email address is too long.' })
  .refine((v) => v === '' || z.email().safeParse(v).success, { error: 'Enter a valid email address.' })
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || (PHONE_PATTERN.test(v) && v.replace(/\D/g, '').length >= 7), {
    error: 'Enter a valid phone number.',
  })
  .optional()
  .transform((v) => (v ? v : undefined));

export const customerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: 'Enter your name.' })
      .max(100, { error: 'Please use 100 characters or fewer.' }),
    email: optionalEmail,
    phone: optionalPhone,
  })
  .superRefine((value, ctx) => {
    if (!value.email && !value.phone) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter an email address or phone number so we can reach you.',
        path: ['email'],
      });
    }
  });

export const orderRequestSchema = z.object({
  items: z
    .array(
      z.object({
        signId: z.uuid({ error: 'Invalid sign.' }),
        quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_SIGN),
      }),
    )
    .min(1, { error: 'Your cart is empty.' })
    .max(MAX_CART_LINES, { error: 'Too many different signs in one order.' }),
  customer: customerSchema,
  pickupMethod: z.enum(PICKUP_METHODS, { error: 'Choose a pickup option.' }),
  notes: z.string().trim().max(1000, { error: 'Please keep notes under 1000 characters.' }).default(''),
  paymentChoice: z.enum(PAYMENT_CHOICES, { error: 'Choose how you would like to pay.' }),
  /** The subtotal the customer saw. If prices changed, the server refuses rather than surprise them. */
  expectedSubtotalCents: z.number().int().nonnegative().optional(),
  /** Honeypot field. Real people never see or fill it. */
  website: z.string().max(500).optional(),
});

export type OrderRequest = z.input<typeof orderRequestSchema>;
export type ParsedOrderRequest = z.output<typeof orderRequestSchema>;

export const orderLookupSchema = z.object({
  orderId: z.uuid(),
  token: z.string().min(20).max(200),
});

export const adminActionSchema = z.object({
  orderId: z.uuid(),
  action: z.enum(ADMIN_ACTIONS),
});

/** Flatten zod issues into { "customer.email": "message" } for form display. */
export function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_form';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
