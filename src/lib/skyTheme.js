// The "sky" theme: a third color mode that drifts through the day in
// lockstep with Dame's hourly Bluesky avatar (and the favicon — see
// api/favicon.js and og/time.js). Instead of two fixed palettes, every
// Eastern hour gets its own palette derived from the actual sky gradient
// in that hour's avatar frame.
//
// SKY_BANDS holds, per hour, the average color of the TOP and BOTTOM
// quarter of images/sky-avatars/<key>.jpg (sampled with sharp; the middle
// band is skipped because the "dame" wordmark pollutes it). The top band
// is the deep sky, the bottom band is the horizon — at dawn/dusk that's
// where the warm glow lives, so accents derived from it track the sunrise
// and sunset just like the art does.
//
// From those two anchors, paletteForHour() derives the full set of theme
// tokens (page, surfaces, ink ramp, rules, accents, scrims) with the same
// relative steps the static light/dark themes use in styles/theme.css.
// Hue and saturation stay true to the frame, but the page's LIGHTNESS is
// driven by SUN_CURVE — a hand-eased solar arc — so the app background
// physically tracks the sun: near-flat dark through the night, a steep
// climb across sunrise, a gentle crest at solar noon, and a steep fall
// at sunset. Hours whose curve value sits above the midpoint get dark
// ink on a light sky page; the rest get light ink on a deep-sky page —
// mirroring the avatar's own wordmark flip.
//
// applySkyTheme(hour) writes the palette as --sky-* custom properties on
// <html>; styles/theme.css maps the real tokens onto those vars inside
// [data-theme='sky'].

import { easternHour, avatarKeys, secondsUntilNextHour } from '../../og/time.js';

export { easternHour, secondsUntilNextHour };

const KEYS = avatarKeys();

/** The clock label ("12am" … "11pm") for an hour 0–23. */
export function skyHourKey(hour) {
  return KEYS[((hour % 24) + 24) % 24];
}

// Sampled top/bottom band averages per hour (0 = 12am … 23 = 11pm).
const SKY_BANDS = [
  { top: '#111111', bottom: '#101111' }, // 12am
  { top: '#121314', bottom: '#161616' }, // 1am
  { top: '#161b1e', bottom: '#171818' }, // 2am
  { top: '#0f1213', bottom: '#212121' }, // 3am
  { top: '#090808', bottom: '#2b2215' }, // 4am
  { top: '#07091b', bottom: '#43290c' }, // 5am
  { top: '#181e3c', bottom: '#5f3c06' }, // 6am
  { top: '#3660df', bottom: '#cc9543' }, // 7am
  { top: '#3369ff', bottom: '#c5ac94' }, // 8am
  { top: '#658eff', bottom: '#bccbfc' }, // 9am
  { top: '#96b5ff', bottom: '#87cffa' }, // 10am
  { top: '#8aebf0', bottom: '#afdff6' }, // 11am
  { top: '#2ce9f3', bottom: '#a0dff7' }, // 12pm
  { top: '#1dd7fc', bottom: '#82eff4' }, // 1pm
  { top: '#00c2ff', bottom: '#5be9f7' }, // 2pm
  { top: '#0ad1fd', bottom: '#84cffd' }, // 3pm
  { top: '#0dc7ff', bottom: '#82b1ff' }, // 4pm
  { top: '#0088ff', bottom: '#8082fb' }, // 5pm
  { top: '#1055ff', bottom: '#b36e8f' }, // 6pm
  { top: '#191793', bottom: '#66225c' }, // 7pm
  { top: '#101256', bottom: '#382354' }, // 8pm
  { top: '#030611', bottom: '#2c1a34' }, // 9pm
  { top: '#010105', bottom: '#100b18' }, // 10pm
  { top: '#0a0b10', bottom: '#0a0b0c' }, // 11pm
];

// The page-lightness envelope, one value per hour — a hand-eased solar
// arc rather than a formula, because the shape matters more than the
// math. Calibrated to Eastern-timezone daylight (the hour itself already
// resolves in America/New_York): the night core (10pm–4am) is near-flat
// dark, dawn stirs at 5–6am, sunrise climbs through 7–8am, the daylight
// hours hold bright — cresting at 1pm, solar noon in EDT — and stay
// bright through 5pm. The light doesn't start leaving until 6pm, then
// steps down through sunset (7pm) and twilight (8pm) into night. Both
// twilight ramps are spread over three hours — an S-curve, not a cliff —
// so no single increment slams from day to night. Bulk of day and night:
// small increments. Sunrise/sunset shoulders: the biggest steps.
//
// An hour is "daylight" (dark ink on a light page) when its value is
// ≥ 0.5; the flip points (7am, 7pm) are where each S-curve crosses the
// middle.
const SUN_CURVE = [
  0.095, // 12am
  0.09,  // 1am — deepest night
  0.09,  // 2am
  0.095, // 3am
  0.10,  // 4am
  0.13,  // 5am — first light on the horizon
  0.26,  // 6am — dawn glow building
  0.60,  // 7am — sunrise crosses into day
  0.74,  // 8am — morning settles in
  0.81,  // 9am
  0.85,  // 10am
  0.86,  // 11am
  0.875, // 12pm
  0.88,  // 1pm — solar noon
  0.875, // 2pm
  0.87,  // 3pm
  0.86,  // 4pm
  0.83,  // 5pm — still full daylight
  0.70,  // 6pm — the light starts to leave
  0.38,  // 7pm — sunset crosses into night
  0.22,  // 8pm — twilight fading
  0.13,  // 9pm
  0.10,  // 10pm
  0.09,  // 11pm
];

/* ---------- small color kit (hex ⇄ rgb ⇄ hsl) ---------- */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  return (
    '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')
  );
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
    case g: h = (b - r) / d + 2; break;
    default: h = (r - g) / d + 4;
  }
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  s = clamp01(s); l = clamp01(l);
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255),
  ];
}

const hsl = (h, s, l) => rgbToHex(hslToRgb([h, s, l]));
const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;

/* ---------- palette derivation ---------- */

/**
 * The full token set for one hour of sky, as a map of --sky-* custom
 * properties plus the meta bits (theme-color, color-scheme, label).
 */
export function paletteForHour(hour) {
  const h24 = ((hour % 24) + 24) % 24;
  const { top, bottom } = SKY_BANDS[h24];
  const topRgb = hexToRgb(top);
  const botRgb = hexToRgb(bottom);
  const base = topRgb.map((v, i) => (v + botRgb[i]) / 2);
  const [bh, bs] = rgbToHsl(base);
  const [th, ts] = rgbToHsl(topRgb);
  const [hh, hs] = rgbToHsl(botRgb); // horizon band
  const sun = SUN_CURVE[h24];
  const day = sun >= 0.5;

  let vars;
  let themeColor;

  if (day) {
    // Sky-colored page, dark ink. The sun curve sets the lightness —
    // that's the whole arc: morning and late-afternoon pages sit lower,
    // noon crests brightest. Hue and saturation come from the frame.
    // Near-gray frames (7am's blue + gold bands cancel each other out)
    // borrow the top band's hue so sunrise reads as a pale morning blue
    // instead of mud.
    let hue = bh;
    let s = Math.min(bs, 0.7);
    if (bs < 0.15) {
      hue = th;
      s = clamp((bs + ts) / 2, 0.2, 0.4);
    }
    const l = sun;
    const ink = hslToRgb([hue, 0.25, 0.1]);
    const accent = hslToRgb([th, clamp(ts, 0.35, 0.8), 0.3]);
    vars = {
      '--sky-page': hsl(hue, s, l),
      '--sky-page-edge': hsl(hue, s, l - 0.06),
      '--sky-surface-raised': hsl(hue, s, l - 0.08),
      '--sky-surface-deep': hsl(hue, s, l - 0.03),
      '--sky-ink': rgbToHex(ink),
      // The muted/faint steps ride the page lightness down through the
      // dimmer shoulder hours (7am, 6pm) so secondary text keeps its
      // contrast when the page isn't at full brightness.
      '--sky-ink-soft': hsl(hue, 0.18, 0.22),
      '--sky-ink-muted': hsl(hue, 0.15, Math.min(0.34, l - 0.32)),
      '--sky-ink-faint': hsl(hue, 0.12, Math.min(0.46, l - 0.18)),
      '--sky-rule': hsl(hue, s * 0.45, l - 0.18),
      '--sky-rule-soft': hsl(hue, s * 0.5, l - 0.1),
      // Deep-sky accent (from the frame's top band) and a horizon accent
      // (from its bottom band) — the sky-mode stand-ins for moss + tan.
      '--sky-accent': rgbToHex(accent),
      '--sky-accent-soft': hsl(th, clamp(ts * 0.6, 0.25, 0.55), 0.45),
      '--sky-tan': hsl(hh, clamp(hs, 0.3, 0.65), 0.38),
      '--sky-highlight': rgba(accent, 0.16),
      '--sky-shadow': rgba(hslToRgb([hue, 0.3, 0.09]), 0.16),
      '--sky-scrim': rgba(hslToRgb([hue, s, l - 0.04]), 0.86),
      '--sky-scrim-clear': rgba(hslToRgb([hue, s, l - 0.04]), 0),
      '--sky-scrim-ink': rgba(ink, 0.9),
      // Muted/faint re-tuned for text sitting on --surface-raised
      // (mirrors the [data-theme] .chrome-bar rules in theme.css).
      '--sky-ink-muted-raised': hsl(hue, 0.16, Math.min(0.28, l - 0.34)),
      '--sky-ink-faint-raised': hsl(hue, 0.13, Math.min(0.38, l - 0.24)),
      '--sky-paper-rule': rgba(ink, 0.07),
      '--sky-paper-dot': rgba(ink, 0.1),
    };
    themeColor = vars['--sky-surface-raised'];
  } else {
    // Deep-sky page, light ink, lightness from the sun curve (a hair
    // above black at 6pm's sunset drop, settling to the flat night
    // core). The accent comes from the horizon band, so pre-dawn glows
    // amber, dusk glows orchid, and dead-of-night (horizon too
    // desaturated to mean anything) falls back to a pale moonlit cast
    // of the sky's own hue.
    const s = Math.min(bs, 0.45);
    const l = sun;
    const ink = hslToRgb([bh, 0.14, 0.89]);
    const glowHue = hs < 0.1 ? bh : hh;
    const glowSat = hs < 0.1 ? 0.22 : hs;
    const accent = hslToRgb([glowHue, clamp(glowSat, 0.3, 0.6), 0.7]);
    vars = {
      '--sky-page': hsl(bh, s, l),
      '--sky-page-edge': hsl(bh, s, Math.max(l - 0.02, 0.05)),
      '--sky-surface-raised': hsl(bh, s, Math.max(l - 0.045, 0.035)),
      '--sky-surface-deep': hsl(bh, s, Math.max(l - 0.075, 0.02)),
      '--sky-ink': rgbToHex(ink),
      // Muted/faint ride the page lightness up through the brighter
      // shoulder hours (6am dawn, 7pm sunset) so secondary text keeps
      // its contrast against the not-fully-dark page.
      '--sky-ink-soft': hsl(bh, 0.11, 0.78),
      '--sky-ink-muted': hsl(bh, 0.09, Math.max(0.61, l + 0.26)),
      '--sky-ink-faint': hsl(bh, 0.08, Math.max(0.45, l + 0.13)),
      '--sky-rule': hsl(bh, Math.min(s + 0.05, 0.35), l + 0.12),
      '--sky-rule-soft': hsl(bh, Math.min(s + 0.03, 0.3), l + 0.06),
      '--sky-accent': rgbToHex(accent),
      '--sky-accent-soft': hsl(glowHue, clamp(glowSat * 0.8, 0.25, 0.5), 0.58),
      '--sky-tan': hsl(glowHue, clamp(glowSat, 0.25, 0.55), 0.64),
      '--sky-highlight': rgba(accent, 0.16),
      '--sky-shadow': 'rgba(0, 0, 0, 0.45)',
      '--sky-scrim': rgba(hslToRgb([bh, s, Math.max(l - 0.06, 0.02)]), 0.8),
      '--sky-scrim-clear': rgba(hslToRgb([bh, s, Math.max(l - 0.06, 0.02)]), 0),
      '--sky-scrim-ink': rgba(ink, 0.9),
      // Night muted already clears the darker raised surface; only faint
      // needs a lift (same shape as the static dark theme's re-tune).
      '--sky-ink-muted-raised': hsl(bh, 0.09, Math.max(0.61, l + 0.26)),
      '--sky-ink-faint-raised': hsl(bh, 0.08, Math.max(0.52, l + 0.18)),
      '--sky-paper-rule': rgba(ink, 0.055),
      '--sky-paper-dot': rgba(ink, 0.08),
    };
    themeColor = vars['--sky-surface-raised'];
  }

  return {
    hour: h24,
    key: KEYS[h24],
    day,
    colorScheme: day ? 'light' : 'dark',
    themeColor,
    vars,
  };
}

// Every var name paletteForHour emits, so clearSkyTheme can sweep them all.
const SKY_VAR_NAMES = Object.keys(paletteForHour(0).vars);

/** Write the given hour's palette onto <html> as --sky-* vars. */
export function applySkyTheme(hour) {
  const palette = paletteForHour(hour);
  const root = document.documentElement;
  for (const name of SKY_VAR_NAMES) root.style.setProperty(name, palette.vars[name]);
  // Inline so form controls / scrollbars flip with the hour; theme.css's
  // static `color-scheme: dark` inside [data-theme='sky'] is the fallback.
  root.style.colorScheme = palette.colorScheme;
  return palette;
}

/** Remove every inline --sky-* var (leaving the static themes untouched). */
export function clearSkyTheme() {
  const root = document.documentElement;
  for (const name of SKY_VAR_NAMES) root.style.removeProperty(name);
  root.style.removeProperty('color-scheme');
}
