import { describe, it, expect } from 'vitest';
import {
  anchorsFromTemplate,
  isPiecePost,
  isSealed,
  takeFromText,
  breakerFromAnnouncement,
  isAnnouncement,
  findPieces,
  measureWindows,
  buildEventLog,
  buildPieceRecord,
} from './ratioedDiscovery.js';
import { tidToTimestamp } from './atproto.js';

const PIECE_TEXT =
  'i would like your help with an experimental social art project\n\nthis post is the project\n\n' +
  'the goal of this post is for it to receive ZERO likes, and only receive *replies* or *reposts*\n\n' +
  'if it receives any likes, i will immediately turn off replies, thereby sealing and finishing it\n\n' +
  'this is take #4';

describe('isPiecePost', () => {
  it('matches the wording takes #1 to #10 used', () => {
    expect(isPiecePost({ text: PIECE_TEXT })).toBe(true);
  });

  it('also matches take #11, which reworded everything else', () => {
    expect(
      isPiecePost({
        text:
          'i would like your help with an experimental social art project\n\nthis post is the project\n\n' +
          'the goal of this post is for it to receive ZERO likes… only replies, reposts, or quotes allowed\n\n' +
          'this is take #11',
      }),
    ).toBe(true);
  });

  it('matches take #13, which dropped "experimental" and broke the exact-phrase test', () => {
    expect(
      isPiecePost({
        text:
          'i would like your help with a social art project\n\nthis post is the project\n\n' +
          'the goal of this post is for it to receive ZERO likes… only replies, reposts, or quotes allowed\n\n' +
          'once it is liked, replies are immediately disabled, thereby sealing & finishing it\n\n' +
          'this is take #13',
      }),
    ).toBe(true);
  });

  it('matches on either marker alone, in case the other is the one that drifts', () => {
    expect(isPiecePost({ text: 'help me with a social art project' })).toBe(true);
    expect(isPiecePost({ text: 'this post is the project' })).toBe(true);
  });

  it('ignores unrelated posts and non-posts', () => {
    expect(isPiecePost({ text: 'just had a sandwich' })).toBe(false);
    expect(isPiecePost(null)).toBe(false);
    expect(isPiecePost({})).toBe(false);
  });

  it('ignores the concluding announcement, which talks about a piece without being one', () => {
    expect(
      isPiecePost({
        text:
          'thank you for your participation, this piece has now concluded, @satyrs.eu was to blame ' +
          'for liking the post\n\nat the time of this piece’s completion, it had zero engagement',
      }),
    ).toBe(false);
  });

  // Take #13's failure, generalised: the copy is rewritten so thoroughly that
  // nothing this file was taught to look for survives. The template is the one
  // description of a piece that is always current, so hand it over and the
  // wording needs no teaching.
  it('matches a wording it has never seen, given the template it came from', () => {
    const template = [
      'a collaborative exercise in restraint',
      '',
      'please do not press the heart',
      '',
      'this is take #{take}',
    ].join('\n');
    const post = { text: template.replace('{take}', '14') };
    expect(isPiecePost(post)).toBe(false);
    expect(isPiecePost(post, anchorsFromTemplate(template))).toBe(true);
  });

  // The case the anchors can't cover: a piece posted from one wording, scanned
  // after the template moved on to another. The take line and the piece's own
  // link are all that's left, and a valid template cannot drop either.
  it('matches on the take line and the link with no template to hand', () => {
    expect(
      isPiecePost({
        text:
          'a collaborative exercise in restraint\n\nthis is take #14\n\ndame.is/creating/ratioed/14',
      }),
    ).toBe(true);
  });

  it('does not take the take line alone as a piece', () => {
    expect(isPiecePost({ text: 'this is take #14 of my sandwich series' })).toBe(false);
  });
});

describe('anchorsFromTemplate', () => {
  const TEMPLATE = [
    'i would like your help with a social art project',
    '',
    'this post is the project',
    '',
    'this is take #{take}',
    '',
    '{link}',
  ].join('\n');

  it('keeps the lines every piece carries verbatim', () => {
    expect(anchorsFromTemplate(TEMPLATE)).toEqual([
      'i would like your help with a social art project',
      'this post is the project',
    ]);
  });

  it('drops what the placeholders leave behind, since it differs per piece', () => {
    expect(anchorsFromTemplate(TEMPLATE).some((a) => a.includes('take'))).toBe(false);
  });

  it('keeps the fixed part of a line that also carries a placeholder', () => {
    expect(anchorsFromTemplate('the piece you are looking at is take #{take}')).toEqual([
      'the piece you are looking at is take #',
    ]);
  });

  it('ignores lines too short to be evidence of anything', () => {
    expect(anchorsFromTemplate('hello\n\nbye\n\n{link}')).toEqual([]);
  });

  it('is unbothered by a template that is empty or absent', () => {
    expect(anchorsFromTemplate('')).toEqual([]);
    expect(anchorsFromTemplate(null)).toEqual([]);
  });
});

describe('isSealed', () => {
  it('only an empty allow list is a seal', () => {
    expect(isSealed({ allow: [] })).toBe(true);
    // The meta post carries a real threadgate; it is not a sealed piece.
    expect(isSealed({ allow: [{ $type: 'app.bsky.feed.threadgate#followingRule' }] })).toBe(false);
    // No `allow` at all means "everyone can reply" — also not a seal.
    expect(isSealed({})).toBe(false);
    expect(isSealed(null)).toBe(false);
  });
});

describe('takeFromText', () => {
  it('reads the take number', () => {
    expect(takeFromText(PIECE_TEXT)).toBe(4);
    expect(takeFromText('this is take #11')).toBe(11);
    expect(takeFromText('this is take 12')).toBe(12);
  });

  it('returns null when the post does not say', () => {
    expect(takeFromText('no number here')).toBeNull();
    expect(takeFromText('')).toBeNull();
  });
});

describe('breakerFromAnnouncement', () => {
  // These are the real announcement strings from the first eleven pieces.
  it('reads a plain handle', () => {
    expect(
      breakerFromAnnouncement(
        'thank you for your participation, this piece has now concluded, @round.is was to blame for liking the post',
      ),
    ).toEqual({ handle: 'round.is' });
  });

  it('reads the handle + did form used for take #8', () => {
    expect(
      breakerFromAnnouncement(
        'thank you for your participation, this piece has now concluded, ' +
          '@bolsonarosex.myatproto.social / did:plc:pe7ti3wxckxccbq5udlayg4m was to blame for liking the post',
      ),
    ).toEqual({
      handle: 'bolsonarosex.myatproto.social',
      did: 'did:plc:pe7ti3wxckxccbq5udlayg4m',
    });
  });

  it('handles hyphenated handles', () => {
    expect(breakerFromAnnouncement('@g-sharp-major.bsky.social was to blame')).toEqual({
      handle: 'g-sharp-major.bsky.social',
    });
  });

  it('returns null for anything else', () => {
    expect(breakerFromAnnouncement('at the time of this piece’s completion')).toBeNull();
    expect(breakerFromAnnouncement('')).toBeNull();
  });

  it('isAnnouncement agrees with it', () => {
    expect(isAnnouncement({ text: '@round.is was to blame for liking the post' })).toBe(true);
    expect(isAnnouncement({ text: '0 replies\n0 reposts' })).toBe(false);
  });
});

describe('findPieces', () => {
  const DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
  const uri = (rkey) => `at://${DID}/app.bsky.feed.post/${rkey}`;
  const gateUri = (rkey) => `at://${DID}/app.bsky.feed.threadgate/${rkey}`;
  // Take #4's real keys and times.
  const posts = [
    { uri: uri('3lrqlgyvftk27'), value: { text: PIECE_TEXT } },
    { uri: uri('3lrq5r2ouw22b'), value: { text: 'this is take #1 experimental social art project' } },
    { uri: uri('3mrln4zidxs2e'), value: { text: 'for the newcomers, this project is called Ratioed' } },
  ];
  const gates = [
    { uri: gateUri('3lrqlgyvftk27'), value: { allow: [], createdAt: '2025-06-16T18:42:46.543Z' } },
    { uri: gateUri('3lrq5r2ouw22b'), value: { allow: [], createdAt: '2025-06-16T14:09:16.528Z' } },
  ];

  it('finds sealed pieces and orders them oldest first', () => {
    const found = findPieces(posts, gates);
    expect(found.map((p) => p.take)).toEqual([1, 4]);
  });

  it('derives the lifespan from the post TID and the gate', () => {
    const four = findPieces(posts, gates).find((p) => p.take === 4);
    expect(four.lifespanMs).toBe(1763889);
    expect(four.postedAt).toBe('2025-06-16T18:13:22.654Z');
  });

  it('skips a piece-shaped post with no seal', () => {
    expect(findPieces(posts, [gates[0]]).map((p) => p.take)).toEqual([4]);
  });

  it('finds a piece written from a reworded template, given that template', () => {
    const template = 'a collaborative exercise in restraint\n\nthis is take #{take}';
    const reworded = [
      {
        uri: uri('3lrqm2vlfmk2v'),
        value: { text: 'a collaborative exercise in restraint\n\nthis is take #5' },
      },
    ];
    const gate = [
      { uri: gateUri('3lrqm2vlfmk2v'), value: { allow: [], createdAt: '2025-06-16T18:42:46.543Z' } },
    ];
    expect(findPieces(reworded, gate).map((p) => p.take)).toEqual([]);
    expect(
      findPieces(reworded, gate, new Set(), anchorsFromTemplate(template)).map((p) => p.take),
    ).toEqual([5]);
  });

  it('skips the meta post, which quotes a piece but is not one', () => {
    const found = findPieces(posts, gates);
    expect(found.some((p) => p.rkey === '3mrln4zidxs2e')).toBe(false);
  });

  it('marks pieces that already have a record', () => {
    const found = findPieces(posts, gates, new Set(['3lrq5r2ouw22b']));
    expect(found.find((p) => p.take === 1).known).toBe(true);
    expect(found.find((p) => p.take === 4).known).toBe(false);
  });
});

describe('measureWindows', () => {
  const SELF = 'did:plc:self';
  // 3lrq5r2ouw22b is take #1's post key: 2025-06-16T14:08:27.696Z.
  const SEAL = Date.parse('2025-06-16T14:09:16.528Z');
  // A like written at 14:08:59.479 — take #1's real breaking like moment.
  const LIKE = '3lrq5ryysys22';
  // A reply written at 14:08:40, comfortably inside the piece's 49 seconds.
  const EARLY = '3lrq5rggek222';

  it('splits records either side of the seal', () => {
    const { preSeal, postSeal } = measureWindows(
      [
        { kind: 'reply', rkey: EARLY, did: 'did:plc:a' },
        { kind: 'like', rkey: '3mrlmsxbqjc2e', did: 'did:plc:b' }, // 2026 — long after
      ],
      SEAL,
      SELF,
    );
    expect(preSeal.threadPosts).toBe(1);
    expect(postSeal.likes).toBe(1);
    expect(preSeal.participants).toBe(1);
    expect(postSeal.participants).toBe(1);
  });

  it('excludes the artist from the counts', () => {
    const { preSeal } = measureWindows(
      [{ kind: 'reply', rkey: EARLY, did: SELF }],
      SEAL,
      SELF,
    );
    expect(preSeal.threadPosts).toBe(0);
    expect(preSeal.participants).toBe(0);
  });

  it('finds a surviving pre-seal like as the breaking like', () => {
    const { breakingLike } = measureWindows(
      [{ kind: 'like', rkey: LIKE, did: 'did:plc:round' }],
      SEAL,
      SELF,
    );
    expect(breakingLike).not.toBeNull();
    expect(breakingLike.did).toBe('did:plc:round');
  });

  it('reports no breaking like when it was deleted', () => {
    // Six of the first eleven look exactly like this: a seal with nothing
    // before it to explain the seal.
    const { breakingLike } = measureWindows(
      [{ kind: 'reply', rkey: EARLY, did: 'did:plc:a' }],
      SEAL,
      SELF,
    );
    expect(breakingLike).toBeNull();
  });

  it('ignores unparseable record keys rather than counting them as epoch', () => {
    const { preSeal, postSeal } = measureWindows(
      [{ kind: 'like', rkey: 'not-a-tid', did: 'did:plc:a' }],
      SEAL,
      SELF,
    );
    expect(preSeal.likes).toBe(0);
    expect(postSeal.likes).toBe(0);
  });
});

describe('buildPieceRecord', () => {
  const piece = {
    rkey: '3lrq5r2ouw22b',
    take: 1,
    postedAt: '2025-06-16T14:08:27.696Z',
    sealedAt: '2025-06-16T14:09:16.528Z',
    lifespanMs: 48832,
  };
  const windows = {
    preSeal: { likes: 1, reposts: 0, quotes: 0, threadPosts: 0, participants: 1 },
    postSeal: { likes: 3, reposts: 1, quotes: 1, threadPosts: 0, participants: 5 },
    breakingLike: { at: Date.parse('2025-06-16T14:08:59.479Z'), did: 'did:plc:round' },
  };

  it('reproduces take #1 from its parts', () => {
    const rec = buildPieceRecord({
      piece,
      windows,
      announcement: { text: '@round.is was to blame for liking the post', rkey: '3lrq5tdhik222' },
      subject: 'at://did:plc:x/app.bsky.feed.post/3lrq5r2ouw22b',
      measuredAt: '2026-07-27T01:00:00.000Z',
    });
    expect(rec.take).toBe(1);
    expect(rec.breaker).toEqual({
      handle: 'round.is',
      likeSurvives: true,
      reactionMs: 17049,
    });
    expect(rec.lifespanMs).toBe(48832);
    expect(rec.preSeal.likes).toBe(1);
  });

  it('omits the reaction time when the like is gone', () => {
    const rec = buildPieceRecord({
      piece,
      windows: { ...windows, breakingLike: null },
      announcement: { text: '@fenny.moe was to blame for liking the post' },
      subject: 'at://did:plc:x/app.bsky.feed.post/3lrq5r2ouw22b',
      measuredAt: '2026-07-27T01:00:00.000Z',
    });
    expect(rec.breaker.likeSurvives).toBe(false);
    expect(rec.breaker.reactionMs).toBeUndefined();
    expect(rec.breaker.handle).toBe('fenny.moe');
  });

  it('falls back to an unknown breaker when no announcement was found', () => {
    const rec = buildPieceRecord({
      piece,
      windows,
      announcement: null,
      subject: 'at://did:plc:x/app.bsky.feed.post/3lrq5r2ouw22b',
      measuredAt: '2026-07-27T01:00:00.000Z',
    });
    expect(rec.breaker.handle).toBe('unknown');
    expect(rec.announceLagMs).toBeUndefined();
  });
});

describe('buildEventLog', () => {
  // Real TIDs, so they decode to real times.
  const POSTED = tidToTimestamp('3lrq5rggek222');
  const LATER = tidToTimestamp('3lrq5ryysys22');
  const postedAtMs = Date.parse(POSTED);
  const laterMs = Date.parse(LATER);

  const base = {
    postedAtMs,
    sealedAtMs: laterMs + 1,
    selfDid: 'did:plc:me',
    handles: { 'did:plc:them': 'them.bsky.social' },
  };

  it('times each record against the moment the piece went up', () => {
    const [e] = buildEventLog([{ kind: 'like', rkey: '3lrq5ryysys22', did: 'did:plc:them' }], base);
    expect(e.k).toBe('like');
    expect(e.h).toBe('them.bsky.social');
    expect(e.offMs).toBe(laterMs - postedAtMs);
    expect(e.pre).toBe(1);
  });

  it('marks what landed after the seal', () => {
    const [e] = buildEventLog([{ kind: 'reply', rkey: '3lrq5ryysys22', did: 'did:plc:them' }], {
      ...base,
      sealedAtMs: postedAtMs, // sealed before this record
    });
    expect(e.pre).toBe(0);
  });

  it("flags the artist's own records so the counts can exclude them", () => {
    const [e] = buildEventLog([{ kind: 'reply', rkey: '3lrq5ryysys22', did: 'did:plc:me' }], base);
    expect(e.self).toBe(1);
    expect(buildEventLog([{ kind: 'reply', rkey: '3lrq5ryysys22', did: 'did:plc:them' }], base)[0].self)
      .toBeUndefined();
  });

  it('labels a handle it could not resolve rather than dropping the record', () => {
    // A deactivated account resolves to nothing; the event still happened.
    const [e] = buildEventLog([{ kind: 'like', rkey: '3lrq5ryysys22', did: 'did:plc:gone' }], base);
    expect(e.h).toBe('(unresolvable)');
  });

  it('sorts earliest first and skips a key that will not decode', () => {
    const log = buildEventLog(
      [
        { kind: 'like', rkey: '3lrq5ryysys22', did: 'did:plc:them' },
        { kind: 'reply', rkey: 'not-a-tid', did: 'did:plc:them' },
        { kind: 'repost', rkey: '3lrq5rggek222', did: 'did:plc:them' },
      ],
      base,
    );
    expect(log.map((e) => e.k)).toEqual(['repost', 'like']);
  });
});
