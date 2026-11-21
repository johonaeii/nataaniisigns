import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatCents } from '../../shared/money';
import { AddToCartButton } from '../components/AddToCartButton';
import { Notice, SignImage, Spinner, useDocumentTitle } from '../components/ui';
import { CatalogError, fetchSign, type PublicSign } from '../lib/catalog';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; sign: PublicSign };

export function SignPage() {
  const { signId = '' } = useParams();
  // Keyed so that navigating between signs starts from a clean state.
  return <SignDetail key={signId} signId={signId} />;
}

function SignDetail({ signId }: { signId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [photoIndex, setPhotoIndex] = useState(0);
  useDocumentTitle(state.status === 'ready' ? state.sign.name : 'Sign');

  useEffect(() => {
    const controller = new AbortController();
    fetchSign(signId, controller.signal)
      .then((sign) => setState(sign ? { status: 'ready', sign } : { status: 'missing' }))
      .catch((error: unknown) => {
        if ((error as Error).name === 'AbortError') return;
        setState({ status: 'error', message: error instanceof CatalogError ? error.message : "Couldn't load this sign." });
      });
    return () => controller.abort();
  }, [signId]);

  return (
    <>
      <p className="back-link">
        <Link to="/">← All signs</Link>
      </p>
      {state.status === 'loading' && <Spinner />}
      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
      {state.status === 'missing' && (
        <Notice tone="info" title="This sign isn't available">
          It may have just sold. <Link to="/">See what's in stock</Link>.
        </Notice>
      )}
      {state.status === 'ready' && (
        <article className="sign-detail">
          <div className="gallery">
            <SignImage
              path={state.sign.image_paths[photoIndex] ?? state.sign.image_paths[0]}
              alt={state.sign.name}
              className="gallery-main"
              eager
            />
            {state.sign.image_paths.length > 1 && (
              <div className="gallery-thumbs" role="group" aria-label="More photos">
                {state.sign.image_paths.map((path, i) => (
                  <button
                    key={path}
                    type="button"
                    className={i === photoIndex ? 'thumb active' : 'thumb'}
                    onClick={() => setPhotoIndex(i)}
                    aria-label={`Show photo ${i + 1}`}
                    aria-pressed={i === photoIndex}
                  >
                    <SignImage path={path} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="sign-detail-info">
            <h1>{state.sign.name}</h1>
            <p className="sign-price large">{formatCents(state.sign.price_cents)}</p>
            {state.sign.quantity_available === 1 && <p className="stock-note">One of a kind. Only 1 available.</p>}
            {state.sign.quantity_available > 1 && <p className="stock-note">{state.sign.quantity_available} available</p>}
            {state.sign.description && <p className="sign-full-desc">{state.sign.description}</p>}
            <AddToCartButton sign={state.sign} />
          </div>
        </article>
      )}
    </>
  );
}
