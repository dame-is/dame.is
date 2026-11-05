// What the overlay hears from the network while it is on stream, over one
// Jetstream socket:
//
//   place.stream.chat.message   chat in dame's stream.place chat: a record in
//                               the CHATTER's repo whose `streamer` is dame's DID
//   place.stream.chat.gate      dame hiding a message in that chat (a record in
//                               dame's repo whose `hiddenMessage` is its at-uri)
//   is.dame.overlay             dame saving an overlay, so a save in the studio
//                               reaches the stream within a second or two
//   place.stream.livestream     dame's own stream records: a new one is the
//                               stream going live, one updated with an
//                               `endedAt` is it over (Poe cheers and waves)
//   app.bsky.graph.follow       new follows of dame, for Poe to say thank you;
//                               only asked for while a Poe on screen wants
//                               them, since follows come for the whole network
//                               (tens a second) and are picked out here
//
// All three are public records in people's own repos, so the overlay needs no
// sign-in and no stream.place API. The same three collections, and the same
// reading of them, as atpota.to's overlay (website/src/overlay/chat.ts there).
// A chat message that is deleted anywhere is a person taking theirs back, and
// leaves the screen.
//
// Jetstream filters by collection and not by what a record points at, so the
// chat comes for the whole network and is picked out here. It is a quiet
// collection: nothing like the like-stream lib/jetstream.js watches.
//
// The wire. The site's other watcher (lib/jetstream.js) speaks Jetstream v2,
// which wraps each event in an envelope with the commit's fields flat on
// `payload`; atpota.to's speaks v1, where they nest under `commit`. Both are
// read here, and a socket that keeps failing on one endpoint moves to the
// other, so the overlay keeps hearing chat whichever one is up.
//
// Chat is other people's words. They reach the screen as text only (React
// escapes it), one line each, cut at TEXT_MAX; an avatar is only ever shown
// from Bluesky's own image CDN.

export const CHAT = 'place.stream.chat.message';
export const GATE = 'place.stream.chat.gate';
export const OVERLAY = 'is.dame.overlay';
export const BLOCK = 'app.bsky.graph.block';
export const LIVESTREAM = 'place.stream.livestream';
export const FOLLOW = 'app.bsky.graph.follow';

/** "!weather" … "!poe" at the start of a message (any case), for Poe; anything else is chat. */
export function commandOf(text) {
  const m = /^\s*!(weather|forecast|apps|pet|poe)\b/i.exec(String(text));
  return m ? m[1].toLowerCase() : null;
}

export const ENDPOINTS = Object.freeze([
  { v: 2, url: 'wss://jetstream.us-east.bsky.network/xrpc/network.bsky.jetstream.subscribeEvents' },
  { v: 1, url: 'wss://jetstream2.us-east.bsky.network/subscribe' },
  { v: 1, url: 'wss://jetstream1.us-west.bsky.network/subscribe' },
]);

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
/** A socket has to stay up this long before its drop counts as a fresh failure. */
const STABLE_MS = 10_000;
export const TEXT_MAX = 300;

const obj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const HIDDEN_RE =
  /^at:\/\/(did:[a-z]+:[a-zA-Z0-9._:%-]+)\/place\.stream\.chat\.message\/([a-zA-Z0-9._~:-]{1,512})$/;

/** A Jetstream message's commit, from either wire version, or null. */
export function commitOf(message) {
  if (!obj(message)) return null;
  // v2: { payload: { did, collection, rkey, operation, record } }
  if (obj(message.payload) && typeof message.payload.collection === 'string') {
    const p = message.payload;
    return typeof p.did === 'string' ? p : null;
  }
  // v1: { did, kind: 'commit', commit: { collection, rkey, operation, record } }
  if (message.kind === 'commit' && obj(message.commit) && typeof message.did === 'string') {
    return { ...message.commit, did: message.did };
  }
  return null;
}

/** One line of chat as the screen shows it. */
export function chatText(text) {
  // eslint-disable-next-line no-control-regex
  const s = String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...s];
  return chars.length > TEXT_MAX ? `${chars.slice(0, TEXT_MAX - 1).join('')}…` : s;
}

/**
 * A Jetstream message as an overlay event for `streamer` (a DID), or null when
 * it is about someone else:
 *
 *   { type: 'chat', did, rkey, text }   a new message in their chat
 *   { type: 'unchat', did, rkey }       a chat message deleted by its writer
 *   { type: 'hide', did, rkey }         the streamer hid a message
 *   { type: 'overlay', rkey, value }    the streamer saved an overlay
 *   { type: 'unoverlay', rkey }         the streamer deleted one
 *   { type: 'live', rkey, title }       the streamer went live
 *   { type: 'ended', rkey }             that stream ended
 *   { type: 'follow', did }             someone followed the streamer
 *
 * A chat event also carries `command` (commandOf), null for plain chat.
 */
export function eventFrom(message, streamer) {
  const c = commitOf(message);
  if (!c || typeof c.rkey !== 'string') return null;
  const own = c.did === streamer;
  if (c.operation === 'delete') {
    if (c.collection === CHAT) return { type: 'unchat', did: c.did, rkey: c.rkey };
    if (own && c.collection === OVERLAY) return { type: 'unoverlay', rkey: c.rkey };
    return null;
  }
  if (!obj(c.record)) return null;
  const r = c.record;
  if (c.collection === OVERLAY) {
    return own && (c.operation === 'create' || c.operation === 'update')
      ? { type: 'overlay', rkey: c.rkey, value: r }
      : null;
  }
  if (c.collection === LIVESTREAM) {
    if (!own) return null;
    if (c.operation === 'create' && r.endedAt === undefined) {
      const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 140) : null;
      return { type: 'live', rkey: c.rkey, title };
    }
    if (c.operation === 'update' && typeof r.endedAt === 'string') return { type: 'ended', rkey: c.rkey };
    return null;
  }
  if (c.collection === FOLLOW) {
    return c.operation === 'create' && r.subject === streamer && !own ? { type: 'follow', did: c.did } : null;
  }
  if (c.collection === GATE) {
    const hit = own && c.operation === 'create' && typeof r.hiddenMessage === 'string' ? HIDDEN_RE.exec(r.hiddenMessage) : null;
    return hit ? { type: 'hide', did: hit[1], rkey: hit[2] } : null;
  }
  if (c.collection === CHAT && c.operation === 'create' && r.streamer === streamer && typeof r.text === 'string') {
    const text = chatText(r.text);
    return text ? { type: 'chat', did: c.did, rkey: c.rkey, text, command: commandOf(text) } : null;
  }
  return null;
}

/** The socket address for an endpoint: our collections, and the network's follows when `follows`. */
export function streamUrl(endpoint, { follows = false } = {}) {
  const params = new URLSearchParams();
  const key = endpoint.v === 2 ? 'collections' : 'wantedCollections';
  for (const c of [CHAT, GATE, OVERLAY, LIVESTREAM, ...(follows ? [FOLLOW] : [])]) params.append(key, c);
  if (endpoint.v === 2) params.append('kinds', 'commit');
  return `${endpoint.url}?${params}`;
}

/**
 * Listen until stopped, reconnecting with a backoff (and moving to the next
 * endpoint after a failure). Returns the stop function. `onState` hears
 * 'connecting' | 'open' | 'closed'.
 */
export function listenStream(streamer, { onEvent, onState, follows = false, Socket = globalThis.WebSocket, endpoints = ENDPOINTS } = {}) {
  let ws = null;
  let stopped = false;
  let attempt = 0;
  let which = 0;
  let openedAt = 0;
  let timer = null;

  const connect = () => {
    if (stopped || !Socket) return;
    const endpoint = endpoints[which % endpoints.length];
    onState?.('connecting');
    let sock;
    try {
      sock = new Socket(streamUrl(endpoint, { follows }));
    } catch {
      retry();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      openedAt = Date.now();
      onState?.('open');
    };
    sock.onmessage = (msg) => {
      if (typeof msg.data !== 'string') return;
      let data;
      try {
        data = JSON.parse(msg.data);
      } catch {
        return;
      }
      const event = eventFrom(data, streamer);
      if (event) onEvent?.(event);
    };
    sock.onerror = () => {
      /* onclose follows */
    };
    sock.onclose = () => {
      if (stopped || ws !== sock) return;
      ws = null;
      onState?.('closed');
      retry();
    };
  };

  function retry() {
    if (stopped) return;
    if (openedAt && Date.now() - openedAt > STABLE_MS) attempt = 0;
    openedAt = 0;
    which += 1;
    const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    // ±30%, so a room of overlays that lost the same server don't all redial at once.
    const wait = base * (0.7 + Math.random() * 0.6);
    timer = setTimeout(connect, wait);
  }

  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    try {
      ws?.close();
    } catch {
      /* already gone */
    }
  };
}

/** An avatar URL the overlay will show: Bluesky's image CDN only, else null. */
export function safeAvatar(url) {
  if (typeof url !== 'string' || url.length > 1000) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'cdn.bsky.app' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The DIDs a repo's app.bsky.graph.block records name. */
export function blockedDids(records) {
  const out = new Set();
  for (const r of records || []) {
    const s = r?.value?.subject;
    if (typeof s === 'string' && s.startsWith('did:')) out.add(s);
  }
  return out;
}

/**
 * The chat as a list, newest last: add a message (ignoring repeats and the
 * blocked), take one away, hide one. Pure, so the hook above it is a reducer.
 */
export const CHAT_KEEP = 40;

export function chatReducer(state, action) {
  switch (action.type) {
    case 'chat': {
      if (state.blocked.has(action.did)) return state;
      const id = `${action.did}/${action.rkey}`;
      if (state.hidden.has(id) || state.messages.some((m) => m.id === id)) return state;
      const messages = [...state.messages, { id, did: action.did, text: action.text, at: action.at ?? Date.now() }];
      return { ...state, messages: messages.slice(-CHAT_KEEP) };
    }
    case 'unchat':
    case 'hide': {
      const id = `${action.did}/${action.rkey}`;
      const hidden = new Set(state.hidden);
      hidden.add(id);
      return { ...state, hidden, messages: state.messages.filter((m) => m.id !== id) };
    }
    case 'blocked': {
      const blocked = action.blocked;
      return { ...state, blocked, messages: state.messages.filter((m) => !blocked.has(m.did)) };
    }
    case 'reset':
      return { ...state, messages: [] };
    default:
      return state;
  }
}

export const CHAT_EMPTY = Object.freeze({ messages: [], hidden: new Set(), blocked: new Set() });

/** Example chat for placing the widget (the studio's preview, and ?demo). */
export const DEMO_CHAT = Object.freeze([
  { handle: 'poe.atpota.to', text: 'the atmosphere is breezy today' },
  { handle: 'alice.mosphere.at', text: 'first time here, the grid looks lovely' },
  { handle: 'atpota.to', text: 'hello hello!' },
  { handle: 'zschamis.com', text: 'what are we building?' },
  { handle: 'xan.lol', text: 'the sky changed colour again' },
  { handle: 'flushes.app', text: 'brb' },
  { handle: 'moth.dame.is', text: 'is that a moth on the camera' },
  { handle: 'anisota.net', text: 'tonight’s moon is waxing' },
]);
