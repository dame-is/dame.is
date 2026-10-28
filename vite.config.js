import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { injectSkyBoot } from './src/lib/skyBoot.js';
import { effectiveSkyTuning } from './src/lib/skyTuning.js';

// Build identity for the auto-update watcher (see src/hooks/useAutoUpdate.js).
//
// Keyed on the git commit so a content-only rebuild — the 6-hour PDS-refresh
// cron fires the deploy hook without a code change — keeps the same id and
// never reloads anyone. Only an actual code change ships a new id. Falls back
// to build time when git isn't available (e.g. a source tarball) so the id is
// still unique.
function getBuildInfo() {
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    (() => {
      try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      } catch {
        return '';
      }
    })();
  return {
    id: commit ? commit.slice(0, 12) : `t${Date.now()}`,
    commit: commit || 'unknown',
    builtAt: new Date().toISOString(),
  };
}

const BUILD = getBuildInfo();

// Emit dist/version.json (matching the baked-in build id) so the running app
// can poll it and detect when a newer build has been deployed. Written in
// closeBundle — after Vite copies public/ into the output — so nothing
// clobbers it.
function emitVersionJson() {
  let outDir = 'dist';
  return {
    name: 'dame-emit-version-json',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const body = JSON.stringify(
        { id: BUILD.id, commit: BUILD.commit, builtAt: BUILD.builtAt },
        null,
        2,
      );
      writeFileSync(resolve(outDir, 'version.json'), body + '\n', 'utf8');
    },
  };
}

// The owner's is.dame.sky tuning as `npm run build` prefetched it, read once
// here for both sides of the first paint: index.html's sky boot table (see
// src/lib/skyBoot.js), and `virtual:sky-tuning`, which main.jsx installs
// before the bundle's first paint. One reading, so the colour the page boots
// in is the colour the bundle then paints, and only the normalised tuning
// ships rather than the raw record. Read on every request, so a dev server
// picks up a fresh prefetch without a restart. No snapshot (a fresh clone, a
// `build:offline`) means no tuning on either side: the built-in palette.
const SKY_TUNING_ID = 'virtual:sky-tuning';
const RESOLVED_SKY_TUNING_ID = '\0' + SKY_TUNING_ID;

function skyBootPaint() {
  let snapshot = resolve(process.cwd(), 'public/data/sky.json');
  const readTuning = () =>
    existsSync(snapshot)
      ? effectiveSkyTuning(JSON.parse(readFileSync(snapshot, 'utf8')))
      : null;
  return {
    name: 'dame-sky-boot-paint',
    configResolved(config) {
      snapshot = resolve(config.root, 'public/data/sky.json');
    },
    resolveId(id) {
      return id === SKY_TUNING_ID ? RESOLVED_SKY_TUNING_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_SKY_TUNING_ID) return null;
      this.addWatchFile(snapshot);
      return `export default ${JSON.stringify(readTuning())};`;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return injectSkyBoot(html, readTuning());
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), emitVersionJson(), skyBootPaint()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  define: {
    __BUILD_ID__: JSON.stringify(BUILD.id),
    __COMMIT_SHA__: JSON.stringify(BUILD.commit),
    __BUILD_TIME__: JSON.stringify(BUILD.builtAt),
  },
});
