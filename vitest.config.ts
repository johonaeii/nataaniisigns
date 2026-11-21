import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node', // UI tests opt in to jsdom with a file comment
    setupFiles: ['tests/ui/setup.ts'],
    env: {
      VITE_SUPABASE_URL: 'https://project.supabase.test',
      VITE_SUPABASE_ANON_KEY: 'anon-key-for-tests',
      VITE_ONLINE_PAYMENTS_ENABLED: 'true',
    },
    // PGlite boots a real Postgres in WebAssembly; give it room on slow machines.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
