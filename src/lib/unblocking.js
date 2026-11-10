// /experimenting/unblocking: who has been unblocked, by whom, and when.
//
// The watching is done by a consumer on a droplet (services/unblock-consumer),
// which keeps every live block on the network and notices when one is
// deleted. What it concludes is read from Supabase by api/unblocked.js. This
// module is the part the page, that function and the tests share: what the
// answers look like, how to read one that might be malformed, and how to say
// it in words. Nothing here touches the network but the two fetches at the
// bottom.

/**
 * A block undone in under this many seconds is set apart as "quick".
 *
 * Blocking someone and unblocking them straight away removes them as a
 * follower without leaving them blocked (a "soft block"). It is an unblock in
 * the record, and nearly the opposite of one in what it means, so the ranking
 * leaves these out and the list for one account labels them.
 *
 * Five minutes is a guess. It was chosen before the tracker had any data to
 * check it against; once it has run for a while, look at how long quick ones
 * actually last and move this. docs/sql/unblock.sql takes it as a parameter,
 * so this is the one place it is set.
 */
export const QUICK_SECONDS = 300;

/** How many accounts the ranking shows, and how many unblocks one lookup lists. */
export const BOARD_SIZE = 50;
export const LOOKUP_SIZE = 200;

/** The tracker is taken to have stopped when its newest event is older than this. */
export const STALE_SECONDS = 15 * 60;

// A DID as the syntax spec has it, held to a length nothing real approaches.
const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;

export function isDid(value) {
  return typeof value === 'string' && value.length <= 512 && DID.test(value);
}

/**
 * What somebody typed into the lookup, as something to resolve: a DID, or a
 * handle. Takes a leading "@", a bsky.app profile link, and a bare name with
 * no dot in it ("dame" for "dame.bsky.social"), since those are the three
 * ways a handle gets typed. '' when there is nothing to look up.
 */
export function cleanActor(input) {
  let text = String(input || '').trim();
  if (!text) return '';
  const profile = /^https?:\/\/[^/]+\/profile\/([^/?#]+)/i.exec(text);
  if (profile) text = decodeURIComponent(profile[1]);
  text = text.replace(/^@+/, '').trim();
  if (!text || /\s/.test(text)) return '';
  if (text.startsWith('did:')) return isDid(text) ? text : '';
  text = text.toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(text)) return '';
  return text.includes('.') ? text : `${text}.bsky.social`;
}

/* ── reading an answer ────────────────────────────────────────────────────── */

const isoOrNull = (value) => {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/**
 * One unblock: `{ did, blockedAt, unblockedAt, heldSeconds, quick }`. `did` is
 * the account that did the unblocking. Null for anything that isn't one.
 */
export function readEvent(raw) {
  if (!raw || !isDid(raw.did)) return null;
  const blockedAt = isoOrNull(raw.blockedAt);
  const unblockedAt = isoOrNull(raw.unblockedAt);
  if (!blockedAt || !unblockedAt) return null;
  const heldSeconds = Math.max(0, Math.round((Date.parse(unblockedAt) - Date.parse(blockedAt)) / 1000));
  return { did: raw.did, blockedAt, unblockedAt, heldSeconds, quick: heldSeconds < QUICK_SECONDS };
}

/**
 * What the tracker last said about itself, or null when it has said nothing:
 * `{ startedAt, horizonAt, lastEventAt, publishedAt, blocksHeld, deletesSeen,
 * deletesPlaced }`.
 */
export function readStatus(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startedAt = isoOrNull(raw.startedAt);
  if (!startedAt) return null;
  return {
    startedAt,
    horizonAt: isoOrNull(raw.horizonAt) || startedAt,
    lastEventAt: isoOrNull(raw.lastEventAt),
    publishedAt: isoOrNull(raw.publishedAt),
    blocksHeld: count(raw.blocksHeld),
    deletesSeen: count(raw.deletesSeen),
    deletesPlaced: count(raw.deletesPlaced),
  };
}

/** The front of the page: `{ status, unblocks, leaderboard: [{ did, count, latest }] }`. */
export function readBoard(raw) {
  const rows = Array.isArray(raw?.leaderboard) ? raw.leaderboard : [];
  return {
    status: readStatus(raw?.status),
    unblocks: count(raw?.unblocks),
    leaderboard: rows
      .filter((row) => isDid(row?.did) && count(row?.count) > 0)
      .map((row) => ({ did: row.did, count: count(row.count), latest: isoOrNull(row.latest) })),
  };
}

/**
 * One account's unblocks: `{ did, total, quick, events }`, newest first.
 * `total` counts everyone and `quick` the ones undone within QUICK_SECONDS;
 * `events` may be shorter than `total` (the newest LOOKUP_SIZE).
 */
export function readLookup(raw) {
  const events = (Array.isArray(raw?.events) ? raw.events : []).map(readEvent).filter(Boolean);
  const total = Math.max(count(raw?.total), events.length);
  return {
    did: isDid(raw?.did) ? raw.did : null,
    total,
    quick: Math.min(count(raw?.quick), total),
    events,
  };
}

/* ── saying it ────────────────────────────────────────────────────────────── */

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "1 person", "12 people". */
export function countPeople(n) {
  return plural(count(n), 'person', 'people');
}

/**
 * How long a block stood, in the largest unit that says it honestly:
 * "12 seconds", "3 hours", "5 days", "6 weeks", "4 months", "2 years".
 * Rounded down, so a block is never said to have stood longer than it did.
 */
export function heldWords(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return plural(s, 'second');
  if (s < 3600) return plural(Math.floor(s / 60), 'minute');
  if (s < 86_400) return plural(Math.floor(s / 3600), 'hour');
  const days = Math.floor(s / 86_400);
  if (days < 14) return plural(days, 'day');
  if (days < 61) return plural(Math.floor(days / 7), 'week');
  if (days < 365) return plural(Math.floor(days / 30.44), 'month');
  return plural(Math.floor(days / 365.25) || 1, 'year');
}

/**
 * The share of the deleted blocks the tracker saw that it could put a name
 * to, 0 to 1, or null before it has seen any. This is how much of the
 * picture the page has: a block made before the tracker started (or dropped
 * from its index since) can be undone without it knowing who was unblocked.
 */
export function placedShare(status) {
  if (!status?.deletesSeen) return null;
  return Math.min(1, status.deletesPlaced / status.deletesSeen);
}

/** "under 1%", "37%", "over 99%": a share that is never rounded to all or nothing. */
export function shareWords(share) {
  if (share == null) return '';
  const pct = share * 100;
  if (pct > 0 && pct < 1) return 'under 1%';
  if (pct > 99 && pct < 100) return 'over 99%';
  return `${Math.round(pct)}%`;
}

/** Whether the tracker's newest event is old enough that it has likely stopped. */
export function isStale(status, now = Date.now()) {
  if (!status?.lastEventAt) return false;
  return now - Date.parse(status.lastEventAt) > STALE_SECONDS * 1000;
}

/* ── asking ───────────────────────────────────────────────────────────────── */

export const UNBLOCKED_API = '/api/unblocked';

async function ask(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error(`unblocked api answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** The ranking and the tracker's status. */
export async function fetchBoard({ fetchImpl = fetch } = {}) {
  return readBoard(await ask(UNBLOCKED_API, fetchImpl));
}

/** One account's unblocks, by DID. */
export async function fetchLookup(did, { fetchImpl = fetch } = {}) {
  if (!isDid(did)) throw new Error('fetchLookup needs a DID');
  return readLookup(await ask(`${UNBLOCKED_API}?did=${encodeURIComponent(did)}`, fetchImpl));
}
