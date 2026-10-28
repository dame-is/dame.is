// The /posting page's post-type filter, as plain functions.
//
// Lives apart from components/PostingFilters.jsx (which re-exports it) so the
// rules can be tested in node: they decide which of Dame's posts a reader sees,
// and the page used to cut threads short without anyone noticing.

import { selfThreadMembers } from './threadGrouping.js';

export const NONE_SENTINEL = '__none__';

export const POSTING_TYPES = ['reply', 'image', 'link', 'quote', 'text'];
// Default: hide replies, show everything else. Mirrors the home feed's
// reply-hiding default.
export const POSTING_TYPES_DEFAULT = ['image', 'link', 'quote', 'text'];

/**
 * Categorize a posting item into the set of sub-types it satisfies.
 * Returns `null` for non-posting items (they're not filterable here).
 * A post can match multiple types (a reply with an image is both
 * `reply` and `image`); the filter shows the post if ANY of its
 * categories is enabled.
 *
 * `continuing` is the set of URIs that carry on one of Dame's own threads
 * (see `selfThreadMembers`). Those are replies only to the lexicon: the home
 * feed reads them as more of the post they continue, and so does this page —
 * otherwise hiding replies, the default, hid every text-only post after the
 * first of a thread.
 *
 * The categories come from the embed: a quote that also carries media (a
 * recordWithMedia) is a quote AND whatever that media is, and a video counts
 * with the images.
 */
export function postingCategories(item, continuing = null) {
  if (item?.verb !== 'posting') return null;
  const payload = item.payload || {};
  const embed = payload.embed || payload.embedRecord || null;
  const type = embed?.$type || '';
  const withMedia = type.startsWith('app.bsky.embed.recordWithMedia');
  const media = withMedia ? embed.media?.$type || '' : type;
  const cats = new Set();
  if (payload.reply?.parent?.uri && !continuing?.has(item.atUri))
    cats.add('reply');
  if (
    media.startsWith('app.bsky.embed.images') ||
    media.startsWith('app.bsky.embed.video')
  ) {
    cats.add('image');
  }
  if (media.startsWith('app.bsky.embed.external')) cats.add('link');
  if (withMedia || type.startsWith('app.bsky.embed.record')) cats.add('quote');
  if (cats.size === 0) cats.add('text');
  return cats;
}

export function resolveActivePostingTypes(params) {
  if (!params.has('postTypes')) return new Set(POSTING_TYPES_DEFAULT);
  const value = params.get('postTypes') || '';
  if (value === NONE_SENTINEL) return new Set();
  const raw = value.split(',').filter(Boolean);
  if (raw.length === 0) return new Set(POSTING_TYPES);
  return new Set(raw);
}

/** The `postTypes` value for a set of types: the sentinel when it's empty,
 *  because an empty list already means "all" (see `resolveActivePostingTypes`). */
export function postTypesParam(types) {
  const list = Array.from(types || []);
  return list.length ? list.join(',') : NONE_SENTINEL;
}

/**
 * `items` as the filter in `params` shows them. Thread membership is worked
 * out over the whole of `items`, before anything is filtered away, so pass the
 * full list.
 */
export function filterPostingItems(items, params, myDid = null) {
  const active = resolveActivePostingTypes(params);
  const q = (params.get('q') || '').trim().toLowerCase();
  const continuing = myDid ? selfThreadMembers(items, myDid) : null;
  return items.filter((item) => {
    const cats = postingCategories(item, continuing);
    if (!cats) return false;
    let pass = false;
    for (const c of cats) {
      if (active.has(c)) {
        pass = true;
        break;
      }
    }
    if (!pass) return false;
    if (!q) return true;
    return String(item.payload?.text || '')
      .toLowerCase()
      .includes(q);
  });
}

/** Per-type counts for the filter chips, by the same rules as the filter. */
export function postingCounts(items, myDid = null) {
  const continuing = myDid ? selfThreadMembers(items, myDid) : null;
  const out = {};
  for (const item of items || []) {
    const cats = postingCategories(item, continuing);
    if (!cats) continue;
    for (const t of cats) out[t] = (out[t] || 0) + 1;
  }
  return out;
}
