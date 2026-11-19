// Browser side of the moderation hub, talking to the bluesky-mod bot.
//
// The bot serves its own API (github.com/dame-is/bluesky-mod, docs/API.md)
// at VITE_MOD_API_URL. The admin already holds an atproto OAuth session, so it
// asks the PDS for a short-lived token addressed to the bot (aud is the bot's
// DID, VITE_MOD_BOT_DID) and sends that; the bot checks it against dame's key
// and its roster. Nothing is shared between this site and the bot.
//
// Tokens are REUSED until shortly before they expire. Minting one per call put
// a round trip to the PDS in front of every request, which is most of why the
// old hub felt slow.
//
// The functions below return what the hub's views draw, so the field names of
// the bot's API are read here and nowhere else.

import {
  ApiError,
  approveByName,
  blockCommand,
  createClient,
  onList,
  postLink,
  undoCommand,
  unblockCommand,
} from 'bluesky-mod-client';
import { ME_DID } from '../../config.js';

export { ApiError };

const env = import.meta.env || {};
export const MOD_API_URL = String(env.VITE_MOD_API_URL || '').replace(
  /\/+$/,
  '',
);
export const MOD_BOT_DID = String(env.VITE_MOD_BOT_DID || '');

/* --------------------------------------------------------------- tokens */

const tokens = new Map();

/** The `exp` claim of a JWT, in milliseconds, or 0 if it cannot be read. */
export function tokenExpiry(token) {
  try {
    const part = String(token).split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = Number(JSON.parse(json).exp);
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** Seconds of life a cached token must still have to be handed out. */
const TOKEN_MARGIN_MS = 15_000;

async function mint(agent, lxm, aud) {
  const key = `${agent?.session?.did ?? agent?.did ?? ''}|${aud}|${lxm}`;
  const hit = tokens.get(key);
  if (hit?.token && hit.exp - Date.now() > TOKEN_MARGIN_MS) return hit.token;
  // Two panels asking at once share one mint rather than racing two.
  if (hit?.pending) return hit.pending;
  const pending = agent.com.atproto.server
    .getServiceAuth({ aud, lxm })
    .then((res) => {
      const token = res?.data?.token;
      if (!token)
        throw new Error('the PDS did not return a service auth token');
      tokens.set(key, { token, exp: tokenExpiry(token) });
      return token;
    })
    .catch((err) => {
      tokens.delete(key);
      throw err;
    });
  tokens.set(key, { pending });
  return pending;
}

/* ------------------------------------------------------------ the bot */

const clients = new WeakMap();

/** The client for this session's agent: one per agent, so tokens are shared. */
export function bot(agent) {
  if (!MOD_API_URL || !MOD_BOT_DID) {
    throw new Error(
      'The moderation hub needs VITE_MOD_API_URL (where the bot is served) and VITE_MOD_BOT_DID (the bot account) set for this build.',
    );
  }
  let c = clients.get(agent);
  if (!c) {
    c = createClient({
      baseUrl: MOD_API_URL,
      auth: { serviceAuth: (lxm) => mint(agent, lxm, MOD_BOT_DID) },
    });
    clients.set(agent, c);
  }
  return c;
}

/** Names and faces for DIDs, a hundred at a time. Missing ones are left out. */
async function profilesFor(agent, dids) {
  const wanted = [...new Set(dids.filter(Boolean))];
  const out = {};
  for (let i = 0; i < wanted.length; i += 100) {
    const { profiles } = await bot(agent).profiles(wanted.slice(i, i + 100));
    Object.assign(out, profiles || {});
  }
  return out;
}

const withProfiles = async (agent, rows) => {
  const p = await profilesFor(
    agent,
    rows.map((r) => r.did),
  );
  return rows.map((r) => ({ ...r, profile: p[r.did] || null }));
};

/* ------------------------------------------------------------ the hub */

/**
 * The header's figures and what the hub needs to know about the bot: who is
 * signed in and what they may do, and the lists, when there are several.
 */
export async function hubOverview(agent, { list = null } = {}) {
  const c = bot(agent);
  const [me, lists, o] = await Promise.all([
    c.me(),
    c.lists(),
    c.overview({ list: list || undefined }),
  ]);
  const takenAt = o.snapshot?.takenAt;
  return {
    me,
    multi: Boolean(lists.multi),
    lists: lists.lists || [],
    queue: { total: o.waiting?.queue ?? 0 },
    scansWaiting: o.waiting?.scans ?? 0,
    listInfo: { count: o.list?.total ?? null, counts: o.list?.counts || {} },
    week: o.week || { added: 0, removed: 0 },
    snapshot: {
      takenAt: takenAt || null,
      ageHours: takenAt
        ? Math.round((Date.now() - Date.parse(takenAt)) / 3_600_000)
        : null,
      scoring: o.snapshot?.scoring || null,
    },
    rescoredAt: o.rescoredAt || null,
    budget: o.budget || null,
    adding: o.adding || [],
  };
}

/* ------------------------------------------------------------ the queue */

/**
 * A page of the review queue: everyone on the main list who is not a
 * stranger, closest first, with their faces.
 */
export async function queuePage(
  agent,
  { band = 'all', offset = 0, limit = 20 } = {},
) {
  const q = await bot(agent).queue({
    band: band === 'all' ? undefined : band,
    offset,
    limit,
  });
  const items = await withProfiles(agent, q.rows || []);
  return {
    items,
    counts: q.counts || {},
    total: q.total ?? 0,
    matched: q.matched ?? 0,
    more: offset + items.length < (q.matched ?? 0),
    asOf: q.asOf || null,
  };
}

/**
 * Run one of the bot's commands. A reply that did nothing and says why (a
 * protected account, a plan that is not there) is thrown, so the hub shows the
 * bot's own words; a "Which list?" comes back for the hub to ask.
 */
export async function runCommand(agent, text) {
  const reply = await bot(agent).command(text);
  if (reply.choice) return reply;
  if (reply.outcome !== 'done')
    throw new Error(reply.text || 'Nothing was done.');
  return reply;
}

/** The main list's record key, for a command on a bot with several lists. */
const listToken = (lists, rkey) =>
  lists?.multi ? rkey || lists.lists?.[0]?.rkey : null;

/**
 * A decision about one account on the list. Keep and reopen change only the
 * review queue. Remove and restore are the bot's own unblock and block, so the
 * veto and the decision log are the bot's.
 */
export async function queueDecide(
  agent,
  { did, decision, band, list = null, lists = null },
  { run = (text) => runCommand(agent, text) } = {},
) {
  const c = bot(agent);
  if (decision === 'keep') return c.keep(did, band);
  if (decision === 'reopen') return c.reopen(did);
  const key = listToken(lists, list);
  if (decision === 'remove') return run(onList(unblockCommand(did), key));
  if (decision === 'restore') return run(onList(blockCommand(did), key));
  throw new Error(`unknown decision ${decision}`);
}

/* ------------------------------------------------------------- the list */

/** A page of the list, newest add first, or what matches `q`. */
export async function listPage(
  agent,
  { offset = 0, limit = 50, q = '', list = null } = {},
) {
  const page = await bot(agent).list({
    sort: 'recent',
    q: q || undefined,
    offset,
    limit,
    list: list || undefined,
  });
  const items = await withProfiles(agent, page.rows || []);
  return {
    items,
    total: page.total ?? 0,
    matched: page.matched ?? 0,
    more: offset + items.length < (page.matched ?? 0),
    source: page.source,
  };
}

/** The list as the radar draws it. */
export function listRadar(agent, { list = null } = {}) {
  return bot(agent).radar({ list: list || undefined });
}

/* ------------------------------------------------------------ an account */

/** One account: a live score, every list they are on, and the whole log. */
export async function accountDetail(agent, actor) {
  const a = await bot(agent).account(actor);
  const profiles = await profilesFor(agent, [a.did]).catch(() => ({}));
  return {
    did: a.did,
    profile: profiles[a.did] || a.live || null,
    score: a.live || null,
    failed: a.failed || null,
    onLists: a.onLists || [],
    onList: (a.onLists || []).length > 0,
    protectedReason: a.protectedReason || a.live?.protectedReason || null,
    kept: a.kept || null,
    entries: a.entries || [],
  };
}

/* -------------------------------------------------------------- activity */

/** The decision log as events, newest first: a batch is one line. */
export async function activityPage(
  agent,
  { offset = 0, limit = 30, direct = false } = {},
) {
  const page = await bot(agent).activity({ offset, limit });
  const events = direct ? page.events.filter((e) => !e.scan) : page.events;
  return { events, more: Boolean(page.more), next: offset + limit };
}

/** Scans, newest first, a page at a time. */
export async function scanPage(agent, { before = null, limit = 30 } = {}) {
  const page = await bot(agent).scans({ before: before || undefined, limit });
  return {
    scans: page.scans || [],
    more: Boolean(page.more),
    next: page.next || null,
  };
}

const PLAN_PAGE = 50;

/** Who a filter keeps of a plan's rows. */
function keeps({ state, label, band }) {
  return (r) =>
    (state === 'all' ||
      (state === 'added' && r.added) ||
      (state === 'pending' && !r.added && !r.listed)) &&
    (!label || r.label === label) &&
    (!band || r.band === band);
}

/** Closest first, then the most shared follows. */
const ORDER = [
  'PROTECTED',
  'CONNECTED',
  'PERIPHERAL',
  'NOTABLE',
  'UNKNOWN',
  'UNSCORED',
];
const byCloseness = (a, b) =>
  ORDER.indexOf(a.band) - ORDER.indexOf(b.band) ||
  (b.vouches ?? 0) - (a.vouches ?? 0);

/**
 * One plan, filtered and paged here: the bot sends every row once, and the
 * hub keeps it, so moving between filters asks for nothing new.
 */
export async function planDetail(
  agent,
  { code, state = 'pending', label = '', band = '', offset = 0 },
) {
  const plan = await bot(agent).scan(code);
  const rows = [...plan.rows].sort(byCloseness);
  const matched = rows.filter(keeps({ state, label, band }));
  const page = await withProfiles(
    agent,
    matched.slice(offset, offset + PLAN_PAGE),
  );
  const labelled =
    (plan.labels?.hostile || 0) +
    (plan.labels?.arguing || 0) +
    (plan.labels?.neutral || 0);
  return {
    plan,
    code: plan.code,
    scan: plan.scan,
    list: plan.list || null,
    createdAt: plan.createdAt,
    words: plan.words || [],
    webUrl: postLink(plan.uri),
    counts: {
      total: plan.total ?? rows.length,
      added: plan.live ?? 0,
      labelled,
    },
    byLabel: plan.labels || {},
    rows: page,
    allRows: rows,
    matched: matched.length,
    offset,
    pageSize: PLAN_PAGE,
  };
}

/**
 * Add the accounts ticked on a plan, by name: the bot's personal path, at
 * most 25 a command. `run` is the hub's command runner, which asks "Which
 * list?" when the bot does; null from it means nobody chose, and the rest
 * are not sent.
 */
export async function planAdd(
  agent,
  { code, dids, list = null },
  { run = (text) => runCommand(agent, text) } = {},
) {
  let last = null;
  for (const command of approveByName(code, dids)) {
    last = await run(onList(command, list));
    if (!last) return null;
  }
  return last;
}

/** Take back everything a plan added. */
export function planUndo(agent, { code }) {
  return runCommand(agent, undoCommand(code));
}

/* ----------------------------------------------------------------- check */

/** Score everyone who engaged with a post. Stores nothing. */
export function preflight(agent, link) {
  return bot(agent).check(link);
}

/* -------------------------------------------------------------- settings */

/** What the settings page shows: health, the follow graph, model use, config. */
export async function settingsPage(agent) {
  const c = bot(agent);
  const [health, graph, models, settings] = await Promise.all([
    c.health(),
    c.graph(),
    c.models({ days: 30 }),
    c.settings(),
  ]);
  return { health, graph, models, settings };
}

export const rebuildSnapshot = (agent) => bot(agent).rebuild();
export const rescoreList = (agent) => bot(agent).rescore();

/* ---------------------------------------------------------------- shield */

export const shieldState = (agent) => bot(agent).shield();

/* --------------------------------------------- the site's own graph lists */

/** Must match the LXM in api/graph-lists.js. */
const GRAPH_LISTS_LXM = 'is.dame.graph.lists';

/**
 * The managed graph lists (api/graph-lists.js). One endpoint, an `action` in
 * the body: status, preview, save, sync, remove, orbit. A call to this site,
 * not the bot, signed for this site (aud is dame's own DID).
 */
export async function graphLists(agent, body = {}, { signal } = {}) {
  const token = await mint(agent, GRAPH_LISTS_LXM, ME_DID);
  const res = await fetch('/api/graph-lists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'status', ...body }),
    signal,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body means the platform answered, not the handler: a Vercel
    // timeout page or an auth redirect.
    throw new Error(
      `/api/graph-lists returned ${res.status} with a non-JSON body (${text.slice(0, 120)})`,
    );
  }
  if (!res.ok)
    throw new Error(parsed?.error || `/api/graph-lists returned ${res.status}`);
  return parsed;
}

/* ------------------------------------------------------------ band words */

/** Band → how it should read on screen. Order is severity, loudest first. */
export const BAND_META = [
  {
    key: 'PROTECTED',
    label: 'Protected',
    hint: 'You follow them, or they are on one of your curation lists. No automated path can touch these.',
  },
  {
    key: 'CONNECTED',
    label: 'Connected',
    hint: 'Several of the people you follow also follow them, or one does and they have real reach.',
  },
  {
    key: 'PERIPHERAL',
    label: 'Peripheral',
    hint: 'One or two of the people you follow also follow them.',
  },
  {
    key: 'NOTABLE',
    label: 'Notable',
    hint: 'No connection to your circle, but a large audience or an unusually loud account.',
  },
  {
    key: 'UNKNOWN',
    label: 'Unknown',
    hint: 'No connection found and nothing notable. This is the bulk of any stranger sweep.',
  },
];

/** Engagement kind → a verb phrase, for reading a row aloud. */
export const KIND_LABEL = {
  quote: 'quoted',
  reply: 'replied',
  threadReply: 'in thread',
  repost: 'reposted',
  like: 'liked',
  gate: 'gated',
};

export function describeEngagements(engagements = {}) {
  return Object.entries(engagements)
    .map(([kind, n]) => {
      const label = KIND_LABEL[kind] || kind;
      return n > 1 ? `${label} ×${n}` : label;
    })
    .join(', ');
}
