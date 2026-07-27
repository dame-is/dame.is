import { describe, it, expect } from 'vitest';
import { paletteForHour } from './skyTheme.js';
import {
  hexToRgb,
  rgbToHsl,
  hslToHex,
  contrast,
  ratioedScale,
  ratioedScaleVars,
  CONTRAST_FLOOR,
} from './ratioedPalette.js';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const KEYS = ['reply', 'repost', 'quote', 'like'];
const hueOf = (hex) => rgbToHsl(hexToRgb(hex))[0];
const lightOf = (hex) => rgbToHsl(hexToRgb(hex))[2];
const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('colour space round trips', () => {
  it('parses both hex forms and rejects junk', () => {
    expect(hexToRgb('#ff8800')).toEqual([255, 136, 0]);
    expect(hexToRgb('f80')).toEqual([255, 136, 0]);
    expect(hexToRgb('nope')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });

  it('survives hex → hsl → hex', () => {
    for (const hex of ['#8c3a2e', '#5e7a47', '#c9f0f5', '#181919']) {
      const [h, s, l] = rgbToHsl(hexToRgb(hex));
      expect(hslToHex(h, s, l)).toBe(hex);
    }
  });

  it('computes contrast the WCAG way', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

describe('ratioedScale', () => {
  it('gives all four series at every hour', () => {
    for (const h of HOURS) {
      const scale = ratioedScale(h);
      for (const k of KEYS) expect(scale[k]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('keeps every series legible against that hour’s page', () => {
    // The whole reason the scale is derived rather than fixed: the sky's page
    // runs from a pale noon to a near-black midnight inside one theme.
    for (const h of HOURS) {
      const page = paletteForHour(h).vars['--sky-page'];
      for (const k of KEYS) {
        expect(contrast(ratioedScale(h)[k], page)).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
      }
    }
  });

  it('never collapses two series into one hue', () => {
    // The bug this replaced: reply and repost both resolving to the sky's
    // accent, leaving a categorical scale with three colours for four things.
    for (const h of HOURS) {
      const scale = ratioedScale(h);
      const hues = KEYS.map((k) => hueOf(scale[k]));
      for (let i = 0; i < hues.length; i += 1) {
        for (let j = i + 1; j < hues.length; j += 1) {
          expect(hueGap(hues[i], hues[j])).toBeGreaterThan(15);
        }
      }
    }
  });

  it('puts the like opposite the trio, not among it', () => {
    for (const h of HOURS) {
      const scale = ratioedScale(h);
      const seal = hueOf(scale.like);
      for (const k of ['reply', 'repost', 'quote']) {
        expect(hueGap(seal, hueOf(scale[k]))).toBeGreaterThan(120);
      }
    }
  });

  it('graduates the trio in lightness as well as hue', () => {
    // So the three living kinds stay separable where hue perception doesn't
    // help. The gap narrows at the mid-luminance hours, where the lightness
    // clamp trades some of it back for contrast, but never vanishes.
    for (const h of HOURS) {
      const scale = ratioedScale(h);
      const ls = ['reply', 'repost', 'quote'].map((k) => lightOf(scale[k])).sort((a, b) => a - b);
      expect(ls[1] - ls[0]).toBeGreaterThan(0);
      expect(ls[2] - ls[1]).toBeGreaterThan(0);
    }
  });

  it('tracks the sky rather than returning one fixed scale', () => {
    expect(ratioedScale(3).reply).not.toBe(ratioedScale(13).reply);
  });

  it('emits the custom properties the charts read', () => {
    const vars = ratioedScaleVars(9);
    expect(Object.keys(vars).sort()).toEqual([
      '--ratioed-quote',
      '--ratioed-reply',
      '--ratioed-repost',
      '--ratioed-seal',
    ]);
    expect(vars['--ratioed-seal']).toBe(ratioedScale(9).like);
  });

  it('wraps out-of-range hours instead of throwing', () => {
    expect(ratioedScale(24)).toEqual(ratioedScale(0));
    expect(ratioedScale(-1)).toEqual(ratioedScale(23));
  });
});
