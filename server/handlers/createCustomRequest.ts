import { createHmac, randomUUID } from 'node:crypto';
import {
  MAX_CUSTOM_PHOTO_BYTES,
  MAX_CUSTOM_PHOTOS,
  MAX_CUSTOM_REQUEST_BYTES,
} from '../../shared/customRequests';
import type { CreateCustomRequestResponse, CustomRequestRow } from '../../shared/types';
import { customRequestSchema, fieldErrorsFromZod } from '../../shared/validation';
import { DbError } from '../db';
import type { AppDeps } from '../deps';
import { GENERIC_ERROR_MESSAGE, apiError, json, methodNotAllowed } from '../http';
import { sniffImageType, type ImageType } from '../photoStore';

interface Photo {
  bytes: Uint8Array;
  type: ImageType;
}

/**
 * POST /api/custom-requests (multipart/form-data)
 * Fields: name, email, phone, description, website (honeypot), photos (0-4 image files).
 *
 * Validates everything (photo types are checked by their content), applies a
 * rate limit, then stores the request and uploads photos to private storage.
 */
export async function handleCreateCustomRequest(req: Request, deps: AppDeps): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed(['POST']);

  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_CUSTOM_REQUEST_BYTES) {
    return apiError(413, 'too_large', 'Those photos are too large. Try fewer or smaller photos.');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(400, 'invalid_request', 'The request could not be read.');
  }

  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value : '';
  };

  const parsed = customRequestSchema.safeParse({
    customer: { name: text('name'), email: text('email'), phone: text('phone') },
    description: text('description'),
    website: text('website'),
  });
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'Please check the highlighted fields.', {
      fieldErrors: fieldErrorsFromZod(parsed.error),
    });
  }
  if (parsed.data.website) {
    deps.log.warn('custom_request_honeypot_triggered');
    return apiError(400, 'invalid_request', 'The request could not be processed.');
  }

  const files = form.getAll('photos').filter((value): value is File => typeof value !== 'string');
  if (files.length > MAX_CUSTOM_PHOTOS) {
    return photoError(`You can attach up to ${MAX_CUSTOM_PHOTOS} photos.`);
  }
  const photos: Photo[] = [];
  for (const file of files) {
    if (file.size > MAX_CUSTOM_PHOTO_BYTES) return photoError('One of the photos is too large. Try a smaller one.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type) return photoError('Photos must be JPEG, PNG, or WebP images.');
    photos.push({ bytes, type });
  }

  const { customer, description } = parsed.data;
  let request: CustomRequestRow;
  try {
    request = await deps.customRequests.create({
      name: customer.name,
      email: customer.email ?? null,
      phone: customer.phone ?? null,
      description,
      clientKey: clientKey(req, deps),
    });
  } catch (error) {
    if (error instanceof DbError && error.message === 'RATE_LIMITED') {
      return apiError(
        429,
        'rate_limited',
        "We've received a lot of requests recently. Please try again later, or contact us directly.",
      );
    }
    if (error instanceof DbError && (error.code === '23514' || error.code === '22001')) {
      return apiError(400, 'invalid_request', 'Please check your details and try again.');
    }
    deps.log.error('custom_request_create_failed', { error: String(error) });
    return apiError(500, 'server_error', GENERIC_ERROR_MESSAGE);
  }

  if (photos.length > 0) {
    const uploaded: string[] = [];
    try {
      for (const photo of photos) {
        const path = `${request.id}/${randomUUID()}.${photo.type.ext}`;
        await deps.customPhotos.upload(path, photo.bytes, photo.type.mime);
        uploaded.push(path);
      }
      await deps.customRequests.attachPhotos(request.id, uploaded);
      request = { ...request, photo_paths: uploaded };
    } catch (error) {
      deps.log.error('custom_request_upload_failed', { requestId: request.id, error: String(error) });
      // Roll back so the customer can simply try again.
      await deps.customPhotos.remove(uploaded).catch(() => undefined);
      await deps.customRequests.discard(request.id).catch(() => undefined);
      return apiError(502, 'upload_failed', "We couldn't upload your photos. Please try again.");
    }
  }

  deps.log.info('custom_request_submitted', { requestId: request.id, photos: photos.length });
  await deps.notify.customRequestSubmitted(request);
  return json(201, { requestNumber: request.request_number } satisfies CreateCustomRequestResponse);
}

function photoError(message: string): Response {
  return apiError(400, 'invalid_photos', message, { fieldErrors: { photos: message } });
}

/**
 * A keyed hash of the visitor's IP address for rate limiting. The raw IP is
 * never stored, and the key (a server secret) prevents reversing the hash.
 */
function clientKey(req: Request, deps: AppDeps): string | null {
  const ip =
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const secret = deps.config.supabaseServiceRoleKey;
  if (!ip || !secret) return null;
  return createHmac('sha256', secret).update(`custom-request:${ip}`).digest('hex');
}
