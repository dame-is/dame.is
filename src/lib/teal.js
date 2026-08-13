// teal.fm's namespace move, in one place.
//
// On 2026-08-13 teal.fm left its `fm.teal.alpha.*` lexicons for production
// `fm.teal.*` (announced by @matt.evil.gay,
// https://bsky.app/profile/matt.evil.gay/post/3mswizpehic2g). The guidance for
// appviews and analysis apps was explicit:
//
//   "backfill both `fm.teal.alpha.feed.play` *and* `fm.teal.feed.play`, then
//    deduplicate based on rkeys (prioritize production namespace)"
//
// So nothing here cuts over on a date. Every teal surface on the site reads
// BOTH namespaces and collapses the result by rkey with production winning —
// which means the archive stays whole no matter which namespace the scrobbler
// is writing to at any given moment, and a play that exists in both is counted
// once. The play NSIDs (and their priority) come straight from the `listening`
// verb's collection order in the registry; production is listed first there,
// and that ordering IS the priority.
//
// The record shapes are near-identical across the move. Two fields were renamed
// on the way to production — `originUrl` → `originUri` (which the site reads,
// under both spellings) and `musicServiceBaseDomain` → `musicServiceUri` (which
// it doesn't surface at all) — and `artistNames`, a plain string[], survives as
// a deprecated alternative to `artists` (objects carrying `artistName` +
// `artistMbId`). The accessors below are the only place any of that is spelled
// out; everything else on the site asks them for a track name, an artist line,
// or an origin URL.

import { getRecord, listRecords, rkeyFromAtUri } from './atproto.js';
import { verbConfig } from './verbRegistry.js';

/**
 * Play lexicons, production first. Sourced from the registry so the feed
 * ingest and these helpers can never disagree about which collections make up
 * "listening" — or about which one wins a tie.
 */
export const TEAL_PLAY_NSIDS = (verbConfig('listening')?.collections || []).map((c) => c.nsid);

/**
 * "Now playing" status lexicons, production first. A singleton at rkey `self`
 * carrying `{ time, expiry, item }`, where `item` is a play view — the same
 * shape a play record has. Not a feed verb (it's a single mutable record, not
 * an archive), so unlike the play NSIDs these aren't in the registry.
 */
export const TEAL_STATUS_NSIDS = ['fm.teal.actor.status', 'fm.teal.alpha.actor.status'];

/**
 * The lexicon's own fallback: a status with no `expiry` is current for ten
 * minutes after its `time`.
 */
const DEFAULT_STATUS_TTL_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Field accessors — alpha and production spellings                    */
/* ------------------------------------------------------------------ */

/** Track title. `track` is neither lexicon's field, but old snapshots carry it. */
export function playTrackName(value) {
  return String(value?.trackName || value?.track || '').trim();
}

/**
 * Artist names in order of appearance. Reads `artists` (both lexicons'
 * preferred form), then the deprecated `artistNames` string array, then a
 * bare `artist` string.
 */
export function playArtistNames(value) {
  if (Array.isArray(value?.artists)) {
    return value.artists.map((a) => a?.artistName).filter(Boolean);
  }
  if (Array.isArray(value?.artistNames)) {
    return value.artistNames.filter(Boolean).map(String);
  }
  return value?.artist ? [String(value.artist)] : [];
}

/** Artist names as one display line ("Kelela, Asmara"). */
export function playArtistLine(value) {
  return playArtistNames(value).join(', ');
}

/** Where the play happened — `originUri` in production, `originUrl` in alpha. */
export function playOriginUrl(value) {
  return value?.originUri || value?.originUrl || null;
}

/** When playback began. */
export function playedAtOf(value) {
  return value?.playedTime || value?.playedAt || null;
}

/* ------------------------------------------------------------------ */
/* Cross-namespace deduplication                                       */
/* ------------------------------------------------------------------ */

const defaultUriOf = (entry) => entry?.uri || entry?.atUri || null;

/** Registry position of a URI's collection; unknown collections sort last. */
function namespaceRank(uri) {
  const m = String(uri || '').match(/^at:\/\/[^/]+\/([^/]+)\//);
  const idx = m ? TEAL_PLAY_NSIDS.indexOf(m[1]) : -1;
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

/**
 * Collapse plays that exist in more than one namespace. The migration keeps
 * rkeys, so an rkey seen under both lexicons is one play written twice;
 * production wins, and ties (two entries from the same namespace, or two
 * unranked ones) go to whichever came first.
 *
 * Input order is preserved for the survivors, so a newest-first list stays
 * newest-first. Entries whose URI has no rkey pass through untouched rather
 * than being silently dropped.
 *
 * Works on raw PDS records (`uri`) and on unified-feed items (`atUri`) alike;
 * pass `uriOf` to read the URI off some other shape.
 */
export function dedupePlaysByRkey(entries, uriOf = defaultUriOf) {
  if (!Array.isArray(entries) || entries.length < 2) return entries || [];
  const winners = new Map();
  for (const entry of entries) {
    const uri = uriOf(entry);
    const rkey = rkeyFromAtUri(uri);
    if (!rkey) continue;
    const rank = namespaceRank(uri);
    const held = winners.get(rkey);
    if (!held || rank < held.rank) winners.set(rkey, { entry, rank });
  }
  return entries.filter((entry) => {
    const rkey = rkeyFromAtUri(uriOf(entry));
    if (!rkey) return true;
    return winners.get(rkey)?.entry === entry;
  });
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Every play on `repo`, both namespaces, deduped by rkey and sorted
 * newest-first. `max` is the per-namespace cap.
 *
 * A namespace that errors (or simply doesn't exist yet on this PDS) yields
 * nothing rather than failing the whole read — during the move, exactly one of
 * the two is usually empty.
 */
export async function listTealPlays(pds, { repo, max = 500 } = {}) {
  const pages = await Promise.all(
    TEAL_PLAY_NSIDS.map((collection) =>
      listRecords(pds, { repo, collection, max }).catch(() => []),
    ),
  );
  const merged = dedupePlaysByRkey(pages.flat().filter((r) => r?.uri && r.value));
  return merged.sort(comparePlaysDesc);
}

/**
 * Newest-first comparator for raw play records. Undated plays sink to the
 * bottom instead of poisoning the sort with NaN.
 */
export function comparePlaysDesc(a, b) {
  return playInstant(b) - playInstant(a);
}

function playInstant(record) {
  const value = record?.value || {};
  const t = Date.parse(playedAtOf(value) || value.createdAt || record?.indexedAt || '');
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * The `self` status singleton, newest `time` across both namespaces, or null
 * when neither exists. Returns the raw record (`{ uri, value }`).
 */
export async function fetchTealStatus(pds, { repo } = {}) {
  const found = await Promise.all(
    TEAL_STATUS_NSIDS.map((collection) =>
      getRecord(pds, { repo, collection, rkey: 'self' }).catch(() => null),
    ),
  );
  const present = found.filter((r) => r?.value?.item);
  if (!present.length) return null;
  const stamp = (r) => {
    const t = Date.parse(r.value.time || '');
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  return present.reduce((best, rec) => (stamp(rec) > stamp(best) ? rec : best));
}

/**
 * The play view inside a status record, but only while the status is still
 * current — a stale "now playing" is worse than none, since the whole point of
 * the record is that it's happening right now. Returns null once it's expired.
 */
export function statusPlay(record, now = Date.now()) {
  const value = record?.value;
  if (!value?.item) return null;
  const expiry = Date.parse(value.expiry || '');
  const started = Date.parse(value.time || '');
  const until = Number.isFinite(expiry)
    ? expiry
    : Number.isFinite(started)
      ? started + DEFAULT_STATUS_TTL_MS
      : null;
  if (until === null || now > until) return null;
  return value.item;
}
