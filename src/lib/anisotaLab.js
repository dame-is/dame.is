// Helpers for rendering Anisota Lab creations (the `crafting` verb) faithfully
// on dame.is. The layout / tokenisation math is ported verbatim from the
// Anisota app so a poem, erasure, or sigil re-lays here exactly as it does on
// anisota.net:
//   - computePoemLayout  ← anisota src/utils/poemLayout.js
//   - tokenizePost        ← anisota src/utils/redaction.js
//   - sigilSvgDataUrl     ← anisota src/components/sigil/sigilGeometry.js
// Keeping the numbers identical is the whole point — see the comments there.

const ANISOTA_ORIGIN = 'https://anisota.net';

/**
 * Lab collections that have a dedicated, designed viewer page on anisota.net
 * (`/profile/{who}/{nsid}/{rkey}`). The rest (carving, petri, synth) have no
 * per-piece page, so we fall back to the maker's profile.
 */
const ANISOTA_WORK_PAGE_COLLECTIONS = new Set([
  'net.anisota.lab.poetry',
  'net.anisota.lab.redaction',
  'net.anisota.lab.sigil',
  'net.anisota.lab.inkblot',
  'net.anisota.spell.custom',
]);

/**
 * Build the canonical anisota.net URL for a Lab record from its at:// URI.
 * The `/profile/{who}/…` route accepts a DID in the `who` slot, which is
 * exactly what the URI gives us. Pieces without a designed page link to the
 * maker's Anisota profile instead.
 */
export function anisotaWorkUrl(atUri) {
  const m = String(atUri || '').match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  const [, did, collection, rkey] = m;
  if (ANISOTA_WORK_PAGE_COLLECTIONS.has(collection)) {
    return `${ANISOTA_ORIGIN}/profile/${did}/${collection}/${encodeURIComponent(rkey)}`;
  }
  return `${ANISOTA_ORIGIN}/profile/${did}`;
}

/* ------------------------------------------------------------------ */
/* Poetry (Word Magnets) — poemLayout.js                               */
/* ------------------------------------------------------------------ */

// ATProto has no float type, so the board's ratios are stored as scaled
// integers and divided back when read (bx/by/bw/bh are already whole units).
export const BOARD_ASPECT_SCALE = 1000;
export const BOARD_FONT_SCALE = 100000;

/**
 * Re-lay a saved poem's tiles from its `board` snapshot. Returns the field
 * aspect ratio, the tile font size in `cqw` (percent of the field's own
 * width, resolved via a container query), and every tile placed by its
 * centre as a percent of the field. Returns null for poems saved before
 * board capture, so the caller can fall back to plain text.
 */
export function computePoemLayout(tiles, board, opts = {}) {
  const { pad = 0.06, minAspect = 0.6, maxAspect = 2, fieldAspect: forced } = opts;
  if (!board || !Array.isArray(tiles) || tiles.length === 0) return null;

  const aspect = Number(board.aspect) / BOARD_ASPECT_SCALE;
  const font = Number(board.font) / BOARD_FONT_SCALE;
  const bx = Number(board.bx);
  const by = Number(board.by);
  const bw = Number(board.bw);
  const bh = Number(board.bh);
  if (
    ![aspect, font, bx, by, bw, bh].every(Number.isFinite) ||
    aspect <= 0 || font <= 0 || bw <= 0 || bh <= 0
  ) {
    return null;
  }

  const fieldAspect = forced && forced > 0
    ? forced
    : Math.max(minAspect, Math.min(maxAspect, aspect));
  const avail = 1 - 2 * pad;

  let contentW;
  let contentH;
  if (aspect >= fieldAspect) {
    contentW = avail;
    contentH = (avail * fieldAspect) / aspect;
  } else {
    contentH = avail;
    contentW = (avail * aspect) / fieldAspect;
  }
  const leftBase = (1 - contentW) / 2;
  const topBase = (1 - contentH) / 2;

  const placed = tiles.map((t) => {
    const rx = ((Number(t.x) || 0) - bx) / bw;
    const ry = ((Number(t.y) || 0) - by) / bh;
    return {
      word: t.word,
      fragment: !!t.fragment,
      rot: Number(t.rot) || 0,
      left: (leftBase + rx * contentW) * 100,
      top: (topBase + ry * contentH) * 100,
    };
  });

  return {
    fieldAspect,
    fontCqw: font * contentW * 100,
    tiles: placed,
  };
}

/* ------------------------------------------------------------------ */
/* Redaction (erasure poetry) — redaction.js                           */
/* ------------------------------------------------------------------ */

// One token at a time: a word, or a whitespace run. Anything between matches
// is a "mark" run (punctuation/symbols/emoji).
const TOKEN_RE = /([\p{L}\p{N}][\p{L}\p{N}'’]*)|(\s+)/gu;

// Marks are redactable too, but must never collide with the word indices a
// saved piece already stores, so they live in their own high numbering.
export const PUNCT_BASE = 100000;

/** True for any token that can be blacked out — a word or a punctuation mark. */
export function isRedactable(token) {
  return !!token && token.index >= 0;
}

/**
 * Break post text into an ordered list of tokens
 * `[{ text, isWord, isMark, index }]`. Words carry a zero-based word index;
 * marks carry a PUNCT_BASE-offset index; whitespace gets index -1. A saved
 * redaction stores the indices, so the same tokenisation reopens the same
 * arrangement over the same original text.
 */
export function tokenizePost(text) {
  const src = String(text || '');
  const tokens = [];
  let last = 0;
  let wordIndex = 0;
  let markIndex = 0;

  const pushMarks = (from, to) => {
    if (to > from) {
      tokens.push({ text: src.slice(from, to), isWord: false, isMark: true, index: PUNCT_BASE + markIndex++ });
    }
  };

  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(src))) {
    if (m.index > last) pushMarks(last, m.index);
    if (m[1] != null) {
      tokens.push({ text: m[1], isWord: true, isMark: false, index: wordIndex++ });
    } else {
      tokens.push({ text: m[0], isWord: false, isMark: false, index: -1 });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) pushMarks(last, src.length);
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Sigil — sigilGeometry.js                                            */
/* ------------------------------------------------------------------ */

/**
 * Make a stored sigil SVG safe to render. Older records were truncated at the
 * PDS size cap mid-path; keep the paths that completed and close the document
 * so the figure still shows. Returns '' when nothing renderable survives.
 */
export function sanitizeSvgDocument(svg) {
  if (typeof svg !== 'string' || !svg) return '';
  if (svg.includes('</svg>')) return svg;
  const lastClose = svg.lastIndexOf('/>');
  if (lastClose === -1) return '';
  return svg.slice(0, lastClose + 2) + '\n</svg>';
}

/**
 * A sigil SVG as a data URL (sanitised first), ready for an <img src> or a
 * CSS mask-image. Going through an image reference rather than inline markup
 * keeps it sandboxed — a record can't run script. On dame.is the card uses it
 * as a mask over a flat --ink fill so the one stroke tracks the page's ink
 * instead of the color Anisota baked into the SVG. Returns '' if unrenderable.
 */
export function sigilSvgDataUrl(svg) {
  const safe = sanitizeSvgDocument(svg);
  return safe ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(safe) : '';
}

/* ------------------------------------------------------------------ */
/* Inkblot — re-ink a baked blot into the current theme                */
/* ------------------------------------------------------------------ */

// Inkblots arrive as a baked PNG: a symmetric blot in whatever color Anisota's
// live theme gave the piece's `palette` slot when it was made (see the record's
// `palette` field — 'ink', 'accent-deep', …). To re-ink one in dame.is's
// current sky palette we can't just flat-fill it: the blot carries internal
// light↔dark structure (the ink layered at different densities) that gives it
// depth. So we duotone it — map each pixel's luminance onto a two-stop ramp
// pulled from the live theme, densest ink → stop A, faintest → stop B. A
// single-tone blot (no internal range — e.g. a blot baked in a flat white)
// collapses to a flat stop-A silhouette, which is exactly what it should do.

// Which pair of live --sky-* tokens a blot's `palette` slot maps onto, as
// [dense, faint]. Anything unrecognised falls back to the ink ramp — the
// blot's namesake, and the slot four of every five blots in the wild use.
export const INKBLOT_RAMPS = {
  ink: ['--sky-ink', '--sky-ink-muted'],
  accent: ['--sky-accent', '--sky-accent-soft'],
  'accent-deep': ['--sky-accent', '--sky-accent-soft'],
  'accent-soft': ['--sky-accent', '--sky-accent-soft'],
  tan: ['--sky-tan', '--sky-accent-soft'],
};

/** The [denseToken, faintToken] --sky-* ramp for a blot's `palette` slot. */
export function inkblotRamp(palette) {
  return INKBLOT_RAMPS[palette] || INKBLOT_RAMPS.ink;
}

/** Parse a `#rgb` / `#rrggbb` hex to `[r, g, b]` (0–255); null on anything else. */
export function hexToRgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Rec. 709 luma, matching the weighting skyTheme.js's own palette math uses.
function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Duotone a decoded inkblot in place. `data` is an RGBA byte array (a canvas
 * ImageData.data); `dense` and `faint` are the ramp's two [r, g, b] stops.
 * Fully transparent pixels are left untouched; every visible pixel is re-inked
 * by where its luminance falls in the blot's own min→max range (normalised per
 * blot, so even a faint original spans the full ramp). Alpha is preserved, so
 * the blot's anti-aliased edges survive the recolor.
 */
export function recolorInkblot(data, dense, faint) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const y = luma(data[i], data[i + 1], data[i + 2]);
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  if (hi < lo) return; // fully transparent — nothing to re-ink
  const range = hi - lo || 1; // flat blot → every pixel lands on `dense`
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let t = (luma(data[i], data[i + 1], data[i + 2]) - lo) / range;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    data[i] = Math.round(dense[0] + (faint[0] - dense[0]) * t);
    data[i + 1] = Math.round(dense[1] + (faint[1] - dense[1]) * t);
    data[i + 2] = Math.round(dense[2] + (faint[2] - dense[2]) * t);
  }
}
