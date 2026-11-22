import type { SupabaseClient } from '@supabase/supabase-js';

/** Where customer-submitted photos are stored. Faked in tests. */
export interface PhotoStore {
  upload(path: string, data: Uint8Array, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
}

export function supabasePhotoStore(supabase: SupabaseClient, bucket: string): PhotoStore {
  return {
    async upload(path, data, contentType) {
      const { error } = await supabase.storage.from(bucket).upload(path, data, { contentType, upsert: false });
      if (error) throw new Error(`Storage upload failed: ${error.message}`);
    },
    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) throw new Error(`Storage remove failed: ${error.message}`);
    },
  };
}

export type ImageType = { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' };

/**
 * Identify an image by its first bytes, not by its file name or the type the
 * browser claims. Anything other than JPEG, PNG, or WebP (including SVG, which
 * can contain scripts) is rejected.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (bytes.length >= 3 && startsWith([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 8 && startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (bytes.length >= 12 && startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}
