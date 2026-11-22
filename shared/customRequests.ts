// Plain constants for custom sign requests (no dependencies), shared by the
// browser and the server.
import type { CustomRequestStatus } from './types';

export const MAX_CUSTOM_PHOTOS = 4;
/** Per photo, after the browser has resized it. */
export const MAX_CUSTOM_PHOTO_BYTES = 3 * 1024 * 1024;
/** Netlify functions accept request bodies up to 6 MB. */
export const MAX_CUSTOM_REQUEST_BYTES = 6_000_000;
export const CUSTOM_DESCRIPTION_MIN = 10;
export const CUSTOM_DESCRIPTION_MAX = 3000;
export const CUSTOM_PHOTO_BUCKET = 'custom-request-photos';

export const CUSTOM_STATUS_LABEL: Record<CustomRequestStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
};

export function customRequestRef(requestNumber: number): string {
  return `C-${requestNumber}`;
}
