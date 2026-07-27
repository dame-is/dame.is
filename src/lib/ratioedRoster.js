// Deriving the Ratioed participant roster from recorded event logs.
//
// The bundled roster (src/data/ratioedPeople.json) was harvested offline
// alongside the first eleven pieces and stays authoritative for them: it counts
// by DID, it carries display names, and it reflects records that have since
// been deleted. Nothing here re-derives any of that.
//
// What it does is extend it. A piece measured by the admin panel records its
// own event log, so the people in that log can be folded into the roster at
// build time — which is the only reason a new piece's participants ever show up
// without someone re-running the original harvest by hand.

/** Merge a person's counts into a roster entry, creating it if needed. */
function upsert(byKey, key, seed) {
  const found = byKey.get(key);
  if (found) return found;
  const fresh = { did: seed.did, h: seed.h, dn: '', ev: 0, pre: [], post: [], kinds: {} };
  byKey.set(key, fresh);
  return fresh;
}

/**
 * Roster entries for everyone in the given pieces' recorded event logs.
 *
 * Keyed by DID where the log has one. A log written before DIDs were recorded
 * falls back to the handle, which is enough to list someone but can't be merged
 * against the DID-keyed roster — so those entries are marked `weakKey` and the
 * caller can decide whether to trust them.
 *
 * The artist's own records are skipped, as they are in every other count here.
 */
export function rosterFromEvents(pieces) {
  const byKey = new Map();
  for (const piece of pieces || []) {
    const take = piece.take;
    const events = Array.isArray(piece.events) ? piece.events : [];
    for (const e of events) {
      if (e.self || !e.k) continue;
      const key = e.did || (e.h ? `handle:${e.h}` : null);
      if (!key) continue;
      const person = upsert(byKey, key, { did: e.did || key, h: e.h || '(unresolvable)' });
      if (!e.did) person.weakKey = true;
      person.ev += 1;
      person.kinds[e.k] = (person.kinds[e.k] || 0) + 1;
      const bucket = e.pre ? person.pre : person.post;
      if (take && !bucket.includes(take)) bucket.push(take);
    }
    // The breaker is named by the announcement even when their like is gone, so
    // they belong in the roster whether or not the log has anything of theirs.
    const b = piece.breaker;
    if (b?.handle && b.handle !== 'unknown' && b.likeSurvives === false) {
      const key = b.did || `handle:${b.handle}`;
      const person = upsert(byKey, key, { did: b.did || key, h: b.currentHandle || b.handle });
      if (!b.did) person.weakKey = true;
      if (take && !person.pre.includes(take)) person.pre.push(take);
    }
  }
  // Tag breakers last, so a person who broke one piece and merely replied to
  // another still reads as its breaker.
  for (const piece of pieces || []) {
    const b = piece.breaker;
    if (!b?.handle || b.handle === 'unknown') continue;
    for (const person of byKey.values()) {
      if (person.did === b.did || person.h === b.handle || person.h === b.currentHandle) {
        person.broke = piece.take;
      }
    }
  }
  for (const person of byKey.values()) {
    person.pre.sort((a, b) => a - b);
    person.post.sort((a, b) => a - b);
  }
  return Array.from(byKey.values());
}

/**
 * Fold derived entries into the bundled roster.
 *
 * `base` wins on identity — its display names and its DID-level distinctions
 * were resolved at harvest time and can't be recovered now. Counts and piece
 * lists are unioned, so a person who showed up for an old piece and a new one
 * ends up with both.
 *
 * An entry whose key is only a handle is dropped when that handle is already in
 * the base under a real DID: merging on a handle would be a guess, and the base
 * deliberately keeps two accounts apart that share one.
 */
export function mergeRoster(base, derived) {
  const byDid = new Map();
  const byHandle = new Map();
  for (const p of base || []) {
    const copy = { ...p, pre: [...p.pre], post: [...p.post], kinds: { ...p.kinds } };
    byDid.set(p.did, copy);
    // A handle shared by two entries can't identify either of them.
    byHandle.set(p.h, byHandle.has(p.h) ? null : copy);
  }

  for (const p of derived || []) {
    let existing = byDid.get(p.did);
    if (!existing && p.weakKey) {
      const match = byHandle.get(p.h);
      // null is the marker for a handle two entries share; undefined just
      // means nobody in the base has it. Only the first is a reason to skip.
      if (match === null) continue;
      existing = match;
    }
    if (!existing) {
      const fresh = { ...p, dn: p.dn || '' };
      delete fresh.weakKey; // an internal marker, not part of a roster entry
      byDid.set(p.did, fresh);
      continue;
    }
    existing.ev += p.ev;
    for (const [k, n] of Object.entries(p.kinds)) existing.kinds[k] = (existing.kinds[k] || 0) + n;
    for (const take of p.pre) if (!existing.pre.includes(take)) existing.pre.push(take);
    for (const take of p.post) if (!existing.post.includes(take)) existing.post.push(take);
    existing.pre.sort((a, b) => a - b);
    existing.post.sort((a, b) => a - b);
    if (p.broke && !existing.broke) existing.broke = p.broke;
  }

  return Array.from(byDid.values()).sort((a, b) => b.ev - a.ev || a.h.localeCompare(b.h));
}
