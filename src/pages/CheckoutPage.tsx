import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { formatCents } from '../../shared/money';
import type { PaymentChoice, PickupMethod } from '../../shared/types';
import { fieldErrorsFromZod, orderRequestSchema, type OrderRequest } from '../../shared/validation';
import { TextField } from '../components/TextField';
import { Notice, Spinner, useDocumentTitle } from '../components/ui';
import { LOCAL_PICKUP_DETAILS, MARKET_PICKUP_DETAILS, ONLINE_PAYMENTS_ENABLED } from '../config';
import { ApiError, api } from '../lib/api';
import { useCart } from '../lib/CartContext';
import { orderPath, pendingCheckout, recentOrder } from '../lib/recentOrder';
import { useCartAvailability } from '../lib/useCartAvailability';

type FieldErrors = Record<string, string>;

const FIELD_ORDER = ['customer.name', 'customer.email', 'customer.phone', 'pickupMethod', 'paymentChoice', 'notes'];

export function CheckoutPage() {
  useDocumentTitle('Checkout');
  const { cart, subtotalCents, dispatch } = useCart();
  const { state: availability, problems, recheck } = useCartAvailability();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pickupMethod, setPickupMethod] = useState<PickupMethod>('market');
  const [notes, setNotes] = useState('');
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice | ''>(ONLINE_PAYMENTS_ENABLED ? '' : 'pay_later');
  const [honeypot, setHoneypot] = useState('');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<{ title: string; message: string; reviewCart?: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If the shopper comes back from Stripe with the browser's Back button, the page
  // may be restored from cache with the button still disabled.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSubmitting(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  if (availability.status === 'redirect') return <Navigate to={availability.to} replace />;
  if (cart.lines.length === 0 && !submitting) return <Navigate to="/cart" replace />;

  const cartBlocked = availability.status === 'ready' && problems.size > 0;

  function focusFirstError(errors: FieldErrors) {
    const first = FIELD_ORDER.find((key) => errors[key]);
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`);
    el?.focus();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const body: OrderRequest = {
      items: cart.lines.map((line) => ({ signId: line.signId, quantity: line.quantity })),
      customer: { name, email, phone },
      pickupMethod,
      notes,
      paymentChoice: paymentChoice as PaymentChoice,
      expectedSubtotalCents: subtotalCents,
      website: honeypot,
    };

    const parsed = orderRequestSchema.safeParse(body);
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      setFieldErrors(errors);
      focusFirstError(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      const result = await api.createOrder(body);
      const ref = { orderId: result.orderId, token: result.token, orderNumber: result.orderNumber };
      recentOrder.set(ref);

      if (result.checkoutUrl) {
        pendingCheckout.set(ref);
        window.location.assign(result.checkoutUrl); // off to Stripe; keep the button disabled
        return;
      }

      dispatch({ type: 'clear' });
      navigate(orderPath(ref), { replace: true });
    } catch (error) {
      setSubmitting(false);
      if (!(error instanceof ApiError)) {
        setFormError({ title: 'Something went wrong', message: 'Please try again.' });
        return;
      }
      const { body: err } = error;
      if (err.error === 'sign_unavailable') {
        const line = cart.lines.find((l) => l.signId === err.signId);
        recheck();
        setFormError({
          title: line ? `"${line.name}" was just reserved` : 'A sign was just reserved',
          message: 'Someone else got to it first. Nothing was charged. Please review your cart.',
          reviewCart: true,
        });
      } else if (err.error === 'price_changed') {
        recheck();
        setFormError({
          title: 'Prices changed',
          message: 'A price changed since you loaded the page. Check the updated total below, then submit again.',
        });
      } else if (err.fieldErrors) {
        setFieldErrors(err.fieldErrors);
        focusFirstError(err.fieldErrors);
      } else {
        setFormError({ title: "Your order wasn't placed", message: err.message });
      }
    }
  }

  const submitLabel = submitting
    ? paymentChoice === 'online'
      ? 'Opening secure checkout…'
      : 'Submitting request…'
    : paymentChoice === 'online'
      ? `Continue to payment · ${formatCents(subtotalCents)}`
      : 'Submit request';

  return (
    <>
      <p className="back-link">
        <Link to="/cart">← Back to cart</Link>
      </p>
      <h1>Checkout</h1>

      <section className="order-summary" aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="h3">
          Your order
        </h2>
        <ul>
          {cart.lines.map((line) => (
            <li key={line.signId}>
              <span>
                {line.quantity} × {line.name}
              </span>
              <span>{formatCents(line.priceCents * line.quantity)}</span>
            </li>
          ))}
        </ul>
        <p className="summary-row">
          <span>Total</span>
          <strong>{formatCents(subtotalCents)}</strong>
        </p>
        {availability.status === 'checking' && <Spinner label="Checking availability…" />}
      </section>

      {cartBlocked && (
        <Notice
          tone="warning"
          title="Some signs in your cart are no longer available"
          action={
            <Link to="/cart" className="button button-secondary">
              Review cart
            </Link>
          }
        />
      )}

      {formError && (
        <Notice
          tone="error"
          title={formError.title}
          action={
            formError.reviewCart ? (
              <Link to="/cart" className="button button-secondary">
                Review cart
              </Link>
            ) : undefined
          }
        >
          {formError.message}
        </Notice>
      )}

      <form ref={formRef} className="checkout-form" onSubmit={onSubmit} noValidate>
        <fieldset>
          <legend>Your details</legend>
          <p className="hint">Only used to reach you about this order. No account needed.</p>

          <TextField
            id="name"
            field="customer.name"
            label="Name"
            value={name}
            onChange={setName}
            error={fieldErrors['customer.name']}
            autoComplete="name"
            required
          />
          <TextField
            id="email"
            field="customer.email"
            label="Email"
            type="email"
            inputMode="email"
            value={email}
            onChange={setEmail}
            error={fieldErrors['customer.email']}
            autoComplete="email"
            hint="For your confirmation. Enter an email, a phone number, or both."
          />
          <TextField
            id="phone"
            field="customer.phone"
            label="Phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={setPhone}
            error={fieldErrors['customer.phone']}
            autoComplete="tel"
          />
        </fieldset>

        <fieldset aria-describedby={fieldErrors.pickupMethod ? 'pickup-error' : undefined}>
          <legend>Pickup</legend>
          <ChoiceCard
            name="pickup"
            field="pickupMethod"
            value="market"
            checked={pickupMethod === 'market'}
            onChange={() => setPickupMethod('market')}
            title="Pick up at the market"
            description={MARKET_PICKUP_DETAILS}
          />
          <ChoiceCard
            name="pickup"
            value="local"
            checked={pickupMethod === 'local'}
            onChange={() => setPickupMethod('local')}
            title="Arrange a local pickup"
            description={LOCAL_PICKUP_DETAILS}
          />
          {fieldErrors.pickupMethod && (
            <p id="pickup-error" className="field-error">
              {fieldErrors.pickupMethod}
            </p>
          )}
        </fieldset>

        <fieldset aria-describedby={fieldErrors.paymentChoice ? 'payment-error' : undefined}>
          <legend>Payment</legend>
          {ONLINE_PAYMENTS_ENABLED && (
            <ChoiceCard
              name="payment"
              field="paymentChoice"
              value="online"
              checked={paymentChoice === 'online'}
              onChange={() => setPaymentChoice('online')}
              title="Pay online now"
              description="Card payment on Stripe's secure checkout page. Your signs are held while you pay."
            />
          )}
          <ChoiceCard
            name="payment"
            field={ONLINE_PAYMENTS_ENABLED ? undefined : 'paymentChoice'}
            value="pay_later"
            checked={paymentChoice === 'pay_later'}
            onChange={() => setPaymentChoice('pay_later')}
            title="Request now, pay later"
            description="We'll hold these signs for you. Pay in person at pickup. Nothing is charged now."
          />
          {fieldErrors.paymentChoice && (
            <p id="payment-error" className="field-error">
              {fieldErrors.paymentChoice}
            </p>
          )}
        </fieldset>

        <div className="field">
          <label htmlFor="notes">
            Notes <span className="optional">(optional)</span>
          </label>
          <textarea
            id="notes"
            data-field="notes"
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Which market day works for you, or anything else we should know"
            aria-invalid={Boolean(fieldErrors.notes)}
            aria-describedby={fieldErrors.notes ? 'notes-error' : undefined}
          />
          {fieldErrors.notes && (
            <p id="notes-error" className="field-error">
              {fieldErrors.notes}
            </p>
          )}
        </div>

        {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
        <div className="honeypot" aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input
            id="website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        <button
          type="submit"
          className="button button-block button-large"
          disabled={submitting || cartBlocked || availability.status !== 'ready'}
          aria-busy={submitting}
        >
          {submitLabel}
        </button>
        {paymentChoice === 'online' && (
          <p className="hint center">You'll be taken to Stripe to pay. We never see your card details.</p>
        )}
      </form>
    </>
  );
}

function ChoiceCard(props: {
  name: string;
  value: string;
  field?: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
}) {
  const id = `${props.name}-${props.value}`;
  return (
    <label className={props.checked ? 'choice-card checked' : 'choice-card'} htmlFor={id}>
      <input
        type="radio"
        id={id}
        name={props.name}
        value={props.value}
        checked={props.checked}
        onChange={props.onChange}
        data-field={props.field}
      />
      <span>
        <span className="choice-title">{props.title}</span>
        <span className="choice-desc">{props.description}</span>
      </span>
    </label>
  );
}
