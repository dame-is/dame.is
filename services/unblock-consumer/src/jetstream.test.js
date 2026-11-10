import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectJetstream, streamUrl } from './jetstream.js';

describe('where it connects', () => {
  it('asks v1 for block records and nothing else', () => {
    expect(streamUrl({ host: 'jetstream2.us-west.bsky.network', api: 'v1', cursor: null })).toBe(
      'wss://jetstream2.us-west.bsky.network/subscribe?wantedCollections=app.bsky.graph.block',
    );
  });

  it('resumes from a cursor', () => {
    expect(streamUrl({ host: 'jetstream2.us-west.bsky.network', api: 'v1', cursor: 1794333519962000 })).toBe(
      'wss://jetstream2.us-west.bsky.network/subscribe?wantedCollections=app.bsky.graph.block&cursor=1794333519962000',
    );
  });

  it('asks v2 for commits and account events, by its own spelling', () => {
    expect(streamUrl({ host: 'jetstream.us-west.bsky.network', api: 'v2', cursor: 24664288881 })).toBe(
      'wss://jetstream.us-west.bsky.network/xrpc/network.bsky.jetstream.subscribeEvents' +
        '?collections=app.bsky.graph.block&kinds=commit&kinds=account&cursor=24664288881',
    );
  });

  it('takes a host that states its scheme at its word', () => {
    expect(streamUrl({ host: 'ws://127.0.0.1:6008', api: 'v1', cursor: null })).toBe(
      'ws://127.0.0.1:6008/subscribe?wantedCollections=app.bsky.graph.block',
    );
    expect(streamUrl({ host: 'wss://jetstream.example', api: 'v1', cursor: null })).toBe(
      'wss://jetstream.example/subscribe?wantedCollections=app.bsky.graph.block',
    );
  });
});

/**
 * A WebSocket that does what the test tells it to.
 *
 * `answersClose: false` is a peer that has stopped answering: asked to close,
 * the socket never says it has. That is what a hung server looks like, and
 * the real WebSocket behaves the same way.
 */
function fakeSockets({ answersClose = true } = {}) {
  const made = [];
  class FakeSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.listeners = {};
      this.closed = false;
      made.push(this);
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    emit(type, event = {}) {
      for (const fn of this.listeners[type] || []) fn(event);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      if (answersClose) this.emit('close');
    }
  }
  return { FakeSocket, made };
}

const config = {
  jetstreamHost: 'jetstream.test',
  jetstreamApi: 'v1',
  reconnectBaseMs: 1000,
  reconnectMaxMs: 8000,
  silenceMs: 90_000,
};
const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('staying connected', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T18:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hands on each frame, parsed, and shrugs off one that isn’t JSON', () => {
    const { FakeSocket, made } = fakeSockets();
    const frames = [];
    const stream = connectJetstream({
      config,
      logger: quiet,
      getCursor: () => null,
      onFrame: (frame) => frames.push(frame),
      WebSocketImpl: FakeSocket,
    });
    made[0].emit('open');
    made[0].emit('message', { data: '{"kind":"commit","time_us":1}' });
    made[0].emit('message', { data: 'not json' });
    made[0].emit('message', { data: '{"kind":"account","time_us":2}' });
    expect(frames).toEqual([
      { kind: 'commit', time_us: 1 },
      { kind: 'account', time_us: 2 },
    ]);
    stream.close();
  });

  it('reconnects from wherever the caller has got to, waiting longer each time', () => {
    const { FakeSocket, made } = fakeSockets();
    let cursor = 100;
    const stream = connectJetstream({
      config,
      logger: quiet,
      getCursor: () => cursor,
      onFrame: () => {},
      WebSocketImpl: FakeSocket,
    });
    expect(made[0].url).toContain('cursor=100');

    cursor = 250;
    made[0].close();
    vi.advanceTimersByTime(999);
    expect(made).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(made).toHaveLength(2);
    expect(made[1].url).toContain('cursor=250');

    // It never opened, so the wait doubles.
    made[1].close();
    vi.advanceTimersByTime(1999);
    expect(made).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(made).toHaveLength(3);

    // And once one does open, it starts over.
    made[2].emit('open');
    made[2].close();
    vi.advanceTimersByTime(1000);
    expect(made).toHaveLength(4);
    stream.close();
  });

  it('takes a socket that has gone silent for dead, and replaces it', () => {
    const { FakeSocket, made } = fakeSockets();
    const stream = connectJetstream({
      config,
      logger: quiet,
      getCursor: () => 1,
      onFrame: () => {},
      WebSocketImpl: FakeSocket,
    });
    made[0].emit('open');

    // Frames keep it alive.
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(60_000);
      made[0].emit('message', { data: '{}' });
    }
    expect(made[0].closed).toBe(false);

    // Then nothing for longer than it is ever quiet.
    vi.advanceTimersByTime(121_000);
    expect(made[0].closed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(made).toHaveLength(2);
    stream.close();
  });

  it('reconnects when a silent peer never answers the close', () => {
    // The watchdog used to ask the socket to close and wait for it to say it
    // had. A server that has stopped answering never does.
    const { FakeSocket, made } = fakeSockets({ answersClose: false });
    const frames = [];
    const stream = connectJetstream({
      config,
      logger: quiet,
      getCursor: () => 7,
      onFrame: (frame) => frames.push(frame),
      WebSocketImpl: FakeSocket,
    });
    made[0].emit('open');
    vi.advanceTimersByTime(121_000);
    expect(made[0].closed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(made).toHaveLength(2);

    // Whatever the abandoned socket says afterwards is not listened to: its
    // frames are behind the cursor the new one resumed from, and its close
    // must not start a third connection.
    made[0].emit('message', { data: '{"late":true}' });
    made[0].emit('close');
    vi.advanceTimersByTime(60_000);
    expect(frames).toEqual([]);
    expect(made).toHaveLength(2);
    stream.close();
  });

  it('tries again when a connection can’t be made at all', () => {
    // Node's WebSocket fires `error` and no `close` when it can't connect.
    const { FakeSocket, made } = fakeSockets({ answersClose: false });
    const stream = connectJetstream({
      config,
      logger: quiet,
      getCursor: () => 7,
      onFrame: () => {},
      WebSocketImpl: FakeSocket,
    });
    made[0].emit('error', { message: 'connect ECONNREFUSED' });
    vi.advanceTimersByTime(1000);
    expect(made).toHaveLength(2);
    // And again, waiting longer.
    made[1].emit('error', { message: 'connect ECONNREFUSED' });
    vi.advanceTimersByTime(1999);
    expect(made).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(made).toHaveLength(3);
    // An error and then a close from the same socket is one failure, not two.
    made[2].emit('error', { message: 'reset' });
    made[2].emit('close');
    vi.advanceTimersByTime(4000);
    expect(made).toHaveLength(4);
    vi.advanceTimersByTime(60_000);
    expect(made).toHaveLength(4);
    stream.close();
  });

  it('gives up on a connection that neither opens nor fails', () => {
    const { FakeSocket, made } = fakeSockets({ answersClose: false });
    const stream = connectJetstream({
      config,
      logger: quiet,
      getCursor: () => 7,
      onFrame: () => {},
      WebSocketImpl: FakeSocket,
    });
    // Never opened. Silence is counted from the attempt.
    vi.advanceTimersByTime(121_000);
    expect(made[0].closed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(made).toHaveLength(2);
    stream.close();
  });

  it('tries again when a socket can’t even be constructed', () => {
    let attempts = 0;
    class Throws {
      constructor() {
        attempts += 1;
        throw new Error('bad address');
      }
    }
    const stream = connectJetstream({
      config,
      logger: quiet,
      getCursor: () => 7,
      onFrame: () => {},
      WebSocketImpl: Throws,
    });
    expect(attempts).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(attempts).toBe(2);
    stream.close();
    vi.advanceTimersByTime(60_000);
    expect(attempts).toBe(2);
  });

  it('stays closed once it has been told to stop', () => {
    const { FakeSocket, made } = fakeSockets();
    const stream = connectJetstream({
      config,
      logger: quiet,
      getCursor: () => 1,
      onFrame: () => {},
      WebSocketImpl: FakeSocket,
    });
    made[0].emit('open');
    stream.close();
    expect(made[0].closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(made).toHaveLength(1);
  });

  it('names the v2 framing as a subprotocol, and v1 none', () => {
    const { FakeSocket, made } = fakeSockets();
    const v1 = connectJetstream({ config, logger: quiet, getCursor: () => null, onFrame: () => {}, WebSocketImpl: FakeSocket });
    const v2 = connectJetstream({
      config: { ...config, jetstreamApi: 'v2' },
      logger: quiet,
      getCursor: () => null,
      onFrame: () => {},
      WebSocketImpl: FakeSocket,
    });
    expect(made[0].protocols).toBeUndefined();
    expect(made[1].protocols).toBe('xrpc.v1.json');
    v1.close();
    v2.close();
  });
});
