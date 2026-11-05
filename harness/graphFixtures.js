// Fixtures for /api/graph-lists, served by the harness dev server (see
// vite.harness.config.js) so the Analytics studio's Graph tab can be opened and
// screenshotted with no app password, no Supabase and no PDS writes.
//
// Every account is invented (example.social), the PRNG is seeded and the clock
// fixed, so screenshots compare run to run. Saves and syncs change the in-memory
// state for the life of the dev server.

import { normalizeDefinition, slugKey } from '../src/lib/graphLists.js';

const NOW = Date.parse('2026-11-05T15:30:00Z');
const ME = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rand = prng(20261105);

const NAMES = [
  'Ash',
  'Bea',
  'Cass',
  'Dev',
  'Eli',
  'Fen',
  'Gray',
  'Hal',
  'Ivy',
  'Jun',
  'Kit',
  'Lou',
  'Mo',
  'Nia',
  'Oz',
  'Pip',
  'Quinn',
  'Rae',
  'Sol',
  'Tam',
];
const TINTS = [
  '#c9a27e',
  '#7ea9c9',
  '#9bc97e',
  '#c97e9b',
  '#a17ec9',
  '#7ec9b8',
];

function avatar(name, i) {
  if (i % 9 === 4) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${TINTS[i % TINTS.length]}"/><text x="20" y="26" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#fff">${name[0]}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function account(i, kind) {
  const name = `${NAMES[i % NAMES.length]} ${String.fromCharCode(65 + (i % 26))}.`;
  const handle = `${NAMES[i % NAMES.length].toLowerCase()}${i}.example.social`;
  const youFollow = kind === 'mutual' || kind === 'following';
  const vouches =
    kind === 'second'
      ? Math.max(1, Math.round(rand() ** 2.2 * 120))
      : kind === 'beyond'
        ? 0
        : Math.round(rand() * 40);
  const engaged = rand() < (youFollow ? 0.45 : 0.6);
  const inN = engaged ? Math.round(rand() ** 2 * 30) : 0;
  const outN = engaged ? Math.round(rand() ** 2 * (youFollow ? 30 : 8)) : 0;
  return {
    did: `did:plc:harnessgraph${String(i).padStart(4, '0')}`,
    handle,
    displayName: name,
    avatar: avatar(name, i),
    followers: Math.round(rand() ** 3 * 40000),
    youFollow,
    followsYou: kind === 'mutual',
    mutual: kind === 'mutual',
    vouches,
    distance: youFollow ? 0 : vouches ? 1 : 3,
    degree: youFollow ? 1 : vouches ? 2 : null,
    band: youFollow
      ? 'PROTECTED'
      : vouches >= 3
        ? 'CONNECTED'
        : vouches
          ? 'PERIPHERAL'
          : 'UNKNOWN',
    in: inN,
    out: outN,
  };
}

const NODES = [];
for (let i = 0; i < 70; i += 1) NODES.push(account(i, 'mutual'));
for (let i = 70; i < 130; i += 1) NODES.push(account(i, 'following'));
for (let i = 130; i < 220; i += 1) NODES.push(account(i, 'second'));
for (let i = 220; i < 260; i += 1) NODES.push(account(i, 'beyond'));

const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const HOUR = 3600_000;

const state = {
  lists: [
    {
      key: 'who-engages-with-me',
      ...normalizeDefinition({
        kind: 'engaged-in',
        name: 'Who engages with me',
        description: 'The people who engaged with me most in the last 30 days.',
        size: 50,
        minInteractions: 3,
      }),
      listUri: `at://${ME}/app.bsky.graph.list/3mharnessengin`,
      members: 50,
      lastSync: {
        at: iso(2 * HOUR),
        size: 50,
        target: 50,
        eligible: 212,
        added: 4,
        removed: 4,
        pending: 0,
        error: null,
      },
      history: Array.from({ length: 12 }, (_, i) => ({
        at: iso((i * 6 + 2) * HOUR),
        size: Math.min(50, 22 + (12 - i) * 3),
        added: 3,
        removed: 2,
      })),
    },
    {
      key: 'close-to-my-circle',
      ...normalizeDefinition({
        kind: 'proximity',
        name: 'Close to my circle',
        description:
          'Accounts I do not follow that many of the people I follow do.',
        notFollowing: true,
        size: 150,
        minVouches: 20,
        enabled: false,
      }),
      listUri: `at://${ME}/app.bsky.graph.list/3mharnessprox`,
      members: 150,
      lastSync: {
        at: iso(30 * HOUR),
        size: 150,
        target: 150,
        eligible: 1130,
        added: 0,
        removed: 1,
        pending: 0,
        error: null,
      },
      history: [],
    },
  ],
};

function breakdown(side) {
  const out = {
    mutual: 0,
    following: 0,
    strong: 0,
    weak: 0,
    beyond: 0,
    total: 0,
  };
  for (const n of NODES) {
    if (!(side === 'in' ? n.in : n.out)) continue;
    out.total += 1;
    if (n.mutual) out.mutual += 1;
    else if (n.youFollow) out.following += 1;
    else if (n.vouches >= 3) out.strong += 1;
    else if (n.vouches) out.weak += 1;
    else out.beyond += 1;
  }
  // The drawn nodes are the top of each side; the breakdown covers everyone.
  out.beyond += side === 'in' ? 140 : 9;
  out.weak += side === 'in' ? 31 : 4;
  out.total += side === 'in' ? 171 : 13;
  return out;
}

function previewFor(def) {
  const d = normalizeDefinition(def);
  let rows;
  if (d.kind === 'proximity') {
    rows = NODES.filter((n) =>
      d.notFollowing
        ? !n.youFollow && n.vouches >= d.minVouches
        : n.youFollow || n.vouches >= d.minVouches,
    ).sort(
      (a, b) =>
        Number(b.youFollow) - Number(a.youFollow) || b.vouches - a.vouches,
    );
  } else {
    const key = d.kind === 'engaged-in' ? 'in' : 'out';
    rows = NODES.filter(
      (n) => n[key] >= d.minInteractions && (!d.notFollowing || !n.youFollow),
    )
      .sort((a, b) => b[key] - a[key])
      .map((n) => ({ ...n, total: n[key] }));
  }
  const eligible = rows.length;
  rows = rows.slice(0, d.size);
  const existing = state.lists.find((l) => l.key === def.key);
  return {
    definition: { ...d, listUri: existing?.listUri || null },
    size: rows.length,
    eligible,
    adds: existing ? Math.min(3, rows.length) : rows.length,
    removes: existing ? 2 : 0,
    kept: existing ? rows.length - 3 : 0,
    members: rows
      .slice(0, 100)
      .map((r, i) => ({ ...r, onList: Boolean(existing) && i > 2 })),
    leaving: existing ? NODES.filter((n) => !n.youFollow).slice(-2) : [],
    coverage: {
      inboundComplete: true,
      snapshotAt: iso(15 * HOUR),
      modListRead: true,
    },
  };
}

export function handleGraph(body = {}) {
  const action = body.action || 'status';
  if (action === 'status')
    return { maxSize: 1000, maxWritesPerRun: 600, lists: state.lists };
  if (action === 'orbit') {
    return {
      windowDays: 30,
      gatheredAt: iso(0),
      snapshotAt: iso(15 * HOUR),
      following: 130,
      mutuals: 70,
      maxVouches: 120,
      breakdown: { inbound: breakdown('in'), outbound: breakdown('out') },
      nodes: NODES,
      coverage: {
        inboundComplete: true,
        snapshotAt: iso(15 * HOUR),
        modListRead: true,
      },
    };
  }
  if (action === 'preview') return previewFor(body.definition || {});
  if (action === 'save') {
    const d = normalizeDefinition(body.definition || {});
    if (!d) return { error: 'unknown list kind' };
    const existing = state.lists.find((l) => l.key === body.definition.key);
    if (existing) {
      Object.assign(existing, d, { listUri: existing.listUri });
      return existing;
    }
    const row = {
      key: slugKey(d.name),
      ...d,
      listUri: `at://${ME}/app.bsky.graph.list/3mharness${state.lists.length}`,
      members: 0,
      lastSync: null,
      history: [],
    };
    state.lists.push(row);
    return row;
  }
  if (action === 'sync') {
    const out = [];
    for (const l of state.lists) {
      if (body.key ? l.key !== body.key : !l.enabled) continue;
      const p = previewFor(l);
      l.members = p.size;
      l.lastSync = {
        at: iso(0),
        size: p.size,
        target: p.size,
        eligible: p.eligible,
        added: 2,
        removed: 1,
        pending: 0,
        error: null,
      };
      l.history = [
        { at: iso(0), size: p.size, added: 2, removed: 1 },
        ...(l.history || []),
      ];
      out.push({
        key: l.key,
        ...l.lastSync,
        addedDids: ['a', 'b'],
        removedDids: ['c'],
      });
    }
    return { lists: out, writes: out.length * 3, pending: 0 };
  }
  if (action === 'remove') {
    state.lists = state.lists.filter((l) => l.key !== body.key);
    return { key: body.key, deletedList: Boolean(body.deleteList) };
  }
  return { error: `unknown action ${action}` };
}
