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

/**
 * Serve `harness/index.html` for every HTML navigation.
 *
 * The root stays the REPO root rather than `harness/`, which is where it used to
 * be, because `import.meta.glob` resolves a leading-slash pattern against
 * Vite's root. Rooted at `harness/`, `src/lib/legacyBlog.js`'s
 * `import.meta.glob('/writing/blogs/*.md')` looked for `harness/writing/blogs`,
 * matched nothing, and the legacy-blog migration surface rendered zero rows in
 * the harness while the real site had eight posts — a surface that could not be
 * reviewed at all, and a silent one, because an empty glob is not an error.
 * Same for `/images/blog/**`.
 *
 * With the root moved, Vite's own SPA fallback would serve the PRODUCTION
 * `index.html`, which boots the real app against the real PDS. This middleware
 * points every navigation at the harness shell instead. It runs BEFORE the
 * transform middleware so the html still goes through Vite's pipeline.
 */
function serveHarnessShell() {
  return {
    name: 'harness-shell',
    configureServer(server) {
      // Installed EAGERLY, not through the returned post-hook. Vite's own
      // spa-fallback middleware is one of the internals, and it rewrites
      // `/admin` to `/index.html` — the production shell, which boots the real
      // app against the real PDS — before a post-hook middleware ever sees the
      // request. (Symptom when it did: the admin rendered, because the session
      // swap is a resolver and still applied, but `?hour=` did nothing and
      // `data-harness` was absent, so every screenshot was taken at the wall
      // clock's palette while claiming to be pinned.)
      server.middlewares.use((req, _res, next) => {
        const url = (req.url || '').split('?')[0];
        // Anything Vite owns — modules, @fs reads, HMR, source files — keeps its
        // own URL. Only a navigation is rewritten.
        const isAsset = /\.[a-z0-9]+$/i.test(url);
        const isInternal = url.startsWith('/@') || url.startsWith('/node_modules');
        if (!isAsset && !isInternal && req.headers.accept?.includes('text/html')) {
          req.url = '/harness/index.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [swapSessionModule(), serveHarnessShell(), react()],
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
