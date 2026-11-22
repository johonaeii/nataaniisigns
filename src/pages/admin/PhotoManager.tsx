import { useId, useState, type ChangeEvent } from 'react';
import { Notice, SignImage, Spinner } from '../../components/ui';
import { PHOTO_BUCKET } from '../../config';
import { extensionFor, resizeImage } from '../../lib/images';
import { requireSupabase } from './supabaseClient';

export const MAX_PHOTOS = 8;
const FOLDER = 'signs';

type Library = { status: 'closed' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'open'; paths: string[] };

export function PhotoManager({ paths, onChange }: { paths: string[]; onChange: (paths: string[]) => void }) {
  const inputId = useId();
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Library>({ status: 'closed' });
  const full = paths.length >= MAX_PHOTOS;

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ''; // allow choosing the same file again
    if (files.length === 0) return;
    setError(null);

    const room = MAX_PHOTOS - paths.length;
    if (files.length > room) setError(`Only ${MAX_PHOTOS} photos per sign; added the first ${room}.`);

    const added: string[] = [];
    try {
      for (const [i, file] of files.slice(0, room).entries()) {
        setUploading(`Uploading photo ${i + 1} of ${Math.min(files.length, room)}…`);
        const blob = await resizeImage(file);
        const path = `${FOLDER}/${crypto.randomUUID()}.${extensionFor(blob.type)}`;
        const { error: uploadError } = await requireSupabase()
          .storage.from(PHOTO_BUCKET)
          .upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
        added.push(path);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(null);
      if (added.length) onChange([...paths, ...added]);
    }
  }

  async function openLibrary() {
    setLibrary({ status: 'loading' });
    const { data, error: listError } = await requireSupabase()
      .storage.from(PHOTO_BUCKET)
      .list(FOLDER, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
    if (listError) setLibrary({ status: 'error', message: listError.message });
    else
      setLibrary({
        status: 'open',
        paths: (data ?? []).filter((f) => f.id && !f.name.startsWith('.')).map((f) => `${FOLDER}/${f.name}`),
      });
  }

  const move = (from: number, to: number) => {
    const next = [...paths];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <div className="photo-manager">
      {paths.length === 0 && <p className="muted">No photos yet. Signs with clear photos sell better.</p>}
      {paths.length > 0 && (
        <ul className="photo-grid">
          {paths.map((path, index) => (
            <li key={path}>
              <SignImage path={path} alt={`Photo ${index + 1}`} />
              {index === 0 && <span className="badge badge-good photo-main">Main</span>}
              <div className="photo-actions">
                {index > 0 && (
                  <button type="button" className="link-button" onClick={() => move(index, 0)}>
                    Make main
                  </button>
                )}
                <button
                  type="button"
                  className="link-button danger"
                  onClick={() => onChange(paths.filter((p) => p !== path))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {uploading && <Spinner label={uploading} />}

      <div className="photo-buttons">
        <label htmlFor={inputId} className={`button button-secondary ${full || uploading ? 'disabled' : ''}`}>
          Upload photos
        </label>
        <input
          id={inputId}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/*"
          multiple
          disabled={full || Boolean(uploading)}
          onChange={(e) => void onFiles(e)}
        />
        <button
          type="button"
          className="button button-secondary"
          disabled={full}
          onClick={() => (library.status === 'open' ? setLibrary({ status: 'closed' }) : void openLibrary())}
        >
          {library.status === 'open' ? 'Hide uploaded photos' : 'Choose from uploaded photos'}
        </button>
      </div>

      {library.status === 'loading' && <Spinner label="Loading photos…" />}
      {library.status === 'error' && <Notice tone="error">{library.message}</Notice>}
      {library.status === 'open' && (
        <div className="photo-library">
          {library.paths.length === 0 && <p className="muted">No uploaded photos yet.</p>}
          <ul className="photo-grid small">
            {library.paths.map((path) => {
              const chosen = paths.includes(path);
              return (
                <li key={path}>
                  <button
                    type="button"
                    className={chosen ? 'library-pick chosen' : 'library-pick'}
                    disabled={chosen || full}
                    onClick={() => onChange([...paths, path])}
                    aria-label={chosen ? 'Already added' : 'Add this photo'}
                  >
                    <SignImage path={path} alt="" />
                    {chosen && <span className="badge badge-good">Added</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
