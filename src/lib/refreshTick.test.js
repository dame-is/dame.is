import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

// A document with just enough of the visibility API for refreshTick.js.
function fakeDocument() {
  const listeners = new Set();
  return {
    hidden: false,
    addEventListener: (type, fn) =>
      type === 'visibilitychange' && listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    show() {
      this.hidden = false;
      for (const fn of listeners) fn();
    },
    hide() {
      this.hidden = true;
      for (const fn of listeners) fn();
    },
  };
}

let doc;
let subscribeRefreshTick;

beforeEach(async () => {
  vi.useFakeTimers();
  doc = fakeDocument();
  vi.stubGlobal('document', doc);
  // Fresh module state per test: the tick is a module-level singleton.
  vi.resetModules();
  ({ subscribeRefreshTick } = await import('./refreshTick.js'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('refresh tick', () => {
  it('fires every 30s while visible and not while hidden', () => {
    const fn = vi.fn();
    const off = subscribeRefreshTick(fn);
    vi.advanceTimersByTime(30_000);
    expect(fn).toHaveBeenCalledTimes(1);
    doc.hide();
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });

  it('fires on return, then waits a full interval before the next', () => {
    const fn = vi.fn();
    const off = subscribeRefreshTick(fn);
    vi.advanceTimersByTime(30_000);
    doc.hide();
    // Back a second before the old phase would have fired.
    vi.advanceTimersByTime(29_000);
    doc.show();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(29_000);
    expect(fn).toHaveBeenCalledTimes(3);
    off();
  });

  it("doesn't refire for a tab flicked away and straight back", () => {
    const fn = vi.fn();
    const off = subscribeRefreshTick(fn);
    vi.advanceTimersByTime(30_000);
    expect(fn).toHaveBeenCalledTimes(1);
    doc.hide();
    vi.advanceTimersByTime(2_000);
    doc.show();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });
});
