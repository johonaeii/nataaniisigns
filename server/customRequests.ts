import type { CustomRequestRow } from '../shared/types';
import type { RpcClient } from './db';

/** Typed wrappers around the custom request functions in the Supabase migration. */
export function createCustomRequestRepo(rpc: RpcClient) {
  return {
    create(input: {
      name: string;
      email: string | null;
      phone: string | null;
      description: string;
      clientKey: string | null;
    }): Promise<CustomRequestRow> {
      return rpc<CustomRequestRow>('create_custom_request', {
        p_customer_name: input.name,
        p_customer_email: input.email,
        p_customer_phone: input.phone,
        p_description: input.description,
        p_client_key: input.clientKey,
      });
    },

    attachPhotos(requestId: string, photoPaths: string[]): Promise<void> {
      return rpc<void>('attach_custom_request_photos', { p_request_id: requestId, p_photo_paths: photoPaths });
    },

    discard(requestId: string): Promise<void> {
      return rpc<void>('discard_custom_request', { p_request_id: requestId });
    },
  };
}

export type CustomRequestRepo = ReturnType<typeof createCustomRequestRepo>;
