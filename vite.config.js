import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paletteForHour } from './src/lib/skyTheme.js';
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

// The nav menu's is.dame.nav/self snapshot, baked into the bundle so the menu's
// first render is already the owner's list (see src/hooks/useNavRoutes.js).
// scripts/prefetch.mjs writes it before `vite build` runs. The app used to
// fetch the same file at runtime, which left the built-in routes on screen for
// the half second that took and then reshuffled them, under any tap that
// landed in it. Null with no snapshot (dev without a prefetch,
// `build:offline`), and the app falls back to that runtime fetch.
function readNavSeed() {
  try {
    const path = fileURLToPath(new URL('./public/data/nav.json', import.meta.url));
    const snap = JSON.parse(readFileSync(path, 'utf8'));
    return snap?.value ? snap : null;
  } catch {
    return null;
  }
}

// The is.dame.sky/self tuning, baked in the same way so the palette is the
// tuned hour from the first frame (see src/main.jsx). It used to arrive after
// paint, so a cold load went untuned cyan → tuned page. Null with no snapshot
// or an empty record, and the app falls back to the runtime fetch.
function readSkySeed() {
  try {
    const path = fileURLToPath(new URL('./public/data/sky.json', import.meta.url));
    const snap = JSON.parse(readFileSync(path, 'utf8'));
    return snap?.value ? snap : null;
  } catch {
    return null;
  }
}

const SKY_SEED = readSkySeed();

// The tokens the first frame needs before any module has run: the page, the
// bar surfaces the browser tints its own chrome from, and the inks.
const FIRST_PAINT_TOKENS = ['page', 'surface-raised', 'surface-deep', 'ink', 'ink-faint', 'accent'];

// Inline a 24-hour table of those tokens (tuning and contrast floor applied)
// into <head>, with a few lines that pick this Eastern hour's row. Before
// this, everything ahead of the entry module painted in theme.css's
// fallbacks, so a cold load opened on the retired parchment. main.jsx then
// writes the full palette over it, from the same derivation. About 1 KB.
function skyFirstPaint() {
  return {
    name: 'dame-sky-first-paint',
    transformIndexHtml(html) {
      const tuning = effectiveSkyTuning(SKY_SEED);
      const rows = Array.from({ length: 24 }, (_, h) => {
        const p = paletteForHour(h, tuning);
        return [p.day ? 1 : 0, ...FIRST_PAINT_TOKENS.map((k) => p.vars[`--sky-${k}`].slice(1))].join(',');
      });
      const script =
        '<script>(function(){try{' +
        `var T=${JSON.stringify(rows)},K=${JSON.stringify(FIRST_PAINT_TOKENS)};` +
        "var h=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false}).format(new Date()))%24;" +
        "var r=T[h].split(','),s=document.documentElement.style;" +
        "for(var i=0;i<K.length;i++)s.setProperty('--sky-'+K[i],'#'+r[i+1]);" +
        "s.colorScheme=r[0]==='1'?'light':'dark';" +
        "var m=document.querySelector('meta[name=\"theme-color\"]');if(m)m.setAttribute('content','#'+r[2]);" +
        '}catch(e){}})();</script>';
      return html.replace('<!-- sky-first-paint -->', script);
    },
  };
}

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

export default defineConfig({
  plugins: [react(), skyFirstPaint(), emitVersionJson()],
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
    __NAV_SEED__: JSON.stringify(readNavSeed()),
    __SKY_SEED__: JSON.stringify(SKY_SEED),
  },
});
