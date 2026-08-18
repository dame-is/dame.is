// Field accessors shared by every admin list, row and dashboard section.
//
// The first four — `recordInstant`, `stampAutoTimestamps`, `previewFor` and
// `truncate` — are lifted VERBATIM out of src/pages/Admin.jsx, where they were
// module-private helpers of the old `RecordList`. Their behaviour is deliberately
// unchanged: the record rows they render are the ones the owner already reads,
// and "the list looks different now" is not a feature of this rebuild.
//
// The last two — `latestInstant` and `rowLabel` — are NEW, and exist because the
// old helpers answer a different question than the Front Desk asks. `previewFor`
// answers "what does this record say?"; a dashboard row asks "which record is
// this?". `recordInstant` answers "when was this published?"; a newest-first
// merge asks "when was this last touched?". Using the display helpers for the
// ordering questions was measured against the live repo and produced four at-URIs
// and a duplicated slug in the top eight rows — see the notes on each below.

import { lexiconFor } from '../lib/lexicons.js';
import { rkeyFromAtUri, tidToTimestamp } from '../lib/atproto.js';

/**
 * The record's own timestamp for display. Different lexicons name their primary
 * instant differently — standard docs use `publishedAt`, is.dame.* records use
 * `createdAt`, teal.fm plays use `playedTime` — so prefer a "published" instant,
 * then creation, then last-update.
 */
export function recordInstant(value) {
  if (!value || typeof value !== 'object') return null;
  return (
    value.publishedAt || value.createdAt || value.playedTime || value.updatedAt || null
  );
}

/**
 * Stamp any `autoOnEdit` datetime fields (e.g. `updatedAt`) to now, mirroring
 * what the full record editor does on save so a bulk visibility flip records
 * the same freshness bump.
 */
export function stampAutoTimestamps(lex, value) {
  if (!lex?.fields) return value;
  const next = { ...value };
  const nowIso = new Date().toISOString();
  for (const f of lex.fields) {
    if (f.autoOnEdit && f.type === 'datetime') next[f.key] = nowIso;
  }
  return next;
}

export function previewFor(value, lex) {
  if (!value || typeof value !== 'object') return '';
  if (lex?.fields) {
    for (const f of lex.fields) {
      const v = value[f.key];
      if (typeof v === 'string' && v.trim()) {
        return f.key === 'createdAt' || f.key === 'updatedAt' ? '' : truncate(v, 120);
      }
    }
  }
  for (const k of ['title', 'status', 'text', 'name']) {
    if (typeof value[k] === 'string' && value[k].trim()) return truncate(value[k], 120);
  }
  return '';
}

export function truncate(s, n) {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

/**
 * Per-collection last-resort instants, for records whose real time of occurrence
 * lives in a named field rather than one of the three conventional ones.
 *
 * `is.dame.creating.ratioed.piece` carries no createdAt / updatedAt / publishedAt
 * at all — its required field is `measuredAt` — and its rkey is the SUBJECT post's
 * rkey (see the lexicon's own summary), so neither the timestamp fallbacks nor the
 * TID would date it correctly.
 */
const LAST_RESORT = {
  'is.dame.creating.ratioed.piece': (v) => v?.measuredAt || null,
};

/**
 * Best honest instant for a record, for newest-first ordering only.
 *
 * Returns null when the record has no trustworthy timestamp — such a record is
 * DROPPED from an ordered list rather than dated wrong. That is the whole point:
 * a wrong date on a dashboard row is not a small error, it is a row that claims
 * you touched something last week when you touched it in 2024.
 *
 * The TID fallback is CONDITIONAL on `rkeyMode === 'tid'`, because a TID rkey only
 * encodes this record's own minting time when the lexicon is what minted it. For
 * fixed-rkey collections the key means something else entirely — a page slug, a
 * subject post's rkey — and `tidToTimestamp` will happily decode a borrowed TID
 * into a confident, wrong instant.
 *
 * @param {object|null} value  The record value.
 * @param {string|null} uri    Its at:// URI, for the TID fallback.
 * @param {string} nsid        Its collection.
 * @returns {string|null} ISO instant, or null.
 */
export function latestInstant(value, uri, nsid) {
  const lex = lexiconFor(nsid);
  return (
    value?.updatedAt ||
    value?.publishedAt ||
    value?.createdAt ||
    LAST_RESORT[nsid]?.(value) ||
    (lex?.rkeyMode === 'tid' ? tidToTimestamp(rkeyFromAtUri(uri)) : null) ||
    null
  );
}

/**
 * Per-collection row labels, for the collections where `previewFor` reads the
 * wrong field. `previewFor` returns the first non-empty STRING field in lexicon
 * order, which is the right rule for a record list row and the wrong one here:
 *
 *   - ratioed pieces: `take` is a number, so it is skipped, and the next string
 *     field is `subject` — a raw `at://did:plc:…/app.bsky.feed.post/…`. (`take` is
 *     `required` in the lexicon, so the override always fires on a valid record;
 *     only a record that violates its own lexicon falls through to the at-URI.)
 *   - arena channels: `arenaSlug` comes before the `title` override in field
 *     order, and live, none of the channels set `title` — so the label came out
 *     equal to the rkey already rendered beside it.
 */
const ROW_LABELS = {
  'is.dame.creating.ratioed.piece': (v) => (v?.take != null ? `Take ${v.take}` : null),
  'is.dame.arena.channel': (v) => v?.title || v?.arenaSlug || null,
  // The profile's first string field is `tagline`, which is optional; without
  // it `previewFor` walks on to `photoLayout` and labels the record "two-up".
  // Returning null instead falls through to `recordTitle`'s rkey floor ("self").
  'is.dame.profile': (v) => v?.tagline || null,
};

/**
 * Display label for one record row. Falls back to `previewFor`, which is kept
 * verbatim so the record list's existing rendering is untouched.
 *
 * @param {object|null} value
 * @param {string} nsid
 * @param {object|null} [lex]  The lexicon, if the caller already has it.
 * @returns {string}
 */
export function rowLabel(value, nsid, lex) {
  const override = ROW_LABELS[nsid];
  const s = override ? override(value) : null;
  return s || previewFor(value, lex !== undefined ? lex : lexiconFor(nsid));
}

/**
 * The heading for ONE OPEN RECORD — the same question a list row asks, plus a
 * guaranteed answer.
 *
 * A record detail used to be headed with its LEXICON's label: "Document" over a
 * back link reading "← Blogging", and on Curating a page titled "Curating" under
 * a crumb reading "Curating". That names the type, which the small-caps kicker
 * above the title already says; the heading should name the record you opened.
 *
 * `rowLabel` can legitimately come back empty — a record whose only fields are
 * numbers, a brand-new record with nothing typed in it yet — and a blank <h1> is
 * worse than a technical one, so the rkey is the floor. It is what the URL says
 * and what the owner searched for.
 *
 * @param {object|null} value
 * @param {string} nsid
 * @param {string|null} [rkey]
 * @param {object|null} [lex]  The lexicon, if the caller already has it.
 * @returns {string}
 */
export function recordTitle(value, nsid, rkey = null, lex = undefined) {
  const label = rowLabel(value, nsid, lex);
  if (label && label.trim()) return truncate(label.trim(), 120);
  return rkey || lexiconFor(nsid)?.label || nsid;
}
