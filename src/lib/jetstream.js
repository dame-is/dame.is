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

// How long a socket has to stay up before its drop counts as a fresh failure
// rather than the next one in a run. Resetting the backoff on open alone meant
// an endpoint that accepts and then hangs up — what an overloaded server does
// — was redialled every second, by every open page, for as long as it kept
// doing it.
const STABLE_MS = 10_000;

// Reconnects are spread ±30% so pages that lost the same server at the same
// moment don't all come back at the same moment too.
const JITTER = 0.3;

// How far back a reconnect will replay. See replayCursor.
const MAX_REPLAY_MS = 30_000;

// What one watch is allowed to cost before it stops itself. ~24 minutes at the
// measured rate. Stopping is reported, not silent.
//
// It is also OPTIONAL: pass `budgetBytes: null` and the socket runs until the
// caller closes it. That is the right setting wherever the person watching is
// the person paying — the studio, where stopping is how you lose the one like
// the whole panel exists to catch — and the wrong one on a page a stranger
// opened, where a default that reads a firehose forever is not a default
// anybody chose. There is no third option available at the socket: Jetstream
// filters by collection and by author, and a Ratioed piece is watched for what
// records POINT at, which no server-side filter can express. The bytes are the
// bytes. All that can be decided is who spends them and for how long.
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
 * and decide to stop. `'spent'` is this deciding for them at `budgetBytes`,
 * which only happens when a caller asked for a budget: pass `null` and the only
 * thing that ends this socket is the function it returns.
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
  let openedAt = 0;
  const meter = createMeter();
  // null / 0 / Infinity all mean "run until told to stop".
  const capped = Number.isFinite(budgetBytes) && budgetBytes > 0;
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
      openedAt = Date.now();
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
      if (capped && bytes > budgetBytes) {
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

      // The cursor advances on everything, matched or not. Its age is kept on
      // this machine's clock, not read off the event: replayCursor measures the
      // gap against Date.now(), and a client clock running behind the server's
      // made every gap negative and threw every resume away.
      const seq = numberField(raw, '"seq":');
      if (seq) {
        lastSeq = seq;
        lastTimeMs = Date.now();
      }

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
      if (openedAt && Date.now() - openedAt >= STABLE_MS) attempt = 0;
      openedAt = 0;
      status('closed');
      schedule();
    };
  };

  const schedule = () => {
    if (stopped) return;
    const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    const wait = Math.round(base * (1 - JITTER + Math.random() * 2 * JITTER));
    timer = setTimeout(connect, wait);
  };

  connect();

  return () => {
    const wasStopped = stopped;
    stopped = true;
    if (timer) clearTimeout(timer);
    // Silenced before it's closed. The close lands a moment later, and its
    // 'closed' would be reported through the same onStatus as whatever watch
    // the caller has opened in this one's place.
    if (ws) ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      ws?.close();
    } catch {
      /* already gone */
    }
    // So the close is said here instead, while the setter is still this
    // watch's: a replacement opened next reports over it, and a watch stopped
    // for good (the seal, a hidden tab) still ends on 'closed' rather than on
    // its last live rate. A watch that spent its budget already said so.
    if (!wasStopped) status('closed');
  };
}

/* ------------------------------------------------------------------ */
/* Replaying a window that has already happened                         */
/* ------------------------------------------------------------------ */

// How long Jetstream's live socket will look back. Documented as 36 hours; a
// cursor older than that is refused, so there is no point asking.
export const LOOKBACK_MS = 36 * 60 * 60 * 1000;

// Settling a replay that has caught up with the present. Every other way a
// replay ends is an event — one stamped past the window, the budget, the
// socket closing — and a stream filtered to one account delivers nothing at
// all once it reaches now, until that account next does something. So a
// replay is also done when it has gone quiet for a while, but only once it
// can plausibly have read through the backlog: a filtered stream is just as
// silent while the server is still scanning the hours before the window.
//
// The server replays at about 300x real time (78,000 events a second against a
// live rate near 260, measured); a third of that is assumed. Plus the rewind:
// a cursor lands up to half an hour early.
const REPLAY_SPEEDUP = 100;
const REPLAY_REWIND_MS = 30 * 60 * 1000;
const REPLAY_QUIET_MS = 8_000;
// And a hard stop, whatever the stream is doing: at least two minutes, or three
// times the expected catch-up.
const REPLAY_MIN_MS = 2 * 60 * 1000;

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
 * the budget or the time limit stopped it early, so a caller can tell "nothing
 * was there" from "we stopped looking". It always resolves: a replay that has
 * caught up and gone quiet counts as having reached the end.
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
    maxMs,
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
    let watchdog = null;

    const startedAt = Date.now();
    const catchUpMs = (startedAt - fromMs + REPLAY_REWIND_MS) / REPLAY_SPEEDUP;
    const caughtUpBy = startedAt + catchUpMs;
    const giveUpAt =
      startedAt + (maxMs ?? Math.max(REPLAY_MIN_MS, 3 * catchUpMs));
    let lastMsgAt = startedAt;

    const finish = (reachedEnd, error) => {
      if (done) return;
      done = true;
      clearInterval(watchdog);
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

    watchdog = setInterval(() => {
      const now = Date.now();
      if (now >= giveUpAt) {
        finish(false, 'the replay ran out of time');
        return;
      }
      if (
        now > toMs &&
        now >= caughtUpBy &&
        now - lastMsgAt >= REPLAY_QUIET_MS
      ) {
        finish(true);
      }
    }, 1000);

    ws.onmessage = (msg) => {
      lastMsgAt = Date.now();
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
