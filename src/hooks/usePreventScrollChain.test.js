import { describe, it, expect } from 'vitest';
import { exceedsTapSlop, TAP_SLOP_PX } from './usePreventScrollChain.js';

describe('exceedsTapSlop', () => {
  // The scroll-chain guard cancels touchmove, and a canceled first touchmove
  // costs the touch its click. Everything a tap can plausibly drift must stay
  // under the threshold, or buttons inside our sheets go dead.
  it('treats a still or barely-drifting touch as a tap', () => {
    expect(exceedsTapSlop(0, 0)).toBe(false);
    expect(exceedsTapSlop(1, -2)).toBe(false);
    expect(exceedsTapSlop(0, 6)).toBe(false);
  });

  it('counts drift in either axis, and in both at once', () => {
    expect(exceedsTapSlop(0, 40)).toBe(true);
    expect(exceedsTapSlop(-40, 0)).toBe(true);
    // 8 and 8 are each under the threshold; their diagonal (~11.3) is not.
    expect(exceedsTapSlop(8, 8)).toBe(true);
  });

  it('needs to clear the threshold, not just reach it', () => {
    expect(exceedsTapSlop(0, TAP_SLOP_PX)).toBe(false);
    expect(exceedsTapSlop(0, TAP_SLOP_PX + 0.5)).toBe(true);
  });

  it('accepts a caller-supplied slop', () => {
    expect(exceedsTapSlop(0, 6, 20)).toBe(false);
    expect(exceedsTapSlop(0, 6, 2)).toBe(true);
  });
});
