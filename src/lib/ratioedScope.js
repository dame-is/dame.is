// A live piece, drawn on the page grid.
//
// The piece page and the studio both open on a timeline while a take is up: a
// lane for each kind of record, every record a mark where it landed, and the
// rest of the series as ticks along the top at the lengths they stood. Its
// clock is the page grid itself. One column is a fixed number of minutes, so
// the grid's own lines are the axis and a mark's column says roughly when it
// landed without anyone reading a label.
//
// Everything here is the arithmetic for that, kept out of the components so
// it can be tested: how many columns the drawing has, how many minutes each
// one stands for, what the axis says, the three figures a piece has while it
// is still up, and where the live take sits in the series by length.

const MIN = 60_000;

/** The kinds of record a piece counts. */
const KINDS = new Set(['like', 'repost', 'quote', 'reply']);

/**
 * Minutes a column may stand for. Divisions of an hour and multiples of it,
 * so the axis counts in steps a reader can add up: 6m, 12m, 18m, not 7m, 14m.
 */
export const SCOPE_STEPS = [1, 2, 3, 5, 6, 10, 12, 15, 20, 30, 60, 120, 240];

/**
 * Room past the furthest mark, as a share of it. The record's tick carries a
 * label and the live piece's line carries another; with the span drawn edge to
 * edge, the longest take's tick sat on the frame's last pixel.
 */
const HEADROOM = 1.04;

/**
 * How many whole columns fit across `width` pixels of the grid.
 *
 * A run of n columns is n pitches less the one gutter it doesn't end on, so
 * the gutter is handed back before dividing. Half a pixel of slack absorbs the
 * rounding a browser does to a width measured in rem.
 */
export function scopeColumns(width, pitch, gutter = 0) {
  if (!(width > 0) || !(pitch > 0)) return 0;
  return Math.max(1, Math.floor((width + gutter + 0.5) / pitch));
}

/**
 * Minutes to a column: the smallest step that fits `spanMs` into `cols`
 * columns with a little room past it.
 *
 * The span is the longer of the record and the live piece, so the record is
 * always on the drawing while it stands, and the scale changes once, when the
 * live piece passes it. A minute is the least span drawn, so the first seconds
 * of a piece with no record to run at aren't stretched across the page.
 */
export function scopeStep(cols, spanMs) {
  const need = (Math.max(spanMs || 0, MIN) / MIN) * HEADROOM;
  const across = Math.max(1, cols || 0);
  const step = SCOPE_STEPS.find((s) => s * across >= need);
  return step || Math.ceil(need / across / 60) * 60;
}

/** `6` → `6m`, `60` → `1h`, `90` → `1h30m`. */
export function stepLabel(minutes) {
  const m = Math.round(minutes || 0);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h${String(rest).padStart(2, '0')}m` : `${h}h`;
}

/** The axis: one label at the start of every column. */
export function scopeAxis(cols, step) {
  return Array.from({ length: Math.max(0, cols || 0) }, (_, i) => ({
    i,
    label: i === 0 ? '0' : `+${stepLabel(i * step)}`,
  }));
}

const WORDS = {
  2: 'two',
  3: 'three',
  5: 'five',
  6: 'six',
  10: 'ten',
  12: 'twelve',
  15: 'fifteen',
  20: 'twenty',
  30: 'thirty',
};

/** What one column is, as the caption says it: "six minutes", "an hour". */
export function columnSays(step) {
  if (step === 1) return 'a minute';
  if (step === 60) return 'an hour';
  if (step > 60 && step % 60 === 0) {
    const h = step / 60;
    return `${WORDS[h] || h} hours`;
  }
  return `${WORDS[step] || step} minutes`;
}

/**
 * The three figures a piece has while it is still up, from the witnessed log:
 * when the first thing arrived, the longest stretch when nothing did, and the
 * pace of what still stands.
 *
 * `endMs` is where the piece's life stops for these purposes: the like that
 * ended it, or the present. The silence runs to it, so on a quiet piece the
 * silence going on right now is the longest there has been, and it says so.
 * The artist's own records are in none of the three, as they are in none of
 * the counts. A record taken back still landed, so it counts as a touch and
 * breaks a silence; it isn't standing, so it adds nothing to the pace.
 */
export function liveTexture(rows, { selfDid = null, endMs = 0 } = {}) {
  const theirs = (rows || []).filter(
    (r) => r && typeof r.offMs === 'number' && !(selfDid && r.did === selfDid) && r.offMs <= endMs,
  );
  const at = theirs.map((r) => r.offMs).sort((a, b) => a - b);
  const firstMs = at.length ? at[0] : null;
  let silence = null;
  let last = 0;
  for (const off of [...at, endMs]) {
    const gap = off - last;
    if (gap > 0 && (!silence || gap > silence.ms)) silence = { ms: gap, fromMs: last };
    last = off;
  }
  const standing = theirs.filter((r) => r.goneMs == null && KINDS.has(r.k)).length;
  const pace = endMs > 0 ? standing / (endMs / MIN) : null;
  return { firstMs, silence, pace, records: standing };
}


/** Records a minute, the way a figure is read: `0.6/min`, `12/min`. */
export function fmtPace(pace) {
  if (typeof pace !== 'number' || !Number.isFinite(pace)) return '—';
  return `${pace >= 10 ? Math.round(pace) : pace.toFixed(1)}/min`;
}

/**
 * Every take by how long it stood, longest first, with the live one among them
 * at however long it has stood so far.
 *
 * `standingMs` is the live piece's length: the time since it went up, or, once
 * somebody has liked it, the moment they did. Each bar carries its length as a
 * share of the longest (`at`), and whether the live piece has outlived it.
 * A tie keeps the finished piece ahead: it got there first, which is what the
 * longest-piece record already says about ties.
 */
export function seriesRank(pieces, { take = null, standingMs = 0 } = {}) {
  const bars = (pieces || [])
    .filter((p) => p && p.lifespanMs > 0)
    .map((p) => ({ key: p.rkey || `take-${p.take}`, take: p.take, ms: p.lifespanMs, live: false }));
  const liveMs = Math.max(0, standingMs || 0);
  bars.push({ key: 'live', take, ms: liveMs, live: true });
  bars.sort((a, b) => b.ms - a.ms || Number(a.live) - Number(b.live));
  const top = bars[0].ms || 1;
  return {
    bars: bars.map((b) => ({ ...b, at: Math.min(1, b.ms / top), passed: !b.live && b.ms < liveMs })),
    rank: bars.findIndex((b) => b.live) + 1,
    total: bars.length,
  };
}

/** `1` → `1st`, `22` → `22nd`, `13` → `13th`. */
export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

/**
 * Where the live take stands in the series, as a sentence. `ended` is a piece
 * somebody has liked: its length is settled, so it no longer climbs.
 */
export function seriesSentence({ rank, total, ended = false }) {
  if (!rank || !total) return '';
  const place = rank === 1 ? 'the longest' : `the ${ordinal(rank)} longest`;
  if (ended) return `Over, as ${place} of ${total}.`;
  if (rank === 1) return `The longest of ${total} so far: every take is behind it.`;
  return `${place[0].toUpperCase()}${place.slice(1)} of ${total} so far. It climbs this list while it stands.`;
}
