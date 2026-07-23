import { describe, it, expect } from 'vitest';
import { inkblotRamp, hexToRgb, recolorInkblot } from './anisotaLab.js';

describe('hexToRgb', () => {
  it('parses #rrggbb', () => {
    expect(hexToRgb('#1d2419')).toEqual([29, 36, 25]);
  });
  it('expands #rgb shorthand', () => {
    expect(hexToRgb('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
  });
  it('is case- and whitespace-insensitive', () => {
    expect(hexToRgb('  #FFFFFF ')).toEqual([255, 255, 255]);
  });
  it('rejects non-hex', () => {
    expect(hexToRgb('rgb(1,2,3)')).toBeNull();
    expect(hexToRgb('')).toBeNull();
    expect(hexToRgb(null)).toBeNull();
  });
});

describe('inkblotRamp', () => {
  it('maps the ink slot to the ink ramp', () => {
    expect(inkblotRamp('ink')).toEqual(['--sky-ink', '--sky-ink-muted']);
  });
  it('maps accent slots to the accent ramp', () => {
    expect(inkblotRamp('accent-deep')).toEqual(['--sky-accent', '--sky-accent-soft']);
  });
  it('falls back to the ink ramp for unknown / missing slots', () => {
    expect(inkblotRamp('mystery')).toEqual(['--sky-ink', '--sky-ink-muted']);
    expect(inkblotRamp(undefined)).toEqual(['--sky-ink', '--sky-ink-muted']);
  });
});

describe('recolorInkblot', () => {
  const DENSE = [10, 20, 30];
  const FAINT = [200, 210, 220];

  // Build an RGBA buffer from [r,g,b,a] tuples.
  const buf = (...px) => new Uint8ClampedArray(px.flat());

  it('leaves fully transparent pixels untouched', () => {
    const data = buf([123, 45, 67, 0]);
    recolorInkblot(data, DENSE, FAINT);
    expect([...data]).toEqual([123, 45, 67, 0]);
  });

  it('collapses a single-tone blot onto the dense stop', () => {
    // Every visible pixel shares one luminance → all land on `dense`.
    const data = buf([255, 255, 255, 255], [255, 255, 255, 128], [0, 0, 0, 0]);
    recolorInkblot(data, DENSE, FAINT);
    expect([...data.slice(0, 3)]).toEqual(DENSE);
    expect([...data.slice(4, 7)]).toEqual(DENSE); // recolor ignores alpha level
    expect(data[7]).toBe(128); // ...but preserves it
    expect([...data.slice(8, 12)]).toEqual([0, 0, 0, 0]); // transparent untouched
  });

  it('maps the darkest visible pixel to dense and the lightest to faint', () => {
    const data = buf([0, 0, 0, 255], [255, 255, 255, 255]);
    recolorInkblot(data, DENSE, FAINT);
    expect([...data.slice(0, 3)]).toEqual(DENSE);
    expect([...data.slice(4, 7)]).toEqual(FAINT);
  });

  it('places a mid-luminance pixel between the stops', () => {
    const data = buf([0, 0, 0, 255], [128, 128, 128, 255], [255, 255, 255, 255]);
    recolorInkblot(data, DENSE, FAINT);
    const mid = [...data.slice(4, 7)];
    mid.forEach((c, k) => {
      expect(c).toBeGreaterThan(DENSE[k]);
      expect(c).toBeLessThan(FAINT[k]);
    });
  });

  it('always preserves the alpha channel', () => {
    const data = buf([40, 60, 80, 255], [40, 60, 80, 90], [40, 60, 80, 12]);
    recolorInkblot(data, DENSE, FAINT);
    expect([data[3], data[7], data[11]]).toEqual([255, 90, 12]);
  });
});
