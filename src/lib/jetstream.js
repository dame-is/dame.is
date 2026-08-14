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

// How far back a reconnect will replay. See replayCursor.
const MAX_REPLAY_US = 30_000_000;

// What one watch is allowed to cost before it stops itself. ~24 minutes at the
// measured rate, and past that a piece is long-lived enough that four seconds
// of notice no longer decides anything. Stopping is reported, not silent.
const DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024;

// Deletes name a collection and a record key and nothing else, so they can't be
// pre-filtered by subject — but they're only ~6% of traffic, so parsing them
// all is cheap. This is the literal shape on the wire.
const DELETE_MARK = '"operation":"delete"';

// Record keys held for delete-matching. A Ratioed piece draws tens of records,
// but this must not be able to grow without bound on a busy post.
const MAX_TRACKED = 2000;

/**
 * The cursor a reconnect should ask for, or null to start live.
 *
 * A cursor is how a dropped socket picks up what it missed. It is also how a
 * laptop that slept for an hour asks Jetstream to send an hour of firehose as
 * fast as it can, which at the measured rate is about a gigabyte. Past
 * MAX_REPLAY_US it starts live instead: the studio polls underneath and the
 * backlink index takes the real measurement afterwards, so a long gap costs
 * promptness, not data.
 */
export function replayCursor(cursorUs, nowMs = Date.now()) {
  if (!cursorUs) return null;
  const gap = nowMs * 1000 - cursorUs;
  if (gap < 0 || gap >= MAX_REPLAY_US) return null;
  // A second of overlap, so a reconnect can't drop the one message this whole
  // subscription exists for. Duplicates are the caller's problem and cheap; a
  // missed like is not recoverable.
  return cursorUs - 1_000_000;
}

/**
 * `time_us` off the raw string, without parsing the message.
 *
 * The cursor has to advance on every message, including the ones this never
 * looks at — otherwise a reconnect resumes from wherever the last MATCHING
 * event was, which on a quiet piece is the moment it was posted.
 */
function timeUsOf(raw) {
  const i = raw.indexOf('"time_us":');
  if (i < 0) return 0;
  let end = i + 10;
  while (end < raw.length) {
    const ch = raw.charCodeAt(end);
    if (ch < 48 || ch > 57) break;
    end += 1;
  }
  return Number(raw.slice(i + 10, end)) || 0;
}

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
 * `'connecting' | 'open' | 'closed' | 'spent'`. `bytes` is what the stream has
 * cost so far — surfaced because a caller should be able to see that number and
 * decide to stop. `'spent'` is this deciding for them at `budgetBytes`.
 */
export function watchSubject(
  subject,
  { onEvent, onStatus, endpoint = DEFAULT_ENDPOINT, budgetBytes = DEFAULT_BUDGET_BYTES } = {},
) {
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
  // The post's own record key: distinctive enough that its presence in a raw
  // message is a near-certain sign the record points here, and cheap to test.
  const subjectKey = String(subject || '').split('/').pop() || '\u0000';

  // Spending the budget is terminal, and closing the socket to enforce it fires
  // onclose — which would otherwise report 'closed' over the top of 'spent' and
  // leave the caller showing a stopped stream as merely disconnected.
  let spent = false;
  const status = (state) => onStatus?.({ state: spent ? 'spent' : state, bytes, seen });

  const connect = () => {
    if (stopped) return;
    const params = new URLSearchParams();
    for (const c of COLLECTIONS) params.append('wantedCollections', c);
    const cursor = replayCursor(cursorUs);
    if (cursor) params.set('cursor', String(cursor));

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
      const raw = typeof msg.data === 'string' ? msg.data : '';
      bytes += raw.length;
      if (bytes > budgetBytes) {
        stopped = true;
        spent = true;
        status('spent');
        try {
          ws?.close();
        } catch {
          /* already gone */
        }
        return;
      }

      // The cursor advances on everything, matched or not.
      const t = timeUsOf(raw);
      if (t) cursorUs = t;

      // Reject before parsing. A record that points at this post carries the
      // post's key in its text; a substring test costs 0.6µs against 11µs to
      // parse, and better than 99.9% of the firehose fails it. Deletes have no
      // subject in them at all, so they're let through to the parser — they're
      // 6% of traffic, which is affordable.
      if (!raw.includes(subjectKey) && !raw.includes(DELETE_MARK)) return;

      let e;
      try {
        e = JSON.parse(raw);
      } catch {
        return;
      }
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
      if (mine.size > MAX_TRACKED) mine.delete(mine.keys().next().value);
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
