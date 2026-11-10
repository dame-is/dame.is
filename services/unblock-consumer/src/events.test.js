import { describe, expect, it } from 'vitest';
import { readFrame } from './events.js';

const BLOCKER = 'did:plc:loilflxis3le26aehdmjrmm2';
const SUBJECT = 'did:plc:5bdmpod3mnauxvzuuoqihsbi';
const RKEY = '3mzxze2xndp2p';
// 2026-11-10T17:58:39.962Z
const TIME_US = 1794333519962000;
const AT = 1794333519;

/** A v1 frame, as jetstream2.us-west sends it. */
function v1(commit, extra = {}) {
  return { did: BLOCKER, time_us: TIME_US, kind: 'commit', commit, ...extra };
}

const create = {
  rev: '3mzxze2xq5k2p',
  operation: 'create',
  collection: 'app.bsky.graph.block',
  rkey: RKEY,
  record: { $type: 'app.bsky.graph.block', createdAt: '2026-11-10T17:58:39.755Z', subject: SUBJECT },
  cid: 'bafyreiftgprdvoboyedk6jqz5rt3lpstoqsb5ooie6pblguyq4nt3bsm44',
};

describe('reading a v1 frame', () => {
  it('reads a block being made', () => {
    expect(readFrame(v1(create))).toEqual({
      cursor: TIME_US,
      event: { type: 'put', did: BLOCKER, at: AT, rkey: RKEY, subject: SUBJECT },
    });
  });

  it('reads a rewrite the same way as a create', () => {
    expect(readFrame(v1({ ...create, operation: 'update' })).event.type).toBe('put');
  });

  it('reads a delete, which says whose and which but not who', () => {
    const frame = v1({ rev: '3mzxzf', operation: 'delete', collection: 'app.bsky.graph.block', rkey: RKEY });
    expect(readFrame(frame)).toEqual({
      cursor: TIME_US,
      event: { type: 'delete', did: BLOCKER, at: AT, rkey: RKEY },
    });
  });

  it('times an event by Jetstream’s clock, not by the record’s own claim', () => {
    // Seen live on 2026-11-10: a createdAt an hour ahead of its own arrival.
    const skewed = { ...create, record: { ...create.record, createdAt: '2026-11-10T18:58:24.572Z' } };
    expect(readFrame(v1(skewed)).event.at).toBe(AT);
  });

  it('reads an account deleted outright, and no other change of status', () => {
    const account = (fields) => ({
      did: BLOCKER,
      time_us: TIME_US,
      kind: 'account',
      account: { did: BLOCKER, seq: 1, time: '2026-11-10T17:58:39.962Z', ...fields },
    });
    expect(readFrame(account({ active: false, status: 'deleted' })).event).toEqual({
      type: 'gone',
      did: BLOCKER,
      at: AT,
    });
    for (const fields of [
      { active: true },
      { active: false, status: 'deactivated' },
      { active: false, status: 'takendown' },
      { active: false, status: 'suspended' },
    ]) {
      const read = readFrame(account(fields));
      expect(read.event).toBeNull();
      // Still a place in the stream.
      expect(read.cursor).toBe(TIME_US);
    }
  });

  it('has no use for anything else, but keeps its place', () => {
    const others = [
      v1({ ...create, collection: 'app.bsky.graph.listblock' }),
      v1({ ...create, collection: 'app.bsky.feed.like' }),
      { did: BLOCKER, time_us: TIME_US, kind: 'identity', identity: { did: BLOCKER, handle: 'x.test' } },
    ];
    for (const frame of others) expect(readFrame(frame)).toEqual({ cursor: TIME_US, event: null });
  });

  it('drops a block that blocks nobody', () => {
    const subjects = [
      undefined,
      null,
      '',
      'dame.is',
      42,
      { did: SUBJECT },
      `did:web:${'a'.repeat(600)}`,
      // A block of oneself.
      BLOCKER,
    ];
    for (const subject of subjects) {
      expect(readFrame(v1({ ...create, record: { ...create.record, subject } })).event).toBeNull();
    }
    expect(readFrame(v1({ ...create, record: undefined })).event).toBeNull();
  });

  it('drops a frame it can’t make sense of rather than throwing on it', () => {
    for (const frame of [null, undefined, 'text', 7, [], {}, { kind: 'commit' }]) {
      expect(readFrame(frame).event).toBeNull();
    }
    expect(readFrame(v1({ ...create, rkey: 'has a space' })).event).toBeNull();
    expect(readFrame(v1({ ...create, rkey: '' })).event).toBeNull();
    expect(readFrame(v1({ ...create, operation: 'explode' })).event).toBeNull();
    expect(readFrame({ ...v1(create), did: 'not-a-did' }).event).toBeNull();
    expect(readFrame({ ...v1(create), time_us: undefined }).event).toBeNull();
  });
});

describe('reading a v2 frame', () => {
  // The envelope from bsky.network/docs/jetstream, with a block in it.
  const v2 = (payload) => ({
    $type: 'message',
    payload: {
      did: BLOCKER,
      seq: 24664288881,
      time: '2026-11-10T17:58:39.962305Z',
      ...payload,
    },
  });
  const commit = {
    $type: 'network.bsky.jetstream.subscribeEvents#commit',
    operation: 'create',
    collection: 'app.bsky.graph.block',
    rkey: RKEY,
    rev: '3mzxze2xq5k2p',
    cid: 'bafyreiftgprdvoboyedk6jqz5rt3lpstoqsb5ooie6pblguyq4nt3bsm44',
    record: { $type: 'app.bsky.graph.block', createdAt: '2026-11-10T17:58:39.755Z', subject: SUBJECT },
  };

  it('reads a block being made, with the sequence number as its place', () => {
    expect(readFrame(v2(commit))).toEqual({
      cursor: 24664288881,
      event: { type: 'put', did: BLOCKER, at: AT, rkey: RKEY, subject: SUBJECT },
    });
  });

  it('reads a delete', () => {
    // A delete carries no record and no cid.
    const gone = { ...commit, operation: 'delete', record: undefined, cid: undefined };
    expect(readFrame(v2(gone)).event).toEqual({
      type: 'delete',
      did: BLOCKER,
      at: AT,
      rkey: RKEY,
    });
  });

  it('reads an account deleted outright', () => {
    const frame = v2({
      $type: 'network.bsky.jetstream.subscribeEvents#account',
      account: { active: false, status: 'deleted' },
    });
    expect(readFrame(frame).event).toEqual({ type: 'gone', did: BLOCKER, at: AT });
  });

  it('prefers a cursor the frame states outright', () => {
    expect(readFrame({ ...v2(commit), cursor: 99 }).cursor).toBe(99);
  });
});
