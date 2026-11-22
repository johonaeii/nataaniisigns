import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleCreateCustomRequest } from '../../server/handlers/createCustomRequest';
import type { CustomRequestRow } from '../../shared/types';
import { buildDeps, type TestDeps } from '../helpers/appDeps';
import { createTestDb, type TestDb } from '../helpers/testDb';

let t: TestDb;
let deps: TestDeps;

beforeEach(async () => {
  t = await createTestDb();
  deps = buildDeps(t);
});

afterEach(async () => {
  await t.close();
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBPVP8 '].map((c) => c.charCodeAt(0))));
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function submit(
  fields: Partial<Record<'name' | 'email' | 'phone' | 'description' | 'website', string>> = {},
  photos: Array<{ bytes: Uint8Array<ArrayBuffer>; name?: string; type?: string }> = [],
  headers: Record<string, string> = {},
) {
  const form = new FormData();
  const values = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '',
    description: 'A cedar sign that says "The Lovelace Family", about 3 feet wide, white letters.',
    ...fields,
  };
  for (const [key, value] of Object.entries(values)) form.append(key, value);
  for (const [i, photo] of photos.entries()) {
    form.append('photos', new File([photo.bytes], photo.name ?? `photo${i}.jpg`, { type: photo.type ?? 'image/jpeg' }));
  }
  return handleCreateCustomRequest(
    new Request('https://shop.test/api/custom-requests', { method: 'POST', body: form, headers }),
    deps,
  );
}

async function storedRequests() {
  const result = await t.db.query<CustomRequestRow>('select * from public.custom_requests order by request_number');
  return result.rows;
}

describe('custom sign request submission', () => {
  it('stores the request and uploads photos to private storage', async () => {
    const response = await submit({}, [{ bytes: JPEG }, { bytes: PNG, name: 'sketch.png', type: 'image/png' }, { bytes: WEBP }]);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ requestNumber: 101 });

    const [request] = await storedRequests();
    expect(request.customer_name).toBe('Ada Lovelace');
    expect(request.photo_paths).toHaveLength(3);
    for (const path of request.photo_paths) {
      expect(path.startsWith(`${request.id}/`)).toBe(true);
      expect(deps.customPhotos.files.has(path)).toBe(true);
    }
    expect([...deps.customPhotos.files.values()].map((f) => f.contentType)).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(deps.notify.sent).toEqual([{ kind: 'customRequestSubmitted', orderId: request.id }]);
  });

  it('works without photos and with phone-only contact', async () => {
    const response = await submit({ email: '', phone: '505-555-0142' });
    expect(response.status).toBe(201);
    expect((await storedRequests())[0]).toMatchObject({ customer_email: null, customer_phone: '505-555-0142', photo_paths: [] });
  });

  it('returns field errors and stores nothing for invalid details', async () => {
    const response = await submit({ email: '', phone: '', description: 'sign' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { fieldErrors: Record<string, string> };
    expect(Object.keys(body.fieldErrors).sort()).toEqual(['customer.email', 'description']);
    expect(await storedRequests()).toEqual([]);
  });

  it('rejects files that are not really images, whatever they claim to be', async () => {
    const response = await submit({}, [{ bytes: SVG, name: 'photo.jpg', type: 'image/jpeg' }]);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('invalid_photos');
    expect(await storedRequests()).toEqual([]);
    expect(deps.customPhotos.files.size).toBe(0);
  });

  it('limits the number and size of photos', async () => {
    expect((await submit({}, Array.from({ length: 5 }, () => ({ bytes: JPEG })))).status).toBe(400);

    const huge = new Uint8Array(3 * 1024 * 1024 + 1);
    huge.set(JPEG);
    expect((await submit({}, [{ bytes: huge }])).status).toBe(400);
    expect(await storedRequests()).toEqual([]);
  });

  it('refuses oversized requests before reading them', async () => {
    const response = await handleCreateCustomRequest(
      new Request('https://shop.test/api/custom-requests', {
        method: 'POST',
        headers: { 'content-length': '7000000', 'content-type': 'multipart/form-data; boundary=x' },
        body: '--x--',
      }),
      deps,
    );
    expect(response.status).toBe(413);
  });

  it('rejects bots that fill the honeypot', async () => {
    expect((await submit({ website: 'http://spam.example' })).status).toBe(400);
    expect(await storedRequests()).toEqual([]);
  });

  it('rate-limits repeat submissions from one visitor before uploading anything', async () => {
    const ip = { 'x-nf-client-connection-ip': '203.0.113.7' };
    for (let i = 0; i < 5; i += 1) expect((await submit({}, [], ip)).status).toBe(201);

    const limited = await submit({}, [{ bytes: JPEG }], ip);
    expect(limited.status).toBe(429);
    expect(deps.customPhotos.files.size).toBe(0);

    expect((await submit({}, [], { 'x-nf-client-connection-ip': '198.51.100.2' })).status).toBe(201);
    // The raw IP address is never stored.
    expect(JSON.stringify(await storedRequests())).not.toContain('203.0.113.7');
  });

  it('rolls everything back if a photo upload fails, so the customer can retry', async () => {
    deps.customPhotos.failOnUpload = 2;
    const response = await submit({}, [{ bytes: JPEG }, { bytes: JPEG }]);

    expect(response.status).toBe(502);
    expect(deps.customPhotos.files.size).toBe(0);
    expect(await storedRequests()).toEqual([]);
    expect(deps.notify.sent).toEqual([]);
  });

  it('rejects non-POST requests', async () => {
    const response = await handleCreateCustomRequest(new Request('https://shop.test/api/custom-requests'), deps);
    expect(response.status).toBe(405);
  });
});
