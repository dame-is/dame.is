// Deterministic fixture repo for the admin harness.
//
// Builds an in-memory stand-in for the owner's PDS: realistic records across
// every collection the admin touches, enough of them that lists, filters,
// paging and counts all have something to chew on. Deterministic (seeded, with
// a fixed "now") so two harness runs screenshot identically.
//
// Nothing here ships — see harness/README.md.

import { COLLECTIONS, ME_DID, BLOG_PUBLICATION, PORTFOLIO_PUBLICATION } from '../src/config.js';

/** Fixed clock so timestamps — and therefore sort order — never drift. */
export const NOW = new Date('2026-04-02T16:04:00.000Z');

/** Mulberry32: tiny seeded PRNG, so the fixtures are the same every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20260402);

/** An ISO timestamp `minutes` before NOW. */
function ago(minutes) {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

/**
 * A plausible TID-shaped rkey. Real TIDs sort lexically by creation time, and
 * several admin surfaces lean on that, so these are generated in descending
 * order from a base and stay sortable.
 */
let tidCursor = 0;
function tid() {
  const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
  const n = 999_999_999 - tidCursor++ * 977;
  let out = '';
  let v = n;
  for (let i = 0; i < 8; i++) {
    out = alphabet[v % 32] + out;
    v = Math.floor(v / 32);
  }
  return `3l${out}${alphabet[Math.floor(rand() * 32)]}${alphabet[Math.floor(rand() * 32)]}`;
}

function uri(collection, rkey) {
  return `at://${ME_DID}/${collection}/${rkey}`;
}

let cidCursor = 0;
function cid() {
  return `bafyrei${String(cidCursor++).padStart(6, '0')}fixturecidnotreal`;
}

/** Wrap a value into the `{ uri, cid, value }` shape listRecords returns. */
function rec(collection, value, rkey = tid()) {
  return { uri: uri(collection, rkey), cid: cid(), value };
}

/* ------------------------------------------------------------------ */
/* Source text                                                         */
/* ------------------------------------------------------------------ */

const BLOG_TITLES = [
  'On keeping a website like a garden',
  'Notes toward a smaller feed',
  'What the PDS actually stores',
  'Leaving the timeline',
  'An hourly sky, in CSS',
  'Guestbooks are backlinks',
  'Every play, kept',
  'A resume that forks itself',
  'Small tools, kept sharp',
  'Backlinks all the way down',
  'What a year of statuses looks like',
  'The shape of a personal archive',
  'Reading the repo directly',
  'Against the dashboard',
  'Lexicons as a design material',
  'A site that knows what hour it is',
  'Slow software for one person',
  'What I stopped syncing',
  'Notes on record editing',
  'The cost of a good back button',
];

const WORK_TITLES = [
  'Ratioed, one year in',
  'Inkblot series, plates 1–9',
  'The moth pages, explained',
  'Sigils for a small web',
  'Carving: a typeface diary',
  'Petri, an ambient generator',
  'Redaction studies',
  'Synth sketches, winter',
];

const BODY = [
  'A website you tend is a different object from a website you launch. The launched one has a date on it; the tended one has a season.',
  'The nice thing about putting it all on a PDS is that the garden is portable. Nothing here is a post in a product; it is a record in a repo I hold the keys to.',
  'Which changes what maintenance means. There is no launch to work toward and no relaunch to dread, only the ordinary weekly business of pulling something out and putting something in.',
];

const STATUSES = [
  'rebuilding the admin, again',
  'mothing at the porch light',
  'reading about lexicons',
  'walking the creek',
  'editing the resume down',
  'listening to the same record',
  'tuning hour 19',
  'writing a very long footnote',
  'sorting photographs',
  'not answering email',
];

const POSTS = [
  'the sky theme now knows about civil twilight',
  'every play I have ever logged is on my own server, which is a strange sentence to be able to write',
  'spent the morning making a list scroll correctly',
  'a guestbook is just backlinks with manners',
  'small sites, long memories',
  'the admin is the part of a site nobody sees and everybody feels',
];

const TRACKS = [
  ['Grouper', 'Made of Air', 'Dragging a Dead Deer Up a Hill'],
  ['Duster', 'Constellations', 'Stratosphere'],
  ['Low', 'Words', 'I Could Live in Hope'],
  ['Slowdive', 'Alison', 'Souvlaki'],
  ['Bark Psychosis', 'Big Shot', 'Hex'],
  ['Talk Talk', 'New Grass', 'Laughing Stock'],
  ['Codeine', 'Pickup Song', 'The White Birch'],
  ['Bedhead', 'Bedside Table', 'Transaction de Novo'],
];

const SIGNERS = [
  ['ewan.bsky.social', 'found you through the moth pages'],
  ['tris.bsky.social', 'the sky thing is very good'],
  ['nima.bsky.social', 'hello from a fellow PDS gardener'],
  ['orla.bsky.social', 'came for ratioed, stayed for the ledger'],
  ['rhys.bsky.social', 'your resume forking idea stole a whole afternoon from me'],
  ['sena.bsky.social', 'signed'],
  ['juno.bsky.social', 'the hourly palette is the best thing on the web right now'],
];

const HERO_PHRASES = [
  'is quietly indexing the moths',
  'is keeping the lights on',
  'is reading the repo directly',
  'is between deployments',
  'is making a list scroll correctly',
  'is out at the porch light',
  'is tending, not shipping',
];

/** A pub.leaflet.content body with `paras` text blocks. */
function leafletBody(paras) {
  return {
    $type: 'pub.leaflet.content',
    pages: [
      {
        $type: 'pub.leaflet.pages.linearDocument',
        blocks: paras.map((p) => ({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: { $type: 'pub.leaflet.blocks.text', plaintext: p, facets: [] },
        })),
      },
    ],
  };
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/* ------------------------------------------------------------------ */
/* The repo                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build the fixture repo: `{ [collection]: Array<{uri, cid, value}> }`, each
 * collection newest-first, matching what listRecords returns with the default
 * reverse ordering.
 */
export function buildRepo() {
  const repo = {};
  const put = (collection, values) => {
    repo[collection] = values;
  };

  /* Blog documents + creative works, both site.standard.document. */
  const docs = [];
  BLOG_TITLES.forEach((title, i) => {
    const draft = i === 1 || i === 8 || i === 15;
    const value = {
      $type: 'site.standard.document',
      title,
      description:
        i === 0
          ? 'Tending, not shipping — what changes when the site is never finished.'
          : `A short note about ${title.toLowerCase()}.`,
      path: `/${slugify(title)}`,
      site: BLOG_PUBLICATION,
      content: leafletBody(BODY.slice(0, 2 + (i % 2))),
      createdAt: ago(i * 1440 + 120),
      updatedAt: ago(i === 0 ? 240 : i * 1440),
    };
    if (draft) value.draft = true;
    docs.push(rec('site.standard.document', value));
  });
  WORK_TITLES.forEach((title, i) => {
    docs.push(
      rec('site.standard.document', {
        $type: 'site.standard.document',
        title,
        description: `Portfolio piece — ${title.toLowerCase()}.`,
        path: `/${slugify(title)}`,
        site: PORTFOLIO_PUBLICATION,
        content: leafletBody(BODY.slice(0, 2)),
        createdAt: ago(i * 2880 + 4000),
        updatedAt: ago(i * 2880 + 3600),
      }),
    );
  });
  put('site.standard.document', docs);

  /* Logging — is.dame.now */
  put(
    COLLECTIONS.now,
    Array.from({ length: 42 }, (_, i) =>
      rec(COLLECTIONS.now, {
        $type: COLLECTIONS.now,
        status: STATUSES[i % STATUSES.length],
        createdAt: ago(102 + i * 380),
        updatedAt: ago(102 + i * 380),
      }),
    ),
  );

  /* Posting — app.bsky.feed.post */
  put(
    'app.bsky.feed.post',
    Array.from({ length: 60 }, (_, i) =>
      rec('app.bsky.feed.post', {
        $type: 'app.bsky.feed.post',
        text: POSTS[i % POSTS.length],
        langs: ['en'],
        createdAt: ago(297 + i * 610),
      }),
    ),
  );

  /* Listening — fm.teal.alpha.feed.play. The big one: paging + bulk delete. */
  put(
    'fm.teal.alpha.feed.play',
    Array.from({ length: 240 }, (_, i) => {
      const [artist, track, release] = TRACKS[i % TRACKS.length];
      return rec('fm.teal.alpha.feed.play', {
        $type: 'fm.teal.alpha.feed.play',
        trackName: track,
        artistNames: [artist],
        releaseName: release,
        duration: 180 + ((i * 37) % 240),
        playedTime: ago(134 + i * 41),
        submissionClientAgent: 'rocksky/1.0',
      });
    }),
  );

  /* Curating — is.dame.arena.channel */
  put(
    COLLECTIONS.arenaChannel,
    [
      ['soft-architecture', 'Soft architecture', true],
      ['field-notes', 'Field notes', true],
      ['type-specimens', 'Type specimens', true],
      ['moth-reference', 'Moth reference', true],
      ['abandoned-uis', 'Abandoned UIs', false],
      ['colour-studies', 'Colour studies', true],
    ].map(([slug, title, enabled], i) =>
      rec(
        COLLECTIONS.arenaChannel,
        {
          $type: COLLECTIONS.arenaChannel,
          slug,
          title,
          channel: slug,
          enabled,
          createdAt: ago(9000 + i * 2000),
          updatedAt: ago(700 + i * 2000),
        },
        slug,
      ),
    ),
  );

  /* Site pages — is.dame.page, keyed by slug */
  put(
    COLLECTIONS.page,
    [
      ['welcoming', 'Welcoming', 'Sign the guestbook. Your signature lives on your own PDS.'],
      ['blogging', 'Blogging', 'Long-form writing, published straight from the repo.'],
      ['creating', 'Creating', 'Things made, mostly slowly.'],
      ['listening', 'Listening', 'Every play, kept.'],
      ['mothing', 'Mothing', 'Observations from the porch light.'],
      ['curating', 'Curating', 'Channels worth keeping.'],
      ['available', 'Available', 'What I can be hired to do.'],
      ['themself', 'Themself', 'The long version.'],
    ].map(([slug, title, intro], i) =>
      rec(
        COLLECTIONS.page,
        {
          $type: COLLECTIONS.page,
          title,
          intro,
          createdAt: ago(40000 + i * 900),
          updatedAt: ago(1500 + i * 900),
        },
        slug,
      ),
    ),
  );

  /* Guestbook entries — signed by other people, mirrored via backlinks. */
  put(
    'is.dame.guestbook.entry',
    SIGNERS.flatMap(([handle, text], i) => {
      const entries = [
        rec('is.dame.guestbook.entry', {
          $type: 'is.dame.guestbook.entry',
          subject: `at://${ME_DID}/is.dame.guestbook/self`,
          text,
          handle,
          createdAt: ago(360 + i * 2200),
        }),
      ];
      if (i === 1) entries[0].value.hidden = true;
      return entries;
    }),
  );

  /* Hero phrases */
  put(
    COLLECTIONS.heroPhrase,
    HERO_PHRASES.map((text, i) =>
      rec(COLLECTIONS.heroPhrase, {
        $type: COLLECTIONS.heroPhrase,
        text,
        enabled: i !== 3,
        createdAt: ago(20000 + i * 1200),
      }),
    ),
  );

  /* Publications */
  put('site.standard.publication', [
    rec(
      'site.standard.publication',
      {
        $type: 'site.standard.publication',
        name: 'dame is blogging',
        description: 'Long-form writing from dame.is.',
        base_path: '/blogging',
        icon: undefined,
        theme: { backgroundColor: '#f1ead4', accentColor: '#5e7a47' },
      },
      BLOG_PUBLICATION.split('/').pop(),
    ),
    rec(
      'site.standard.publication',
      {
        $type: 'site.standard.publication',
        name: 'dame is creating',
        description: 'Work made at dame.is.',
        base_path: '/creating',
        theme: { backgroundColor: '#f1ead4', accentColor: '#a88c5f' },
      },
      PORTFOLIO_PUBLICATION.split('/').pop(),
    ),
  ]);

  /* Profile (rkey "self") */
  put(COLLECTIONS.profile, [
    rec(
      COLLECTIONS.profile,
      {
        $type: COLLECTIONS.profile,
        displayName: 'dame',
        bio: 'Keeping a website like a garden. Moths, records, and small tools.',
        pronouns: 'they/them',
        location: 'North Carolina',
        createdAt: ago(90000),
        updatedAt: ago(3000),
      },
      'self',
    ),
  ]);

  /* Resume versions + canonical jobs and education */
  put(COLLECTIONS.resume, [
    rec(COLLECTIONS.resume, {
      $type: COLLECTIONS.resume,
      name: 'studio-lead',
      visibility: 'public',
      summary: 'Design lead with a long tail of small, durable tools.',
      createdAt: ago(60000),
      updatedAt: ago(11000),
    }),
    rec(COLLECTIONS.resume, {
      $type: COLLECTIONS.resume,
      name: 'engineering',
      visibility: 'unlisted',
      summary: 'Front-end heavy, protocol-curious.',
      createdAt: ago(70000),
      updatedAt: ago(30000),
    }),
    rec(COLLECTIONS.resume, {
      $type: COLLECTIONS.resume,
      name: 'archive-2024',
      visibility: 'private',
      summary: 'Kept for reference.',
      createdAt: ago(200000),
      updatedAt: ago(190000),
    }),
  ]);
  put(
    COLLECTIONS.resumeJob,
    [
      ['Design lead', 'Anisota', '2023', ''],
      ['Senior designer', 'Field & Rule', '2020', '2023'],
      ['Designer', 'Marginalia Co.', '2017', '2020'],
    ].map(([title, org, start, end], i) =>
      rec(COLLECTIONS.resumeJob, {
        $type: COLLECTIONS.resumeJob,
        title,
        organization: org,
        startDate: `${start}-01`,
        endDate: end ? `${end}-01` : undefined,
        bullets: [
          'Rebuilt the internal tooling around a single durable data model.',
          'Cut the design system down to what was actually used.',
        ],
        createdAt: ago(80000 + i * 500),
      }),
    ),
  );
  put(COLLECTIONS.resumeEducation, [
    rec(COLLECTIONS.resumeEducation, {
      $type: COLLECTIONS.resumeEducation,
      institution: 'University of North Carolina',
      credential: 'BA, Studio Art',
      startDate: '2011-08',
      endDate: '2015-05',
      createdAt: ago(120000),
    }),
  ]);

  /* Ratioed pieces */
  put(
    COLLECTIONS.ratioedPiece,
    Array.from({ length: 8 }, (_, i) => {
      const running = i === 0;
      return rec(COLLECTIONS.ratioedPiece, {
        $type: COLLECTIONS.ratioedPiece,
        index: 8 - i,
        subject: `at://${ME_DID}/app.bsky.feed.post/${tid()}`,
        sealed: !running,
        sealedAt: running ? undefined : ago(1200 + i * 4000),
        reactionMs: running ? undefined : 2_460_000 + i * 130_000,
        createdAt: ago(running ? 4320 : 1500 + i * 4000),
      });
    }),
  );

  /* Nav override + sky tuning, both singletons at rkey "self" */
  put(COLLECTIONS.nav, [
    rec(
      COLLECTIONS.nav,
      {
        $type: COLLECTIONS.nav,
        enabled: true,
        routes: [
          { to: '/', label: 'home' },
          { to: '/blogging', label: 'blogging' },
          { to: '/creating', label: 'creating' },
          { to: '/listening', label: 'listening' },
          { to: '/welcoming', label: 'welcoming' },
        ],
        updatedAt: ago(5200),
      },
      'self',
    ),
  ]);
  put(COLLECTIONS.sky, [
    rec(
      COLLECTIONS.sky,
      {
        $type: COLLECTIONS.sky,
        hours: Object.fromEntries(
          Array.from({ length: 19 }, (_, h) => [
            String(h + 5),
            { page: '#f1ead4', ink: '#1d2419', accent: '#5e7a47' },
          ]),
        ),
        updatedAt: ago(8600),
      },
      'self',
    ),
  ]);

  return repo;
}
