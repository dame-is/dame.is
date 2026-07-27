// The Ratioed charts' categorical scale, derived from whatever hour the sky
// theme is currently showing.
//
// An earlier version pulled two of the four series straight from --accent and
// --tan. Under the sky theme both resolve to that hour's sky colour, so two of
// the four collapsed into one flat hue and the scale stopped being categorical.
// The fix is not to freeze the colours but to DERIVE them: take the hour's own
// hue as an anchor and build a scale around it that is guaranteed to stay
// separable, whatever the sky is doing.
//
// The shape is dichromatic with gradations:
//
//   reply / repost / quote — an analogous trio around the sky's anchor hue,
//     separated by both hue rotation and a lightness step, so they read apart
//     even where hue perception doesn't help.
//   like — the anchor's COMPLEMENT, at higher chroma.
//
// That split is the argument the charts make, in colour: the engagement a piece
// draws belongs to the hour it happened in, and the thing that kills it is the
// one colour permanently at odds with that hour.
//
// Lightness flips with the ground. The sky runs from a pale noon page to a
// near-black midnight one inside a single theme, so a fixed lightness would be
// unreadable at one end or the other.

import { paletteForHour } from './skyTheme.js';

/* --- colour space -------------------------------------------------- */

export function hexToRgb(hex) {
  const s = String(hex || '').replace('#', '').trim();
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export function rgbToHsl([r, g, b]) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (max === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return [h * 360, s, l];
}

export function hslToHex(h, s, l) {
  const H = (((h % 360) + 360) % 360) / 360;
  const S = Math.min(1, Math.max(0, s));
  const L = Math.min(1, Math.max(0, l));
  const f = (n) => {
    const k = (n + H * 12) % 12;
    const a = S * Math.min(L, 1 - L);
    const v = L - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(v * 255);
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance. */
export function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two hex colours, 1–21. */
export function contrast(hexA, hexB) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return 1;
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* --- the scale ------------------------------------------------------ */

// Hue offsets from the anchor. The trio is analogous; the seal is opposite.
const HUE = { reply: -26, repost: 0, quote: 26, like: 180 };
// The lightness step between consecutive members of the trio, so hue is never
// the only thing separating them. Always applied away from the ground.
const STEP = { gap: 0.075 };

// A grey sky (some hours sample almost no chroma) would yield four greys, so
// fall back to a warm anchor rather than an unusable scale.
const FALLBACK_HUE = 28;
const MIN_ANCHOR_SATURATION = 0.08;

// What the solve aims for. It isn't always reachable: at the mid-luminance
// hours the page is neither light nor dark, and chasing 3.5 there drags the
// whole trio into three near-identical near-blacks. The lightness clamp below
// stops that, so the guaranteed floor across all 24 hours is ~3.2 — still clear
// of the 3:1 WCAG minimum for non-text — in exchange for a scale you can
// actually tell apart. `ratioedPalette.test.js` pins both ends of that trade.
export const MIN_CONTRAST = 3.5;

/** What every hour actually clears, once the clamp has had its say. */
export const CONTRAST_FLOOR = 3;

/**
 * Walk a colour's lightness away from the page until it clears `MIN_CONTRAST`.
 *
 * Solving rather than guessing, because `day` is a boolean and the sky's page
 * lightness is not: a 7am sunrise page is bright orange while an 8am one is
 * lavender, and a single "daytime" lightness leaves marks nearly invisible on
 * one of them. Bounded so a hopeless case returns the best it reached instead
 * of looping.
 */
function pushToContrast(hue, sat, startL, pageHex, goDarker) {
  let l = startL;
  let best = hslToHex(hue, sat, l);
  for (let i = 0; i < 44; i += 1) {
    const hex = hslToHex(hue, sat, l);
    if (contrast(hex, pageHex) >= MIN_CONTRAST) return hex;
    best = hex;
    l += goDarker ? -0.02 : 0.02;
    if (l <= 0.04 || l >= 0.97) break;
  }
  return best;
}

/**
 * The four categorical colours for a given sky hour.
 * Returns `{ reply, repost, quote, like }` as hex.
 */
export function ratioedScale(hour) {
  const palette = paletteForHour(hour);
  const page = palette.vars['--sky-page'];
  const rgb = hexToRgb(palette.vars['--sky-accent']);
  const [h, s] = rgb ? rgbToHsl(rgb) : [FALLBACK_HUE, 0];
  const anchor = s >= MIN_ANCHOR_SATURATION ? h : FALLBACK_HUE;

  // Which way to run from the page. A luminance threshold fails on the
  // mid-tone hours — 6pm's violet page is neither light nor dark, and going
  // lighter simply caps out — so ask which direction actually has more room
  // and send the whole scale that way, keeping it coherent.
  const darkRoom = contrast(hslToHex(anchor, 0.42, 0.1), page);
  const lightRoom = contrast(hslToHex(anchor, 0.42, 0.92), page);
  const goDarker = darkRoom > lightRoom;
  const dir = goDarker ? -1 : 1;

  // Solve ONE base lightness for the whole trio, then step from it — rather
  // than solving each hue separately, which at some hours pushed all three onto
  // the same lightness and left hue as the only thing telling them apart.
  // Stepping from a solved base keeps the gradation by construction, and every
  // step moves further from the page, so contrast only improves along the way.
  let baseL = goDarker ? 0.38 : 0.66;
  const trio = ['reply', 'repost', 'quote'];
  for (let i = 0; i < 44; i += 1) {
    const worst = Math.min(
      ...trio.map((k) => contrast(hslToHex(anchor + HUE[k], 0.42, baseL), page)),
    );
    if (worst >= MIN_CONTRAST) break;
    baseL += dir * 0.02;
    // Stop well short of black/white. The mid-luminance hours (6pm's violet
    // page) will happily drag the trio into three near-identical near-blacks
    // chasing the contrast target; a slightly lower ratio on a scale you can
    // still tell apart is the better trade.
    if (baseL <= 0.2 || baseL >= 0.8) break;
  }

  // Chroma rises as lightness gets extreme, so a dark or washed-out trio keeps
  // enough colour left to separate by hue.
  const sat = 0.42 + Math.max(0, Math.abs(baseL - 0.5) - 0.16) * 0.9;

  const out = {};
  trio.forEach((key, i) => {
    const l = Math.min(0.92, Math.max(0.1, baseL + dir * STEP.gap * i));
    out[key] = hslToHex(anchor + HUE[key], sat, l);
  });
  // The complement sits at a different hue, so it gets its own solve.
  out.like = pushToContrast(anchor + HUE.like, Math.min(0.9, sat + 0.26), baseL, page, goDarker);
  return out;
}

/** The CSS custom properties the charts read, for a given hour. */
export function ratioedScaleVars(hour) {
  const s = ratioedScale(hour);
  return {
    '--ratioed-reply': s.reply,
    '--ratioed-repost': s.repost,
    '--ratioed-quote': s.quote,
    '--ratioed-seal': s.like,
  };
}
