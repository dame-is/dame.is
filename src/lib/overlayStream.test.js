import { describe, expect, it, vi } from 'vitest';
import {
  CHAT,
  CHAT_EMPTY,
  GATE,
  OVERLAY,
  TEXT_MAX,
  blockedDids,
  chatReducer,
  chatText,
  eventFrom,
  listenStream,
  safeAvatar,
  streamUrl,
} from './overlayStream.js';

const ME = 'did:plc:me';
const v2 = (payload) => ({ payload });
const v1 = ({ did, ...commit }) => ({ did, kind: 'commit', commit });

describe('eventFrom', () => {
  const chat = { did: 'did:plc:a', collection: CHAT, rkey: '3k1', operation: 'create', record: { streamer: ME, text: ' hi\nthere ' } };

  it('reads chat in our stream on either wire', () => {
    const want = { type: 'chat', did: 'did:plc:a', rkey: '3k1', text: 'hi there' };
    expect(eventFrom(v2(chat), ME)).toEqual(want);
    expect(eventFrom(v1(chat), ME)).toEqual(want);
  });

  it('ignores chat in someone else’s stream, and empty chat', () => {
    expect(eventFrom(v2({ ...chat, record: { streamer: 'did:plc:other', text: 'hi' } }), ME)).toBeNull();
    expect(eventFrom(v2({ ...chat, record: { streamer: ME, text: '   ' } }), ME)).toBeNull();
  });

  it('takes a deleted message off, whoever deleted it', () => {
    expect(eventFrom(v2({ did: 'did:plc:a', collection: CHAT, rkey: '3k1', operation: 'delete' }), ME)).toEqual({
      type: 'unchat',
      did: 'did:plc:a',
      rkey: '3k1',
    });
  });

  it('hides a message only on the streamer’s own gate', () => {
    const gate = {
      did: ME,
      collection: GATE,
      rkey: 'g1',
      operation: 'create',
      record: { hiddenMessage: `at://did:plc:a/${CHAT}/3k1` },
    };
    expect(eventFrom(v2(gate), ME)).toEqual({ type: 'hide', did: 'did:plc:a', rkey: '3k1' });
    expect(eventFrom(v2({ ...gate, did: 'did:plc:a' }), ME)).toBeNull();
  });

  it('hears the streamer’s own overlay saves, and nobody else’s', () => {
    const save = { did: ME, collection: OVERLAY, rkey: 'live', operation: 'update', record: { widgets: [] } };
    expect(eventFrom(v2(save), ME)).toEqual({ type: 'overlay', rkey: 'live', value: { widgets: [] } });
    expect(eventFrom(v2({ ...save, did: 'did:plc:a' }), ME)).toBeNull();
    expect(eventFrom(v2({ ...save, operation: 'delete', record: undefined }), ME)).toEqual({ type: 'unoverlay', rkey: 'live' });
  });

  it('ignores what is not a commit', () => {
    expect(eventFrom(null, ME)).toBeNull();
    expect(eventFrom({ kind: 'identity', did: ME }, ME)).toBeNull();
  });
});

describe('chatText', () => {
  it('is one line, cut short', () => {
    expect(chatText('a\u0000b\n\nc')).toBe('a b c');
    const long = chatText('x'.repeat(1000));
    expect([...long]).toHaveLength(TEXT_MAX);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('streamUrl', () => {
  it('asks each wire for the same collections in its own words', () => {
    const two = new URL(streamUrl({ v: 2, url: 'wss://a/xrpc/x' }));
    expect(two.searchParams.getAll('collections')).toEqual([CHAT, GATE, OVERLAY]);
    expect(two.searchParams.get('kinds')).toBe('commit');
    const one = new URL(streamUrl({ v: 1, url: 'wss://b/subscribe' }));
    expect(one.searchParams.getAll('wantedCollections')).toEqual([CHAT, GATE, OVERLAY]);
  });
});

describe('safeAvatar', () => {
  it('only shows Bluesky’s CDN', () => {
    expect(safeAvatar('https://cdn.bsky.app/img/avatar/plain/x/y@jpeg')).toBe('https://cdn.bsky.app/img/avatar/plain/x/y@jpeg');
    expect(safeAvatar('https://evil.example/a.jpg')).toBeNull();
    expect(safeAvatar('javascript:alert(1)')).toBeNull();
    expect(safeAvatar(null)).toBeNull();
  });
});

describe('chatReducer', () => {
  const msg = (rkey, did = 'did:plc:a') => ({ type: 'chat', did, rkey, text: rkey, at: 1 });

  it('adds once, and drops on delete or hide for good', () => {
    let s = chatReducer(CHAT_EMPTY, msg('1'));
    s = chatReducer(s, msg('1'));
    expect(s.messages).toHaveLength(1);
    s = chatReducer(s, { type: 'hide', did: 'did:plc:a', rkey: '1' });
    expect(s.messages).toHaveLength(0);
    // a replay of the same message stays hidden
    s = chatReducer(s, msg('1'));
    expect(s.messages).toHaveLength(0);
  });

  it('keeps the blocked off screen, including what they already said', () => {
    let s = chatReducer(CHAT_EMPTY, msg('1', 'did:plc:b'));
    s = chatReducer(s, { type: 'blocked', blocked: blockedDids([{ value: { subject: 'did:plc:b' } }]) });
    expect(s.messages).toHaveLength(0);
    s = chatReducer(s, msg('2', 'did:plc:b'));
    expect(s.messages).toHaveLength(0);
  });
});

describe('listenStream', () => {
  it('connects, hands on events, and moves endpoint after a drop', () => {
    vi.useFakeTimers();
    const sockets = [];
    class FakeSocket {
      constructor(url) {
        this.url = url;
        sockets.push(this);
      }
      close() {
        this.onclose?.();
      }
    }
    const onEvent = vi.fn();
    const stop = listenStream(ME, { onEvent, Socket: FakeSocket });
    expect(sockets).toHaveLength(1);
    sockets[0].onmessage({
      data: JSON.stringify(v2({ did: 'did:plc:a', collection: CHAT, rkey: '1', operation: 'create', record: { streamer: ME, text: 'yo' } })),
    });
    expect(onEvent).toHaveBeenCalledWith({ type: 'chat', did: 'did:plc:a', rkey: '1', text: 'yo' });
    sockets[0].onclose();
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).not.toBe(sockets[0].url);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
    vi.useRealTimers();
  });
});
