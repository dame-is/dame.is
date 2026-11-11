// Sunfarming results: a finished island, posted by the player who finished
// it, and everyone's results for an island gathered back into a board.
//
// The game itself (experiments/sunfarming) knows nothing about atproto. It
// offers a "post result" button when the page it sits in hands it something
// to post with, and this is that something's working parts.
//
// A result is an `is.dame.sunfarming.result` record on the PLAYER's repo. It
// points at the island's board through `subject`, an at-uri that names the
// board (`at://<me>/is.dame.sunfarming.island/<key>`), and a board is read
// back the way reactions and guestbook signatures are: backlinks from
// Constellation, each record from Slingshot or its own PDS, faces from the
// AppView. The record key IS the board's key, so a player has at most one
// result per board and posting again replaces it. See lexicons/SUNFARMING.md.

import { getBacklinks, backlinkRows } from './constellation.js';
import { getRecordCached } from './slingshot.js';
import { resolvePds, getRecord, resolveProfiles } from './atproto.js';
import { scopeAllowsCollection } from './experiments.js';
import {
  ME_DID,
  SUNFARMING_ISLAND_NSID,
  SUNFARMING_RESULT_NSID,
} from '../config.js';

/** Constellation source tuple: which records and field point at a board. */
export const RESULT_SOURCE = `${SUNFARMING_RESULT_NSID}:subject`;

/** How many results a board reads. */
export const BOARD_MAX = 200;
const BOARD_PAGE = 100;
const HYDRATE_AT_ONCE = 12;

/** No island takes longer than this; a record that says so is not a result. */
const DAYS_MAX = 999;

const ISLAND_ID = /^[a-z][a-z0-9-]{0,31}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ── boards ───────────────────────────────────────────────────────────────── */

/**
 * The key of the board a result belongs on: the island's id, or
 * `today-YYYY-MM-DD` for the daily island, which is a different island (and
 * so a different board) every day. Null for anything that isn't an island.
 */
export function boardKey({ island, date } = {}) {
  const id = String(island || '');
  if (!ISLAND_ID.test(id)) return null;
  if (id === 'today')
    return DATE.test(String(date || '')) ? `today-${date}` : null;
  return id;
}

/** The at-uri results point at: a name for the board, not a record. */
export function boardUri(key) {
  return key ? `at://${ME_DID}/${SUNFARMING_ISLAND_NSID}/${key}` : null;
}

/**
 * A result as the page holds it, from a record and where it was found:
 * `{ uri, did, days, at, profile }`. Null for a record that isn't one (no
 * days, absurd days, pointing at some other board).
 */
export function toResult({ did, uri = null, value }, subject) {
  if (!did || !value || value.subject !== subject) return null;
  const days = value.days;
  if (!Number.isInteger(days) || days < 1 || days > DAYS_MAX) return null;
  const at =
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt))
      ? value.createdAt
      : null;
  return { uri, did, days, at, profile: null };
}

/**
 * The board as it is shown: one line per person (their quickest; the record
 * key allows only one, but a record can be written by hand), quickest first,
 * and among equals whoever posted first.
 */
export function rankResults(results) {
  const best = new Map();
  for (const r of Array.isArray(results) ? results : []) {
    if (!r?.did) continue;
    const held = best.get(r.did);
    if (!held || r.days < held.days) best.set(r.did, r);
  }
  // ISO timestamps sort as plain strings; a result with no date goes last.
  const when = (r) => r.at || '\uffff';
  return [...best.values()].sort(
    (a, b) =>
      a.days - b.days || (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0),
  );
}

async function mapPooled(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await task(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

// The record behind one backlink: Slingshot first, the player's PDS on a miss.
async function hydrate(ref, subject) {
  const { did, collection, rkey } = ref || {};
  if (!did || !rkey || collection !== SUNFARMING_RESULT_NSID) return null;
  let record = await getRecordCached({ repo: did, collection, rkey });
  if (!record) {
    try {
      const pds = await resolvePds(did);
      record = await getRecord(pds, { repo: did, collection, rkey });
    } catch {
      return null;
    }
  }
  return toResult({ did, uri: record?.uri, value: record?.value }, subject);
}

/**
 * Everyone's results for one board: `{ entries, total, truncated }`, ranked.
 * Null only when the backlink index can't be reached at all.
 */
export async function fetchBoard(key, { max = BOARD_MAX, signal } = {}) {
  const subject = boardUri(key);
  if (!subject) return null;
  const refs = [];
  let total = null;
  let cursor;
  let truncated = false;
  do {
    const page = await getBacklinks(subject, RESULT_SOURCE, {
      limit: BOARD_PAGE,
      cursor,
      signal,
    });
    if (!page) {
      if (refs.length === 0) return null;
      truncated = true;
      break;
    }
    refs.push(...backlinkRows(page));
    if (typeof page.total === 'number') total = page.total;
    cursor = page.cursor || null;
  } while (cursor && refs.length < max);
  if (cursor) truncated = true;

  const found = (
    await mapPooled(refs.slice(0, max), HYDRATE_AT_ONCE, (ref) =>
      hydrate(ref, subject),
    )
  ).filter(Boolean);
  const profiles = found.length
    ? await resolveProfiles(found.map((r) => r.did)).catch(() => ({}))
    : {};
  for (const r of found) r.profile = leanProfile(r.did, profiles[r.did]);
  return {
    entries: rankResults(found),
    total: total ?? found.length,
    truncated,
  };
}

/** The three profile fields a board's line shows. */
export function leanProfile(did, profile) {
  if (!profile) return null;
  return {
    did,
    handle:
      profile.handle && profile.handle !== 'handle.invalid'
        ? profile.handle
        : '',
    displayName: profile.displayName || '',
    avatar: profile.avatar || '',
  };
}

/* ── posting ──────────────────────────────────────────────────────────────── */

/** Does an OAuth grant's scope let its holder write a result? */
export function scopeAllowsResults(scope) {
  return scopeAllowsCollection(scope, SUNFARMING_RESULT_NSID);
}

/**
 * Whether this session's grant covers writing a result. True when it can't
 * be told: the write itself is then the test.
 */
export async function sessionCanPost(session) {
  if (!session) return false;
  try {
    const info = await session.getTokenInfo();
    if (!info?.scope) return true;
    return scopeAllowsResults(info.scope);
  } catch {
    return true;
  }
}

/** What a result has to be before it is written anywhere. */
export function checkResult({ island, date, days } = {}) {
  const key = boardKey({ island, date });
  if (!key) return null;
  if (!Number.isInteger(days) || days < 1 || days > DAYS_MAX) return null;
  return { key, island, date: island === 'today' ? date : null, days };
}

/**
 * Post a result: put an `is.dame.sunfarming.result` on the player's repo
 * under the board's key, replacing any they had there. Returns it in the
 * shape a board holds.
 */
export async function writeResult(agent, result) {
  if (!agent) throw new Error('Sign in to post a result.');
  const checked = checkResult(result);
  if (!checked) throw new Error('That isn’t a finished island.');
  const subject = boardUri(checked.key);
  const value = {
    $type: SUNFARMING_RESULT_NSID,
    subject,
    island: checked.island,
    days: checked.days,
    createdAt: new Date().toISOString(),
  };
  if (checked.date) value.date = checked.date;
  const did = agent.assertDid;
  const res = await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: SUNFARMING_RESULT_NSID,
    rkey: checked.key,
    record: value,
  });
  return toResult({ did, uri: res.data.uri, value }, subject);
}

/* ── a result that has to wait for a sign-in ──────────────────────────────── */

/** Where a result waits while its player is away approving it on their PDS. */
export const PENDING_RESULT_KEY = 'dame.sunfarming.pending';
const PENDING_MAX_AGE_MS = 15 * 60_000;

function storage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function savePendingResult(result, now = Date.now()) {
  const checked = checkResult(result);
  if (!checked) return;
  try {
    storage()?.setItem(
      PENDING_RESULT_KEY,
      JSON.stringify({ ...checked, at: now }),
    );
  } catch {
    // Storage blocked: the result just won't survive the hop.
  }
}

/** What a stored string says is waiting, or null. */
export function parsePendingResult(raw, now = Date.now()) {
  let pending;
  try {
    pending = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!pending || typeof pending !== 'object') return null;
  const at = Number(pending.at);
  if (
    !Number.isFinite(at) ||
    now - at > PENDING_MAX_AGE_MS ||
    at - now > 60_000
  )
    return null;
  const checked = checkResult(pending);
  return checked
    ? { island: checked.island, date: checked.date, days: checked.days }
    : null;
}

export function readPendingResult(now = Date.now()) {
  try {
    const raw = storage()?.getItem(PENDING_RESULT_KEY);
    return raw ? parsePendingResult(raw, now) : null;
  } catch {
    return null;
  }
}

export function clearPendingResult() {
  try {
    storage()?.removeItem(PENDING_RESULT_KEY);
  } catch {
    // Nothing was stored, then.
  }
}
