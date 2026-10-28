import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { replayWindow, watchSubject } from './jetstream.js';

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
