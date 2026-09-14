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

/**
 * The eight songs every play fixture cycles through.
 *
 * The identifiers are invented, but they are the right SHAPE — `mbid:<uuid>`
 * URIs, twelve-character ISRCs, numeric Apple ids — because the code that reads
 * them parses rather than prints. `albumArt.js` pulls the song id out of the
 * `?i=` param and takes it only if it is all digits, and keys its cache off an
 * uppercased ISRC. A fixture that said "isrc-1" would walk a path no real
 * record walks.
 */
const TRACKS = [
  {
    artist: 'Grouper', track: 'Made of Air', release: 'Dragging a Dead Deer Up a Hill',
    artistMbId: 'mbid:9d1d3b4a-7c51-4f0e-8a62-3f7c1de55b90',
    trackMbId: 'mbid:1c7f20ea-45b8-4d93-a016-58e2bd4c7fa3',
    isrc: 'USZZZ0812001', albumId: '268412901', songId: '268412907',
  },
  {
    artist: 'Duster', track: 'Constellations', release: 'Stratosphere',
    artistMbId: 'mbid:2f6a08c3-51ba-4d77-9b0e-c4a2e6f31d85',
    trackMbId: 'mbid:7ae91d36-0b52-4c87-95da-e3f608b1247c',
    isrc: 'USZZZ9812002', albumId: '271003418', songId: '271003422',
  },
  {
    artist: 'Low', track: 'Words', release: 'I Could Live in Hope',
    artistMbId: 'mbid:b7e4c209-3a68-4e15-8d3f-9c05a7b21e44',
    trackMbId: 'mbid:33c80f5d-6e19-4ba2-871c-04d9a5e6238b',
    isrc: 'USZZZ9411003', albumId: '158772630', songId: '158772634',
  },
  {
    artist: 'Slowdive', track: 'Alison', release: 'Souvlaki',
    artistMbId: 'mbid:6c33f81e-9d24-4a70-b5e8-1f9a2c47d063',
    trackMbId: 'mbid:a90b7e42-c58d-4136-b2ef-71d0463c98a5',
    isrc: 'GBZZZ9312004', albumId: '724489301', songId: '724489305',
  },
  {
    artist: 'Bark Psychosis', track: 'Big Shot', release: 'Hex',
    artistMbId: 'mbid:0a5e7d16-84bc-4392-a7f1-6b28e9c04f57',
    trackMbId: 'mbid:5d2c68b1-93f4-40ae-8c67-b1e5730da29f',
    isrc: 'GBZZZ9402005', albumId: '318905227', songId: '318905231',
  },
  {
    artist: 'Talk Talk', track: 'New Grass', release: 'Laughing Stock',
    artistMbId: 'mbid:e812b64f-2c09-4d8a-93b7-5a0fd1e78c26',
    trackMbId: 'mbid:c46e0197-2ab3-4f58-9d10-6825eb7c3401',
    isrc: 'GBZZZ9109006', albumId: '425617840', songId: '425617849',
  },
  {
    artist: 'Codeine', track: 'Pickup Song', release: 'The White Birch',
    artistMbId: 'mbid:4fb0a923-6e57-41cd-82a4-7d3c8be15092',
    trackMbId: 'mbid:8b15da70-e6c2-4d39-af84-2079c3be6154',
    isrc: 'USZZZ9405007', albumId: '193344062', songId: '193344068',
  },
  {
    artist: 'Bedhead', track: 'Bedside Table', release: 'Transaction de Novo',
    artistMbId: 'mbid:d370c5e8-1a4f-48b6-9e02-c85b7a3f2916',
    trackMbId: 'mbid:2e9047fc-b381-45d6-90a7-c6f218e5347d',
    isrc: 'USZZZ9803008', albumId: '206718553', songId: '206718557',
  },
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

  /* Listening — teal.fm plays. The big one: paging + bulk delete.

     Spread across BOTH play lexicons, because the archive on the real PDS is:
     teal.fm left `fm.teal.alpha.*` for production `fm.teal.*` in August 2026,
     and the listening surfaces are built to read the two as one. A fixture in
     a single namespace can't reach any of that —

       - the studio keeps one cursor PER NSID and only stops offering "Load
         more" once both are exhausted;
       - `dedupePlaysByRkey` is a no-op until an rkey turns up twice;
       - `playArtistNames` and `playOriginUrl` branch on which spelling a record
         uses, and a fixture that only ever writes one spelling only ever
         exercises one branch.

     This used to be 240 alpha records carrying `artistNames` and no origin URL
     at all — the one shape no scrobbler has written since 11 August. So: the
     newest 180 are production, the oldest 54 are the frozen alpha archive, and
     6 sit in the cutover window written to both lexicons under the same rkey.
     240 distinct plays, 246 records.

     Two of every eight production plays carry no `originUri` — that is not
     sloppiness, it is what multi-scrobbler on Spotify actually writes, and it
     is the only way the "we have no link to the exact track" path in
     `musicLinks.js` gets walked. Where an origin IS present it is an Apple
     Music URL with a `?i=` song id, so the direct-link and album-art paths get
     walked too. */
  const PLAY_COUNT = 240;
  const ALPHA_FROM = 180; // first index that predates the move
  const OVERLAP = 6; // dual-written across the cutover, same rkey either side

  const plays = Array.from({ length: PLAY_COUNT }, (_, i) => {
    const song = TRACKS[i % TRACKS.length];
    return {
      ...song,
      rkey: tid(),
      duration: 180 + ((i * 37) % 240),
      playedTime: ago(134 + i * 41),
      originUri: `https://music.apple.com/us/album/${slugify(song.release)}/${song.albumId}?i=${song.songId}`,
      // The scrobbler that reports no origin. Also the one that sends trackMbId.
      originless: i % 8 === 3 || i % 8 === 6,
    };
  });

  put(
    'fm.teal.feed.play',
    plays.slice(0, ALPHA_FROM + OVERLAP).map((p) =>
      rec(
        'fm.teal.feed.play',
        {
          $type: 'fm.teal.feed.play',
          trackName: p.track,
          artists: [{ artistName: p.artist, artistMbId: p.artistMbId }],
          releaseName: p.release,
          duration: p.duration,
          isrc: p.isrc,
          playedTime: p.playedTime,
          ...(p.originless
            ? { trackMbId: p.trackMbId }
            : { originUri: p.originUri, musicServiceUri: 'https://music.apple.com' }),
          submissionClientAgent: p.originless
            ? 'multi-scrobbler/0.17.2'
            : 'piper/v0.0.14',
        },
        p.rkey,
      ),
    ),
  );

  put(
    'fm.teal.alpha.feed.play',
    plays.slice(ALPHA_FROM).map((p) =>
      rec(
        'fm.teal.alpha.feed.play',
        {
          $type: 'fm.teal.alpha.feed.play',
          trackName: p.track,
          // The pre-move archive is a genuine mix: the deprecated `artistNames`
          // string[] on the oldest records, `artists` objects on the newer ones.
          ...(p.duration % 2
            ? { artistNames: [p.artist] }
            : { artists: [{ artistName: p.artist, artistMbId: p.artistMbId }] }),
          releaseName: p.release,
          duration: p.duration,
          isrc: p.isrc,
          playedTime: p.playedTime,
          // Alpha spellings: `originUrl`, and a bare host rather than a URI.
          originUrl: p.originUri,
          musicServiceBaseDomain: 'music.apple.com',
          submissionClientAgent: 'rocksky/1.0',
        },
        p.rkey,
      ),
    ),
  );

  /* Curating — is.dame.arena.channel.
     The field names are the lexicon's, not near-misses: the editor renders from
     the lexicon, so a fixture that says `slug`/`channel` opens every channel
     with a blank "Are.na channel slug" — and the two pickers that key off it
     (cover, pins) with nothing to show. `blockOrder` and `pinnedBlockIds` vary
     across the six so the layout controls have something to be. */
  put(
    COLLECTIONS.arenaChannel,
    [
      ['soft-architecture', 'Soft architecture', true, 'newest', [4821, 3390]],
      ['field-notes', 'Field notes', true, undefined, undefined],
      ['type-specimens', 'Type specimens', true, 'oldest', undefined],
      ['moth-reference', 'Moth reference', true, 'random', [7714]],
      ['abandoned-uis', 'Abandoned UIs', false, undefined, undefined],
      ['colour-studies', 'Colour studies', true, 'curated', undefined],
    ].map(([slug, title, enabled, blockOrder, pinnedBlockIds], i) =>
      rec(
        COLLECTIONS.arenaChannel,
        {
          $type: COLLECTIONS.arenaChannel,
          arenaSlug: slug,
          title,
          enabled,
          ...(blockOrder ? { blockOrder } : {}),
          ...(pinnedBlockIds ? { pinnedBlockIds } : {}),
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

  /* Profile (rkey "self").
   *
   * Field names follow `is.dame.profile` as the lexicon defines it. They did
   * not before — this record carried `displayName`, `bio`, `pronouns` and
   * `location`, none of which the lexicon or /themself has ever read — so the
   * About surface fixtured as a form with every field blank. */
  put(COLLECTIONS.profile, [
    rec(
      COLLECTIONS.profile,
      {
        $type: COLLECTIONS.profile,
        tagline: 'Keeping a website like a garden.',
        showAvatar: true,
        showIdentity: true,
        showBlueskyBio: false,
        photoLayout: 'three-up',
        links: [
          { label: 'are.na', url: 'https://are.na/dame' },
          { label: 'anisota', url: 'https://anisota.net' },
        ],
        body: 'Moths, records, and small tools. The long version lives here; the short one is on Bluesky.',
        bodyFormat: 'markdown',
        createdAt: ago(90000),
        updatedAt: ago(3000),
      },
      'self',
    ),
  ]);

  /* Resume versions + canonical jobs and education.
   *
   * These follow `is.dame.resume` / `is.dame.resume.job` as the LEXICON defines
   * them (src/lib/lexicons.js), which an earlier version of this file did not:
   * versions carried `name` where the lexicon says `title`, and jobs carried
   * `bullets` where it says `highlights`. Neither is a field the app reads, so
   * every fixture version rendered as "Untitled version" and every job as "0
   * bullets" — the résumé studio and the whole tailoring workbench, which is the
   * one surface in the admin built entirely around bullets, could not be looked
   * at in the harness at all. Nothing was wrong with the code; the fixtures were
   * describing a different schema.
   */
  const resumeJobs = [
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
      current: !end,
      // `highlights`, the lexicon's name, and shaped the way `resumeHelpers.js`
      // resolves them: an `id` per bullet, plus one alternate phrasing so the
      // workbench's "reword" control has something real to switch between.
      highlights: [
        {
          id: `h${i}a`,
          text: 'Rebuilt the internal tooling around a single durable data model.',
          variants: [
            { id: 'short', text: 'Rebuilt internal tooling on one durable data model.' },
          ],
        },
        { id: `h${i}b`, text: 'Cut the design system down to what was actually used.' },
        { id: `h${i}c`, text: 'Wrote the migration that moved six years of posts onto the PDS.' },
      ],
      createdAt: ago(80000 + i * 500),
    }),
  );
  put(COLLECTIONS.resumeJob, resumeJobs);
  put(COLLECTIONS.resume, [
    rec(COLLECTIONS.resume, {
      $type: COLLECTIONS.resume,
      title: 'Studio lead',
      slug: 'studio-lead',
      headline: 'Design lead, small durable tools',
      visibility: 'public',
      featured: true,
      summary: 'Design lead with a long tail of small, durable tools.',
      // Every job, no explicit highlight selection: "all non-private", which is
      // the state a freshly tailored version starts in.
      entries: resumeJobs.map((r) => ({ job: r.uri })),
      createdAt: ago(60000),
      updatedAt: ago(11000),
    }),
    rec(COLLECTIONS.resume, {
      $type: COLLECTIONS.resume,
      title: 'Engineering',
      slug: 'engineering',
      visibility: 'unlisted',
      summary: 'Front-end heavy, protocol-curious.',
      // A tailored version: two of the three jobs, and the first of those
      // showing two of its three bullets with one of them reworded. This is the
      // state the bullet board exists to edit, so it needs to exist in fixtures.
      entries: [
        { job: resumeJobs[0].uri, highlightIds: ['h0a#short', 'h0c'] },
        { job: resumeJobs[1].uri },
      ],
      createdAt: ago(70000),
      updatedAt: ago(30000),
    }),
    rec(COLLECTIONS.resume, {
      $type: COLLECTIONS.resume,
      title: 'Archive 2024',
      slug: 'archive-2024',
      visibility: 'private',
      summary: 'Kept for reference.',
      createdAt: ago(200000),
      updatedAt: ago(190000),
    }),
  ]);
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

  /* Ratioed pieces.
   *
   * `take`, `postedAt` and `lifespanMs` are the lexicon's own field names
   * (is.dame.creating.ratioed.piece). An earlier version of this block wrote
   * `index`, `createdAt` and `reactionMs`, none of which the catalogue reads —
   * so all eight cards rendered as take "00" with no lifespan, and the one
   * surface whose whole job is per-piece measurement showed the same
   * unmeasurable card eight times over. */
  put(
    COLLECTIONS.ratioedPiece,
    Array.from({ length: 8 }, (_, i) => {
      const running = i === 0;
      return rec(COLLECTIONS.ratioedPiece, {
        $type: COLLECTIONS.ratioedPiece,
        take: 8 - i,
        subject: `at://${ME_DID}/app.bsky.feed.post/${tid()}`,
        postedAt: ago(running ? 4320 : 5000 + i * 4000),
        sealed: !running,
        sealedAt: running ? undefined : ago(1200 + i * 4000),
        lifespanMs: running ? undefined : 2_460_000 + i * 130_000,
        createdAt: ago(running ? 4320 : 5000 + i * 4000),
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
