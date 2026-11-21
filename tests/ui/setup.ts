import { afterEach, vi } from 'vitest';

// Shared by all test files; the DOM-specific parts apply only under jsdom.
afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    localStorage.clear();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
