import { describe, it, expect } from 'vitest';
import { tidToTimestamp } from './atproto.js';
import {
  witnessRow,
  mergeWitness,
  mergeWitnessRow,
  withdrawWitness,
  witnessToRecord,
  witnessFromRecord,
  tallyWitness,
  breakingWitness,
  withdrawnOnly,
  withdrawnWitness,
  resolveBreaker,
  witnessChanged,
  WITNESS_MAX,
  WITNESS_TEXT_MAX,
} from './ratioedLive.js';

// Real TIDs, so they decode to real times the way a live event's would.
const POSTED = '3lrq5rggek222';
const LATER = '3lrq5ryysys22';
const LATEST = '3lrq5s2tf7s2s';
const postedAtMs = Date.parse(tidToTimestamp(POSTED));
const laterMs = Date.parse(tidToTimestamp(LATER));

const ev = (over = {}) => ({
  kind: 'like',
  op: 'create',
  did: 'did:plc:them',
  rkey: LATER,
  time: new Date(laterMs + 5000).toISOString(),
  text: '',
  ...over,
});

describe('witnessRow', () => {
  it('times the row by the record key, not the relay envelope', () => {
    // The envelope says five seconds later than the key does. The key wins:
    // it's the same clock postedAt and every measured event were read from.
    const row = witnessRow(ev(), postedAtMs);
    expect(row.offMs).toBe(laterMs - postedAtMs);
    expect(row.k).toBe('like');
    expect(row.did).toBe('did:plc:them');
  });

  it('falls back to the envelope time when the key is not a TID', () => {
    const at = postedAtMs + 4000;
    const row = witnessRow(ev({ rkey: 'self', time: new Date(at).toISOString() }), postedAtMs);
    expect(row.offMs).toBe(4000);
  });

  it('refuses anything it cannot place on the piece', () => {
    expect(witnessRow(ev({ kind: 'follow' }), postedAtMs)).toBeNull();
    expect(witnessRow(ev({ rkey: '' }), postedAtMs)).toBeNull();
    expect(witnessRow(ev({ rkey: 'self', time: 'nonsense' }), postedAtMs)).toBeNull();
    expect(witnessRow(ev(), NaN)).toBeNull();
  });

  it('keeps a post’s text, bounded', () => {
    const row = witnessRow(ev({ kind: 'reply', text: 'x'.repeat(900) }), postedAtMs);
    expect(row.t).toHaveLength(WITNESS_TEXT_MAX);
  });
});

describe('mergeWitness', () => {
  const like = witnessRow(ev(), postedAtMs);
  const reply = witnessRow(ev({ kind: 'reply', rkey: LATEST, did: 'did:plc:other' }), postedAtMs);

  it('keeps the log earliest first', () => {
    const rows = mergeWitness([], [reply, like]);
    expect(rows.map((r) => r.rkey)).toEqual([LATER, LATEST]);
  });

  it('folds a repeat of the same record rather than appending it', () => {
    // A reconnect replays its cursor, so the same create arrives twice.
    const rows = mergeWitness([], [like, { ...like }]);
    expect(rows).toHaveLength(1);
  });

  it('does not resurrect a row that was withdrawn', () => {
    const gone = withdrawWitness([like], LATER, laterMs + 2000, postedAtMs);
    const again = mergeWitnessRow(gone, { ...like });
    expect(again[0].goneMs).toBe(laterMs + 2000 - postedAtMs);
  });
});

describe('withdrawWitness', () => {
  const like = witnessRow(ev(), postedAtMs);

  it('records when the deletion came through', () => {
    const rows = withdrawWitness([like], LATER, laterMs + 3000, postedAtMs);
    expect(rows[0].goneMs).toBe(laterMs + 3000 - postedAtMs);
  });

  it('keeps the first deletion it heard about', () => {
    const once = withdrawWitness([like], LATER, laterMs + 3000, postedAtMs);
    const twice = withdrawWitness(once, LATER, laterMs + 9000, postedAtMs);
    expect(twice[0].goneMs).toBe(once[0].goneMs);
  });

  it('ignores a key it is not holding', () => {
    expect(withdrawWitness([like], 'nobody', laterMs, postedAtMs)[0].goneMs).toBeUndefined();
  });
});

describe('witnessToRecord / witnessFromRecord', () => {
  const like = witnessRow(ev(), postedAtMs);

  it('stamps in the handle that was resolved at the time', () => {
    const [row] = witnessToRecord([like], { profiles: { 'did:plc:them': { handle: 'them.test' } } });
    expect(row.h).toBe('them.test');
    expect(row.offMs).toBe(laterMs - postedAtMs);
  });

  it('writes nothing undefined', () => {
    const [row] = witnessToRecord([{ k: 'like', rkey: 'x', offMs: 10 }]);
    expect(Object.values(row).every((v) => v !== undefined)).toBe(true);
    expect('did' in row).toBe(false);
    expect('goneMs' in row).toBe(false);
  });

  it('keeps the earliest rows when there are more than a record can hold', () => {
    const many = Array.from({ length: WITNESS_MAX + 50 }, (_, i) => ({
      k: 'reply',
      rkey: `r${i}`,
      offMs: i,
    }));
    const out = witnessToRecord(many);
    expect(out).toHaveLength(WITNESS_MAX);
    expect(out[0].offMs).toBe(0);
    expect(out[out.length - 1].offMs).toBe(WITNESS_MAX - 1);
  });

  it('round-trips', () => {
    const rows = withdrawWitness([like], LATER, laterMs + 1000, postedAtMs);
    const back = witnessFromRecord(witnessToRecord(rows));
    expect(back[0].k).toBe('like');
    expect(back[0].goneMs).toBe(rows[0].goneMs);
    expect(back[0].rkey).toBe(LATER);
  });

  it('answers null for a piece that carries no log at all', () => {
    // Absent is not the same as empty, and the pages that read this say so.
    expect(witnessFromRecord(undefined)).toBeNull();
    expect(witnessFromRecord([])).toBeNull();
    expect(witnessFromRecord([{ k: 'nonsense', offMs: 1 }])).toBeNull();
  });
});

describe('tallyWitness', () => {
  const rows = [
    { k: 'reply', rkey: 'a', did: 'did:plc:1', offMs: 1000 },
    { k: 'repost', rkey: 'b', did: 'did:plc:1', offMs: 2000 },
    { k: 'like', rkey: 'c', did: 'did:plc:2', offMs: 3000, goneMs: 4000 },
    { k: 'quote', rkey: 'd', did: 'did:plc:3', offMs: 5000 },
  ];

  it('counts a withdrawal out of the totals and in on its own', () => {
    const t = tallyWitness(rows);
    expect(t).toMatchObject({ replies: 1, reposts: 1, quotes: 1, likes: 0, withdrawn: 1, total: 3 });
  });

  it('counts people by DID', () => {
    expect(tallyWitness(rows).people).toBe(2);
  });
});

describe('breakingWitness', () => {
  it('takes the earliest surviving like — the one that ended it', () => {
    const rows = [
      { k: 'like', rkey: 'late', did: 'did:plc:2', offMs: 9000 },
      { k: 'like', rkey: 'early', did: 'did:plc:1', offMs: 4000 },
    ];
    expect(breakingWitness(rows).rkey).toBe('early');
  });

  it('does not count one that was taken back', () => {
    const rows = [{ k: 'like', rkey: 'gone', offMs: 4000, goneMs: 5000 }];
    expect(breakingWitness(rows)).toBeNull();
    expect(withdrawnOnly(rows)).toBe(true);
  });

  it('is not "withdrawn only" while another like still stands', () => {
    const rows = [
      { k: 'like', rkey: 'gone', offMs: 4000, goneMs: 5000 },
      { k: 'like', rkey: 'here', offMs: 6000 },
    ];
    expect(withdrawnOnly(rows)).toBe(false);
  });
});

describe('resolveBreaker', () => {
  const postedMs = 1_000_000;
  const sealedMs = postedMs + 20_000;

  it('takes the index over the log, and calls the like alive', () => {
    const out = resolveBreaker({
      indexLike: { at: postedMs + 12_000, did: 'did:plc:index' },
      rows: [{ k: 'like', rkey: 'a', did: 'did:plc:log', h: 'log.test', offMs: 9000 }],
      postedMs,
      sealedMs,
    });
    expect(out).toMatchObject({ did: 'did:plc:index', likeSurvives: true, recovered: false });
    expect(out.at).toBe(postedMs + 12_000);
  });

  it('stands the witnessed like in while the index is still catching up', () => {
    const out = resolveBreaker({
      indexLike: null,
      rows: [{ k: 'like', rkey: 'a', did: 'did:plc:them', h: 'them.test', offMs: 9000 }],
      postedMs,
      sealedMs,
    });
    // The like exists — the index simply hasn't seen it yet — so nothing here
    // is a recovery, and the reaction time is measured from the log's own TID.
    expect(out).toMatchObject({
      at: postedMs + 9000,
      did: 'did:plc:them',
      handle: 'them.test',
      likeSurvives: true,
      recovered: false,
    });
  });

  it('names the person who liked it and took it back, and keeps the timing', () => {
    // The case the whole witnessed log exists for. Take 16: liked at +902.874s,
    // deleted 329ms later, sealed 4.6s after that. The index has nothing to
    // report and never will, and the studio recorded "unknown" with no reaction
    // time — for a like it had watched land, from an account it had named.
    const out = resolveBreaker({
      indexLike: null,
      rows: [
        { k: 'reply', rkey: 'r', offMs: 4000 },
        { k: 'like', rkey: 'a', did: 'did:plc:them', h: 'ponder.test', offMs: 9000, goneMs: 9329 },
      ],
      postedMs,
      sealedMs,
    });
    expect(out).toMatchObject({
      at: postedMs + 9000,
      did: 'did:plc:them',
      handle: 'ponder.test',
      // The like is gone. Only its timing came back — which is exactly what the
      // record's `reactionRecovered` says.
      likeSurvives: false,
      recovered: true,
    });
  });

  it('prefers a like that still stands to one that was taken back', () => {
    const out = resolveBreaker({
      indexLike: null,
      rows: [
        { k: 'like', rkey: 'gone', did: 'did:plc:gone', offMs: 4000, goneMs: 4500 },
        { k: 'like', rkey: 'here', did: 'did:plc:here', offMs: 6000 },
      ],
      postedMs,
      sealedMs,
    });
    expect(out).toMatchObject({ did: 'did:plc:here', likeSurvives: true });
  });

  it('ignores a like that landed after the gate closed', () => {
    // A sealed piece goes on collecting likes forever; none of them ended it.
    const rows = [{ k: 'like', rkey: 'after', offMs: 25_000, goneMs: 26_000 }];
    expect(resolveBreaker({ indexLike: null, rows, postedMs, sealedMs })).toBeNull();
  });

  it('is null when nothing saw a like at all', () => {
    expect(
      resolveBreaker({ indexLike: null, rows: [{ k: 'reply', rkey: 'r', offMs: 10 }], postedMs, sealedMs }),
    ).toBeNull();
  });
});

describe('withdrawnWitness', () => {
  it('takes the earliest like that was taken back', () => {
    const rows = [
      { k: 'like', rkey: 'late', offMs: 9000, goneMs: 9100 },
      { k: 'like', rkey: 'early', offMs: 4000, goneMs: 4100 },
      { k: 'like', rkey: 'standing', offMs: 1000 },
    ];
    expect(withdrawnWitness(rows).rkey).toBe('early');
  });

  it('is null when every like in the log still stands', () => {
    expect(withdrawnWitness([{ k: 'like', rkey: 'a', offMs: 10 }])).toBeNull();
  });
});

describe('witnessChanged', () => {
  const rows = [{ k: 'like', rkey: 'a', offMs: 1 }];
  it('is false for a log nothing has happened to', () => {
    expect(witnessChanged(rows, [{ k: 'like', rkey: 'a', offMs: 1 }])).toBe(false);
  });
  it('is true when a row arrives, is withdrawn, or gets a name', () => {
    expect(witnessChanged(rows, [...rows, { k: 'reply', rkey: 'b', offMs: 2 }])).toBe(true);
    expect(witnessChanged(rows, [{ ...rows[0], goneMs: 9 }])).toBe(true);
    expect(witnessChanged(rows, [{ ...rows[0], h: 'them.test' }])).toBe(true);
  });
});
