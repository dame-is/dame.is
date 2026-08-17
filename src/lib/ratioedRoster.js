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
  // `byTake` is internal and stripped before the entry leaves this module. It
  // is what lets the merge below add a person's counts once: the bundled
  // roster's totals have no take attribution, so without it there is no way to
  // tell whether a derived count is new or is the same act read again.
  const fresh = { did: seed.did, h: seed.h, dn: '', ev: 0, pre: [], post: [], kinds: {}, byTake: {} };
  byKey.set(key, fresh);
  return fresh;
}

/** Note one act against the take it happened on. */
function count(person, take, kind) {
  person.ev += 1;
  person.kinds[kind] = (person.kinds[kind] || 0) + 1;
  if (!take) return;
  const slot = (person.byTake[take] ||= { ev: 0, kinds: {} });
  slot.ev += 1;
  slot.kinds[kind] = (slot.kinds[kind] || 0) + 1;
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
      count(person, take, e.k);
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
        // Every piece they broke, not the last one written. ponder.ooo broke
        // take 15 and take 16; records arrive newest-first, so a scalar took 16
        // and then had 15 written over it — the participants table said "broke
        // #15", take 16's break was attributed to nobody, and the "♥ deleted"
        // marker never rendered for the like that was actually withdrawn.
        person.broke = person.broke || [];
        if (piece.take && !person.broke.includes(piece.take)) person.broke.push(piece.take);
      }
    }
  }
  for (const person of byKey.values()) {
    person.pre.sort((a, b) => a - b);
    person.post.sort((a, b) => a - b);
    person.broke?.sort((a, b) => a - b);
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
      delete fresh.weakKey; // internal markers, not part of a roster entry
      delete fresh.byTake;
      byDid.set(p.did, fresh);
      continue;
    }
    // Only the takes the base does not already account for.
    //
    // These used to be summed outright, on the premise stated at the top of
    // this file: the bundle is the first eleven pieces and nothing re-derives
    // them. That stopped being true when the repair pass wrote event logs onto
    // those eleven records — the same acts then arrived from both sides and
    // were added together. 73 people shipped with an inflated count, the
    // project total read 489 events against a real 402, and because the count
    // is the participants table's sort key it also reordered the list:
    // handle.invalid and cee.wtf displaced eva.bsky.world and mackuba.eu from
    // the top twenty.
    const alreadyCounted = new Set([...existing.pre, ...existing.post]);
    for (const [take, c] of Object.entries(p.byTake || {})) {
      if (alreadyCounted.has(Number(take))) continue;
      existing.ev += c.ev;
      for (const [k, n] of Object.entries(c.kinds)) existing.kinds[k] = (existing.kinds[k] || 0) + n;
    }
    for (const take of p.pre) if (!existing.pre.includes(take)) existing.pre.push(take);
    for (const take of p.post) if (!existing.post.includes(take)) existing.post.push(take);
    existing.pre.sort((a, b) => a - b);
    existing.post.sort((a, b) => a - b);
    // Unioned, for the same reason `broke` is now a list: somebody can break
    // one piece that the bundle knows about and another that it does not.
    if (p.broke?.length) {
      const takes = new Set([...(Array.isArray(existing.broke) ? existing.broke : existing.broke ? [existing.broke] : []), ...p.broke]);
      existing.broke = [...takes].sort((a, b) => a - b);
    }
  }

  return Array.from(byDid.values()).sort((a, b) => b.ev - a.ev || a.h.localeCompare(b.h));
}
