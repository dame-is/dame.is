// Fixtures for the moderation hub's /api/mod-* endpoints, served by the harness
// dev server (see vite.harness.config.js). Plain JS, because the Vite config
// imports it in Node.
//
// Every account here is invented: handles under example.social, generated
// avatars, bios and quotes written for the fixture. Deterministic -- a seeded
// PRNG and a fixed clock -- so screenshots can be compared run to run.
//
// State is in memory for the life of the dev server: deciding a queue item
// takes it out of the queue, removing someone takes them off the list.

const NOW = Date.parse('2026-10-01T15:30:00Z');
const LIST = 'at://did:plc:harnessbot/app.bsky.graph.list/3mvharnesslist';

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rand = prng(20261001);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const FIRST = [
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
  'Uma',
  'Vic',
  'Wren',
  'Xan',
  'Yael',
  'Zed',
];
const LAST = [
  'Marsh',
  'Vale',
  'Okafor',
  'Lindqvist',
  'Moreau',
  'Tanaka',
  'Reyes',
  'Hart',
  'Novak',
  'Quill',
  'Abara',
  'Sato',
  'Brennan',
  'Iyer',
  'Kowal',
];
const BIOS = [
  'posting about transit maps and bad coffee',
  'they/them · tabletop games · mostly lurking',
  'software person. opinions are cached, not stored',
  'birds, bikes, the occasional thread about zoning',
  'tech worker, part-time contrarian',
  'i make zines and argue about fonts',
  null,
  'news junkie. reposts are not endorsements',
  'game dev · cats · do not @ me before coffee',
  null,
];
const QUOTES = {
  arguing: [
    'This policy is cowardly and indefensible, and the people who wrote it know that.',
    'If this is the standard, the standard is broken. Fix the rule, not the replies.',
    'You can have sympathy or you can have this policy. You cannot have both.',
    'Read the thread again. Nobody here is asking for special treatment.',
  ],
  neutral: [
    'wait, is this the same policy from last spring or a new one?',
    'saving this thread for later',
    'lol the replies on this one',
  ],
};

/** A generated avatar: initials on a tint, as an SVG data URI. */
function avatarFor(name, i) {
  if (i % 7 === 3) return null; // some accounts have no avatar; exercise the fallback
  const hues = [12, 38, 95, 160, 205, 250, 290, 330];
  const hue = hues[i % hues.length];
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue} 45% 62%)"/><text x="32" y="41" font-family="Georgia,serif" font-size="26" text-anchor="middle" fill="hsl(${hue} 50% 18%)">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function makeAccount(i) {
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  const handle = `${name.toLowerCase().replace(/[^a-z]/g, '')}${i}.example.social`;
  return {
    did: `did:plc:fixture${String(i).padStart(4, '0')}`,
    handle,
    displayName: i % 9 === 4 ? null : name,
    avatar: avatarFor(name, i),
    description: BIOS[i % BIOS.length],
    followers: Math.floor(40 + rand() * (i % 5 === 0 ? 40000 : 3000)),
    posts: Math.floor(100 + rand() * 9000),
    createdAt: iso((200 + Math.floor(rand() * 1400)) * DAY),
  };
}

const ACCOUNTS = Array.from({ length: 140 }, (_, i) => makeAccount(i + 1));
const byDid = new Map(ACCOUNTS.map((a) => [a.did, a]));

// ---- the list ---------------------------------------------------------------
const VIA = [
  'triage:hostile',
  'band',
  'agent:individual',
  'individual',
  'command',
  null,
  null,
  null,
];
const members = ACCOUNTS.slice(0, 120).map((a, i) => ({
  did: a.did,
  addedVia: VIA[i % VIA.length],
  addedAt: VIA[i % VIA.length] ? iso(i * 5 * HOUR + 3 * HOUR) : null,
  plan: VIA[i % VIA.length]
    ? ['6fa2491d', '94370af5', '3f9a2c1b'][i % 3]
    : null,
  band:
    i < 12
      ? null
      : ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'PERIPHERAL', 'NOTABLE', 'CONNECTED'][
          i % 6
        ],
}));
const LIST_COUNT_OFFSET = 9040 - members.length; // so the header reads like the real list

// ---- the queue --------------------------------------------------------------
const queue = [];
const reasonsPlan = [
  ['CONNECTED', 8],
  ['disputed', 5],
  ['PERIPHERAL', 10],
  ['NOTABLE', 7],
];
let q = 0;
for (const [reason, n] of reasonsPlan) {
  for (let k = 0; k < n; k += 1) {
    const m = members[12 + q];
    const a = byDid.get(m.did);
    q += 1;
    const band =
      reason === 'disputed' ? pick(['UNKNOWN', 'PERIPHERAL']) : reason;
    const label =
      reason === 'disputed' ? (k % 2 ? 'neutral' : 'arguing') : null;
    queue.push({
      did: a.did,
      reason,
      reasons:
        reason === 'disputed' && band !== 'UNKNOWN'
          ? ['disputed', band]
          : [reason],
      band,
      trust:
        reason === 'CONNECTED'
          ? 90 - k
          : reason === 'PERIPHERAL'
            ? 60 - k
            : 35 - k,
      vouches:
        reason === 'CONNECTED'
          ? 3 + ((k * 3) % 9)
          : reason === 'PERIPHERAL'
            ? 1 + (k % 2)
            : 0,
      followers: a.followers,
      protectedReason: null,
      label,
      quote: label ? pick(QUOTES[label]) : null,
      readBy: label ? 'anthropic/claude-sonnet-5.5+openai/gpt-6-luna' : null,
      plan: label ? '6fa2491d' : null,
      addedAt: label ? iso(6 * HOUR) : null,
      handle: a.handle,
    });
  }
}
const reviews = new Map();

// ---- plans ------------------------------------------------------------------
const PLANS = [
  {
    code: '94370af5',
    kind: 'everyone',
    createdAt: iso(2 * HOUR),
    approvedAt: iso(2 * HOUR - 50_000),
    accounts: 94,
    added: 92,
    undone: 0,
    labelled: 0,
    hostile: 0,
    arguing: 0,
    neutral: 0,
    via: { band: 92 },
    note: 'bulk everyone from at://did:plc:fixture0007/app.bsky.feed.post/3mwqat6k4a22e',
  },
  {
    code: '6fa2491d',
    kind: 'quoters',
    createdAt: iso(30 * HOUR),
    approvedAt: iso(29 * HOUR),
    accounts: 839,
    added: 231,
    undone: 0,
    labelled: 816,
    hostile: 142,
    arguing: 381,
    neutral: 293,
    via: { 'triage:hostile': 231 },
    note: 'bulk quoters from at://did:plc:fixture0011/app.bsky.feed.post/3mvq7aa2x2c2j',
  },
  {
    code: '3f9a2c1b',
    kind: 'repliers',
    createdAt: iso(3 * DAY),
    approvedAt: iso(3 * DAY - HOUR),
    accounts: 57,
    added: 12,
    undone: 3,
    labelled: 40,
    hostile: 12,
    arguing: 20,
    neutral: 8,
    via: { 'agent:individual': 9, individual: 3 },
    note: 'bulk repliers from at://did:plc:fixture0021/app.bsky.feed.post/3mu2aa5c4f22k',
  },
  {
    code: 'b850a02f',
    kind: 'everyone',
    createdAt: iso(3 * HOUR),
    approvedAt: null,
    accounts: 94,
    added: 0,
    undone: 0,
    labelled: 0,
    hostile: 0,
    arguing: 0,
    neutral: 0,
    via: {},
    note: 'bulk everyone from at://did:plc:fixture0007/app.bsky.feed.post/3mwqat6k4a22e',
  },
  {
    code: 'a1b2c3d4',
    kind: null,
    createdAt: iso(5 * DAY),
    approvedAt: iso(5 * DAY),
    accounts: 1,
    added: 1,
    undone: 0,
    labelled: 0,
    hostile: 0,
    arguing: 0,
    neutral: 0,
    via: { command: 1 },
    note: 'block @spamco.example.social',
  },
];
const webUrl = (note) => {
  const m = /from at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/(\S+)/.exec(
    note || '',
  );
  return m ? `https://bsky.app/profile/${m[1]}/post/${m[2]}` : null;
};

function planRows(code) {
  const plan = PLANS.find((p) => p.code === code);
  const n = Math.min(plan?.accounts ?? 0, 60);
  return Array.from({ length: n }, (_, i) => {
    const a = ACCOUNTS[(i + code.charCodeAt(0)) % ACCOUNTS.length];
    const triage = plan.labelled
      ? ['hostile', 'arguing', 'neutral', 'arguing'][i % 4]
      : null;
    return {
      did: a.did,
      handle: a.handle,
      displayName: a.displayName,
      avatar: a.avatar,
      followers: a.followers,
      band: [
        'UNKNOWN',
        'UNKNOWN',
        'PERIPHERAL',
        'NOTABLE',
        'CONNECTED',
        'UNKNOWN',
      ][i % 6],
      trust: 80 - i,
      vouches: i % 6 === 4 ? 4 : i % 6 === 2 ? 1 : 0,
      triage,
      quote:
        triage === 'hostile'
          ? 'you are the worst and everyone should tell you so'
          : triage
            ? pick(QUOTES[triage])
            : null,
      added: i < plan.added,
      undone: false,
      approvedVia: i < plan.added ? Object.keys(plan.via)[0] : null,
    };
  });
}

// ---- helpers ----------------------------------------------------------------
const card = (a) => ({ ...a });
const memberCard = (m) => {
  const a = byDid.get(m.did);
  const r = reviews.get(m.did);
  return {
    ...card(a),
    listitem: `at://did:plc:harnessbot/app.bsky.graph.listitem/${m.did.slice(-6)}`,
    band: m.band,
    vouches: null,
    protectedReason: null,
    addedVia: m.addedVia,
    addedAt: m.addedAt,
    plan: m.plan,
    label: m.addedVia === 'triage:hostile' ? 'hostile' : null,
    reviewed: r?.decision ?? null,
  };
};
const countsOf = (items) => {
  const out = {
    PROTECTED: 0,
    CONNECTED: 0,
    disputed: 0,
    PERIPHERAL: 0,
    NOTABLE: 0,
  };
  for (const i of items) out[i.reason] += 1;
  return out;
};
const openQueue = () => queue.filter((i) => !reviews.has(i.did));

// ---- handlers ---------------------------------------------------------------
export function handleMod(path, body = {}) {
  const action = body.action;

  if (path === '/api/mod-queue') {
    if (action === 'decide') {
      const { did, decision } = body;
      if (decision === 'reopen') reviews.delete(did);
      else if (decision === 'restore') {
        reviews.set(did, { decision: 'keep' });
        if (!members.some((m) => m.did === did))
          members.unshift({
            did,
            addedVia: 'portal',
            addedAt: new Date(NOW).toISOString(),
            band: null,
          });
      } else {
        reviews.set(did, { decision });
        if (decision === 'remove') {
          const at = members.findIndex((m) => m.did === did);
          if (at !== -1) members.splice(at, 1);
        }
      }
      return { ok: true, decision, removed: decision === 'remove' ? 1 : 0 };
    }
    const open = openQueue();
    const reason = body.reason && body.reason !== 'all' ? body.reason : null;
    const wanted = reason ? open.filter((i) => i.reason === reason) : open;
    const offset = Number(body.offset) || 0;
    const limit = Number(body.limit) || 20;
    const items = wanted
      .slice(offset, offset + limit)
      .map((i) => ({ ...i, profile: card(byDid.get(i.did)) }));
    const decided = {
      keep: [...reviews.values()].filter((r) => r.decision === 'keep').length,
      remove: [...reviews.values()].filter((r) => r.decision === 'remove')
        .length,
    };
    return {
      audit: { id: 'harness-audit', at: iso(14 * HOUR), total: 8889 },
      counts: countsOf(open),
      total: open.length,
      matched: wanted.length,
      offset,
      limit,
      decided,
      items,
      skipped: 0,
    };
  }

  if (path === '/api/mod-hub') {
    if (action === 'members') {
      const start = Number(body.cursor) || 0;
      const slice = members.slice(start, start + 50);
      return {
        list: {
          uri: LIST,
          name: 'Automated moderation list',
          count: members.length + LIST_COUNT_OFFSET,
        },
        cursor: start + 50 < members.length ? String(start + 50) : null,
        items: slice.map(memberCard),
      };
    }
    if (action === 'search') {
      const term = String(body.q || '')
        .toLowerCase()
        .replace(/^@/, '');
      const hits = members.filter((m) => {
        const a = byDid.get(m.did);
        return `${a.handle} ${a.displayName || ''}`
          .toLowerCase()
          .includes(term);
      });
      return {
        items: hits
          .slice(0, 30)
          .map((m) => ({ ...memberCard(m), onList: true })),
      };
    }
    if (action === 'account') {
      const actor = String(body.actor || '').replace(/^@/, '');
      const a =
        ACCOUNTS.find((x) => x.did === actor || x.handle === actor) ||
        ACCOUNTS[0];
      const m = members.find((x) => x.did === a.did);
      const qi = queue.find((x) => x.did === a.did);
      return {
        did: a.did,
        actor,
        profile: card(a),
        onList: Boolean(m),
        score: {
          band: qi?.band || m?.band || 'UNKNOWN',
          trust: qi?.trust ?? 20,
          vouches: qi?.vouches ?? 0,
          followers: a.followers,
          protected_reason: null,
        },
        scoredAt: iso(14 * HOUR),
        review: reviews.has(a.did)
          ? { decision: reviews.get(a.did).decision, decided_at: iso(0) }
          : null,
        protected: null,
        decisions: m?.addedVia
          ? [
              {
                plan_id: 'p',
                did: a.did,
                band: qi?.band || 'UNKNOWN',
                trust: qi?.trust ?? 20,
                vouches: qi?.vouches ?? 0,
                action: 'list_add',
                acted_at: m.addedAt,
                approved_via: m.addedVia,
                undone_at: null,
                undo_reason: null,
              },
            ]
          : [],
        plans: m?.plan
          ? [
              {
                id: 'p',
                code: m.plan,
                created_at: m.addedAt,
                approved_at: m.addedAt,
                approved_bands: ['band'],
                note: PLANS.find((p) => p.code === m.plan)?.note,
              },
            ]
          : [],
        audits: [
          {
            audit_id: 'a1',
            band: qi?.band || 'UNKNOWN',
            vouches: qi?.vouches ?? 0,
            decision: null,
          },
          {
            audit_id: 'a2',
            band: qi?.band || 'UNKNOWN',
            vouches: qi?.vouches ?? 0,
            decision: null,
          },
        ],
      };
    }
    if (action === 'why')
      return handleMod('/api/mod-hub', {
        action: 'account',
        actor: body.actor,
      });
    if (action === 'lists')
      return {
        lists: [
          {
            uri: LIST,
            name: 'Automated moderation list',
            purpose: 'app.bsky.graph.defs#modlist',
            active: true,
          },
        ],
      };
    if (action === 'list')
      return handleMod('/api/mod-hub', {
        action: 'members',
        cursor: body.cursor,
      });
    // overview
    const open = openQueue();
    return {
      listInfo: {
        name: 'Automated moderation list',
        count: members.length + LIST_COUNT_OFFSET,
      },
      queue: {
        total: open.length,
        counts: countsOf(open),
        decided: { keep: 0, remove: 0 },
      },
      cost: {
        priced: true,
        total: 0.8654,
        week: 0.5943,
        models: [
          {
            model: 'deepseek/deepseek-v4.1-flash',
            calls: 46,
            input: 1820000,
            output: 61000,
            usd: 0.759,
          },
          {
            model: 'zai/glm-5.3-flash',
            calls: 9,
            input: 210000,
            output: 9000,
            usd: 0.036,
          },
          {
            model: 'openai/gpt-6-luna',
            calls: 4,
            input: 21000,
            output: 900,
            usd: 0.0057,
          },
          {
            model: 'typesafe-ai/jev',
            calls: 38,
            input: 15200,
            output: 0,
            usd: 0.0006,
          },
        ],
      },
      snapshot: {
        takenAt: iso(18 * HOUR),
        scored: 75365,
        protected: 962,
        ageHours: 18,
      },
      list: LIST,
      bot: {
        handle: 'agent.example.social',
        did: 'did:plc:harnessbot',
        refreshed_at: iso(40 * 60_000),
      },
      plans: 67,
      decisions: 3385,
      calls: 67,
      tokens: { input: 2066200, output: 70900 },
      audits: [
        {
          id: 'a1',
          list_uri: LIST,
          started_at: iso(14 * HOUR),
          finished_at: iso(14 * HOUR - 48_000),
          total: 8889,
          scored: 8889,
        },
        {
          id: 'a2',
          list_uri: LIST,
          started_at: iso(2 * DAY),
          finished_at: iso(2 * DAY - 4000),
          total: 0,
          scored: 0,
        },
        {
          id: 'a3',
          list_uri: LIST,
          started_at: iso(7 * DAY + 14 * HOUR),
          finished_at: iso(7 * DAY + 14 * HOUR - 96_000),
          total: 8754,
          scored: 8754,
        },
      ],
      settingsUpdated: null,
    };
  }

  if (path === '/api/mod-plan') {
    if (action === 'detail') {
      const plan = PLANS.find((p) => p.code === body.code);
      if (!plan) return { error: 'no plan with that code' };
      let rows = planRows(plan.code);
      const state = body.state || 'all';
      if (body.label) rows = rows.filter((r) => r.triage === body.label);
      if (body.band) rows = rows.filter((r) => r.band === body.band);
      if (state === 'pending') rows = rows.filter((r) => !r.added);
      if (state === 'added') rows = rows.filter((r) => r.added);
      const offset = Number(body.offset) || 0;
      return {
        code: plan.code,
        note: plan.note,
        uri: null,
        webUrl: webUrl(plan.note),
        createdAt: plan.createdAt,
        counts: {
          total: plan.accounts,
          added: plan.added,
          labelled: plan.labelled,
        },
        byLabel: {
          hostile: plan.hostile,
          arguing: plan.arguing,
          neutral: plan.neutral,
          gone: 0,
        },
        byBand: {},
        matched: rows.length,
        offset,
        pageSize: 25,
        rows: rows.slice(offset, offset + 25),
      };
    }
    if (action === 'add')
      return {
        ok: true,
        added: (body.dids || []).length,
        message: `Added ${(body.dids || []).length} by name.`,
      };
    if (action === 'undo')
      return { ok: true, removed: 3, message: 'Took 3 back off the list.' };
    return {
      plans: PLANS.map((p) => ({
        code: p.code,
        createdAt: p.createdAt,
        approvedAt: p.approvedAt,
        approvedBands: p.approvedAt ? Object.keys(p.via) : null,
        note: p.note,
        uri: null,
        webUrl: webUrl(p.note),
        kind: p.kind,
        accounts: p.accounts,
        added: p.added,
        undone: p.undone,
        hostile: p.hostile,
        arguing: p.arguing,
        neutral: p.neutral,
        labelled: p.labelled,
        via: p.via,
      })),
    };
  }

  if (path === '/api/mod-config') {
    return {
      config: null,
      default: {
        style:
          'VOICE. Short. Concrete numbers. No preamble, no restating the question. No em dashes.',
        report:
          '{displayName} (@{handle})\n{band}, {relationship}\n{followers} followers · {postsPerDay}/day',
        postReport: 'Post {code}\n{participants} accounts: {engagements}',
      },
      limitSpec: {
        maxTurns: { min: 1, max: 40, def: 12 },
        maxSteps: { min: 1, max: 20, def: 12 },
        historyHours: { min: 0, max: 168, def: 4 },
        reviewRows: { min: 1, max: 40, def: 40 },
      },
      maxChars: 2000,
    };
  }

  if (path === '/api/mod-preflight') {
    return {
      target: {
        uri: 'at://did:plc:fixture0007/app.bsky.feed.post/3mwqat6k4a22e',
      },
      totals: {
        participants: 94,
        records: 139,
        engagements: { like: 88, repost: 4, reply: 6, quote: 2 },
        byBand: {
          PROTECTED: 2,
          CONNECTED: 6,
          PERIPHERAL: 9,
          NOTABLE: 4,
          UNKNOWN: 73,
        },
        reviewReach: 120400,
      },
      truncated: false,
      autoEligible: 73,
      requiresReview: ACCOUNTS.slice(30, 51).map((a, i) => ({
        did: a.did,
        handle: a.handle,
        band: ['PROTECTED', 'CONNECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE'][
          i % 5
        ],
        vouches: [12, 7, 4, 1, 0][i % 5],
        followers: a.followers,
        postsPerDay: (i % 9) + 0.4,
        engagements: { like: 1, ...(i % 3 === 0 ? { reply: 1 } : {}) },
        protectedReason: i % 5 === 0 ? 'you follow them' : null,
        alreadyListed: i % 4 === 0,
      })),
    };
  }

  if (path === '/api/mod-precompute')
    return { state: 'idle', snapshot: iso(18 * HOUR), vouches: 75365 };
  if (path === '/api/mod-audit') {
    if (action === 'review')
      return {
        audit: { scored: 8889, finished_at: iso(14 * HOUR) },
        items: [],
      };
    return { state: 'finished', scored: 8889 };
  }
  return { error: `harness has no fixture for ${path}` };
}
