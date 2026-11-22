import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CUSTOM_PHOTO_BUCKET, CUSTOM_STATUS_LABEL, customRequestRef } from '../../../shared/customRequests';
import { CUSTOM_REQUEST_STATUSES, type CustomRequestRow, type CustomRequestStatus } from '../../../shared/types';
import { Notice, Spinner, formatDateTime, useDocumentTitle } from '../../components/ui';
import { CUSTOM_REQUEST_COLUMNS, CustomStatusBadge } from './CustomRequestsPage';
import { requireSupabase } from './supabaseClient';

/** Signed links are short-lived; reload the page to get fresh ones. */
const LINK_SECONDS = 60 * 60;

interface PhotoLinks {
  path: string;
  view: string;
  download: string;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; request: CustomRequestRow; photos: PhotoLinks[]; photoError: string | null };

async function fetchRequest(id: string): Promise<State> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('custom_requests').select(CUSTOM_REQUEST_COLUMNS).eq('id', id).maybeSingle();
  if (error) return { status: 'error', message: error.message };
  if (!data) return { status: 'missing' };
  const request = data as CustomRequestRow;
  if (request.photo_paths.length === 0) return { status: 'ready', request, photos: [], photoError: null };

  // The bucket is private: photos are shown through temporary signed links.
  const bucket = supabase.storage.from(CUSTOM_PHOTO_BUCKET);
  const [view, download] = await Promise.all([
    bucket.createSignedUrls(request.photo_paths, LINK_SECONDS),
    bucket.createSignedUrls(request.photo_paths, LINK_SECONDS, { download: true }),
  ]);
  if (view.error || download.error) {
    return { status: 'ready', request, photos: [], photoError: (view.error ?? download.error)!.message };
  }
  const photos = request.photo_paths.flatMap((path) => {
    const v = view.data.find((d) => d.path === path)?.signedUrl;
    const d = download.data.find((x) => x.path === path)?.signedUrl;
    return v && d ? [{ path, view: v, download: d }] : [];
  });
  return {
    status: 'ready',
    request,
    photos,
    photoError: photos.length < request.photo_paths.length ? 'Some photos could not be loaded.' : null,
  };
}

export function CustomRequestDetailPage() {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  useDocumentTitle(state.status === 'ready' ? customRequestRef(state.request.request_number) : 'Custom request');

  useEffect(() => {
    let active = true;
    fetchRequest(requestId).then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, [requestId, reloadKey]);

  async function setStatus(request: CustomRequestRow, status: CustomRequestStatus) {
    setBusy(true);
    setMessage(null);
    const { error } = await requireSupabase().from('custom_requests').update({ status }).eq('id', request.id);
    setBusy(false);
    if (error) setMessage({ tone: 'error', text: `Couldn't update the status: ${error.message}` });
    else setMessage({ tone: 'success', text: `Marked as ${CUSTOM_STATUS_LABEL[status].toLowerCase()}.` });
    setReloadKey((n) => n + 1);
  }

  async function deleteRequest(request: CustomRequestRow) {
    const ref = customRequestRef(request.request_number);
    if (!window.confirm(`Delete request ${ref} and its photos? This can't be undone.`)) return;
    setBusy(true);
    setMessage(null);
    const supabase = requireSupabase();
    // Photos first, so a failure never leaves photos without their request.
    if (request.photo_paths.length > 0) {
      const { error } = await supabase.storage.from(CUSTOM_PHOTO_BUCKET).remove(request.photo_paths);
      if (error) {
        setBusy(false);
        setMessage({ tone: 'error', text: `Couldn't delete the photos: ${error.message}` });
        return;
      }
    }
    const { error } = await supabase.from('custom_requests').delete().eq('id', request.id);
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Couldn't delete the request: ${error.message}` });
      return;
    }
    navigate('/admin/custom', { state: { message: `Deleted request ${ref}.` } });
  }

  if (state.status === 'loading') return <Spinner label="Loading request…" />;
  if (state.status === 'error') return <Notice tone="error" title="Couldn't load the request">{state.message}</Notice>;
  if (state.status === 'missing') {
    return <Notice title="Request not found" action={<Link to="/admin/custom">Back to custom requests</Link>} />;
  }

  const { request, photos, photoError } = state;
  const ref = customRequestRef(request.request_number);
  const subject = encodeURIComponent(`Your custom sign request ${ref}`);

  return (
    <>
      <p className="back-link">
        <Link to="/admin/custom">← All custom requests</Link>
      </p>
      <div className="page-title-row">
        <h1>Custom request {ref}</h1>
        <span className="muted small">{formatDateTime(request.created_at)}</span>
      </div>
      <div className="badges">
        <CustomStatusBadge status={request.status} />
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <section className="card">
        <h2 className="h3">What they want</h2>
        <p className="pre-wrap">{request.description}</p>
      </section>

      <section className="card">
        <h2 className="h3">Photos and sketches</h2>
        {photoError && <Notice tone="error">{photoError}</Notice>}
        {request.photo_paths.length === 0 && <p className="muted">No photos attached.</p>}
        {photos.length > 0 && (
          <ul className="photo-grid">
            {photos.map((photo, i) => (
              <li key={photo.path}>
                <a href={photo.view} target="_blank" rel="noreferrer" aria-label={`Open photo ${i + 1} full size`}>
                  <img className="sign-image" src={photo.view} alt={`Customer photo ${i + 1}`} loading="lazy" />
                </a>
                <a href={photo.download} className="small">
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="h3">Contact</h2>
        <dl className="details-list">
          <div>
            <dt>Name</dt>
            <dd>{request.customer_name}</dd>
          </div>
          {request.customer_email && (
            <div>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${request.customer_email}?subject=${subject}`}>{request.customer_email}</a>
              </dd>
            </div>
          )}
          {request.customer_phone && (
            <div>
              <dt>Phone</dt>
              <dd>
                <a href={`tel:${request.customer_phone}`}>{request.customer_phone}</a> ·{' '}
                <a href={`sms:${request.customer_phone}`}>Text</a>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="card">
        <h2 className="h3">Status</h2>
        <div className="action-bar" role="group" aria-label="Set status">
          {CUSTOM_REQUEST_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={status === request.status ? 'button' : 'button button-secondary'}
              aria-pressed={status === request.status}
              disabled={busy || status === request.status}
              onClick={() => void setStatus(request, status)}
            >
              {CUSTOM_STATUS_LABEL[status]}
            </button>
          ))}
        </div>
        <p className="hint">
          Status is just for your tracking; the customer isn't notified. Reply to them by email, text, or phone.
        </p>
      </section>

      <div className="action-bar">
        <button type="button" className="button button-danger push-right" disabled={busy} onClick={() => void deleteRequest(request)}>
          Delete request
        </button>
      </div>
    </>
  );
}
