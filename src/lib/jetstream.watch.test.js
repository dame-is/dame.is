import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { LOOKBACK_MS, replayWindow, watchSubject } from './jetstream.js';

// A socket that does only what the test tells it to. `close()` reports
// synchronously, which is harsher than a browser (there it lands a tick later)
// and so the better test of anything that must not hear its own close.
class FakeSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.closed = false;
    FakeSocket.instances.push(this);
  }
  open() {
    this.onopen?.();
  }
  message(data) {
    this.onmessage?.({
      data: typeof data === 'string' ? data : JSON.stringify(data),
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

const SUBJECT = 'at://did:plc:artist/app.bsky.feed.post/3piece';
const sockets = () => FakeSocket.instances;
const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1];

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
  vi.stubGlobal('WebSocket', FakeSocket);
  // Jitter pinned to its midpoint, so the waits are the table's own.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('watchSubject reconnects', () => {
  it('backs off when a server keeps accepting and hanging up', async () => {
    const stop = watchSubject(SUBJECT, { budgetBytes: null });

    latest().open();
    latest().close();
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets()).toHaveLength(2);

    // Opened again, dropped again at once: that's the second failure in a
    // row, not a fresh start, so the wait grows.
    latest().open();
    latest().close();
    await vi.advanceTimersByTimeAsync(1999);
    expect(sockets()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets()).toHaveLength(3);

    stop();
  });

  it('starts the backoff over once a socket has stayed up', async () => {
    const stop = watchSubject(SUBJECT, { budgetBytes: null });
    latest().open();
    latest().close();
    await vi.advanceTimersByTimeAsync(1000);
    latest().open();
    latest().close();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets()).toHaveLength(3);

    latest().open();
    await vi.advanceTimersByTimeAsync(10_000);
    latest().close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets()).toHaveLength(4);

    stop();
  });

  it('reports its close as it stops, and nothing after', () => {
    const states = [];
    const stop = watchSubject(SUBJECT, {
      budgetBytes: null,
      onStatus: (s) => states.push(s.state),
    });
    const socket = latest();
    socket.open();
    states.length = 0;

    stop();
    expect(socket.closed).toBe(true);
    expect(states).toEqual(['closed']);

    // The socket's own late events reach nobody.
    socket.onclose?.();
    socket.onmessage?.({ data: '{}' });
    stop();
    expect(states).toEqual(['closed']);
  });
});

describe('replayWindow settles', () => {
  const like = (atMs, rkey) => ({
    time: new Date(atMs).toISOString(),
    payload: {
      did: 'did:plc:breaker',
      collection: 'app.bsky.feed.like',
      operation: 'create',
      rkey,
      record: { subject: { uri: SUBJECT } },
    },
  });

  it('finishes once it has caught up and the filtered stream goes quiet', async () => {
    const now = Date.now();
    let result = null;
    replayWindow(SUBJECT, {
      fromMs: now - 10 * 60_000,
      toMs: now - 5 * 60_000,
      dids: ['did:plc:breaker'],
    }).then((r) => {
      result = r;
    });
    latest().message(like(now - 9 * 60_000, '3like'));

    // Ten minutes of window plus the half-hour rewind, at the assumed 100x, is
    // 24s of scanning — a stream filtered to one account is silent through
    // that too, so silence alone mustn't end it early.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(result).toBeNull();

    await vi.advanceTimersByTimeAsync(6_000);
    expect(result).toMatchObject({ reachedEnd: true, error: null });
    expect(result.events.map((e) => e.rkey)).toEqual(['3like']);
    expect(latest().closed).toBe(true);
  });

  it('still finishes the moment an event past the window arrives', async () => {
    const now = Date.now();
    const pending = replayWindow(SUBJECT, {
      fromMs: now - 10 * 60_000,
      toMs: now - 5 * 60_000,
    });
    latest().message(like(now - 60_000, '3later'));
    await expect(pending).resolves.toMatchObject({
      reachedEnd: true,
      events: [],
    });
  });

  it('gives up at its time limit, and says so', async () => {
    const now = Date.now();
    let result = null;
    replayWindow(SUBJECT, {
      fromMs: now - 60_000,
      // A window that hasn't closed yet can't be quiet-finished.
      toMs: now + 60 * 60_000,
      maxMs: 5_000,
    }).then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(result).toMatchObject({
      reachedEnd: false,
      error: 'the replay ran out of time',
    });
  });
});

describe('watchSubject starts in the past and keeps its place', () => {
  const event = (atMs, seq, extra = {}) => ({
    $type: 'message',
    payload: {
      did: 'did:plc:someone',
      collection: 'app.bsky.feed.like',
      operation: 'create',
      rkey: `3other${seq}`,
      record: { subject: { uri: 'at://did:plc:else/app.bsky.feed.post/3x' } },
      seq,
      time: new Date(atMs).toISOString(),
      ...extra,
    },
  });
  const cursorOf = (s) => new URL(s.url).searchParams.get('cursor');

  it('asks for a timestamp cursor, and vouches only for where it landed', () => {
    const now = Date.now();
    const statuses = [];
    const stop = watchSubject(SUBJECT, {
      budgetBytes: null,
      fromMs: now - 3 * 60_000,
      onStatus: (s) => statuses.push(s),
    });
    expect(cursorOf(latest())).toBe(String((now - 3 * 60_000) * 1000));

    latest().open();
    latest().message(event(now - 3 * 60_000 + 40, 100));
    const last = statuses[statuses.length - 1];
    expect(last.coveredFrom).toBe(now - 3 * 60_000 + 40);
    expect(last.behindMs).toBe(3 * 60_000 - 40);
    stop();
  });

  it('reports a later start when the server could not go back that far', () => {
    const now = Date.now();
    const statuses = [];
    const stop = watchSubject(SUBJECT, {
      budgetBytes: null,
      fromMs: now - 40 * 3600_000,
      onStatus: (s) => statuses.push(s),
    });
    latest().open();
    // What the v2 host actually sends for a cursor below its retention floor.
    latest().message({
      $type: 'message',
      payload: {
        $type: 'network.bsky.jetstream.subscribeEvents#info',
        name: 'OutdatedCursor',
        message:
          'requested timestamp cursor below retention floor; starting at seq 7',
      },
    });
    latest().message(event(now - 36 * 3600_000, 7));
    expect(statuses[statuses.length - 1].coveredFrom).toBe(now - 36 * 3600_000);
    stop();
  });

  // A phone in a pocket: the page is frozen, timers and all, while the clock
  // runs on. Nothing fires until it comes back.
  const background = (ms) => vi.setSystemTime(Date.now() + ms);

  it('resumes a long drop from its seq when the caller pays for it', async () => {
    const now = Date.now();
    const stop = watchSubject(SUBJECT, { budgetBytes: null, maxReplayMs: LOOKBACK_MS });
    latest().open();
    latest().message(event(now, 500));
    background(10 * 60_000);
    latest().close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cursorOf(latest())).toBe('500');
    stop();
  });

  it('still starts live after a long drop by default', async () => {
    const now = Date.now();
    const stop = watchSubject(SUBJECT, { budgetBytes: null });
    latest().open();
    latest().message(event(now, 500));
    background(10 * 60_000);
    latest().close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cursorOf(latest())).toBeNull();
    stop();
  });

  // The other way a phone hands a socket back: still "open", never closing,
  // delivering nothing. The stall check is what notices.
  it('drops a socket that came back from the background dead, and resumes', async () => {
    const now = Date.now();
    const states = [];
    const stop = watchSubject(SUBJECT, {
      budgetBytes: null,
      maxReplayMs: LOOKBACK_MS,
      onStatus: (s) => states.push(s.state),
    });
    const dead = latest();
    dead.open();
    dead.message(event(now, 500));
    await vi.advanceTimersByTimeAsync(5000);
    background(10 * 60_000);
    // The interval frozen in the background fires as the page returns.
    await vi.advanceTimersByTimeAsync(5000);
    expect(states[states.length - 1]).toBe('closed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(latest()).not.toBe(dead);
    expect(cursorOf(latest())).toBe('500');
    // And the dead one's own close, whenever it comes, reaches nobody.
    const count = sockets().length;
    dead.onclose?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets()).toHaveLength(count);
    stop();
  });

  it('leaves a socket alone while it keeps delivering', async () => {
    const now = Date.now();
    const stop = watchSubject(SUBJECT, { budgetBytes: null });
    const live = latest();
    live.open();
    for (let i = 0; i < 12; i += 1) {
      live.message(event(now + i * 5000, 500 + i));
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(sockets()).toHaveLength(1);
    stop();
  });

  it('falls back from a refused seq to a time, then to live, and counts what that lost', async () => {
    const now = Date.now();
    const statuses = [];
    const stop = watchSubject(SUBJECT, {
      budgetBytes: null,
      maxReplayMs: LOOKBACK_MS,
      onStatus: (s) => statuses.push(s),
    });
    latest().open();
    latest().message(event(now, 500));
    latest().close();

    // Each reconnect, as soon as it is made.
    const nextSocket = async () => {
      const n = sockets().length;
      while (sockets().length === n) await vi.advanceTimersByTimeAsync(100);
      return latest();
    };

    // A seq the server no longer holds is refused before the upgrade: no
    // open, no message, just the close. Twice, and the time is tried instead.
    const cursors = [];
    for (let i = 0; i < 4; i += 1) {
      cursors.push(cursorOf(await nextSocket()));
      latest().close();
    }
    expect(cursors).toEqual([
      '500',
      '500',
      String((now - 1000) * 1000),
      String((now - 1000) * 1000),
    ]);

    expect(cursorOf(await nextSocket())).toBeNull();
    latest().open();
    const resumedAt = Date.now();
    latest().message(event(resumedAt, 900));
    const last = statuses[statuses.length - 1];
    expect(last.coveredFrom).toBe(now);
    expect(last.gapMs).toBe(resumedAt - now);
    stop();
  });

  // A reload: a new watch taking up where the page it replaced had got to.
  it('carries on from an earlier watch rather than from the post', () => {
    const now = Date.now();
    const statuses = [];
    const stop = watchSubject(SUBJECT, {
      budgetBytes: null,
      maxReplayMs: LOOKBACK_MS,
      fromMs: now - 40 * 60_000,
      resume: { seq: 900, atMs: now - 20_000, coveredFrom: now - 40 * 60_000, gapMs: 0 },
      onStatus: (s) => statuses.push(s),
    });
    expect(cursorOf(latest())).toBe('900');
    // What it vouches for is the earlier watch's, from before it opens.
    expect(statuses[0].coveredFrom).toBe(now - 40 * 60_000);
    expect(statuses[0].behindMs).toBe(20_000);

    latest().open();
    latest().message(event(now - 20_000, 900));
    const last = statuses[statuses.length - 1];
    expect(last.coveredFrom).toBe(now - 40 * 60_000);
    expect(last.gapMs).toBe(0);
    stop();
  });

  it('counts a hole from where the earlier watch stopped when it cannot resume', async () => {
    const now = Date.now();
    const statuses = [];
    const stop = watchSubject(SUBJECT, {
      budgetBytes: null,
      maxReplayMs: LOOKBACK_MS,
      resume: { seq: 900, atMs: now - 20_000, coveredFrom: now - 40 * 60_000, gapMs: 3000 },
      onStatus: (s) => statuses.push(s),
    });
    const nextSocket = async () => {
      const n = sockets().length;
      while (sockets().length === n) await vi.advanceTimersByTimeAsync(100);
      return latest();
    };
    const cursors = [cursorOf(latest())];
    latest().close();
    for (let i = 0; i < 3; i += 1) {
      cursors.push(cursorOf(await nextSocket()));
      latest().close();
    }
    expect(cursors).toEqual([
      '900',
      '900',
      String((now - 21_000) * 1000),
      String((now - 21_000) * 1000),
    ]);
    expect(cursorOf(await nextSocket())).toBeNull();
    latest().open();
    const liveAt = Date.now();
    latest().message(event(liveAt, 5000));
    const last = statuses[statuses.length - 1];
    expect(last.coveredFrom).toBe(now - 40 * 60_000);
    expect(last.gapMs).toBe(3000 + liveAt - (now - 20_000));
    stop();
  });

  it('only reports a seq once everything before it has been delivered', () => {
    const now = Date.now();
    const log = [];
    const stop = watchSubject(SUBJECT, {
      budgetBytes: null,
      onEvent: (e) => log.push(`event ${e.seq}`),
      onStatus: (s) => log.push(`status ${s.seq}`),
    });
    latest().open();
    log.length = 0;
    latest().message(
      event(now, 41, {
        rkey: '3reply',
        collection: 'app.bsky.feed.post',
        record: { text: 'hi', reply: { root: { uri: SUBJECT }, parent: { uri: SUBJECT } } },
      }),
    );
    // The first event's own status goes out before it is handled, under the
    // seq before it; the match's status after.
    expect(log).toEqual(['status 0', 'event 41', 'status 41']);
    stop();
  });

  it('reports the delete of a record it is told it already knows', () => {
    const now = Date.now();
    const events = [];
    const known = new Map([['3like', 'like']]);
    const stop = watchSubject(SUBJECT, {
      budgetBytes: null,
      known: (rkey, did) => (did === 'did:plc:fan' ? known.get(rkey) || null : null),
      onEvent: (e) => events.push(e),
    });
    latest().open();
    const del = (did, rkey, seq) =>
      latest().message({
        $type: 'message',
        payload: {
          did,
          collection: 'app.bsky.feed.like',
          operation: 'delete',
          rkey,
          seq,
          time: new Date(now).toISOString(),
        },
      });
    del('did:plc:fan', '3like', 50);
    del('did:plc:stranger', '3like', 51);
    del('did:plc:fan', '3other', 52);
    expect(events.map((e) => [e.op, e.kind, e.rkey, e.did])).toEqual([
      ['delete', 'like', '3like', 'did:plc:fan'],
    ]);
    stop();
  });

  it('keeps retrying its starting cursor until something arrives', async () => {
    const now = Date.now();
    const from = now - 60_000;
    const stop = watchSubject(SUBJECT, { budgetBytes: null, fromMs: from });
    latest().close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cursorOf(latest())).toBe(String(from * 1000));
    stop();
  });
});
