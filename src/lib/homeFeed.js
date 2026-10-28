// The decisions behind the home feed's live refresh and its rows, pulled out of
// src/pages/Home.jsx so they can be tested without mounting the page. Pure:
// nothing here fetches, and nothing mutates its inputs.

import { DEFAULT_HOME_VERBS, VERB_REGISTRY, nsidFromAtUri, verbConfig } from './verbRegistry.js';
import { compareIsoDesc } from './time.js';
import { isObservationBatch } from './observationBatches.js';
import { getReplyHint } from './postReplyHint.js';
import { isYearOnlyDate } from './ledger.js';

const DEFAULT_VERBS = new Set(DEFAULT_HOME_VERBS);

/**
 * The verb set a rebuild should fetch: whatever the feed already holds plus
 * whatever the filter now wants, so narrowing the filter and widening it back
 * is answered from memory instead of throwing the other verbs away on the next
 * rebuild. A held verb outside the defaults that the filter no longer wants is
 * let go — those are the opt-in ones (likes above all, with their slow subject
 * hydration), and one look at them shouldn't keep them on every rebuild after.
 */
export function rebuildVerbs(held, wanted) {
  const out = new Set(wanted);
  for (const v of held || []) {
    if (DEFAULT_VERBS.has(v)) out.add(v);
  }
  return Array.from(out);
}

/**
 * How a build went, from the `failures` tally buildUnifiedFeed returns:
 * 'ok', 'partial' (some core fetches failed) or 'failed' (all of them did —
 * the network is down, or the PDS is). A build that attempted nothing (the
 * "show none" filter) is 'ok': an empty result is the right answer there.
 */
export function classifyBuild(failures) {
  if (!failures || !failures.failed) return 'ok';
  return failures.failed >= failures.attempted ? 'failed' : 'partial';
}

/**
 * Keep the rows a partial build couldn't fetch. Items of the collections that
 * failed (`labels`, NSIDs) are carried over from the feed already on screen,
 * so one source timing out leaves its rows where they were instead of
 * blanking them until the next commit. Returns `next` unchanged when there's
 * nothing to carry, otherwise a new array sorted newest-first.
 */
export function carryOverFailedSources(current, next, labels) {
  if (!labels?.length || !current?.length) return next;
  const failed = new Set(labels);
  const have = new Set();
  for (const item of next) if (item?.atUri) have.add(item.atUri);
  const kept = current.filter(
    (item) =>
      item?.atUri &&
      !have.has(item.atUri) &&
      failed.has(nsidFromAtUri(item.atUri)),
  );
  if (!kept.length) return next;
  return [...next, ...kept].sort((a, b) =>
    compareIsoDesc(a.createdAt, b.createdAt),
  );
}

/** A horizon marker — a row of its own, not a record. */
export function isHorizonMarker(item) {
  return item?.kind === 'horizon';
}

/**
 * Make each verb end honestly, part one. `horizons` (from buildUnifiedFeed)
 * gives, per verb, the instant past which its capped fetch has nothing; drop
 * that verb's items older than it. They're the stragglers of a second, uncapped
 * source (an older Anisota post below the last Bluesky one), and leaving them
 * in would make the gap above them read as a quiet stretch. Run before
 * filtering and counting, so the chips count what the feed can show.
 */
export function trimToHorizons(items, horizons) {
  const limits = horizonLimits(horizons);
  if (!limits.size || !items?.length) return items;
  const out = items.filter((item) => {
    const limit = limits.get(item?.verb);
    return limit === undefined || !(Date.parse(item.createdAt) < limit);
  });
  return out.length === items.length ? items : out;
}

/**
 * Part two: a marker row where each verb runs out, so a day further down with
 * no posts reads as "not loaded here" rather than "didn't post". Other verbs
 * carry on past it.
 *
 * `items` must be newest-first (the filtered feed). A marker is only placed for
 * a verb that has rows in `items`, so a filter that hides the verb hides its
 * marker too, and one older than everything left still goes at the end — that
 * is where the verb stops. Markers carry a `rowKey`, and the `createdAt` of
 * the row above them, so each closes the day it follows: a horizon can fall on
 * a day nothing else was logged on, and a marker dated by it would head a day
 * of its own.
 */
export function insertHorizonMarkers(items, horizons) {
  const limits = horizonLimits(horizons);
  if (!limits.size || !items?.length) return items;
  const present = new Set();
  for (const item of items) if (item?.verb) present.add(item.verb);
  const cuts = [...limits]
    .filter(([verb]) => present.has(verb))
    .sort(([va, a], [vb, b]) => b - a || (va < vb ? -1 : 1));
  if (!cuts.length) return items;

  const out = [];
  let next = 0;
  let above = null;
  for (const item of items) {
    const t = Date.parse(item?.createdAt);
    while (next < cuts.length && t < cuts[next][1])
      out.push(horizonMarker(cuts[next++], above));
    out.push(item);
    above = item;
  }
  while (next < cuts.length) out.push(horizonMarker(cuts[next++], above));
  return out;
}

function horizonLimits(horizons) {
  const limits = new Map();
  for (const [verb, at] of Object.entries(horizons || {})) {
    const t = Date.parse(at);
    if (Number.isFinite(t)) limits.set(verb, t);
  }
  return limits;
}

function horizonMarker([verb, t], above) {
  return {
    kind: 'horizon',
    horizonVerb: verb,
    createdAt: above?.createdAt || new Date(t).toISOString(),
    rowKey: `horizon:${verb}`,
  };
}

/**
 * How far back the ledger is whole: the newest of the horizons of the verbs
 * actually in `items` (the filtered feed), as an ISO instant, or null when no
 * verb on show ran out. Each verb is complete from its own horizon on, so all
 * of them are from the newest one; the first whole day after it is the one
 * the closing colophon names. A verb the filter hides doesn't hold the
 * ledger's answer back.
 */
export function completeSince(items, horizons) {
  const limits = horizonLimits(horizons);
  if (!limits.size || !items?.length) return null;
  const present = new Set();
  for (const item of items) if (item?.verb) present.add(item.verb);
  let newest = null;
  for (const [verb, t] of limits) {
    if (present.has(verb) && (newest === null || t > newest)) newest = t;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/**
 * Works known only by their year (see isYearOnlyDate) taken out of the
 * dated timeline, so they don't each head a "January 1" of their own with a
 * "12:00 am" beside them. They close the ledger instead, as a short list of
 * earlier works with their years. Returns `{ dated, yearOnly }`; `dated` is
 * `items` itself when there were none.
 */
export function splitYearOnlyWorks(items) {
  if (!items?.length) return { dated: items || [], yearOnly: [] };
  const yearOnly = [];
  const dated = items.filter((item) => {
    if (item?.verb === 'creating' && isYearOnlyDate(item.createdAt)) {
      yearOnly.push(item);
      return false;
    }
    return true;
  });
  return { dated: yearOnly.length ? dated : items, yearOnly };
}

// A day's counts read in the registry's order, after the busiest.
const VERB_ORDER = new Map(
  ['posting', 'replying', ...VERB_REGISTRY.map((v) => v.verb)].map((v, i) => [v, i]),
);

/**
 * What a day holds, by what each row's margin calls it: `[{ verb, count }]`,
 * busiest first. A post counts as `replying` when its row says so (a reply to
 * a post that isn't the one above it), a listening session as its songs and a
 * night of moths as its sightings, so "listened to 22 songs" matches the
 * session rows once they're opened. Horizon markers aren't records.
 */
export function dayVerbCounts(items) {
  const counts = new Map();
  const bump = (verb, n) => counts.set(verb, (counts.get(verb) || 0) + n);
  for (const item of items || []) {
    if (!item?.verb || isHorizonMarker(item)) continue;
    if (item.verb === 'posting') {
      const reply = !item._thread?.continuesPrev && getReplyHint(item.payload);
      bump(reply ? 'replying' : 'posting', 1);
    } else if (item.verb === 'listening') {
      bump('listening', Array.isArray(item.plays) ? item.plays.length : item.count || 1);
    } else if (isObservationBatch(item)) {
      bump(item.verb, item.observations.length);
    } else {
      bump(item.verb, 1);
    }
  }
  const rank = (v) => VERB_ORDER.get(v) ?? VERB_ORDER.size;
  return [...counts]
    .map(([verb, count]) => ({ verb, count }))
    .sort((a, b) => b.count - a.count || rank(a.verb) - rank(b.verb));
}

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// Verbs whose past tense needs a noun to read as a count.
const COUNT_PHRASES = {
  replying: (n) => `replied ${n.toLocaleString()}`,
  listening: (n) => `listened to ${plural(n, 'song', 'songs')}`,
  mothing: (n) => `spotted ${plural(n, 'moth', 'moths')}`,
  feeding: (n) => `published ${plural(n, 'feed', 'feeds')}`,
  listing: (n) => `made ${plural(n, 'list', 'lists')}`,
};

/** "posted 18", "listened to 22 songs": one of a day header's counts. */
export function countPhrase(verb, count) {
  const phrase = COUNT_PHRASES[verb];
  if (phrase) return phrase(count);
  return `${verbConfig(verb)?.pastTense || verb} ${count.toLocaleString()}`;
}

/** The at:// URIs a row stands for: its members if it's a batch, else itself. */
function memberUris(row) {
  const members = Array.isArray(row?.plays)
    ? row.plays
    : isObservationBatch(row)
      ? row.observations
      : null;
  if (!members) return row?.atUri ? [row.atUri] : [];
  return members.map((m) => m?.atUri).filter(Boolean);
}

/**
 * Give every row a React key that survives the row changing shape.
 *
 * A collapsed listening session or run of observations copies its fields from
 * its NEWEST member, at:// URI included — so keying on that URI meant every new
 * play remounted the session (closing it if it was open, and replaying the
 * slide-in). A batch now keeps whatever key any of its members had last time
 * (`previous`, a Map of member URI → key from the last call); a night of moths
 * is keyed by the night itself. Everything else keeps its own URI.
 *
 * Returns the keyed rows (copies only where a key was added) and the Map to
 * pass back in next time. Keys are unique within a call even if two batches
 * claim the same predecessor.
 */
export function assignRowKeys(rows, previous = new Map()) {
  const keys = new Map();
  const used = new Set();
  const out = rows.map((row, i) => {
    if (row?.rowKey) {
      used.add(row.rowKey);
      return row;
    }
    const uris = memberUris(row);
    const batch = uris.length > 1 || Array.isArray(row?.plays);
    let key = null;
    if (row?.nightDate && isObservationBatch(row))
      key = `night:${row.verb}:${row.nightDate}`;
    if (!key && batch) {
      for (const uri of uris) {
        const prior = previous.get(uri);
        if (prior && !used.has(prior)) {
          key = prior;
          break;
        }
      }
    }
    if (!key || used.has(key)) key = row?.atUri || `row-${i}`;
    if (used.has(key)) key = `${key}#${i}`;
    used.add(key);
    for (const uri of uris) keys.set(uri, key);
    return key === row?.atUri && !batch ? row : { ...row, rowKey: key };
  });
  return { rows: out, keys };
}
