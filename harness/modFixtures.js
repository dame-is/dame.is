// Fixtures for the moderation hub, answering the bluesky-mod bot's API
// (github.com/dame-is/bluesky-mod, docs/API.md) as the harness dev server
// (see vite.harness.config.js). Plain JS, because the Vite config imports it
// in Node.
//
// Every account here is invented: handles under example.social, generated
// avatars, bios and quotes written for the fixture. Deterministic -- a seeded
// PRNG and a fixed clock -- so screenshots can be compared run to run.
//
// State is in memory for the life of the dev server: keeping someone takes
// them out of the queue, an unblock takes them off the list, an undo takes a
// plan's adds back, shields up closes the posts.
//
// `?lists=2` on the harness page gives the bot two lists, for the picker and
// the "Which list?" question.

const NOW = Date.parse('2026-10-01T15:30:00Z');
const BOT = 'did:plc:harnessbot0000000000000';
const OWNER = 'did:plc:harnessowner00000000000';
const MAIN = {
  uri: `at://${BOT}/app.bsky.graph.list/3mvharnesslist`,
  rkey: '3mvharnesslist',
  name: 'Block List',
};
const SECOND = {
  uri: `at://${BOT}/app.bsky.graph.list/3mvspamlist00`,
  rkey: '3mvspamlist00',
  name: 'Spam',
};

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
  hostile: [
    'Nobody asked for your opinion, and nobody will.',
    'Log off forever. The site is better without you.',
    'You are a clown and everyone in this thread knows it.',
  ],
  arguing: [
    'This policy is cowardly and indefensible, and the people who wrote it know that.',
    'If this is the standard, the standard is broken. Fix the rule, not the replies.',
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
  return {
    did: `did:plc:fixture${String(i).padStart(4, '0')}`,
    handle: `${name.toLowerCase().replace(/[^a-z]/g, '')}${i}.example.social`,
    displayName: i % 9 === 4 ? null : name,
    avatar: avatarFor(name, i),
    description: BIOS[i % BIOS.length],
    followers: Math.floor(40 + rand() * (i % 5 === 0 ? 40000 : 3000)),
    follows: Math.floor(20 + rand() * 900),
    posts: Math.floor(100 + rand() * 9000),
    createdAt: iso((200 + Math.floor(rand() * 1400)) * DAY),
  };
}

const ACCOUNTS = Array.from({ length: 420 }, (_, i) => makeAccount(i + 1));
const byDid = new Map(ACCOUNTS.map((a) => [a.did, a]));

// ---- plans and the log -------------------------------------------------------

const POST = (n) =>
  `at://did:plc:fixture00${n}/app.bsky.feed.post/3mwqat6k4a2${n}`;
const KINDS_OF = [
  ['like'],
  ['like'],
  ['repost'],
  ['reply'],
  ['quote'],
  ['like', 'repost'],
  ['reply', 'like'],
];
const BAND_AT = (i) =>
  i % 41 === 0
    ? 'PROTECTED'
    : i % 13 === 0
      ? 'CONNECTED'
      : i % 7 === 0
        ? 'PERIPHERAL'
        : i % 11 === 0
          ? 'NOTABLE'
          : 'UNKNOWN';

function scanRows(from, n, { labelled = false } = {}) {
  return Array.from({ length: n }, (_, k) => {
    const i = from + k;
    const a = ACCOUNTS[i % ACCOUNTS.length];
    const band = BAND_AT(i);
    const kinds = KINDS_OF[i % KINDS_OF.length];
    const wrote = kinds.includes('reply') || kinds.includes('quote');
    const label =
      labelled && wrote
        ? i % 3 === 0
          ? 'hostile'
          : i % 3 === 1
            ? 'arguing'
            : 'neutral'
        : null;
    return {
      did: a.did,
      band,
      trust: band === 'UNKNOWN' ? 6 : 50,
      vouches:
        band === 'CONNECTED'
          ? 3 + (i % 6)
          : band === 'PERIPHERAL'
            ? 1 + (i % 2)
            : 0,
      kinds,
      label,
      quote: label ? QUOTES[label][i % 3] : null,
      hasText: wrote,
      protected: band === 'PROTECTED',
      added: false,
      undone: false,
      via: null,
      listed: false,
      blocksYou: false,
    };
  });
}

/** Plans by code. A scan has `totals`; a typed block or unblock does not. */
const PLANS = new Map();
function addPlan(p) {
  PLANS.set(p.code, p);
  return p;
}

const quoters = addPlan({
  code: '6fa2491d',
  createdAt: iso(30 * HOUR),
  kind: 'quoters',
  uri: POST(11),
  scan: true,
  words: ['approve 6fa2491d hostile UNKNOWN'],
  rows: scanRows(1, 260, { labelled: true }),
});
for (const r of quoters.rows) {
  if (r.label === 'hostile' && r.band === 'UNKNOWN')
    Object.assign(r, {
      added: true,
      via: 'triage:hostile',
      at: iso(29 * HOUR),
    });
}
const everyone = addPlan({
  code: '94370af5',
  createdAt: iso(2 * HOUR),
  kind: 'everyone',
  uri: POST(7),
  scan: true,
  words: ['approve 94370af5 UNKNOWN'],
  rows: scanRows(120, 180),
});
for (const r of everyone.rows) {
  if (r.band === 'UNKNOWN')
    Object.assign(r, { added: true, via: 'band', at: iso(2 * HOUR - 50_000) });
}
addPlan({
  code: 'b850a02f',
  createdAt: iso(3 * HOUR),
  kind: 'likers',
  uri: POST(8),
  scan: true,
  words: [],
  rows: scanRows(300, 110),
});
addPlan({
  code: '74680fcb',
  createdAt: iso(14 * DAY),
  kind: null,
  scan: false,
  words: ['carried over from the old list when it moved to the bot account'],
  rows: ACCOUNTS.slice(330, 420).map((a, k) => ({
    did: a.did,
    band: k % 9 === 0 ? 'NOTABLE' : 'UNKNOWN',
    vouches: 0,
    kinds: [],
    label: null,
    quote: null,
    protected: false,
    added: true,
    undone: false,
    via: 'band',
    listed: false,
    blocksYou: false,
    at: iso(14 * DAY - k * 1000),
  })),
});
addPlan({
  code: 'a1b2c3d4',
  createdAt: iso(5 * DAY),
  kind: null,
  scan: false,
  words: ['block @spamco.example.social'],
  rows: [
    {
      ...scanRows(77, 1)[0],
      band: 'UNKNOWN',
      added: true,
      via: 'command',
      at: iso(5 * DAY),
    },
  ],
});
// Someone close to you, on the list since a scan, whom the re-score now
// puts closer: what the queue is for.
for (const r of quoters.rows.slice(0, 40)) {
  if (r.band !== 'UNKNOWN' && r.band !== 'PROTECTED' && r.label)
    Object.assign(r, {
      added: true,
      via: 'agent:individual',
      at: iso(28 * HOUR),
    });
}

let seq = 1;
const nextCode = () => (0x10000000 + seq++ * 7919).toString(16).slice(-8);
const kept = new Map(); // did -> { band, at }

/** Every open add: did -> { plan, row }. The newest add wins. */
function openAdds() {
  const out = new Map();
  const plans = [...PLANS.values()].sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt)),
  );
  for (const p of plans)
    for (const r of p.rows)
      if (r.added && !r.undone) out.set(r.did, { plan: p, row: r });
  return out;
}

/** What the last re-score said: a band per account on the list, steadied by DID. */
function bandNow(did, fallback) {
  const i = Number(did.slice(-4)) || 0;
  if (fallback !== 'UNKNOWN') return fallback;
  return i % 29 === 0 ? 'PERIPHERAL' : i % 31 === 0 ? 'CONNECTED' : 'UNKNOWN';
}

const FAMILY = (via) => {
  const v = String(via || '');
  if (!v) return 'none';
  if (/^(agent|watch):/.test(v)) return 'agent';
  if (v.includes('triage')) return 'label';
  if (v === 'band') return 'band';
  return 'name';
};

function listRows(listKey) {
  return [...openAdds().values()]
    .filter(({ plan }) => (plan.list || MAIN.rkey) === listKey)
    .map(({ plan, row }) => {
      const a = byDid.get(row.did);
      const band = bandNow(row.did, row.band);
      return {
        did: row.did,
        handle: a?.handle || null,
        band,
        bandThen: row.band === 'UNSCORED' ? null : row.band,
        vouches: band === 'UNKNOWN' ? 0 : row.vouches || 1,
        followers: a?.followers ?? null,
        protectedReason: band === 'PROTECTED' ? 'you follow them' : null,
        rescored: true,
        via: row.via,
        family: FAMILY(row.via),
        code: plan.code,
        addedAt: row.at,
        keptBand: kept.get(row.did)?.band || null,
        label: row.label || null,
        quote: row.quote || null,
      };
    });
}

const CLOSE = ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE'];
const closeness = (b) => (CLOSE.includes(b) ? CLOSE.indexOf(b) : CLOSE.length);

function queueRows() {
  return listRows(MAIN.rkey)
    .filter(
      (r) =>
        CLOSE.includes(r.band) &&
        !(r.keptBand && closeness(r.band) >= closeness(r.keptBand)),
    )
    .sort(
      (x, y) =>
        closeness(x.band) - closeness(y.band) ||
        (y.vouches ?? 0) - (x.vouches ?? 0),
    )
    .map((r) => ({
      ...r,
      reason:
        r.bandThen && closeness(r.band) < closeness(r.bandThen)
          ? 'closer'
          : 'close',
    }));
}

function summary(p) {
  const rows = p.rows;
  const count = (f) => rows.filter(f).length;
  const added = count((r) => r.added || r.undone);
  const live = count((r) => r.added && !r.undone);
  return {
    code: p.code,
    createdAt: p.createdAt,
    list: p.list || null,
    approved: added > 0,
    uri: p.uri || null,
    kind: p.kind,
    total: rows.length,
    byBand: Object.fromEntries(
      ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN'].map(
        (b) => [b, count((r) => r.band === b)],
      ),
    ),
    labels: {
      hostile: count((r) => r.label === 'hostile'),
      arguing: count((r) => r.label === 'arguing'),
      neutral: count((r) => r.label === 'neutral'),
    },
    added,
    live,
    state: live > 0 ? 'added' : added > 0 ? 'undone' : 'waiting',
  };
}

// ---- the shield -----------------------------------------------------------------

const shield = {
  attack: { on: false, since: null, until: null, why: null },
  limits: [
    {
      post: `at://${OWNER}/app.bsky.feed.post/3mbikelanes2`,
      kind: 'replies',
      why: 'trigger',
      appliedAt: iso(2 * HOUR),
      restoreAfter: iso(-22 * HOUR),
    },
  ],
  guards: [
    {
      post: `at://${OWNER}/app.bsky.feed.post/3mfarecap202`,
      mode: 'ask',
      until: iso(-48 * HOUR),
    },
  ],
};

// ---- commands --------------------------------------------------------------------

const say = (text, outcome = null, options = []) => ({
  ok: true,
  action: 'command',
  text,
  outcome,
  options,
  choice: false,
});

function runCommand(text, { multi }) {
  const raw = String(text || '').trim();
  const list = /\blist:(\S+)/.exec(raw)?.[1] || null;
  const plain = raw.replace(/\s+list:\S+/, '');
  const lists = multi ? [MAIN, SECOND] : [MAIN];
  const ask = (lead, base) => ({
    ok: true,
    action: 'command',
    text: `${lead} Which list?`,
    outcome: null,
    choice: true,
    options: lists.map((l) => ({
      label: l.name,
      command: `${base} list:${l.rkey}`,
      commands: [`${base} list:${l.rkey}`],
      takesBack: false,
    })),
  });

  let m = /^unblock (did:\S+)$/.exec(plain);
  if (m) {
    const did = m[1];
    if (multi && !list)
      return ask(
        `@${byDid.get(did)?.handle || did} is on a list.`,
        `unblock ${did}`,
      );
    const open = openAdds().get(did);
    if (!open) return say('They are not on the list.');
    open.row.undone = true;
    const code = nextCode();
    addPlan({
      code,
      createdAt: new Date().toISOString(),
      kind: null,
      scan: false,
      list,
      words: [raw],
      rows: [
        {
          ...open.row,
          added: false,
          undone: false,
          action: 'list_remove',
          at: new Date().toISOString(),
          via: 'command',
        },
      ],
    });
    return say(`Took @${byDid.get(did)?.handle || did} off the list.`, 'done', [
      {
        label: 'Put them back',
        command: `block ${did}`,
        commands: [`block ${did}`],
        takesBack: false,
      },
    ]);
  }
  m = /^block (did:\S+)$/.exec(plain);
  if (m) {
    const did = m[1];
    if (multi && !list) return ask('', `block ${did}`);
    if (BAND_AT(Number(did.slice(-4))) === 'PROTECTED')
      return say('They are PROTECTED: you follow them. I added nobody.');
    const code = nextCode();
    addPlan({
      code,
      createdAt: new Date().toISOString(),
      kind: null,
      scan: false,
      list,
      words: [raw],
      rows: [
        {
          ...scanRows(Number(did.slice(-4)) - 1, 1)[0],
          did,
          added: true,
          via: 'command',
          at: new Date().toISOString(),
        },
      ],
    });
    return say(`Added @${byDid.get(did)?.handle || did} to the list.`, 'done', [
      {
        label: 'Undo',
        command: `undo ${code}`,
        commands: [`undo ${code}`],
        takesBack: true,
      },
    ]);
  }
  m = /^undo ([0-9a-f]{8})$/.exec(plain);
  if (m) {
    const p = PLANS.get(m[1]);
    if (!p) return say(`There is no plan ${m[1]}.`);
    const open = p.rows.filter((r) => r.added && !r.undone);
    for (const r of open) r.undone = true;
    return say(
      open.length
        ? `Took the ${open.length} plan ${p.code} added back off the list.`
        : `Nothing from plan ${p.code} is on the list.`,
      open.length ? 'done' : null,
    );
  }
  m = /^approve ([0-9a-f]{8}) (did:.+)$/.exec(plain);
  if (m) {
    const p = PLANS.get(m[1]);
    if (!p) return say(`There is no plan ${m[1]}.`);
    if (multi && !list && !p.list)
      return ask(`Plan ${p.code} has no list yet.`, plain);
    if (list) p.list = list;
    const dids = new Set(m[2].split(/\s+/));
    const rows = p.rows.filter(
      (r) =>
        dids.has(r.did) && !r.added && !r.protected && r.band !== 'PROTECTED',
    );
    for (const r of rows)
      Object.assign(r, {
        added: true,
        via: 'individual',
        at: new Date().toISOString(),
      });
    return say(
      rows.length ? `Added ${rows.length} to the list.` : 'Nothing to add.',
      rows.length ? 'done' : null,
    );
  }
  // The shield
  if (/^shields up$/.test(plain)) {
    Object.assign(shield.attack, {
      on: true,
      since: new Date().toISOString(),
      until: new Date(Date.now() + DAY).toISOString(),
      why: 'manual',
    });
    return say(
      'Shields up: replies closed and quotes off on 14 recent posts. "shields down" puts them back.',
      'done',
    );
  }
  if (/^shields down$/.test(plain)) {
    Object.assign(shield.attack, {
      on: false,
      since: null,
      until: null,
      why: null,
    });
    return say('Shields down: everything is back as it was.', 'done');
  }
  m = /^(open replies|enable quotes|unguard) (at:\/\/\S+)$/.exec(plain);
  if (m) {
    if (m[1] === 'unguard') {
      shield.guards = shield.guards.filter((g) => g.post !== m[2]);
      return say('Stopped guarding it.', 'done');
    }
    const kind = m[1] === 'open replies' ? 'replies' : 'quotes';
    shield.limits = shield.limits.filter(
      (l) => !(l.post === m[2] && l.kind === kind),
    );
    return say(
      kind === 'replies' ? 'Replies are open again.' : 'Quotes are back on.',
      'done',
    );
  }
  return {
    status: 400,
    error: `"${raw.split(/\s+/)[0]}" is not something the panel runs. Send it to the bot in a DM.`,
  };
}

// ---- routes ----------------------------------------------------------------------

const json = (body, status = 200) => ({ status, body });
const page = (rows, offset, limit) => rows.slice(offset, offset + limit);

/**
 * Answer one API request.
 *
 * @param {string} method
 * @param {string} path      like /api/queue
 * @param {URLSearchParams} query
 * @param {object} body
 * @param {{ multi: boolean }} opts
 * @returns {{ status: number, body: object }}
 */
export function handleBot(
  method,
  path,
  query,
  body = {},
  { multi = false } = {},
) {
  const num = (k, d) => (query.get(k) == null ? d : Number(query.get(k)));
  const route = `${method} ${path}`;
  const listKey = multi ? query.get('list') || MAIN.rkey : MAIN.rkey;

  switch (route) {
    case 'GET /api/me':
      return json({
        apiVersion: 1,
        did: OWNER,
        tier: 'owner',
        canWrite: true,
        via: 'atproto',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        bot: { did: BOT, handle: 'quietlist.example.social' },
        owner: { did: OWNER, handle: 'dame.example.social' },
        hasModel: true,
        dryRun: false,
      });
    case 'GET /api/lists': {
      const all = multi ? [MAIN, SECOND] : [MAIN];
      return json({
        multi,
        lists: all.map((l) => ({
          rkey: l.rkey,
          name: l.name,
          n: listRows(l.rkey).length,
        })),
      });
    }
    case 'GET /api/overview': {
      const rows = listRows(listKey);
      const counts = Object.fromEntries(
        [...CLOSE, 'UNKNOWN', 'UNSCORED'].map((b) => [
          b,
          rows.filter((r) => (r.band || 'UNSCORED') === b).length,
        ]),
      );
      const week = rows.filter(
        (r) => Date.parse(r.addedAt) > NOW - 7 * DAY,
      ).length;
      return json({
        list: {
          total: rows.length,
          source: 'repo',
          complete: true,
          asOf: iso(2 * DAY),
          counts,
        },
        week: { added: week, removed: 1 },
        waiting: { queue: queueRows().length, scans: 1 },
        snapshot: { takenAt: iso(3 * DAY), scoring: 'full', ageDays: 3 },
        rescoredAt: iso(2 * DAY),
        budget: {
          hour: { used: 120, max: 5000 },
          day: { used: 2400, max: 35000 },
        },
        adding: [],
      });
    }
    case 'GET /api/queue': {
      const band = query.get('band');
      const all = queueRows();
      const counts = Object.fromEntries(
        CLOSE.map((b) => [b, all.filter((r) => r.band === b).length]),
      );
      const shown = band ? all.filter((r) => r.band === band) : all;
      return json({
        asOf: iso(2 * DAY),
        total: all.length,
        counts,
        matched: shown.length,
        rows: page(shown, num('offset', 0), num('limit', 30)),
      });
    }
    case 'POST /api/queue/keep':
      kept.set(body.did, { band: body.band, at: new Date().toISOString() });
      return json({ ok: true });
    case 'POST /api/queue/reopen':
      kept.delete(body.did);
      return json({ ok: true });
    case 'GET /api/list': {
      const needle = String(query.get('q') || '')
        .toLowerCase()
        .replace(/^@/, '');
      let rows = listRows(listKey);
      if (query.get('sort') === 'recent')
        rows = rows.sort((a, b) =>
          String(b.addedAt).localeCompare(String(a.addedAt)),
        );
      const matched = needle
        ? rows.filter(
            (r) => r.did === needle || String(r.handle).includes(needle),
          )
        : rows;
      return json({
        source: 'repo',
        complete: true,
        asOf: iso(2 * DAY),
        total: rows.length,
        matched: matched.length,
        rows: page(matched, num('offset', 0), num('limit', 50)),
      });
    }
    case 'GET /api/list/radar': {
      const rows = listRows(listKey);
      const near = rows
        .filter((r) => r.band && r.band !== 'UNKNOWN')
        .map((r) => ({
          did: r.did,
          handle: r.handle,
          band: r.band,
          family: r.family,
        }));
      const far = {};
      for (const r of rows)
        if (!r.band || r.band === 'UNKNOWN')
          far[r.family] = (far[r.family] || 0) + 1;
      return json({
        source: 'repo',
        asOf: iso(2 * DAY),
        total: rows.length,
        near,
        far,
      });
    }
    case 'POST /api/profiles': {
      const out = {};
      for (const did of body.dids || []) {
        const a = byDid.get(did);
        if (a) out[did] = a;
      }
      return json({ profiles: out });
    }
    case 'GET /api/account': {
      const actor = String(query.get('actor') || '').replace(/^@/, '');
      const a = byDid.get(actor) || ACCOUNTS.find((x) => x.handle === actor);
      if (!a) return json({ error: 'I could not find that account.' }, 404);
      const i = Number(a.did.slice(-4));
      const band = bandNow(a.did, BAND_AT(i));
      const open = openAdds().get(a.did);
      const entries = [];
      for (const p of PLANS.values()) {
        for (const r of p.rows.filter((x) => x.did === a.did)) {
          entries.push({
            code: p.code,
            scan: p.scan,
            uri: p.uri || null,
            list: p.list || null,
            at: r.at || p.createdAt,
            band: r.band,
            vouches: r.vouches,
            action: r.action || (r.added || r.undone ? 'list_add' : null),
            already: false,
            via: r.via,
            undoneAt: r.undone ? new Date(NOW).toISOString() : null,
            label: r.label,
            quote: r.quote,
            words: p.words,
          });
        }
      }
      entries.sort((x, y) => String(y.at).localeCompare(String(x.at)));
      return json({
        did: a.did,
        live: {
          ...a,
          band,
          vouches: band === 'UNKNOWN' ? 0 : 3,
          protectedReason: band === 'PROTECTED' ? 'you follow them' : null,
        },
        failed: null,
        onLists: open
          ? [{ did: a.did, band, list: open.plan.list || MAIN.rkey }]
          : [],
        protectedReason: band === 'PROTECTED' ? 'you follow them' : null,
        kept: kept.get(a.did)
          ? { band: kept.get(a.did).band, at: kept.get(a.did).at }
          : null,
        entries,
      });
    }
    case 'GET /api/activity': {
      const events = [];
      for (const p of PLANS.values()) {
        const groups = new Map();
        for (const r of p.rows) {
          if (!(r.added || r.undone || r.action)) continue;
          const kind = r.action === 'list_remove' ? 'removed' : 'added';
          const g = groups.get(kind) || {
            kind,
            code: p.code,
            at: r.at || p.createdAt,
            n: 0,
            undone: 0,
            via: r.via,
            band: r.band,
            scan: p.scan,
            uri: p.uri || null,
            list: p.list || null,
            words: p.words,
          };
          g.n += 1;
          if (r.undone) g.undone += 1;
          if (g.band !== r.band) g.band = null;
          groups.set(kind, g);
        }
        events.push(...groups.values());
      }
      events.sort((x, y) => String(y.at).localeCompare(String(x.at)));
      const offset = num('offset', 0);
      const limit = num('limit', 30);
      return json({
        more: events.length > offset + limit,
        events: page(events, offset, limit),
      });
    }
    case 'GET /api/scans': {
      const before = query.get('before');
      const all = [...PLANS.values()]
        .filter((p) => p.scan && (!before || p.createdAt < before))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(summary);
      const limit = num('limit', 60);
      const shown = all.slice(0, limit);
      return json({
        scans: shown,
        counts: {},
        more: all.length > limit,
        next: all.length > limit ? shown[shown.length - 1].createdAt : null,
      });
    }
    case 'GET /api/scan': {
      const p = PLANS.get(query.get('code'));
      if (!p) return json({ error: 'There is no plan with that code.' }, 404);
      return json({
        ...summary(p),
        scan: p.scan,
        words: p.words,
        rows: p.rows,
        list: multi ? p.list || null : null,
      });
    }
    case 'POST /api/check': {
      if (!/\/post\/|app\.bsky\.feed\.post/.test(String(body.link || '')))
        return json(
          { error: 'That check failed: I scan posts, and that is not a post.' },
          400,
        );
      const rows = scanRows(200, 140);
      const review = rows
        .filter((r) => r.band !== 'UNKNOWN')
        .map((r) => ({
          ...r,
          handle: byDid.get(r.did).handle,
          followers: byDid.get(r.did).followers,
          engagements: Object.fromEntries(r.kinds.map((k) => [k, 1])),
          protectedReason: r.band === 'PROTECTED' ? 'you follow them' : null,
          alreadyListed: false,
        }));
      return json({
        target: { uri: POST(9), did: 'did:plc:fixture0009' },
        totals: {
          participants: rows.length,
          engagements: { like: 96, repost: 22, reply: 31, quote: 12 },
          byBand: summary({ rows }).byBand,
          reviewReach: review.reduce((n, r) => n + r.followers, 0),
          alreadyListed: 0,
        },
        truncated: false,
        requiresReview: review,
        autoEligible: rows.length - review.length,
      });
    }
    case 'GET /api/settings':
      return json({
        mode: 'classic',
        scoring: 'full',
        dryRun: false,
        provider: 'gateway',
        multiList: multi,
        file: {
          style: 'Write plainly and briefly. Lowercase is fine. No emoji.',
          guidance: 'Never add someone who only liked a post unless I say so.',
          openers: false,
          report: false,
          postReport: false,
          model: null,
          limits: { maxTurns: 12, maxSteps: 12 },
          barePost: 'card',
        },
      });
    case 'GET /api/health':
      return json({
        startedAt: iso(4 * DAY),
        lastPollAt: iso(1500),
        dmAnswers: 212,
        bot: { did: BOT, handle: 'quietlist.example.social' },
        dryRun: false,
        disk: { free: 1.6 * 1024 ** 3, total: 2 * 1024 ** 3, low: false },
        database: { kind: 'Postgres', bytes: null },
      });
    case 'GET /api/graph':
      return json({
        snapshot: {
          takenAt: iso(3 * DAY),
          scoring: 'full',
          ageDays: 3,
          vouches: 81_204,
        },
        newest: {
          takenAt: iso(3 * DAY),
          scoring: 'full',
          circle: 234,
          pending: 0,
          unreadable: 2,
          building: false,
        },
        protected: { total: 980, follows: 234, lists: 746, manual: 0 },
        audits: [
          {
            startedAt: iso(2 * DAY + HOUR),
            finishedAt: iso(2 * DAY),
            total: 8875,
            scored: 8875,
            bands: {},
          },
        ],
      });
    case 'GET /api/models':
      return json({
        total: { calls: 61, input: 1_640_000, output: 290_000 },
        byModel: [
          {
            name: 'deepseek/deepseek-v4.1-flash',
            calls: 47,
            input: 1_292_146,
            output: 267_699,
          },
          {
            name: 'zai/glm-5.3-flash',
            calls: 14,
            input: 347_854,
            output: 22_301,
          },
        ],
        provider: 'gateway',
        models: {
          agent: 'deepseek/deepseek-v4.1-flash',
          check: 'deepseek/deepseek-v4.1-flash',
          escalation: 'zai/glm-5.3-flash',
        },
        mode: 'classic',
      });
    case 'GET /api/shield':
      return json({
        running: true,
        canAct: true,
        problem: null,
        attack: {
          ...shield.attack,
          mode: 'ask',
          trip: { count: 40, windowMs: 30 * 60_000 },
        },
        triggers: {
          mode: 'ask',
          replies: { count: 12, windowMs: 15 * 60_000 },
          quotes: { count: 6, windowMs: 15 * 60_000 },
          replyRule: ['following', 'mentioned'],
        },
        stream: { on: true, live: true, coversMs: 4 * HOUR, held: 318 },
        limits: shield.limits,
        guards: shield.guards,
      });
    case 'POST /api/command': {
      const out = runCommand(body.command, { multi });
      return out.status ? json({ error: out.error }, out.status) : json(out);
    }
    case 'POST /api/graph/rebuild':
    case 'POST /api/rescore':
      return json({ started: true });
    default:
      return json({ error: 'There is nothing at that address.' }, 404);
  }
}
