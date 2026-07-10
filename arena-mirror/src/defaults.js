// Option normalization and derived collection NSIDs for the are.na → PDS
// mirror. Every collection name is derived from a single configurable
// `nsidBase`, so another deployment — or an eventual shared "atmosphere
// arena" namespace — can claim its own collections by changing one string.
// The lexicon JSONs in ../lexicons document the record shapes under the
// default base.

export const DEFAULT_NSID_BASE = 'is.dame.arena.mirror';

export const BLOCK_SCOPES = ['connected', 'created'];
export const MEDIA_MODES = ['references', 'blobs'];

// Matches the reference PDS's default blobUploadLimit. Anything larger is
// mirrored as a reference even in blobs mode.
export const DEFAULT_MAX_BLOB_BYTES = 5 * 1024 * 1024;

export function collectionsFor(nsidBase = DEFAULT_NSID_BASE) {
  return {
    channel: `${nsidBase}.channel`,
    block: `${nsidBase}.block`,
    connection: `${nsidBase}.connection`,
    sync: `${nsidBase}.sync`,
  };
}

/**
 * Validate and default the sync options. Throws on anything that would
 * otherwise fail silently (a typo'd mode shouldn't fall back to a default).
 */
export function normalizeOptions(opts = {}) {
  const user = String(opts.user || '').trim();
  if (!user) throw new Error('arena-mirror: `user` (are.na profile slug) is required');

  const blockScope = opts.blockScope || 'connected';
  if (!BLOCK_SCOPES.includes(blockScope)) {
    throw new Error(`arena-mirror: blockScope must be one of ${BLOCK_SCOPES.join(', ')}`);
  }

  const mediaMode = opts.mediaMode || 'references';
  if (!MEDIA_MODES.includes(mediaMode)) {
    throw new Error(`arena-mirror: mediaMode must be one of ${MEDIA_MODES.join(', ')}`);
  }

  const maxBlobBytes = Number(opts.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES);
  if (!Number.isFinite(maxBlobBytes) || maxBlobBytes <= 0) {
    throw new Error('arena-mirror: maxBlobBytes must be a positive number');
  }

  const channels = Array.isArray(opts.channels) && opts.channels.length
    ? opts.channels.map((s) => String(s).trim()).filter(Boolean)
    : null;

  return {
    user,
    nsidBase: opts.nsidBase || DEFAULT_NSID_BASE,
    blockScope,
    mediaMode,
    includePrivate: Boolean(opts.includePrivate),
    maxBlobBytes,
    channels, // optional slug/id subset (testing) — implies partial semantics
    full: Boolean(opts.full),
    dryRun: Boolean(opts.dryRun),
    timeBudgetMs: opts.timeBudgetMs ? Number(opts.timeBudgetMs) : null,
  };
}

/**
 * A settings fingerprint stored on the sync-state record. When it changes
 * (scope widened, media mode flipped, different namespace…) the per-channel
 * freshness markers are ignored and everything is re-walked, so records
 * reflect the new settings instead of a mix.
 */
export function settingsSignature(o) {
  return [
    'v1',
    o.nsidBase,
    o.blockScope,
    o.mediaMode,
    o.includePrivate ? 'private+public' : 'public',
    String(o.maxBlobBytes),
    o.user,
  ].join('|');
}
