// Dev-only config for the admin harness.
//
//   npm run harness      → http://localhost:5174/admin
//
// Runs the real app — real router, real providers, real admin components — with
// exactly one module swapped: the ATProto session hook is replaced by
// harness/fakeSession.jsx, which presents a signed-in owner backed by an
// in-memory fixture repo. That is enough to open, edit and screenshot every
// admin surface without an OAuth round trip.
//
// This config is never used by `npm run build`; the production entry is the
// root index.html and knows nothing about harness/.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const REAL_SESSION = fileURLToPath(new URL('./src/hooks/useAtprotoSession.jsx', import.meta.url));
const FAKE_SESSION = fileURLToPath(new URL('./harness/fakeSession.jsx', import.meta.url));

/**
 * Redirect every import of the session hook to the fake, whatever relative
 * specifier the importer used. A plain `resolve.alias` can't do this: aliases
 * match the raw specifier, and every call site imports it relatively.
 */
function swapSessionModule() {
  return {
    name: 'harness-swap-session',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith('\0')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && resolved.id.split('?')[0] === REAL_SESSION) return FAKE_SESSION;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [swapSessionModule(), react()],
  root: fileURLToPath(new URL('./harness', import.meta.url)),
  publicDir: false,
  server: {
    port: 5174,
    fs: {
      // The harness entry lives in harness/ but imports the whole of src/.
      allow: [fileURLToPath(new URL('.', import.meta.url))],
    },
  },
  define: {
    __BUILD_ID__: JSON.stringify('harness'),
    __COMMIT_SHA__: JSON.stringify('harness'),
    __BUILD_TIME__: JSON.stringify('1970-01-01T00:00:00.000Z'),
  },
});
