// Build identity, injected at build time by vite.config.js via `define`.
//
// These resolve in dev too (the config computes them on every start), but
// nothing polls locally — the auto-update watcher is production-only. The
// build id is keyed on the git commit, so a content-only rebuild (the
// 6-hour PDS refresh cron) keeps the same id and never reloads anyone;
// only an actual code change ships a new id.

/* global __BUILD_ID__, __COMMIT_SHA__, __BUILD_TIME__ */

export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
export const COMMIT_SHA = typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : 'dev';
export const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null;
