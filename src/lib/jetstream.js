// A Jetstream subscriber that watches one post.
//
// Jetstream v2 (https://bsky.network/docs/jetstream) is the firehose as plain
// JSON over a websocket. It can filter by collection and by author, but
// NOT by what a record points at — so watching one post means taking every
// like, repost and post on the network and testing each one's subject. That is
// roughly 260 messages a second, 166 KB/s, measured. Expensive, and worth it
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

const DEFAULT_ENDPOINT =
  'wss://jetstream.us-east.bsky.network/xrpc/network.bsky.jetstream.subscribeEvents';

// The three collections a piece can be pointed at from. Same set the backlink
// reader uses (see fetchPieceRecords), for the same reason.
const COLLECTIONS = ['app.bsky.feed.like', 'app.bsky.feed.repost', 'app.bsky.feed.post'];

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

// How far back a reconnect will replay. See replayCursor.
const MAX_REPLAY_MS = 30_000;

// What one watch is allowed to cost before it stops itself. ~24 minutes at the
// measured rate, and past that a piece is long-lived enough that four seconds
// of notice no longer decides anything. Stopping is reported, not silent.
const DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024;

// Deletes name a collection and a record key and nothing else, so they can't be
// pre-filtered by subject — but under `kinds=commit` they're under 2% of
// traffic, so parsing them all is cheap. This is the literal shape on the wire.
const DELETE_MARK = '"operation":"delete"';

// Record keys held for delete-matching. A Ratioed piece draws tens of records,
// but this must not be able to grow without bound on a busy post.
const MAX_TRACKED = 2000;

// How often a watch reports what it is costing and how fast it is reading.
//
// Status used to be emitted only when something MATCHED, which on a piece
// nobody has touched is never — so the panel showed "0.0 MB read" for the whole
// life of the piece and looked broken while it was working perfectly. Reporting
// throughput is the fix, and it has to be rate-limited or it becomes a React
// render at 260 Hz.
const STATUS_MS = 1000;

// And how often the clock is even consulted. A power of two so the test is a
// mask; at the measured rate this lands about four times a second, which is
// four Date.now() calls a second to police a once-a-second update.
const STATUS_EVERY = 64;

/**
 * Throughput over the last window, sampled rather than measured.
 *
 * Kept out of the socket so it can be tested with a clock you control. `mark`
 * returns null until a full window has passed, then returns that window's rate
 * and rebases. The first call only sets the baseline: there is no window before
 * it, and reporting an infinite rate for a zero-length one is worse than
 * reporting nothing.
 */
export function createMeter({ windowMs = STATUS_MS } = {}) {
  let at = 0;
  let msgs0 = 0;
  let bytes0 = 0;
  let started = false;
  return {
    mark(nowMs, msgs, bytes) {
      if (!started) {
        started = true;
        at = nowMs;
        msgs0 = msgs;
        bytes0 = bytes;
        return null;
      }
      const dt = nowMs - at;
      if (dt < windowMs) return null;
      const sample = {
        rate: Math.round(((msgs - msgs0) * 1000) / dt),
        kbps: Math.round(((bytes - bytes0) * 1000) / dt / 1024),
      };
      at = nowMs;
      msgs0 = msgs;
      bytes0 = bytes;
      return sample;
    },
  };
}

/**
 * The cursor a reconnect should ask for, or null to start live.
 *
 * v2 numbers every event with a `seq`, so resuming is exact — no rewind, no
 * duplicates, no gap. What still needs deciding is WHETHER to resume: a cursor
 * is how a dropped socket recovers the second it missed, and it is also how a
 * laptop that slept for an hour asks Jetstream to send an hour of firehose as
 * fast as it will go, which at the measured rate is about a gigabyte. That
 * decision is made on the clock, not the sequence number, because sequence
 * numbers say nothing about elapsed time.
 *
 * Past MAX_REPLAY_MS it starts live: the studio polls underneath and the
 * backlink index measures afterwards, so a long gap costs promptness, not data.
 */
export function replayCursor(lastSeq, lastTimeMs, nowMs = Date.now()) {
  if (!lastSeq || !lastTimeMs) return null;
  const gap = nowMs - lastTimeMs;
  if (gap < 0 || gap >= MAX_REPLAY_MS) return null;
  return lastSeq;
}

/**
 * A number field off the raw string, without parsing the message.
 *
 * The cursor has to advance on every message, including the ones this never
 * looks at — otherwise a reconnect resumes from wherever the last MATCHING
 * event was, which on a quiet piece is the moment it was posted. Parsing every
 * message to learn that costs 18x what reading it out of the string does.
 */
function numberField(raw, key) {
  const i = raw.indexOf(key);
  if (i < 0) return 0;
  let end = i + key.length;
  while (end < raw.length) {
    const ch = raw.charCodeAt(end);
    if (ch < 48 || ch > 57) break;
    end += 1;
  }
  return Number(raw.slice(i + key.length, end)) || 0;
}

/** `"time":"2026-08-14T00:22:52.861690Z"` → epoch ms, without parsing. */
function timeMsOf(raw) {
  const i = raw.indexOf('"time":"');
  if (i < 0) return 0;
  const end = raw.indexOf('"', i + 8);
  if (end < 0) return 0;
  const ms = Date.parse(raw.slice(i + 8, end));
  return Number.isNaN(ms) ? 0 : ms;
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
 * `onEvent` receives `{ kind, op, did, rkey, seq, time, text }` — `op` is
 * `'create'` or `'delete'`. A delete carries no record, so there is nothing on
 * it to match against a subject; only deletes of records this subscription
 * ALREADY reported are passed on. That means a like cast before the socket
 * opened and deleted while it's up goes unseen here, which is the right trade:
 * the alternative is reporting every deletion on Bluesky, and the pieces this
 * watches are watched from the moment they go up.
 *
 * `onStatus` receives `{ state, bytes, seen, msgs, rate, kbps }`, where `state`
 * is `'connecting' | 'open' | 'closed' | 'spent'`. `bytes` is what the stream
 * has cost so far — surfaced because a caller should be able to see that number
 * and decide to stop. `'spent'` is this deciding for them at `budgetBytes`.
 * `msgs` is everything the socket has delivered and `rate`/`kbps` are how fast
 * it is arriving, resampled about once a second: a watch on a piece nobody has
 * touched matches nothing for minutes, and those three are the difference
 * between a panel that looks broken and one that is visibly working.
 */
export function watchSubject(
  subject,
  { onEvent, onStatus, endpoint = DEFAULT_ENDPOINT, budgetBytes = DEFAULT_BUDGET_BYTES } = {},
) {
  let ws = null;
  let stopped = false;
  let attempt = 0;
  let lastSeq = 0;
  let lastTimeMs = 0;
  let bytes = 0;
  let seen = 0;
  let msgs = 0;
  let rate = 0;
  let kbps = 0;
  let timer = null;
  const meter = createMeter();
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
  const status = (state) =>
    onStatus?.({ state: spent ? 'spent' : state, bytes, seen, msgs, rate, kbps });

  const connect = () => {
    if (stopped) return;
    const params = new URLSearchParams();
    for (const c of COLLECTIONS) params.append('collections', c);
    // Commits only. Identity and account events can't point at a post, and
    // asking for them costs bytes for nothing.
    params.append('kinds', 'commit');
    const cursor = replayCursor(lastSeq, lastTimeMs);
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
      msgs += 1;
      // The throughput sample, on a mask rather than on every message: this is
      // the hot path, ~260 messages a second, and the number it feeds is a
      // display number.
      if ((msgs & (STATUS_EVERY - 1)) === 0) {
        const sample = meter.mark(Date.now(), msgs, bytes);
        if (sample) {
          rate = sample.rate;
          kbps = sample.kbps;
          status('open');
        }
      }
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
      const seq = numberField(raw, '"seq":');
      if (seq) lastSeq = seq;
      const t = timeMsOf(raw);
      if (t) lastTimeMs = t;

      // Reject before parsing. A record that points at this post carries the
      // post's key in its text; a substring test costs 0.6µs against 11µs to
      // parse, and better than 99.9% of the firehose fails it. Deletes have no
      // subject in them at all, so they're let through to the parser — on v2
      // they're under 2% of traffic, which is affordable.
      if (!raw.includes(subjectKey) && !raw.includes(DELETE_MARK)) return;

      let e;
      try {
        e = JSON.parse(raw);
      } catch {
        return;
      }
      // v2 wraps every event in an envelope and puts the commit's fields flat
      // on the payload, where v1 nested them under `commit`.
      const c = e.payload;
      if (!c || !c.collection) return;

      if (c.operation === 'delete') {
        const kind = mine.get(c.rkey);
        if (!kind) return;
        mine.delete(c.rkey);
        onEvent?.({ kind, op: 'delete', did: c.did, rkey: c.rkey, seq: c.seq, time: c.time });
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
        did: c.did,
        rkey: c.rkey,
        seq: c.seq,
        time: c.time,
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

/* ------------------------------------------------------------------ */
/* Replaying a window that has already happened                         */
/* ------------------------------------------------------------------ */

// How long Jetstream's live socket will look back. Documented as 36 hours; a
// cursor older than that is refused, so there is no point asking.
export const LOOKBACK_MS = 36 * 60 * 60 * 1000;

/** Is this moment still inside the lookback window? */
export function withinLookback(ms, nowMs = Date.now()) {
  if (!ms) return false;
  const age = nowMs - ms;
  return age >= 0 && age < LOOKBACK_MS;
}

/**
 * Replay a window of the past and collect everything that pointed at a post.
 *
 * The live socket accepts a cursor into its own 36-hour lookback and replays
 * from there at about 78,000 events a second — measured, so an hour of history
 * arrives in under a minute. Unlike the backlink index, that replay carries
 * DELETES, which is the whole reason this exists: six of the thirteen breaking
 * likes were deleted by the people who cast them, and every one of those
 * reaction times was lost because the like was gone before anything read it.
 * Inside the lookback it isn't gone. It's just in the past.
 *
 * The window is normally a piece's own lifespan, which is seconds to minutes —
 * the breaking like lands inside it by definition. But a cursor does not land
 * where it is asked: Jetstream rewinds to a block boundary, measured at up to
 * half an hour early, and that overshoot has to be read through before the
 * window even starts. Unfiltered that is ~300 MB to recover one like.
 *
 * So pass `dids` whenever you know them. For a Ratioed piece you always do —
 * the reply concluding it names the breaker, which is the only reason a
 * deleted like has a name at all — and filtering to that one account server-
 * side turns the whole replay into a handful of events.
 *
 * Resolves `{ events, bytes, reachedEnd, error }`. `reachedEnd` is false when
 * the budget stopped it early, so a caller can tell "nothing was there" from
 * "we stopped looking".
 */
export function replayWindow(
  subject,
  {
    fromMs,
    toMs,
    dids = [],
    collections = ['app.bsky.feed.like'],
    endpoint = DEFAULT_ENDPOINT,
    budgetBytes = DEFAULT_BUDGET_BYTES,
    onProgress,
  } = {},
) {
  return new Promise((resolve) => {
    if (!subject || !fromMs || !toMs || toMs <= fromMs) {
      resolve({ events: [], bytes: 0, reachedEnd: false, error: 'bad window' });
      return;
    }
    if (!withinLookback(fromMs)) {
      resolve({ events: [], bytes: 0, reachedEnd: false, error: 'outside the 36-hour lookback' });
      return;
    }

    const subjectKey = String(subject).split('/').pop() || '\u0000';
    const params = new URLSearchParams();
    for (const c of collections) params.append('collections', c);
    for (const d of dids) params.append('dids', d);
    params.append('kinds', 'commit');
    // Microseconds, and a second early so the window's own first event can't
    // fall on the wrong side of a rounding. The server will rewind further.
    params.set('cursor', String((fromMs - 1000) * 1000));

    const events = [];
    const mine = new Map();
    let bytes = 0;
    let done = false;
    let ws;

    const finish = (reachedEnd, error) => {
      if (done) return;
      done = true;
      try {
        ws?.close();
      } catch {
        /* already gone */
      }
      resolve({ events, bytes, reachedEnd, error: error || null });
    };

    try {
      ws = new WebSocket(`${endpoint}?${params}`);
    } catch (err) {
      finish(false, err?.message || 'could not open the stream');
      return;
    }

    ws.onmessage = (msg) => {
      const raw = typeof msg.data === 'string' ? msg.data : '';
      bytes += raw.length;
      if (bytes > budgetBytes) {
        finish(false, 'budget spent before the window closed');
        return;
      }

      const t = timeMsOf(raw);
      if (t) {
        if (t > toMs) {
          finish(true);
          return;
        }
        onProgress?.({ at: t, bytes, found: events.length });
      }

      if (!raw.includes(subjectKey) && !raw.includes(DELETE_MARK)) return;
      let e;
      try {
        e = JSON.parse(raw);
      } catch {
        return;
      }
      const c = e.payload;
      if (!c || !c.collection) return;

      if (c.operation === 'delete') {
        // Only deletes of records this replay already saw created — the same
        // rule the live watch uses, and here it is exactly right: a like made
        // and unmade inside the window is fully described by the pair.
        const kind = mine.get(c.rkey);
        if (!kind) return;
        events.push({ kind, op: 'delete', did: c.did, rkey: c.rkey, seq: c.seq, time: c.time });
        return;
      }
      const kind = classify(c.collection, c.record, subject);
      if (!kind) return;
      mine.set(c.rkey, kind);
      events.push({
        kind,
        op: 'create',
        did: c.did,
        rkey: c.rkey,
        seq: c.seq,
        time: c.time,
        text: typeof c.record?.text === 'string' ? c.record.text : '',
      });
    };

    ws.onerror = () => {
      /* onclose follows */
    };
    // A cursor the server won't serve closes the socket rather than erroring.
    ws.onclose = () => finish(false, events.length ? null : 'the stream closed before the window did');
  });
}
