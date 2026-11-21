import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { centsToDollarInput, parseDollarsToCents } from '../../../shared/money';
import type { Sign } from '../../../shared/types';
import { Notice, Spinner, useDocumentTitle } from '../../components/ui';
import { PhotoManager } from './PhotoManager';
import { fetchHolds } from './SignsPage';
import { requireSupabase } from './supabaseClient';

interface FormValues {
  name: string;
  description: string;
  price: string;
  quantity: string;
  isListed: boolean;
  imagePaths: string[];
}

const EMPTY: FormValues = { name: '', description: '', price: '', quantity: '1', isListed: true, imagePaths: [] };

/** Client-side checks for quick feedback. The database enforces the same limits. */
export function validateSignForm(values: FormValues): {
  errors: Partial<Record<keyof FormValues, string>>;
  data?: Pick<Sign, 'name' | 'description' | 'price_cents' | 'quantity_available' | 'is_listed' | 'image_paths'>;
} {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  const name = values.name.trim();
  if (!name) errors.name = 'Give the sign a name.';
  else if (name.length > 120) errors.name = 'Keep the name under 120 characters.';
  if (values.description.length > 2000) errors.description = 'Keep the description under 2000 characters.';

  const priceCents = parseDollarsToCents(values.price);
  if (priceCents === null) errors.price = 'Enter a price like 25 or 24.99.';
  else if (priceCents < 50) errors.price = 'The minimum price is $0.50 (a Stripe limit).';
  else if (priceCents > 10_000_000) errors.price = 'That price is too high.';

  const quantity = Number(values.quantity);
  if (!/^\d+$/.test(values.quantity.trim()) || quantity > 9999) errors.quantity = 'Enter a whole number from 0 to 9999.';

  if (values.imagePaths.length > 8) errors.imagePaths = 'Up to 8 photos per sign.';

  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    data: {
      name,
      description: values.description.trim(),
      price_cents: priceCents!,
      quantity_available: quantity,
      is_listed: values.isListed,
      image_paths: values.imagePaths,
    },
  };
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

export function SignEditPage() {
  const { signId } = useParams();
  const isNew = !signId;
  const navigate = useNavigate();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [version, setVersion] = useState<number | null>(null);
  const [held, setHeld] = useState(0);
  const [load, setLoad] = useState<Load>(isNew ? { status: 'ready' } : { status: 'loading' });
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [saveError, setSaveError] = useState<{ message: string; conflict?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useDocumentTitle(isNew ? 'Add a sign' : 'Edit sign');

  useEffect(() => {
    if (!signId) return;
    let active = true;
    Promise.all([requireSupabase().from('signs').select('*').eq('id', signId).maybeSingle(), fetchHolds(signId)])
      .then(([{ data, error }, holds]) => {
        if (!active) return;
        if (error) throw error;
        if (!data) {
          setLoad({ status: 'error', message: 'This sign no longer exists.' });
          return;
        }
        const sign = data as Sign;
        setValues({
          name: sign.name,
          description: sign.description,
          price: centsToDollarInput(sign.price_cents),
          quantity: String(sign.quantity_available),
          isListed: sign.is_listed,
          imagePaths: sign.image_paths,
        });
        setVersion(sign.version);
        setHeld(holds.get(sign.id) ?? 0);
        setLoad({ status: 'ready' });
      })
      .catch((error: Error) => active && setLoad({ status: 'error', message: error.message }));
    return () => {
      active = false;
    };
  }, [signId, reloadKey]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    const result = validateSignForm(values);
    setErrors(result.errors);
    if (!result.data) return;

    setSaving(true);
    const supabase = requireSupabase();
    try {
      if (isNew) {
        const { error } = await supabase.from('signs').insert(result.data);
        if (error) throw error;
      } else {
        // Only succeeds if nobody (including a customer reservation) changed the
        // sign since this form was loaded. Prevents overwriting stock counts.
        const { data, error } = await supabase
          .from('signs')
          .update(result.data)
          .eq('id', signId)
          .eq('version', version!)
          .select('id');
        if (error) throw error;
        if (!data?.length) {
          setSaveError({
            conflict: true,
            message:
              'This sign changed since you opened it (a customer may have just reserved it). Reload to see the latest, then make your changes again.',
          });
          return;
        }
      }
      navigate('/admin/signs', { state: { message: `Saved "${result.data.name}".` } });
    } catch (error) {
      setSaveError({ message: `Couldn't save: ${(error as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!signId || !window.confirm(`Delete "${values.name}"? This can't be undone.`)) return;
    setSaving(true);
    const { error } = await requireSupabase().from('signs').delete().eq('id', signId);
    setSaving(false);
    if (error) {
      setSaveError({
        message:
          error.code === '23503'
            ? 'This sign is part of past orders, so it can\'t be deleted. Uncheck "Show in shop" to hide it instead.'
            : `Couldn't delete: ${error.message}`,
      });
      return;
    }
    navigate('/admin/signs', { state: { message: `Deleted "${values.name}".` } });
  }

  if (load.status === 'loading') return <Spinner label="Loading sign…" />;
  if (load.status === 'error') {
    return (
      <Notice tone="error" title="Couldn't load this sign" action={<Link to="/admin/signs">Back to signs</Link>}>
        {load.message}
      </Notice>
    );
  }

  return (
    <>
      <p className="back-link">
        <Link to="/admin/signs">← All signs</Link>
      </p>
      <h1>{isNew ? 'Add a sign' : 'Edit sign'}</h1>

      {saveError && (
        <Notice
          tone="error"
          action={
            saveError.conflict ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setSaveError(null);
                  setLoad({ status: 'loading' });
                  setReloadKey((n) => n + 1);
                }}
              >
                Reload sign
              </button>
            ) : undefined
          }
        >
          {saveError.message}
        </Notice>
      )}

      <form className="checkout-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="sign-name">Name</label>
          <input
            id="sign-name"
            value={values.name}
            maxLength={120}
            onChange={(e) => set('name', e.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'sign-name-error' : undefined}
          />
          {errors.name && <p id="sign-name-error" className="field-error">{errors.name}</p>}
        </div>

        <div className="field">
          <label htmlFor="sign-desc">
            Description <span className="optional">(optional)</span>
          </label>
          <textarea
            id="sign-desc"
            rows={4}
            maxLength={2000}
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Size, materials, colors, anything a buyer would want to know"
          />
          {errors.description && <p className="field-error">{errors.description}</p>}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="sign-price">Price (USD)</label>
            <input
              id="sign-price"
              inputMode="decimal"
              value={values.price}
              onChange={(e) => set('price', e.target.value)}
              placeholder="25.00"
              aria-invalid={Boolean(errors.price)}
              aria-describedby={errors.price ? 'sign-price-error' : undefined}
            />
            {errors.price && <p id="sign-price-error" className="field-error">{errors.price}</p>}
          </div>
          <div className="field">
            <label htmlFor="sign-qty">Available to sell</label>
            <input
              id="sign-qty"
              inputMode="numeric"
              value={values.quantity}
              onChange={(e) => set('quantity', e.target.value)}
              aria-invalid={Boolean(errors.quantity)}
              aria-describedby="sign-qty-hint"
            />
            <p id="sign-qty-hint" className="hint">
              Use 1 for one-of-a-kind. Doesn't include signs already held in orders
              {held > 0 ? ` (${held} on hold right now)` : ''}. Set 0 if you sold it in person.
            </p>
            {errors.quantity && <p className="field-error">{errors.quantity}</p>}
          </div>
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={values.isListed} onChange={(e) => set('isListed', e.target.checked)} />
          <span>Show in shop</span>
        </label>

        <fieldset>
          <legend>Photos</legend>
          <PhotoManager paths={values.imagePaths} onChange={(paths) => set('imagePaths', paths)} />
          {errors.imagePaths && <p className="field-error">{errors.imagePaths}</p>}
        </fieldset>

        <div className="action-bar">
          <button type="submit" className="button" disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Add sign' : 'Save changes'}
          </button>
          <Link to="/admin/signs" className="button button-secondary">
            Cancel
          </Link>
          {!isNew && (
            <button type="button" className="button button-danger push-right" onClick={() => void onDelete()} disabled={saving}>
              Delete
            </button>
          )}
        </div>
      </form>
    </>
  );
}
