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
  'text',
  'countdown',
  'clock',
  'tid',
  'day',
  'status',
  'music',
  'vitals',
  'atmosphere',
  'chat',
  'poe',
  'frame',
  'mark',
  'links',
]);

/**
 * What a widget is drawn on. `page` and `raised` are the site's two surfaces;
 * `veil` is the page at two thirds, for words over a capture that should
 * still let it through; `accent` is the filled control's accent and `ink` the
 * page turned over (ink ground, page-coloured words), both for a banner that
 * has to be seen; `sky` is the hour's own sky, the avatar's top and bottom
 * bands (skyTheme.js SKY_BANDS), with whichever of the hour's two inks reads
 * on it.
 */
export const SURFACES = Object.freeze(['none', 'page', 'raised', 'veil', 'accent', 'ink', 'sky']);
export const ALIGNS = Object.freeze(['start', 'center', 'end']);
export const TITLE_SIZES = Object.freeze(['display', 'heading', 'body']);
/** The text widget's voices: the site's type roles, plus its italic and its mono. */
export const VOICES = Object.freeze(['display', 'heading', 'reading', 'italic', 'label', 'mono']);
export const FRAME_SHAPES = Object.freeze(['rect', 'circle']);

/** The kinds that come in styles, each style's name, the first the default. */
export const STYLES = Object.freeze({
  atmosphere: Object.freeze({
    card: 'Card',
    strip: 'Strip',
    badge: 'Badge',
    apps: 'Busiest apps',
    forecast: 'Forecast',
    pulse: 'Pulse',
  }),
  tid: Object.freeze({ ticking: 'With the time', mini: 'Just the TID' }),
});

/** The box a new widget of a style gets, where it differs from its kind's. */
export const STYLE_BOX = Object.freeze({
  atmosphere: Object.freeze({
    card: [5, 2],
    strip: [16, 1],
    badge: [3, 1],
    apps: [4, 3],
    forecast: [6, 2],
    pulse: [5, 2],
  }),
  tid: Object.freeze({ ticking: [5, 2], mini: [4, 1] }),
});

/** A style of `kind`: `style` when it is one, else the kind's first. */
export function styleOf(kind, style) {
  const styles = STYLES[kind];
  if (!styles) return undefined;
  return typeof style === 'string' && Object.hasOwn(styles, style) ? style : Object.keys(styles)[0];
}
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
  text: { name: 'Text', hint: 'Words you set, a line each, in any of the site’s voices and on any of its grounds. Can run as a ticker.', cols: 6, rows: 1, label: '' },
  countdown: { name: 'Countdown', hint: 'To a time, or a timer from when the overlay is shown.', cols: 4, rows: 2, label: 'starting in' },
  clock: { name: 'Clock', hint: 'The time now, in New York or on this machine.', cols: 3, rows: 1, label: 'the time' },
  tid: { name: 'TID clock', hint: 'The time as an atproto TID, ticking: the record key a record made right now would get. Can show your repo’s latest revision too.', cols: 5, rows: 2, label: 'now, as a TID' },
  day: { name: 'Day of life', hint: 'The day count from the chrome bar.', cols: 3, rows: 1, label: 'day of life' },
  status: { name: 'Status', hint: 'Your latest is.dame.now.', cols: 5, rows: 1, label: 'dame is' },
  music: { name: 'Now playing', hint: 'What teal.fm says is on.', cols: 5, rows: 1, label: 'dame is listening' },
  vitals: { name: 'Vitals', hint: 'Heart, activity, battery and sound from is.dame.state.', cols: 5, rows: 1, label: 'right now' },
  atmosphere: { name: 'Atmosphere', hint: 'The atmosphere’s weather from atpota.to’s weather station: the network’s records a second, its condition, the apps outside Bluesky, the forecast.', cols: 5, rows: 2, label: 'the atmosphere' },
  chat: { name: 'Chat', hint: 'Your stream.place chat, as it comes in.', cols: 4, rows: 5, label: 'chat' },
  poe: { name: 'Poe', hint: 'atpota.to’s potato, on your stream: greets chatters, thanks followers, says weather alerts, answers !weather, !forecast, !apps, !pet and !poe, naps when it is quiet. Sits at the bottom of its box; its words rise above it.', cols: 3, rows: 4, label: '' },
  frame: { name: 'Capture frame', hint: 'An empty, ruled window to line a screen or camera up with in OBS. Cuts through a page backdrop.', cols: 12, rows: 7, label: '' },
  mark: { name: 'Mark', hint: 'The hour’s sky avatar and the wordmark.', cols: 3, rows: 1, label: '' },
  links: { name: 'Links', hint: 'Where to find you, a line each.', cols: 5, rows: 2, label: 'find dame' },
});

/** The options each kind reads, beyond the ones every widget has. */
const KIND_FIELDS = Object.freeze({
  title: ['text', 'subtitle', 'size'],
  text: ['lines', 'voice', 'ticker'],
  tid: ['style', 'zone', 'repo'],
  atmosphere: ['style'],
  poe: ['side', 'greet', 'follows', 'alerts', 'volume', 'nap'],
  countdown: ['mode', 'minutes', 'at', 'done'],
  clock: ['seconds', 'zone'],
  day: [],
  status: [],
  music: ['art'],
  vitals: [],
  chat: ['max'],
  frame: ['text', 'shape', 'plate'],
  mark: ['art'],
  links: ['lines'],
});

/** Kinds that take no surface: a frame is a hole, and Poe brings its own bubble. */
export const NO_SURFACE = new Set(['frame', 'poe']);

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
      case 'lines': {
        const max = kind === 'text' ? 160 : 80;
        out.lines = Array.isArray(w.lines)
          ? w.lines.map((l) => cleanLine(l, max)).filter(Boolean).slice(0, MAX_LINES)
          : [];
        break;
      }
      case 'voice':
        out.voice = VOICES.includes(w.voice) ? w.voice : 'reading';
        break;
      case 'ticker':
        out.ticker = w.ticker === true;
        break;
      case 'style':
        out.style = styleOf(kind, w.style);
        break;
      case 'repo':
        out.repo = w.repo === true;
        break;
      case 'side':
        out.side = w.side === 'left' ? 'left' : 'right';
        break;
      case 'greet':
      case 'follows':
      case 'alerts':
        out[field] = w[field] !== false;
        break;
      case 'volume':
        out.volume = intIn(w.volume, 0, 100, 40);
        break;
      case 'nap':
        out.nap = intIn(w.nap, 0, 240, 5);
        break;
      case 'shape':
        out.shape = w.shape === 'circle' ? 'circle' : 'rect';
        break;
      case 'plate':
        out.plate = w.plate === true;
        break;
      default:
        break;
    }
  }
  return out;
}

/** The box a new widget of `kind` (and `style`) gets: [cols, rows]. */
export function defaultBox(kind, style) {
  const byStyle = STYLE_BOX[kind]?.[styleOf(kind, style)];
  return byStyle ? [...byStyle] : [WIDGETS[kind].cols, WIDGETS[kind].rows];
}

/**
 * A new widget of `kind` with `extra` options (a catalog entry's). Its box is
 * `extra.cols` by `extra.rows` (or the kind's own), at `extra.col, extra.row`
 * when it gives one, else the first place on the grid it fits without
 * covering anything, else the top left.
 */
export function newWidget(kind, existing = [], extra = {}) {
  const [dc, dr] = defaultBox(kind, extra.style);
  const cols = extra.cols ?? dc;
  const rows = extra.rows ?? dr;
  if (extra.col && extra.row) return cleanWidget({ ...extra, kind, cols, rows });
  const taken = existing.map(boxCells);
  for (let row = 1; row + rows - 1 <= ROWS; row += 1) {
    for (let col = 1; col + cols - 1 <= COLS; col += 1) {
      const cells = boxCells({ col, row, cols, rows });
      if (!taken.some((t) => overlaps(t, cells))) {
        return cleanWidget({ ...extra, kind, col, row, cols, rows });
      }
    }
  }
  return cleanWidget({ ...extra, kind, col: 1, row: 1, cols, rows });
}

/* --- the studio's add menu ------------------------------------------------- */

/**
 * Everything the studio can add, grouped. An entry is a kind plus the options
 * it starts with, so a "lower third" is a text widget that starts as one and
 * is then the owner's to change like any other.
 */
export const CATALOG = Object.freeze([
  {
    group: 'Words',
    items: [
      { id: 'title', name: 'Title', kind: 'title' },
      { id: 'text', name: 'Text', kind: 'text', extra: { lines: ['words of your own'], voice: 'reading' } },
      {
        id: 'text:lower-third',
        name: 'Text: lower third',
        kind: 'text',
        extra: { lines: ['dame', 'what this stream is'], voice: 'heading', surface: 'raised', label: 'on stream', col: 1, row: 8, cols: 7, rows: 2 },
      },
      {
        id: 'text:banner',
        name: 'Text: ticker banner',
        kind: 'text',
        extra: { lines: ['live from dame.is', 'say hello in the chat'], voice: 'reading', surface: 'accent', ticker: true, col: 1, row: 9, cols: 16, rows: 1 },
      },
      {
        id: 'text:quote',
        name: 'Text: quote on the sky',
        kind: 'text',
        extra: { lines: ['“a line worth setting large”'], voice: 'italic', surface: 'sky', align: 'center', cols: 8, rows: 3 },
      },
      {
        id: 'text:caption',
        name: 'Text: caption',
        kind: 'text',
        extra: { lines: ['a small note'], voice: 'label', surface: 'veil', cols: 4, rows: 1 },
      },
      {
        id: 'text:inverse',
        name: 'Text: ink plate',
        kind: 'text',
        extra: { lines: ['be right back'], voice: 'display', surface: 'ink', align: 'center', cols: 8, rows: 2 },
      },
      { id: 'links', name: 'Links', kind: 'links' },
    ],
  },
  {
    group: 'Time',
    items: [
      { id: 'clock', name: 'Clock', kind: 'clock' },
      { id: 'tid', name: 'TID clock', kind: 'tid', extra: { style: 'ticking' } },
      { id: 'tid:mini', name: 'TID clock: just the TID', kind: 'tid', extra: { style: 'mini' } },
      { id: 'tid:repo', name: 'TID clock: with your repo', kind: 'tid', extra: { style: 'ticking', repo: true, rows: 3 } },
      { id: 'countdown', name: 'Countdown', kind: 'countdown' },
      { id: 'day', name: 'Day of life', kind: 'day' },
    ],
  },
  {
    group: 'From your repo',
    items: [
      { id: 'status', name: 'Status', kind: 'status' },
      { id: 'music', name: 'Now playing', kind: 'music' },
      { id: 'vitals', name: 'Vitals', kind: 'vitals' },
      { id: 'mark', name: 'Mark', kind: 'mark' },
    ],
  },
  {
    group: 'The atmosphere',
    items: Object.entries(STYLES.atmosphere).map(([style, name]) => ({
      id: `atmosphere:${style}`,
      name: `Atmosphere: ${name.toLowerCase()}`,
      kind: 'atmosphere',
      extra: { style },
    })),
  },
  {
    group: 'Stream',
    items: [
      { id: 'poe', name: 'Poe', kind: 'poe', extra: { col: 14, row: 6 } },
      { id: 'chat', name: 'Chat', kind: 'chat' },
      { id: 'frame', name: 'Capture frame: screen', kind: 'frame', extra: { text: 'screen' } },
      { id: 'frame:camera', name: 'Capture frame: camera', kind: 'frame', extra: { text: 'camera', cols: 4, rows: 3 } },
      { id: 'frame:circle', name: 'Capture frame: round camera', kind: 'frame', extra: { text: 'camera', shape: 'circle', cols: 3, rows: 3 } },
    ],
  },
]);

/** A catalog entry by id. */
export function catalogEntry(id) {
  for (const g of CATALOG) for (const item of g.items) if (item.id === id) return item;
  return null;
}

/* --- arranging capture frames ----------------------------------------------- */

const box = (col, row, cols, rows) => ({ col, row, cols, rows });

/**
 * Ready arrangements for one to four capture frames, on the grid. Frames take
 * the boxes in the order they are listed in the overlay, so the first frame is
 * the main one; rotateFrames() moves who is main. The boxes keep close to 16:9
 * where a whole number of cells allows (7x4, 12x7, 14x8 and 16x9 are within 2%
 * of it; 5x3 within 4%).
 */
export const ARRANGEMENTS = Object.freeze({
  1: [
    { key: 'full', name: 'Full screen', boxes: [box(1, 1, 16, 9)] },
    { key: 'large', name: 'Large, a bar under it', boxes: [box(2, 1, 14, 8)] },
    { key: 'room', name: 'Room beside and under', boxes: [box(1, 1, 12, 7)] },
  ],
  2: [
    { key: 'main-side', name: 'Main, second beside it', boxes: [box(1, 1, 12, 7), box(13, 1, 4, 3)] },
    { key: 'pip', name: 'Main full, second inset', boxes: [box(1, 1, 16, 9), box(12, 7, 5, 3)] },
    { key: 'pair', name: 'Side by side', boxes: [box(2, 3, 7, 4), box(9, 3, 7, 4)] },
  ],
  3: [
    { key: 'main-column', name: 'Main, two down the side', boxes: [box(1, 1, 12, 7), box(13, 1, 4, 3), box(13, 4, 4, 3)] },
    { key: 'pip-two', name: 'Main full, two inset', boxes: [box(1, 1, 16, 9), box(14, 6, 3, 2), box(14, 8, 3, 2)] },
    { key: 'across', name: 'Three across', boxes: [box(1, 3, 5, 3), box(6, 3, 5, 3), box(11, 3, 5, 3)] },
  ],
  4: [
    { key: 'main-column', name: 'Main, three down the side', boxes: [box(1, 1, 12, 7), box(13, 1, 4, 3), box(13, 4, 4, 3), box(13, 7, 4, 3)] },
    { key: 'grid', name: 'Two by two', boxes: [box(2, 1, 7, 4), box(9, 1, 7, 4), box(2, 5, 7, 4), box(9, 5, 7, 4)] },
  ],
});

/** The arrangements on offer for the frames in `widgets` (up to four are arranged). */
export function arrangementsFor(widgets) {
  const n = Math.min(4, widgets.filter((w) => w.kind === 'frame').length);
  return n ? ARRANGEMENTS[n] : [];
}

/** The widgets with their frames moved into arrangement `key`. Anything else stays put. */
export function arrangeFrames(widgets, key) {
  const plan = arrangementsFor(widgets).find((a) => a.key === key);
  if (!plan) return widgets;
  let i = 0;
  return widgets.map((w) => {
    if (w.kind !== 'frame' || i >= plan.boxes.length) return w;
    return { ...w, ...plan.boxes[i++] };
  });
}

/**
 * The frames' boxes passed along one: the last frame's box goes to the first,
 * the first's to the second, and so on. Rotating a main-and-two arrangement
 * puts each source in the main window in turn, without moving anything in OBS
 * but the sources themselves.
 */
export function rotateFrames(widgets) {
  const at = widgets.map((w, i) => (w.kind === 'frame' ? i : -1)).filter((i) => i >= 0);
  if (at.length < 2) return widgets;
  const boxes = at.map((i) => {
    const { col, row, cols, rows } = widgets[i];
    return { col, row, cols, rows };
  });
  const out = widgets.slice();
  at.forEach((i, n) => {
    out[i] = { ...widgets[i], ...boxes[(n - 1 + at.length) % at.length] };
  });
  return out;
}

/** Where each frame is on the canvas, for setting a source's transform in OBS. */
export function frameTransforms(widgets) {
  return widgets
    .filter((w) => w.kind === 'frame')
    .map((w) => {
      const b = boxOf(w);
      return { name: w.text || 'frame', x: b.left, y: b.top, width: b.width, height: b.height, shape: w.shape || 'rect' };
    });
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
        at('atmosphere', 4, 1, 3, 1, { style: 'badge', surface: 'veil' }),
        at('status', 1, 9, 5, 1),
        at('music', 6, 9, 5, 1),
        at('chat', 13, 1, 4, 5, { max: 6 }),
        at('poe', 14, 6, 3, 4),
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
        at('frame', 13, 1, 4, 3, { text: 'camera', plate: true }),
        at('chat', 13, 4, 4, 6, { max: 7, surface: 'raised' }),
        at('title', 1, 8, 8, 2, { text: 'what we are making', subtitle: '', size: 'heading', surface: 'none' }),
        at('music', 9, 8, 4, 1, { surface: 'none' }),
        at('mark', 9, 9, 4, 1, { surface: 'none' }),
      ],
    },
  },
  {
    key: 'multicam',
    name: 'multi cam',
    hint: 'A screen, your main camera and a second one at once, ready to rearrange; the chat, a lower third and Poe.',
    config: {
      name: 'multi cam',
      backdrop: 'page',
      hour: null,
      grid: false,
      widgets: [
        at('frame', 1, 1, 12, 7, { text: 'screen' }),
        at('frame', 13, 1, 4, 3, { text: 'main cam', plate: true }),
        at('frame', 13, 4, 4, 3, { text: 'second cam', plate: true }),
        at('text', 1, 8, 8, 2, { lines: ['what we are making', 'live on stream.place'], voice: 'heading', surface: 'none', label: 'on stream' }),
        at('tid', 9, 8, 4, 1, { style: 'mini', surface: 'none' }),
        at('chat', 13, 7, 4, 3, { max: 3, surface: 'raised' }),
      ],
    },
  },
  {
    key: 'atmosphere',
    name: 'the atmosphere',
    hint: 'A full screen of the network’s weather: the card, the pulse, the forecast and the busiest apps, with Poe.',
    config: {
      name: 'the atmosphere',
      backdrop: 'page',
      hour: null,
      grid: true,
      widgets: [
        at('mark', 1, 1, 3, 1, { surface: 'none' }),
        at('tid', 12, 1, 5, 1, { style: 'mini', surface: 'none', align: 'end' }),
        at('atmosphere', 1, 3, 6, 3, { style: 'card', surface: 'raised' }),
        at('atmosphere', 7, 3, 6, 3, { style: 'pulse', surface: 'none' }),
        at('atmosphere', 1, 7, 8, 2, { style: 'forecast', surface: 'none' }),
        at('atmosphere', 9, 6, 4, 3, { style: 'apps', surface: 'none' }),
        at('poe', 14, 6, 3, 4),
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
