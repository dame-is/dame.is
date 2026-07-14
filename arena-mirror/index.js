// arena-pds-mirror — mirror an are.na account (channels, blocks,
// connections, media) into atproto records on the owner's PDS.
//
// This folder is deliberately self-contained: its only runtime dependency is
// `@atproto/api` (supplied by the host project), so it can be lifted out
// into a standalone repo unchanged. See README.md.

export { syncArenaMirror } from './src/engine.js';
export { ArenaClient } from './src/arena.js';
export {
  collectionsFor,
  normalizeOptions,
  settingsSignature,
  DEFAULT_NSID_BASE,
  DEFAULT_MAX_BLOB_BYTES,
  BLOCK_SCOPES,
  MEDIA_MODES,
} from './src/defaults.js';
export { channelValue, blockValue, connectionValue, valuesEqual, arenaMarkdown } from './src/records.js';
