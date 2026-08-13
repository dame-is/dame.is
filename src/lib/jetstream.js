// A Jetstream subscriber that watches one post.
//
// Jetstream (https://github.com/bluesky-social/jetstream) is the firehose as
// plain JSON over a websocket. It can filter by collection and by author, but
// NOT by what a record points at — so watching one post means taking every
// like, repost and post on the network and testing each one's subject. That is
// roughly 320 messages a second, 180 KB/s, measured. Expensive, and worth it
// for exactly one thing: a Ratioed piece's reaction time is six to seventeen
// seconds, and polling an API every four seconds spends a quarter of that
// window waiting. The stream arrives in real time.
//
// So this is not a general-purpose reader. It's for the minutes a piece is
// alive, and the caller is expected to close it the moment one is sealed.
//
// Deletes are reported too, and matter here more than anywhere else on the
// site: six of the thirteen breaking likes were deleted by the people who cast
// them, and this is the only way to watch that happen rather than infer it
// afterwards from an absence.

const DEFAULT_ENDPOINT = 'wss://jetstream2.us-east.bsky.network/subscribe';

// The three collections a piece can be pointed at from. Same set the backlink
// reader uses (see fetchPieceRecords), for the same reason.
const COLLECTIONS = ['app.bsky.feed.like', 'app.bsky.feed.repost', 'app.bsky.feed.post'];

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

/**
 * Which way this record points at `subject`, or null if it doesn't.
 *
 * A quote can nest one level (a post that quotes-with-media wraps the ref), and
 * a reply is matched on its ROOT rather than its parent: a reply to a reply is
 * still engagement with the piece, and it's what `.reply.root.uri` counts in
 * every other reader here.
 */
export function classify(collection, record, subject) {
  if (!record || !subject) return null;
  if (collection === 'app.bsky.feed.like' && record.subject?.uri === subject) return 'like';
  if (collection === 'app.bsky.feed.repost' && record.subject?.uri === subject) return 'repost';
  if (collection === 'app.bsky.feed.post') {
    if (record.reply?.root?.uri === subject || record.reply?.parent?.uri === subject) return 'reply';
    const embed = record.embed;
    if (embed?.record?.uri === subject || embed?.record?.record?.uri === subject) return 'quote';
  }
  return null;
}

/**
 * Watch one post. Returns a function that closes the socket for good.
 *
 * `onEvent` receives `{ kind, op, did, rkey, timeUs, text }` — `op` is
 * `'create'` or `'delete'`. A delete carries no record, so there is nothing on
 * it to match against a subject; only deletes of records this subscription
 * ALREADY reported are passed on. That means a like cast before the socket
 * opened and deleted while it's up goes unseen here, which is the right trade:
 * the alternative is reporting every deletion on Bluesky, and the pieces this
 * watches are watched from the moment they go up.
 *
 * `onStatus` receives `{ state, bytes, seen }`, where `state` is
 * `'connecting' | 'open' | 'closed'`. `bytes` is what the stream has cost so
 * far — surfaced because a caller should be able to see that number and decide
 * to stop.
 */
export function watchSubject(subject, { onEvent, onStatus, endpoint = DEFAULT_ENDPOINT } = {}) {
  let ws = null;
  let stopped = false;
  let attempt = 0;
  let cursorUs = null;
  let bytes = 0;
  let seen = 0;
  let timer = null;
  // Record keys this subscription has reported as creates. A delete names only
  // a collection and an rkey, so this is the only way to know whether one is
  // ours — and without it the caller hears about every deletion on the network.
  const mine = new Map(); // rkey → kind

  const status = (state) => onStatus?.({ state, bytes, seen });

  const connect = () => {
    if (stopped) return;
    const params = new URLSearchParams();
    for (const c of COLLECTIONS) params.append('wantedCollections', c);
    // Replay from a second before the last thing we saw, so a reconnect can't
    // drop the one message this whole subscription exists for. Duplicates are
    // the caller's problem and cheap; a missed like is not recoverable.
    if (cursorUs) params.set('cursor', String(cursorUs - 1_000_000));

    status('connecting');
    try {
      ws = new WebSocket(`${endpoint}?${params}`);
    } catch {
      schedule();
      return;
    }

    ws.onopen = () => {
      attempt = 0;
      status('open');
    };

    ws.onmessage = (msg) => {
      bytes += typeof msg.data === 'string' ? msg.data.length : 0;
      let e;
      try {
        e = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (e.time_us) cursorUs = e.time_us;
      const c = e.commit;
      if (e.kind !== 'commit' || !c) return;

      if (c.operation === 'delete') {
        const kind = mine.get(c.rkey);
        if (!kind) return;
        mine.delete(c.rkey);
        onEvent?.({ kind, op: 'delete', did: e.did, rkey: c.rkey, timeUs: e.time_us });
        return;
      }
      const kind = classify(c.collection, c.record, subject);
      if (!kind) return;
      seen += 1;
      mine.set(c.rkey, kind);
      onEvent?.({
        kind,
        op: 'create',
        did: e.did,
        rkey: c.rkey,
        timeUs: e.time_us,
        text: typeof c.record?.text === 'string' ? c.record.text : '',
      });
      status('open');
    };

    ws.onerror = () => {
      /* onclose follows; reconnect is handled there */
    };

    ws.onclose = () => {
      status('closed');
      schedule();
    };
  };

  const schedule = () => {
    if (stopped) return;
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    timer = setTimeout(connect, wait);
  };

  connect();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    try {
      ws?.close();
    } catch {
      /* already gone */
    }
  };
}
