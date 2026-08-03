import { describe, it, expect } from 'vitest';
import { keyboardOverlap } from './useKeyboardInset.js';

describe('keyboardOverlap', () => {
  // The inset is added to a fixed sheet's bottom offset AND subtracted from its
  // height ceiling, so a wrong reading either leaves the sign-in field behind
  // the keyboard or shoves the sheet up under the top chrome.
  it('is zero with no keyboard up', () => {
    expect(keyboardOverlap(844, 844, 0)).toBe(0);
  });

  it('measures what the keyboard eats out of the layout viewport', () => {
    // iPhone-ish: 844pt tall, keyboard takes the bottom 336.
    expect(keyboardOverlap(844, 508, 0)).toBe(336);
  });

  it('discounts a scrolled or pinch-zoomed visual viewport', () => {
    // The visual viewport is short because it's zoomed in and offset down the
    // page, not because a keyboard is covering the bottom.
    expect(keyboardOverlap(844, 508, 336)).toBe(0);
    // Keyboard up AND offset: only the part past the offset is keyboard.
    expect(keyboardOverlap(844, 508, 100)).toBe(236);
  });

  it('never goes negative on over-scroll bounce', () => {
    // iOS can report a visual viewport taller than the layout one mid-bounce;
    // a negative inset would pull the sheet DOWN behind the bottom bar.
    expect(keyboardOverlap(844, 900, 0)).toBe(0);
  });

  it('rounds to whole pixels', () => {
    expect(keyboardOverlap(844, 507.4, 0)).toBe(337);
  });

  it('defaults offsetTop to zero', () => {
    expect(keyboardOverlap(844, 508)).toBe(336);
  });
});
