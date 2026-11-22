// Shrink phone photos in the browser before upload: faster on mobile data and
// well under the server's size limits. Used by the admin photo manager and the
// custom sign request form.

const MAX_DIMENSION = 1600;
const QUALITY = 0.85;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function resizeImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`"${file.name}" isn't a supported image. Try a JPEG, PNG, or WebP photo.`);
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not process this image.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // WebP is smaller; some browsers (older Safari) silently fall back to PNG, so check.
  let blob = await canvasToBlob(canvas, 'image/webp', QUALITY);
  if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', QUALITY);
  if (!blob) throw new Error('Your browser could not process this image.');
  return blob;
}

export function extensionFor(type: string): string {
  return type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
}
