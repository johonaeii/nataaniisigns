import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  CUSTOM_DESCRIPTION_MAX,
  MAX_CUSTOM_PHOTO_BYTES,
  MAX_CUSTOM_PHOTOS,
  customRequestRef,
} from '../../shared/customRequests';
import { customRequestSchema, fieldErrorsFromZod } from '../../shared/validation';
import { TextField } from '../components/TextField';
import { Notice, Spinner, useDocumentTitle } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { extensionFor, resizeImage } from '../lib/images';

interface PickedPhoto {
  key: number;
  blob: Blob;
  url: string;
}

const FIELD_ORDER = ['customer.name', 'customer.email', 'customer.phone', 'description', 'photos'];

export function CustomRequestPage() {
  useDocumentTitle('Request a custom sign');
  const formRef = useRef<HTMLFormElement>(null);
  const photoInputId = useId();
  const nextKey = useRef(0);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ requestNumber: number; firstName: string } | null>(null);

  // Free the in-memory photo previews when leaving the page.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  async function onPickPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ''; // allow picking the same file again
    if (files.length === 0) return;

    const room = MAX_CUSTOM_PHOTOS - photos.length;
    const errors: string[] = [];
    if (files.length > room) errors.push(`You can attach up to ${MAX_CUSTOM_PHOTOS} photos; added the first ${room}.`);

    setPreparing(true);
    const added: PickedPhoto[] = [];
    for (const file of files.slice(0, room)) {
      try {
        const blob = await resizeImage(file);
        if (blob.size > MAX_CUSTOM_PHOTO_BYTES) throw new Error(`"${file.name}" is too large even after resizing.`);
        added.push({ key: nextKey.current++, blob, url: URL.createObjectURL(blob) });
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    setPreparing(false);
    setPhotos((current) => [...current, ...added]);
    setFieldErrors(({ photos: _old, ...rest }) => (errors.length ? { ...rest, photos: errors.join(' ') } : rest));
  }

  function removePhoto(key: number) {
    setPhotos((current) => {
      const photo = current.find((p) => p.key === key);
      if (photo) URL.revokeObjectURL(photo.url);
      return current.filter((p) => p.key !== key);
    });
  }

  function focusFirstError(errors: Record<string, string>) {
    const first = FIELD_ORDER.find((key) => errors[key]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || preparing) return;
    setFormError(null);

    const parsed = customRequestSchema.safeParse({
      customer: { name, email, phone },
      description,
      website: honeypot,
    });
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      setFieldErrors(errors);
      focusFirstError(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    const form = new FormData();
    form.append('name', name);
    form.append('email', email);
    form.append('phone', phone);
    form.append('description', description);
    form.append('website', honeypot);
    photos.forEach((photo, i) => form.append('photos', photo.blob, `photo-${i + 1}.${extensionFor(photo.blob.type)}`));

    try {
      const result = await api.createCustomRequest(form);
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]);
      setDone({ requestNumber: result.requestNumber, firstName: name.trim().split(/\s+/)[0] });
      window.scrollTo({ top: 0 });
    } catch (error) {
      if (error instanceof ApiError && error.body.fieldErrors) {
        setFieldErrors(error.body.fieldErrors);
        focusFirstError(error.body.fieldErrors);
      } else {
        setFormError(error instanceof ApiError ? error.body.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function startOver() {
    setDone(null);
    setDescription('');
  }

  if (done) {
    return (
      <>
        <div className="order-hero order-hero-success" role="status" aria-live="polite">
          <p className="order-hero-icon" aria-hidden="true">
            ✓
          </p>
          <h1>Request received</h1>
          <div className="order-hero-body">
            <p>
              Thanks, {done.firstName}! Your custom sign request <strong>{customRequestRef(done.requestNumber)}</strong>{' '}
              was sent.
            </p>
            <p>We'll look it over and get back to you with ideas and a price. Nothing has been charged.</p>
          </div>
        </div>
        <p className="center">
          <button type="button" className="link-button" onClick={startOver}>
            Send another request
          </button>
          {' · '}
          <Link to="/">Back to the shop</Link>
        </p>
      </>
    );
  }

  const busy = submitting || preparing;

  return (
    <>
      <p className="back-link">
        <Link to="/">← All signs</Link>
      </p>
      <h1>Request a custom sign</h1>
      <p className="lead">
        Tell us what you'd like made. Add a sketch or a photo if you have one. We'll get back to you with ideas and a
        price. Nothing is charged now.
      </p>

      {formError && (
        <Notice tone="error" title="Your request wasn't sent">
          {formError}
        </Notice>
      )}

      <form ref={formRef} className="checkout-form" onSubmit={onSubmit} noValidate>
        <fieldset>
          <legend>Your details</legend>
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
            hint="So we can reply. Enter an email, a phone number, or both."
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

        <div className="field">
          <label htmlFor="description">
            Describe your sign<span className="required" aria-hidden="true"> *</span>
          </label>
          <p id="description-hint" className="hint">
            What should it say? Size, colors, wood or finish, where it will hang, and when you need it.
          </p>
          <textarea
            id="description"
            data-field="description"
            rows={6}
            maxLength={CUSTOM_DESCRIPTION_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby={['description-hint', fieldErrors.description ? 'description-error' : ''].join(' ').trim()}
          />
          <p className="hint char-count" aria-live="polite">
            {description.length} / {CUSTOM_DESCRIPTION_MAX}
          </p>
          {fieldErrors.description && (
            <p id="description-error" className="field-error">
              {fieldErrors.description}
            </p>
          )}
        </div>

        <fieldset>
          <legend>
            Photos or sketches <span className="optional">(optional)</span>
          </legend>
          <p className="hint">
            Up to {MAX_CUSTOM_PHOTOS}: a drawing, a sign you like, or the spot where it will hang. Only we can see them.
          </p>
          {photos.length > 0 && (
            <ul className="photo-grid" aria-label="Attached photos">
              {photos.map((photo, i) => (
                <li key={photo.key}>
                  <img className="sign-image" src={photo.url} alt={`Attached photo ${i + 1}`} />
                  <button
                    type="button"
                    className="link-button danger"
                    onClick={() => removePhoto(photo.key)}
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {preparing && <Spinner label="Preparing photos…" />}
          <div className="photo-buttons">
            <label
              htmlFor={photoInputId}
              className={`button button-secondary ${photos.length >= MAX_CUSTOM_PHOTOS || busy ? 'disabled' : ''}`}
            >
              {photos.length ? 'Add more photos' : 'Add photos'}
            </label>
            <input
              id={photoInputId}
              data-field="photos"
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/*"
              multiple
              disabled={photos.length >= MAX_CUSTOM_PHOTOS || busy}
              onChange={(e) => void onPickPhotos(e)}
            />
          </div>
          {fieldErrors.photos && <p className="field-error">{fieldErrors.photos}</p>}
        </fieldset>

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

        <button type="submit" className="button button-block button-large" disabled={busy} aria-busy={submitting}>
          {submitting ? 'Sending request…' : 'Send request'}
        </button>
      </form>
    </>
  );
}
