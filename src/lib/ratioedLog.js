// Reading a piece's event log.
//
// A Ratioed piece carries its log in one of two places and sometimes in both.
// The first eleven were measured offline before records had a log field, and
// the bundled harvest is the only copy of their alive window; every piece since
// records its own. Neither simply wins, and working out what one log says about
// one person is a question both the site and the Open Graph renderer ask.
//
// So it lives here, on its own, with nothing behind it but the identity helper.
// ratioed.js — which is where every caller has always found composeEventLog,
// and which re-exports it — imports the bundled seed as JSON, and the renderer
// runs as a serverless function where a bare JSON import is not something to
// rely on. Everything in this file's import graph is plain JavaScript.

import { identifyAcross, UNRESOLVED } from './ratioedIdentity.js';

/**
 * One log for a piece, from the two places its rows can live.
 *
 * The first eleven pieces were measured offline before records carried a log,
 * and the bundle is the only copy of their alive window — and of the TEXT of
 * every reply, which the harvest kept and a backlink index cannot give back.
 * A recorded log covers whatever windows it was measured over, which since the
 * repair pass can be the afterlife alone.
 *
 * So neither source simply wins. The record owns the windows it has rows in,
 * the bundle fills the windows it doesn't, and a recorded row that has no text
 * takes it from the harvested row it plainly is — same kind, same account,
 * within a second of the same offset. Without that last part, repairing a
 * bundled piece replaced nine rows carrying four replies' worth of text with
 * eight rows carrying none, and the essay's "reactions no one can see" read
 * "(image, no text)" all the way down.
 */
export function composeEventLog(recordLog, bundleLog) {
  const rec = Array.isArray(recordLog) ? recordLog : null;
  const bun = Array.isArray(bundleLog) ? bundleLog : null;
  if (!rec?.length) return bun?.length ? bun : null;
  if (!bun?.length) return rec;

  // The same record, measured twice: same kind, same account, within a second
  // of the same offset. Measured against the real pair the harvest and the
  // repair produced for the first eleven pieces, the offsets agree to about ten
  // milliseconds, so a second and a half is slack rather than a guess.
  //
  // The account test is the delicate part. Matching on the handle alone missed
  // a row whose handle had been re-resolved since: take 10 holds a recorded
  // repost by `(unresolvable)` and a harvested one by rascalpyro.bsky.social,
  // thirteen milliseconds apart and the same repost — plc.directory confirms
  // the alias — so the composed log ran to 69 rows for 68 events, drew two
  // ticks stacked at +19m24s, and put the same person on the page twice: once
  // as a face and once as a deactivated frame. Two DIDs are decisive when both
  // rows carry one; otherwise a handle still counts, unless it is the
  // placeholder every unresolved account answers to, which identifies nobody.
  const sameWho = (a, b) => {
    if (a.did && b.did) return a.did === b.did;
    if (!a.h || !b.h) return false;
    if (a.h === UNRESOLVED || b.h === UNRESOLVED) return true;
    return a.h === b.h;
  };
  const sameRow = (a, b) =>
    a.k === b.k && sameWho(a, b) && Math.abs((a.off || 0) - (b.off || 0)) <= 1.5;

  // What the harvest knows and the record cannot say. Text is the obvious one.
  // `n` — whether a reply was nested under another rather than written to the
  // piece itself — is the quieter one: the lexicon has no field for it and a
  // backlink index does not carry it, so it survives ONLY here. Recorded rows
  // used to win outright, which shadowed every harvested `n` and left the
  // hidden-replies list calling all fifteen of them "reply to the sealed post".
  const withText = rec.map((e) => {
    if (e.t && e.n != null) return e;
    const harvested = bun.find((x) => (x.t || x.n != null) && sameRow(e, x));
    if (!harvested) return e;
    return {
      ...e,
      ...(!e.t && harvested.t ? { t: harvested.t } : {}),
      ...(e.n == null && harvested.n != null ? { n: harvested.n } : {}),
    };
  });
  // Everything the harvest holds and the record does not: the alive window of a
  // piece repaired long after it ran, and any row an index has since forgotten.
  // Both are evidence, and the index cannot be asked about either.
  const unrecorded = bun.filter((x) => !rec.some((e) => sameRow(e, x)));
  return [...withText, ...unrecorded].sort((a, b) => a.off - b.off);
}

/**
 * What each person did *while a piece was alive*, counted from the event log.
 *
 * The roster's own `kinds` spans both windows, so it can't tell a repost that
 * spread a living piece from one that landed on a finished one — and which of
 * those someone did is exactly what their role, and the Mix column beside it,
 * are meant to say. The log carries the pre/post flag per record, so it can.
 *
 * Matched through `identifyAcross`, not by handle alone. The harvest behind the
 * first eleven pieces names people by handle and every log written since names
 * them by DID, so a straight handle lookup found nothing for anyone whose only
 * living appearances were recorded rather than harvested — and their Mix fell
 * back to counts that include the afterlife.
 *
 * A handle two roster entries share — the placeholder for deactivated accounts
 * — resolves to neither of them. There is no way to say which is which, and
 * crediting one with the other's acts is worse than showing nothing.
 *
 * Returns a `person => kinds | null` lookup.
 *
 * Here rather than in ratioed.js for the reason brokenTakes is: the Open Graph
 * renderer ranks the same roster this does, and its import graph has to stay
 * free of the bundled JSON seed. Same rule in one place, so a shared card and
 * the page it links to cannot order the same five people differently.
 */
export function livingKindsIndex(events, people) {
  const shared = new Set();
  const seenOnce = new Set();
  for (const p of people || []) {
    if (seenOnce.has(p.h)) shared.add(p.h);
    seenOnce.add(p.h);
  }
  if (!events) return () => null;
  const logs = Object.values(events).map((l) => (Array.isArray(l) ? l : []));
  const who = identifyAcross(logs);
  const byKey = new Map();
  // Everyone the logs hold at all, either side of the seal. Without it there is
  // no telling "the logs don't cover this person" from "the logs cover them and
  // they did nothing while anything was alive" — and the two want opposite
  // answers. The first has to fall back to the roster's all-window counts; the
  // second is the finding, and falling back there reports somebody's post-seal
  // reply in a column that says it counts the living window.
  const known = new Set();
  for (const log of logs) {
    for (const e of log) {
      if (e.self || !e.k) continue;
      const key = who(e);
      if (!key) continue;
      known.add(key);
      if (!e.pre) continue;
      const kinds = byKey.get(key) || {};
      kinds[e.k] = (kinds[e.k] || 0) + 1;
      byKey.set(key, kinds);
    }
  }
  return function forPerson(person) {
    const did = person?.did && !String(person.did).startsWith('handle:') ? person.did : null;
    const h = person?.h && person.h !== UNRESOLVED && !shared.has(person.h) ? person.h : null;
    for (const key of [did, h ? `h:${h}` : null]) {
      if (!key) continue;
      const found = byKey.get(key);
      if (found) return found;
      if (known.has(key)) return {};
    }
    return null;
  };
}
