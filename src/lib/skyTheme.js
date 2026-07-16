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

// The brighter true-horizon samples for the two shoulder hours, picked off
// the actual avatar frames (the averaged SKY_BANDS bottom is muddier than
// the glow at the very horizon). Used as the default "pop" a tuning
// override warms its borders/text/glow from. Other hours default to their
// own SKY_BANDS horizon band.
const SAMPLED_POP = { 7: '#efa82b', 18: '#ce7175' };

/** The default horizon "pop" color a tuning override starts from, per hour. */
export function defaultPopForHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  return SAMPLED_POP[h] || SKY_BANDS[h].bottom;
}

/**
 * Build the untuned --sky-* var set for one hour, optionally with the page
 * color replaced (absolute background override) and the chrome-surface
 * offsets scaled (surfaceSep). With `pageOverride` null and `surfaceSep`
 * 1 this reproduces the historical paletteForHour output exactly. Also
 * returns a `ctx` with the raw HSL of every tunable token so an override
 * layer can re-derive them.
 */
function buildBaseVars(hour, { pageOverride = null, surfaceSep = 1 } = {}) {
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
  const sep = typeof surfaceSep === 'number' ? surfaceSep : 1;
  // An absolute page-color override supplies its own hue/sat/lightness,
  // and the whole neutral ramp (page, surfaces, ink, rules) re-derives
  // from it. The art-based accents (--sky-accent from the top band, the
  // horizon pop) stay tied to the frame.
  const pageHsl = pageOverride ? rgbToHsl(hexToRgb(pageOverride)) : null;

  let vars;
  let raw;

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
    let l = sun;
    if (pageHsl) [hue, s, l] = pageHsl;
    const ink = hslToRgb([hue, 0.25, 0.1]);
    const accent = hslToRgb([th, clamp(ts, 0.35, 0.8), 0.3]);
    raw = {
      rule: [hue, s * 0.45, l - 0.18],
      ruleSoft: [hue, s * 0.5, l - 0.1],
      inkMuted: [hue, 0.15, Math.min(0.34, l - 0.32)],
      inkFaint: [hue, 0.12, Math.min(0.46, l - 0.18)],
      inkMutedRaised: [hue, 0.16, Math.min(0.28, l - 0.34)],
      inkFaintRaised: [hue, 0.13, Math.min(0.38, l - 0.24)],
    };
    vars = {
      '--sky-page': hsl(hue, s, l),
      '--sky-page-edge': hsl(hue, s, l - 0.06 * sep),
      '--sky-surface-raised': hsl(hue, s, l - 0.08 * sep),
      '--sky-surface-deep': hsl(hue, s, l - 0.03 * sep),
      '--sky-ink': rgbToHex(ink),
      // The muted/faint steps ride the page lightness down through the
      // dimmer shoulder hours (7am, 6pm) so secondary text keeps its
      // contrast when the page isn't at full brightness.
      '--sky-ink-soft': hsl(hue, 0.18, 0.22),
      '--sky-ink-muted': hsl(...raw.inkMuted),
      '--sky-ink-faint': hsl(...raw.inkFaint),
      '--sky-rule': hsl(...raw.rule),
      '--sky-rule-soft': hsl(...raw.ruleSoft),
      // Deep-sky accent (from the frame's top band) and a horizon accent
      // (from its bottom band) — the sky-mode stand-ins for moss + tan.
      '--sky-accent': rgbToHex(accent),
      '--sky-accent-soft': hsl(th, clamp(ts * 0.6, 0.25, 0.55), 0.45),
      '--sky-tan': hsl(hh, clamp(hs, 0.3, 0.65), 0.38),
      '--sky-highlight': rgba(accent, 0.16),
      '--sky-shadow': rgba(hslToRgb([hue, 0.3, 0.09]), 0.16),
      '--sky-scrim': rgba(hslToRgb([hue, s, l - 0.04 * sep]), 0.86),
      '--sky-scrim-clear': rgba(hslToRgb([hue, s, l - 0.04 * sep]), 0),
      '--sky-scrim-ink': rgba(ink, 0.9),
      // Muted/faint re-tuned for text sitting on --surface-raised
      // (mirrors the [data-theme] .chrome-bar rules in theme.css).
      '--sky-ink-muted-raised': hsl(...raw.inkMutedRaised),
      '--sky-ink-faint-raised': hsl(...raw.inkFaintRaised),
      '--sky-paper-rule': rgba(ink, 0.07),
      '--sky-paper-dot': rgba(ink, 0.1),
    };
  } else {
    // Deep-sky page, light ink, lightness from the sun curve (a hair
    // above black at 6pm's sunset drop, settling to the flat night
    // core). The accent comes from the horizon band, so pre-dawn glows
    // amber, dusk glows orchid, and dead-of-night (horizon too
    // desaturated to mean anything) falls back to a pale moonlit cast
    // of the sky's own hue.
    let hue = bh;
    let s = Math.min(bs, 0.45);
    let l = sun;
    if (pageHsl) [hue, s, l] = pageHsl;
    const ink = hslToRgb([hue, 0.14, 0.89]);
    const glowHue = hs < 0.1 ? hue : hh;
    const glowSat = hs < 0.1 ? 0.22 : hs;
    const accent = hslToRgb([glowHue, clamp(glowSat, 0.3, 0.6), 0.7]);
    raw = {
      rule: [hue, Math.min(s + 0.05, 0.35), l + 0.12],
      ruleSoft: [hue, Math.min(s + 0.03, 0.3), l + 0.06],
      inkMuted: [hue, 0.09, Math.max(0.61, l + 0.26)],
      inkFaint: [hue, 0.08, Math.max(0.45, l + 0.13)],
      inkMutedRaised: [hue, 0.09, Math.max(0.61, l + 0.26)],
      inkFaintRaised: [hue, 0.08, Math.max(0.52, l + 0.18)],
    };
    vars = {
      '--sky-page': hsl(hue, s, l),
      '--sky-page-edge': hsl(hue, s, Math.max(l - 0.02 * sep, 0.05)),
      '--sky-surface-raised': hsl(hue, s, Math.max(l - 0.045 * sep, 0.035)),
      '--sky-surface-deep': hsl(hue, s, Math.max(l - 0.075 * sep, 0.02)),
      '--sky-ink': rgbToHex(ink),
      // Muted/faint ride the page lightness up through the brighter
      // shoulder hours (6am dawn, 7pm sunset) so secondary text keeps
      // its contrast against the not-fully-dark page.
      '--sky-ink-soft': hsl(hue, 0.11, 0.78),
      '--sky-ink-muted': hsl(...raw.inkMuted),
      '--sky-ink-faint': hsl(...raw.inkFaint),
      '--sky-rule': hsl(...raw.rule),
      '--sky-rule-soft': hsl(...raw.ruleSoft),
      '--sky-accent': rgbToHex(accent),
      '--sky-accent-soft': hsl(glowHue, clamp(glowSat * 0.8, 0.25, 0.5), 0.58),
      '--sky-tan': hsl(glowHue, clamp(glowSat, 0.25, 0.55), 0.64),
      '--sky-highlight': rgba(accent, 0.16),
      '--sky-shadow': 'rgba(0, 0, 0, 0.45)',
      '--sky-scrim': rgba(hslToRgb([hue, s, Math.max(l - 0.06 * sep, 0.02)]), 0.8),
      '--sky-scrim-clear': rgba(hslToRgb([hue, s, Math.max(l - 0.06 * sep, 0.02)]), 0),
      '--sky-scrim-ink': rgba(ink, 0.9),
      // Night muted already clears the darker raised surface; only faint
      // needs a lift (same shape as the static dark theme's re-tune).
      '--sky-ink-muted-raised': hsl(...raw.inkMutedRaised),
      '--sky-ink-faint-raised': hsl(...raw.inkFaintRaised),
      '--sky-paper-rule': rgba(ink, 0.055),
      '--sky-paper-dot': rgba(ink, 0.08),
    };
  }

  return { vars, ctx: { day, raw } };
}

// The tuning override's warmth/contrast model. Hue + saturation come from
// an RGB blend of the token toward the horizon pop (a natural tan/rose
// path, no magenta detour); lightness is pushed away from the page —
// darker by day, lighter by night — so contrast rises predictably either
// way. warmth 0 && push 0 returns the token unchanged (exact identity).
function warmContrast(baseHsl, popRgb, warmth, push, day) {
  if (warmth <= 0 && push <= 0) return hsl(...baseHsl);
  const targetL = clamp01(baseHsl[2] + (day ? -push : push));
  const b = hslToRgb(baseHsl);
  const mixed = b.map((v, i) => v + (popRgb[i] - v) * warmth);
  const [H, S] = rgbToHsl(mixed);
  return hsl(H, Math.min(S, 0.72), targetL);
}

// The glow / shine box-shadow, split per target group (accent buttons,
// avatar mark, accent text, outlined controls) so each element family can
// opt in independently. Returns 'none' for a group the override doesn't
// target, or when the glow is off.
function glowVarsFrom(cfg) {
  const off = { color: 'transparent', buttons: 'none', avatar: 'none', accent: 'none', controls: 'none' };
  const strength = Number(cfg.glowStrength) || 0;
  const size = Math.round(Number(cfg.glowSize) || 0);
  if (strength <= 0 || size <= 0) return off;
  const rgb = hexToRgb(cfg.glowColor || cfg.pop || '#ffffff');
  const c1 = rgba(rgb, Number(strength.toFixed(3)));
  const c2 = rgba(rgb, Number(Math.min(1, strength * 1.35).toFixed(3)));
  const shadow = `0 0 ${size}px ${Math.round(size * 0.18)}px ${c1}, 0 0 ${Math.round(size * 0.45)}px ${c2}`;
  const text = `0 0 ${Math.round(size * 0.7)}px ${c1}`;
  const T = cfg.glowTargets || {};
  return {
    color: c1,
    buttons: T.buttons ? shadow : 'none',
    avatar: T.avatar ? shadow : 'none',
    accent: T.accentText ? text : 'none',
    controls: T.controls ? shadow : 'none',
  };
}

// The always-present glow vars in their "off" state — so every palette
// carries the full var set (clearSkyTheme/theme.css stay consistent).
const GLOW_OFF = {
  '--sky-glow-color': 'transparent',
  '--sky-glow-buttons': 'none',
  '--sky-glow-avatar': 'none',
  '--sky-glow-accent': 'none',
  '--sky-glow-controls': 'none',
};

/**
 * Layer one hour's parametric tuning override onto its base vars: re-warm
 * the borders and faint/muted ink toward the pop, deepen for contrast,
 * pull the inline highlight from the pop, and emit the per-target glow.
 * Page / primary ink / link accent are left as the base derived them
 * (the page itself may already carry an absolute override via buildBaseVars).
 */
function applyOverride(baseVars, ctx, cfg) {
  const { day, raw } = ctx;
  const popRgb = hexToRgb(cfg.pop || '#ffffff');
  const rW = Number(cfg.ruleWarmth) || 0;
  const rC = Number(cfg.ruleContrast) || 0;
  const iW = Number(cfg.inkWarmth) || 0;
  const iC = Number(cfg.inkContrast) || 0;
  const v = { ...baseVars };
  v['--sky-rule'] = warmContrast(raw.rule, popRgb, rW, rC, day);
  v['--sky-rule-soft'] = warmContrast(raw.ruleSoft, popRgb, rW, rC * 0.55, day);
  v['--sky-ink-faint'] = warmContrast(raw.inkFaint, popRgb, iW, iC, day);
  v['--sky-ink-muted'] = warmContrast(raw.inkMuted, popRgb, iW, iC * 0.6, day);
  v['--sky-ink-faint-raised'] = warmContrast(raw.inkFaintRaised, popRgb, iW, iC, day);
  v['--sky-ink-muted-raised'] = warmContrast(raw.inkMutedRaised, popRgb, iW, iC * 0.6, day);
  if (iW > 0 || rW > 0) {
    const [ph, ps] = rgbToHsl(popRgb);
    v['--sky-tan'] = hsl(ph, clamp(ps, 0.35, 0.72), day ? 0.42 : 0.6);
    v['--sky-accent-soft'] = hsl(ph, clamp(ps * 0.7, 0.3, 0.6), day ? 0.5 : 0.58);
  }
  const g = glowVarsFrom(cfg);
  v['--sky-glow-color'] = g.color;
  v['--sky-glow-buttons'] = g.buttons;
  v['--sky-glow-avatar'] = g.avatar;
  v['--sky-glow-accent'] = g.accent;
  v['--sky-glow-controls'] = g.controls;
  return v;
}

// Module-level active tuning, installed once the is.dame.sky override
// resolves (snapshot then live — see useSkyTuning). null = the built-in
// hourly derivation, unchanged. Shaped { enabled, hours: {0..23: cfg} }.
let activeTuning = null;

/** Install the resolved sky-theme tuning (or null to clear). */
export function setSkyTuning(tuning) {
  activeTuning = tuning && tuning.enabled ? tuning : null;
}

/** The currently installed tuning (or null). */
export function getSkyTuning() {
  return activeTuning;
}

/**
 * The full token set for one hour of sky, as a map of --sky-* custom
 * properties plus the meta bits (theme-color, color-scheme, label).
 * `tuning` defaults to the installed override; pass an explicit one (e.g.
 * a draft from the admin studio) to preview it without installing it.
 */
export function paletteForHour(hour, tuning = activeTuning) {
  const h24 = ((hour % 24) + 24) % 24;
  const cfg = tuning && tuning.enabled && tuning.hours ? tuning.hours[h24] : null;
  const { vars, ctx } = buildBaseVars(hour, {
    pageOverride: cfg && cfg.page ? cfg.page : null,
    surfaceSep: cfg ? cfg.surfaceSep : 1,
  });
  const outVars = cfg ? applyOverride(vars, ctx, cfg) : { ...vars, ...GLOW_OFF };
  return {
    hour: h24,
    key: KEYS[h24],
    day: ctx.day,
    colorScheme: ctx.day ? 'light' : 'dark',
    themeColor: outVars['--sky-surface-raised'],
    vars: outVars,
  };
}

// Every var name a palette emits, so clearSkyTheme can sweep them all
// (base tokens + the glow group).
const SKY_VAR_NAMES = Object.keys({ ...buildBaseVars(0).vars, ...GLOW_OFF });

/** Write the given hour's palette onto <html> as --sky-* vars. */
export function applySkyTheme(hour, tuning = activeTuning) {
  const palette = paletteForHour(hour, tuning);
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
