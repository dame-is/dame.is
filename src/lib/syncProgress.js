// The Analytics studio's sync bar, as arithmetic. The sweeps (analyticsSync.js,
// carRepo.js) report facts — rows read, how far back a walk has reached, which
// stage of a multi-stage sweep is under way — and this module turns those into
// how much of each STEP is done. No fetch, no DOM, no state.
//
// The bar is one segment per step, each filled by its own measured progress,
// rather than one bar pretending to know the whole sync's length. A step's
// share is only ever a measurement against something real:
//
//   a count     rows read of a total known up front (the last sweep's size,
//               the profile counter, a list of lists already in hand)
//   a date      a newest-first walk measured by how far back it has reached,
//               counted against the dates the archive already holds — "posts
//               newer than here" over "posts the walk has to reach" — or, where
//               nothing is held, by time itself
//   a stage     a sweep whose stages take very different times gets a span
//               per stage, sized by measurement (see BLOCK_STAGES)
//
// When there is nothing honest to measure against, a share is null and the
// segment shows motion instead of a made-up number. Every share is held under
// 1 until the step itself finishes, so a bar never claims done early.

/** The highest a step's own share may read before the step says it is done. */
const CEILING = 0.99;

/**
 * Every step a sync can take, in the order it takes them: `label` names the
 * bar's segment, `doing` heads the status line while it runs.
 */
export const SYNC_STEPS = Object.freeze({
  followers: Object.freeze({ label: 'Followers', doing: 'Sweeping followers' }),
  following: Object.freeze({ label: 'Follows', doing: 'Reading who you follow' }),
  blocks: Object.freeze({ label: 'Blocks', doing: 'Reading direct and list blocks' }),
  repo: Object.freeze({ label: 'Repo', doing: 'Downloading the repo' }),
  posts: Object.freeze({ label: 'Posts', doing: 'Archiving posts' }),
  inbound: Object.freeze({ label: 'Notifications', doing: 'Reading notifications' }),
  outbound: Object.freeze({ label: 'Likes', doing: 'Reading likes & reposts' }),
});

/** The steps every sync plans for. `outbound` joins only when the repo fails. */
export const SYNC_PLAN = Object.freeze(['followers', 'following', 'blocks', 'repo', 'posts', 'inbound']);

function clamp01(v) {
  return Math.min(CEILING, Math.max(0, v));
}

/** `done` of `total` as a share, or null when there is no total to measure by. */
export function share(done, total) {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  return clamp01(done / total);
}

/**
 * Where a share sits inside a span of its step: `[from, to]` scaled by
 * `inner` (0–1, null read as 0 — the stage has started, nothing measured yet).
 */
function within([from, to], inner) {
  return clamp01(from + (to - from) * (inner ?? 0));
}

/* ------------------------------------------------------------------ */
/* Blocks                                                               */
/* ------------------------------------------------------------------ */

/**
 * The blocks sweep's four stages, as spans of its segment. Sized by a
 * measured run on this account (direct ~3s, finding lists ~1s, checking ~600
 * lists ~7s, walking ~280 moderation lists' subscribers ~70s): the last stage
 * is most of the wait, so it is most of the bar.
 */
export const BLOCK_STAGES = Object.freeze({
  direct: Object.freeze([0, 0.05]),
  lists: Object.freeze([0.05, 0.08]),
  check: Object.freeze([0.08, 0.2]),
  subscribers: Object.freeze([0.2, 1]),
});

/**
 * The blocks step's share from one sweepBlocks progress report.
 * `directEstimate` is the direct-block count the last sync found, the only
 * measure there is for the first stage; without it that stage reads as its
 * start until it ends. The membership stage has no count to measure against,
 * so it holds its start too — it is about a second long.
 */
export function blocksFraction(p, { directEstimate = null } = {}) {
  const span = BLOCK_STAGES[p?.stage];
  if (!span) return null;
  if (p.stage === 'direct') return within(span, share(p.done, directEstimate));
  if (p.stage === 'lists') return within(span, 0);
  // Nothing to check or walk is a finished stage, not an unmeasured one.
  if (p.total === 0) return within(span, 1);
  return within(span, share(p.done, p.total));
}

/* ------------------------------------------------------------------ */
/* Repo                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The repo step is a download, a parse, then writing what it found into this
 * browser's archive. Measured on this account in Chromium: ~66 MB downloaded
 * in ~10s, ~3s of parsing, then ~17s writing ~190,000 rows to IndexedDB — the
 * write is the longest part, so it is half the segment.
 */
export const REPO_SPANS = Object.freeze({
  download: Object.freeze([0, 0.4]),
  read: Object.freeze([0.4, 0.5]),
  save: Object.freeze([0.5, 1]),
});

/** The parse's own stages (readRepoCar), as spans of the parse. */
export const REPO_READ_STAGES = Object.freeze({
  index: Object.freeze([0, 0.25]),
  walk: Object.freeze([0.25, 0.45]),
  decode: Object.freeze([0.45, 1]),
});

/**
 * The repo step's share while downloading. The PDS streams the CAR without a
 * Content-Length, so the total is usually the size of the last full pull —
 * null (motion, no number) when there is no such size to go by.
 */
export function repoDownloadFraction(bytes, totalBytes) {
  const s = share(bytes, totalBytes);
  return s == null ? null : within(REPO_SPANS.download, s);
}

/**
 * The repo step's share while parsing, from one readRepoCar report. The walk
 * has no total of its own; `expectedRecords` (the records the last pull held)
 * is the measure when there is one.
 */
export function repoReadFraction(p, { expectedRecords = null } = {}) {
  const span = REPO_READ_STAGES[p?.stage];
  if (!span) return null;
  const inner = p.stage === 'walk' ? share(p.done, expectedRecords) : share(p.done, p.total);
  return within(REPO_SPANS.read, within(span, inner));
}

/** The repo step's share while writing rows into the archive. */
export function repoSaveFraction(written, total) {
  if (total === 0) return within(REPO_SPANS.save, 1);
  return within(REPO_SPANS.save, share(written, total));
}

/* ------------------------------------------------------------------ */
/* Newest-first walks: posts, notifications, likes                      */
/* ------------------------------------------------------------------ */

/** How many of the ascending `times` are at or after `ms` (binary search). */
export function countAtOrAfter(timesAsc, ms) {
  let lo = 0;
  let hi = timesAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timesAsc[mid] < ms) lo = mid + 1;
    else hi = mid;
  }
  return timesAsc.length - lo;
}

/**
 * A newest-first walk measured against dates the archive already holds: the
 * items newer than where the walk has reached, over the items newer than
 * where it has to reach. Exact for the post archive, whose dates the repo
 * seed or the last sync already knows — a quiet year and a busy month weigh
 * what they actually weigh. Null when nothing held lies in the range.
 *
 * @param {number[]} timesAsc   the held items' times, ascending
 * @param {number|null} reachedMs  the oldest item the walk has read (null: none yet)
 * @param {number} targetMs     how far back the walk has to go
 */
export function walkFraction(timesAsc, reachedMs, targetMs) {
  const want = countAtOrAfter(timesAsc, targetMs);
  if (!want) return null;
  if (reachedMs == null) return 0;
  return share(countAtOrAfter(timesAsc, reachedMs), want);
}

/**
 * A newest-first walk measured by time alone, for feeds whose items the
 * archive cannot know ahead (notifications): how far back from `startMs` the
 * walk has reached, over how far back it has to go.
 */
export function timeFraction(startMs, reachedMs, targetMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(targetMs) || startMs <= targetMs) return null;
  if (reachedMs == null) return 0;
  return share(startMs - reachedMs, startMs - targetMs);
}

/**
 * The likes-and-reposts fallback walks two collections in turn; each is half
 * the step, and within each, time is the measure.
 */
export function partsFraction(part, parts, inner) {
  if (!Number.isFinite(part) || !Number.isFinite(parts) || parts <= 0) return null;
  return clamp01((part + (inner ?? 0)) / parts);
}
