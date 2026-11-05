// Stream overlays: the model behind /overlay/:id and the admin's Overlays
// studio. Pure, so vitest can pin it in `node`.
//
// One record per overlay, `is.dame.overlay/{id}` (lexicons/is.dame.overlay.json).
// The shape came from atpota.to's to.atpota.poe.overlay — a record per layout,
// widgets with a kind and a place, the page following saves live — with two
// changes that make it dame.is's rather than a port:
//
//  1. Widgets sit on the PAGE GRID, not in six corner slots. The site's grid is
//     a 5.75rem column and a 1.5rem gutter (theme.css): at a 16px rem that is a
//     92px column on a 116px pitch, and 1920px holds sixteen of them, which is
//     the grid the site itself draws at its widest. The canvas carries that
//     pitch down as well as across, so a cell is square and the 1080px height
//     holds nine rows. Every widget is a rectangle of whole cells, so whatever
//     is on screen lines up the way the site's pages do.
//
//  2. atpotato keeps its full-screen scenes (starting, brb, ending, screen
//     share) in a second lexicon. Here a scene is just an overlay whose
//     backdrop is the page: the same widgets, the same grid, one record type.
//     The presets below are the scenes, as starting points.
//
// Everything that reads a record goes through fromRecord(), which keeps what
// checks out and fills the rest in, so the renderer never trusts a field it
// hasn't checked (a record can be written by hand, or by a later version).

export const OVERLAY_NSID = 'is.dame.overlay';

/* --- the canvas and its grid ---------------------------------------------- */

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;
/** One column, in canvas pixels: theme.css's --col (5.75rem) at a 16px rem. */
export const CELL = 92;
/** One gutter: theme.css's --gutter (1.5rem). */
export const GUTTER = 24;
export const PITCH = CELL + GUTTER;
export const COLS = 16;
export const ROWS = 9;
/** What's left either side once the columns are centred: 44px across, 30px down. */
export const MARGIN_X = (CANVAS_W - (COLS * CELL + (COLS - 1) * GUTTER)) / 2;
export const MARGIN_Y = (CANVAS_H - (ROWS * CELL + (ROWS - 1) * GUTTER)) / 2;

/** A span of `n` cells, gutters included. */
export const span = (n) => n * CELL + (n - 1) * GUTTER;

/** A widget's box on the canvas, in canvas pixels. */
export function boxOf(w) {
  return {
    left: MARGIN_X + (w.col - 1) * PITCH,
    top: MARGIN_Y + (w.row - 1) * PITCH,
    width: span(w.cols),
    height: span(w.rows),
  };
}

/**
 * The grid line nearest a canvas position: the column (or row) whose cell a
 * point falls in, counting a gutter with the cell before it. Clamped to the
 * grid, so a drag past the canvas edge pins rather than vanishes.
 */
export function cellAt(x, y) {
  const col = Math.floor((x - MARGIN_X + GUTTER / 2) / PITCH) + 1;
  const row = Math.floor((y - MARGIN_Y + GUTTER / 2) / PITCH) + 1;
  return { col: clampInt(col, 1, COLS), row: clampInt(row, 1, ROWS) };
}

/* --- widgets -------------------------------------------------------------- */

export const WIDGET_KINDS = Object.freeze([
  'title',
  'countdown',
  'clock',
  'day',
  'status',
  'music',
  'vitals',
  'chat',
  'frame',
  'mark',
  'links',
]);

export const SURFACES = Object.freeze(['none', 'page', 'raised']);
export const ALIGNS = Object.freeze(['start', 'center', 'end']);
export const TITLE_SIZES = Object.freeze(['display', 'heading', 'body']);
export const MIN_SCALE = 50;
export const MAX_SCALE = 200;
export const MAX_WIDGETS = 24;
export const MAX_LINES = 6;
export const NAME_MAX = 40;

/**
 * What each widget is, for the studio: its name, one line on what it shows,
 * the box a new one gets, and its own label (the small-caps line over its
 * reading, in the ledger's voice: "dame is listening").
 */
export const WIDGETS = Object.freeze({
  title: { name: 'Title', hint: 'Words you set: a heading and a line under it.', cols: 8, rows: 2, label: '' },
  countdown: { name: 'Countdown', hint: 'To a time, or a timer from when the overlay is shown.', cols: 4, rows: 2, label: 'starting in' },
  clock: { name: 'Clock', hint: 'The time now, in New York or on this machine.', cols: 3, rows: 1, label: 'the time' },
  day: { name: 'Day of life', hint: 'The day count from the chrome bar.', cols: 3, rows: 1, label: 'day of life' },
  status: { name: 'Status', hint: 'Your latest is.dame.now.', cols: 5, rows: 1, label: 'dame is' },
  music: { name: 'Now playing', hint: 'What teal.fm says is on.', cols: 5, rows: 1, label: 'dame is listening' },
  vitals: { name: 'Vitals', hint: 'Heart, activity, battery and sound from is.dame.state.', cols: 5, rows: 1, label: 'right now' },
  chat: { name: 'Chat', hint: 'Your stream.place chat, as it comes in.', cols: 4, rows: 5, label: 'chat' },
  frame: { name: 'Capture frame', hint: 'An empty, ruled window to line a screen or camera up with. Cuts through a page backdrop.', cols: 12, rows: 7, label: '' },
  mark: { name: 'Mark', hint: 'The hour’s sky avatar and the wordmark.', cols: 3, rows: 1, label: '' },
  links: { name: 'Links', hint: 'Where to find you, a line each.', cols: 5, rows: 2, label: 'find dame' },
});

/** The options each kind reads, beyond the ones every widget has. */
const KIND_FIELDS = Object.freeze({
  title: ['text', 'subtitle', 'size'],
  countdown: ['mode', 'minutes', 'at', 'done'],
  clock: ['seconds', 'zone'],
  day: [],
  status: [],
  music: ['art'],
  vitals: [],
  chat: ['max'],
  frame: ['text'],
  mark: ['art'],
  links: ['lines'],
});

/** Kinds that take no surface: a frame is a hole, and a hole has no plate. */
export const NO_SURFACE = new Set(['frame']);

/* --- small checks --------------------------------------------------------- */

const obj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export function clampInt(n, min, max) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function intIn(v, min, max, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? clampInt(v, min, max) : fallback;
}

/**
 * One line of text as a record keeps it: control characters out, runs of
 * space folded, trimmed, at most `max` characters (counted as code points, so
 * an emoji is never cut in half).
 */
export function cleanLine(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, max).join('');
}

const isDatetime = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));

/* --- ids ------------------------------------------------------------------ */

/** An overlay's id: its record key and its segment in /overlay/:id. */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function isOverlayId(v) {
  return typeof v === 'string' && ID_RE.test(v);
}

/** A new overlay's id from its name ("Just Chatting" is `just-chatting`), not one of `taken`. */
export function newOverlayId(name, taken = []) {
  const used = new Set(taken);
  const slug =
    String(name || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'overlay';
  if (!used.has(slug)) return slug;
  for (let n = 2; ; n += 1) if (!used.has(`${slug}-${n}`)) return `${slug}-${n}`;
}

/** The public address of an overlay, for OBS. */
export function overlayPath(id) {
  return `/overlay/${encodeURIComponent(id)}`;
}

/* --- one widget ------------------------------------------------------------ */

/**
 * A widget as the renderer draws it: a known kind, a box that fits the grid,
 * and only the options its kind reads, each checked. Null for anything that
 * isn't a widget.
 */
export function cleanWidget(w) {
  if (!obj(w) || !WIDGET_KINDS.includes(w.kind)) return null;
  const kind = w.kind;
  const def = WIDGETS[kind];
  const col = intIn(w.col, 1, COLS, 1);
  const row = intIn(w.row, 1, ROWS, 1);
  const out = {
    kind,
    col,
    row,
    // A box never runs off the grid: it is cut at the last column or row.
    cols: intIn(w.cols, 1, COLS - col + 1, Math.min(def.cols, COLS - col + 1)),
    rows: intIn(w.rows, 1, ROWS - row + 1, Math.min(def.rows, ROWS - row + 1)),
    surface: NO_SURFACE.has(kind) ? 'none' : SURFACES.includes(w.surface) ? w.surface : 'page',
    scale: intIn(w.scale, MIN_SCALE, MAX_SCALE, 100),
    align: ALIGNS.includes(w.align) ? w.align : 'start',
  };
  // The label is three-state: absent is the widget's own, '' drops it.
  if (typeof w.label === 'string') out.label = cleanLine(w.label, 60);
  for (const field of KIND_FIELDS[kind]) {
    switch (field) {
      case 'text':
        out.text = cleanLine(w.text, 120);
        break;
      case 'subtitle':
        out.subtitle = cleanLine(w.subtitle, 240);
        break;
      case 'size':
        out.size = TITLE_SIZES.includes(w.size) ? w.size : 'display';
        break;
      case 'mode':
        out.mode = w.mode === 'until' ? 'until' : 'timer';
        break;
      case 'minutes':
        out.minutes = intIn(w.minutes, 1, 240, 5);
        break;
      case 'at':
        if (isDatetime(w.at)) out.at = new Date(w.at).toISOString();
        break;
      case 'done':
        out.done = typeof w.done === 'string' ? cleanLine(w.done, 60) : 'any moment now';
        break;
      case 'seconds':
        out.seconds = w.seconds === true;
        break;
      case 'zone':
        out.zone = w.zone === 'local' ? 'local' : 'eastern';
        break;
      case 'max':
        out.max = intIn(w.max, 1, 12, 6);
        break;
      case 'art':
        out.art = w.art !== false;
        break;
      case 'lines':
        out.lines = Array.isArray(w.lines)
          ? w.lines.map((l) => cleanLine(l, 80)).filter(Boolean).slice(0, MAX_LINES)
          : [];
        break;
      default:
        break;
    }
  }
  return out;
}

/** A new widget of `kind`, at the first place on the grid its default box fits, or the top left. */
export function newWidget(kind, existing = []) {
  const def = WIDGETS[kind];
  const taken = existing.map(boxCells);
  for (let row = 1; row + def.rows - 1 <= ROWS; row += 1) {
    for (let col = 1; col + def.cols - 1 <= COLS; col += 1) {
      const cells = boxCells({ col, row, cols: def.cols, rows: def.rows });
      if (!taken.some((t) => overlaps(t, cells))) {
        return cleanWidget({ kind, col, row, cols: def.cols, rows: def.rows });
      }
    }
  }
  return cleanWidget({ kind, col: 1, row: 1, cols: def.cols, rows: def.rows });
}

const boxCells = (w) => ({ x0: w.col, y0: w.row, x1: w.col + w.cols - 1, y1: w.row + w.rows - 1 });
const overlaps = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** A widget moved so its top left is on (col, row), kept whole on the grid. */
export function moveWidget(w, col, row) {
  return {
    ...w,
    col: clampInt(col, 1, COLS - w.cols + 1),
    row: clampInt(row, 1, ROWS - w.rows + 1),
  };
}

/** A widget resized so its bottom right is on (col, row), at least one cell. */
export function resizeWidget(w, col, row) {
  return {
    ...w,
    cols: clampInt(col - w.col + 1, 1, COLS - w.col + 1),
    rows: clampInt(row - w.row + 1, 1, ROWS - w.row + 1),
  };
}

/** The label a widget shows: its own when set ('' drops it), else its kind's. */
export function labelOf(w) {
  return typeof w.label === 'string' ? w.label : WIDGETS[w.kind]?.label || '';
}

/* --- one overlay ---------------------------------------------------------- */

/**
 * @typedef {Object} OverlayConfig
 * @property {string} name
 * @property {'transparent'|'page'} backdrop
 * @property {number|null} hour   0–23, or null to follow the clock.
 * @property {boolean} grid
 * @property {object[]} widgets
 */

export const EMPTY_OVERLAY = Object.freeze({
  name: '',
  backdrop: 'transparent',
  hour: null,
  grid: false,
  widgets: Object.freeze([]),
});

/** A record's value as an overlay: what checks out, and the defaults for the rest. */
export function fromRecord(value) {
  if (!obj(value)) return { ...EMPTY_OVERLAY, widgets: [] };
  const hour = typeof value.hour === 'number' && Number.isInteger(value.hour) && value.hour >= 0 && value.hour <= 23 ? value.hour : null;
  return {
    name: cleanLine(value.name, NAME_MAX),
    backdrop: value.backdrop === 'page' ? 'page' : 'transparent',
    hour,
    grid: value.grid === true,
    widgets: Array.isArray(value.widgets)
      ? value.widgets.slice(0, MAX_WIDGETS).map(cleanWidget).filter(Boolean)
      : [],
  };
}

/** The record to write, keeping when it was first made. */
export function toRecord(config, { createdAt, now = new Date() } = {}) {
  const c = fromRecord(config);
  const record = {
    $type: OVERLAY_NSID,
    ...(c.name ? { name: c.name } : {}),
    backdrop: c.backdrop,
    ...(c.hour === null ? {} : { hour: c.hour }),
    grid: c.grid,
    widgets: c.widgets,
    createdAt: createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return record;
}

/** Value equality for two overlays, as they would be written. */
export function sameOverlay(a, b) {
  return JSON.stringify(fromRecord(a)) === JSON.stringify(fromRecord(b));
}

/* --- presets -------------------------------------------------------------- */

const at = (kind, col, row, cols, rows, extra = {}) =>
  cleanWidget({ kind, col, row, cols, rows, ...extra });

/**
 * Starting points, one per sort of screen a stream needs. Each is an ordinary
 * overlay: the studio copies one and the copy is the owner's to change.
 */
export const PRESETS = Object.freeze([
  {
    key: 'live',
    name: 'live',
    hint: 'Transparent, for over a game or a desktop: the mark, what you are doing, what is playing and the chat.',
    config: {
      name: 'live',
      backdrop: 'transparent',
      hour: null,
      grid: false,
      widgets: [
        at('mark', 1, 1, 3, 1),
        at('status', 1, 9, 5, 1),
        at('music', 6, 9, 5, 1),
        at('chat', 13, 1, 4, 5, { max: 6 }),
      ],
    },
  },
  {
    key: 'starting',
    name: 'starting soon',
    hint: 'A full screen on the page: a title, a countdown and what is playing.',
    config: {
      name: 'starting soon',
      backdrop: 'page',
      hour: null,
      grid: true,
      widgets: [
        at('mark', 1, 1, 3, 1, { surface: 'none' }),
        at('clock', 14, 1, 3, 1, { surface: 'none', align: 'end' }),
        at('title', 2, 3, 10, 3, { text: 'starting soon', subtitle: 'what the stream is about, in a line', surface: 'none' }),
        at('countdown', 12, 3, 4, 2, { minutes: 5, surface: 'raised' }),
        at('music', 2, 8, 6, 1, { surface: 'none' }),
        at('chat', 12, 6, 4, 3, { max: 3, surface: 'raised' }),
      ],
    },
  },
  {
    key: 'brb',
    name: 'be right back',
    hint: 'A full screen on the page: what you are off doing, the time and the chat.',
    config: {
      name: 'be right back',
      backdrop: 'page',
      hour: null,
      grid: true,
      widgets: [
        at('mark', 1, 1, 3, 1, { surface: 'none' }),
        at('title', 2, 3, 10, 2, { text: 'be right back', subtitle: '', surface: 'none' }),
        at('status', 2, 5, 8, 1, { surface: 'none' }),
        at('vitals', 2, 6, 8, 1, { surface: 'none' }),
        at('clock', 2, 8, 4, 1, { surface: 'none', seconds: true }),
        at('chat', 12, 3, 4, 6, { max: 8, surface: 'raised' }),
      ],
    },
  },
  {
    key: 'ending',
    name: 'thanks for watching',
    hint: 'A full screen on the page: a goodbye and where to find you.',
    config: {
      name: 'thanks for watching',
      backdrop: 'page',
      hour: null,
      grid: true,
      widgets: [
        at('mark', 1, 1, 3, 1, { surface: 'none' }),
        at('title', 2, 3, 12, 2, { text: 'thanks for watching', subtitle: '', surface: 'none' }),
        at('links', 2, 6, 6, 3, {
          surface: 'none',
          lines: ['dame.is', 'bsky.app/profile/dame.is', 'stream.place/dame.is'],
        }),
        at('day', 13, 9, 4, 1, { surface: 'none', align: 'end' }),
      ],
    },
  },
  {
    key: 'screenshare',
    name: 'screen share',
    hint: 'A page frame with a big window for a screen and a small one for a camera, a title bar and the chat.',
    config: {
      name: 'screen share',
      backdrop: 'page',
      hour: null,
      grid: false,
      widgets: [
        at('frame', 1, 1, 12, 7, { text: 'screen' }),
        at('frame', 13, 1, 4, 3, { text: 'camera' }),
        at('chat', 13, 4, 4, 6, { max: 7, surface: 'raised' }),
        at('title', 1, 8, 8, 2, { text: 'what we are making', subtitle: '', size: 'heading', surface: 'none' }),
        at('music', 9, 8, 4, 1, { surface: 'none' }),
        at('mark', 9, 9, 4, 1, { surface: 'none' }),
      ],
    },
  },
  {
    key: 'blank',
    name: 'blank',
    hint: 'Nothing on it: start from the grid.',
    config: { name: 'untitled', backdrop: 'transparent', hour: null, grid: true, widgets: [] },
  },
]);

/* --- the clock ------------------------------------------------------------- */

/**
 * What a countdown says at `nowMs`: the time left as m:ss (or h:mm:ss), or
 * null once it has run out. `startedMs` is when the overlay was shown, for a
 * timer; `until` counts to `w.at` and is null without one.
 */
export function countdownLeft(w, nowMs, startedMs) {
  const end = w.mode === 'until' ? (w.at ? Date.parse(w.at) : NaN) : startedMs + (w.minutes || 5) * 60_000;
  if (!Number.isFinite(end)) return null;
  const left = Math.ceil((end - nowMs) / 1000);
  if (left <= 0) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
