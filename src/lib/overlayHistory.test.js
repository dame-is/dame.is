import { describe, expect, it, vi } from 'vitest';
import { createOverlayHistory } from './overlayHistory.js';

/**
 * A stand-in for the browser's session history: entries with state and a URL,
 * traversal that lands a task later (as history.back() does), and popstate
 * dispatched to capture listeners before bubble ones, so a capture listener's
 * stopImmediatePropagation keeps the "router" from hearing it.
 */
function fakeWindow(startUrl = '/page') {
  const entries = [{ state: { key: 'k0', idx: 0 }, url: startUrl }];
  let index = 0;
  const listeners = [];
  const win = {
    location: {
      get href() {
        return `https://dame.is${entries[index].url}`;
      },
      origin: 'https://dame.is',
    },
    history: {
      get state() {
        return entries[index].state;
      },
      get length() {
        return entries.length;
      },
      pushState(state, _title, url) {
        entries.splice(index + 1);
        entries.push({ state, url: url ?? entries[index].url });
        index += 1;
      },
      replaceState(state, _title, url) {
        entries[index] = { state, url: url ?? entries[index].url };
      },
      go(delta) {
        setTimeout(() => {
          const next = Math.max(0, Math.min(entries.length - 1, index + delta));
          if (next === index) return;
          index = next;
          dispatch();
        }, 0);
      },
      back() {
        this.go(-1);
      },
    },
    addEventListener(type, fn, capture) {
      listeners.push({ type, fn, capture: Boolean(capture) });
    },
    removeEventListener(type, fn, capture) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === Boolean(capture));
      if (i !== -1) listeners.splice(i, 1);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    queueMicrotask: (fn) => queueMicrotask(fn),
    document: null,
  };
  function dispatch() {
    let stopped = false;
    const event = { stopImmediatePropagation: () => (stopped = true) };
    const ordered = [...listeners.filter((l) => l.capture), ...listeners.filter((l) => !l.capture)];
    for (const l of ordered) {
      if (l.type !== 'popstate') continue;
      l.fn(event);
      if (stopped) break;
    }
  }
  // The router: it hears popstate in the bubble phase and pushes with an idx
  // one past the current entry's, as React Router's history does.
  const router = { pops: [] };
  win.addEventListener('popstate', () => router.pops.push(win.history.state));
  router.push = (url, key) =>
    win.history.pushState({ key, idx: (win.history.state?.idx ?? 0) + 1 }, '', url);
  router.replace = (url, key) =>
    win.history.replaceState({ key, idx: win.history.state?.idx ?? 0 }, '', url);
  // The browser's own Back (a gesture, the button): a traversal that never
  // goes through the page's history methods.
  const rawGo = win.history.go;
  const userBack = () => rawGo.call(win.history, -1);
  return { win, router, userBack, entries: () => entries.map((e) => e.url), at: () => index };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('overlayHistory', () => {
  it('pushes an entry on open and consumes it on close, unseen by the router', async () => {
    const { win, router, entries, at } = fakeWindow();
    const oh = createOverlayHistory(win);
    const onPop = vi.fn();
    const h = oh.open(onPop);
    expect(entries()).toEqual(['/page', '/page']);
    expect(at()).toBe(1);
    h.release();
    await tick();
    expect(at()).toBe(0);
    expect(onPop).not.toHaveBeenCalled();
    expect(router.pops).toEqual([]);
    // Fully off duty: the browser's own methods are back.
    expect(Object.keys(win.history)).toContain('pushState');
    expect(win.history.pushState.name).toBe('pushState');
  });

  it('closes the overlay on Back, unseen by the router', async () => {
    const { win, router, at, userBack } = fakeWindow();
    const oh = createOverlayHistory(win);
    const onPop = vi.fn();
    const h = oh.open(onPop);
    userBack();
    await tick();
    expect(onPop).toHaveBeenCalledTimes(1);
    expect(at()).toBe(0);
    h.release(); // the overlay's own close, after the pop
    await tick();
    expect(at()).toBe(0);
    expect(router.pops).toEqual([]);
  });

  it('lets an in-app Back walk past the overlay to the previous page', async () => {
    const { win, router, at } = fakeWindow();
    router.push('/next', 'k1');
    const oh = createOverlayHistory(win);
    const onPop = vi.fn();
    oh.open(onPop);
    win.history.go(-1); // the bottom bar's Back
    await tick();
    expect(at()).toBe(0);
    expect(onPop).toHaveBeenCalledTimes(1);
    expect(router.pops.map((s) => s.key)).toEqual(['k0']);
  });

  it('replaces the overlay entry when the router navigates from it', async () => {
    const { win, router, entries } = fakeWindow();
    const oh = createOverlayHistory(win);
    const h = oh.open(() => {});
    router.push('/elsewhere', 'k1');
    h.release();
    await tick();
    expect(entries()).toEqual(['/page', '/elsewhere']);
    expect(win.history.state.idx).toBe(1);
  });

  it('waits for the navigation a tapped link starts, then lets it take the entry', async () => {
    const { win, router, entries } = fakeWindow();
    const doc = { listeners: [] };
    doc.addEventListener = (t, fn) => doc.listeners.push(fn);
    doc.removeEventListener = (t, fn) => (doc.listeners = doc.listeners.filter((f) => f !== fn));
    win.document = doc;
    const oh = createOverlayHistory(win, { settleMs: 50 });
    const h = oh.open(() => {});
    const link = { href: '/listening', target: '', hasAttribute: () => false };
    doc.listeners.forEach((fn) =>
      fn({ button: 0, target: { closest: () => link }, defaultPrevented: false }),
    );
    h.release(); // the menu closes first…
    await tick();
    router.push('/listening', 'k1'); // …and navigates two frames later
    await new Promise((r) => setTimeout(r, 80));
    expect(entries()).toEqual(['/page', '/listening']);
  });

  it('carries a replace made under the overlay onto the page entry', async () => {
    const { win, router, entries, at } = fakeWindow();
    const oh = createOverlayHistory(win);
    const h = oh.open(() => {});
    router.replace('/page?verbs=posting', 'k1'); // a filter toggled in the sheet
    h.release();
    await tick();
    expect(at()).toBe(0);
    expect(entries()).toEqual(['/page?verbs=posting', '/page?verbs=posting']);
    expect(win.history.state.key).toBe('k1');
    expect(router.pops).toEqual([]);
  });

  it('does the same when the replace is followed by Back', async () => {
    const { win, router, at, userBack } = fakeWindow();
    const oh = createOverlayHistory(win);
    const onPop = vi.fn();
    oh.open(onPop);
    router.replace('/page?verbs=posting', 'k1');
    userBack();
    await tick();
    expect(onPop).toHaveBeenCalledTimes(1);
    expect(at()).toBe(0);
    expect(win.location.href).toBe('https://dame.is/page?verbs=posting');
    expect(router.pops).toEqual([]);
  });

  it('hands one entry from a closing overlay to the one opening', async () => {
    const { win, entries, at, userBack } = fakeWindow();
    const oh = createOverlayHistory(win);
    const a = oh.open(() => {});
    a.release(); // a sheet closes…
    const onPopB = vi.fn();
    const b = oh.open(onPopB); // …as another opens, in one commit
    await tick();
    expect(entries()).toEqual(['/page', '/page']);
    expect(at()).toBe(1);
    userBack();
    await tick();
    expect(onPopB).toHaveBeenCalledTimes(1);
    b.release();
    await tick();
    expect(at()).toBe(0);
  });

  it('closes only the top overlay of two', async () => {
    const { win, router, userBack } = fakeWindow();
    const oh = createOverlayHistory(win);
    const lower = vi.fn();
    const upper = vi.fn();
    oh.open(lower);
    oh.open(upper);
    userBack();
    await tick();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    expect(oh.depth()).toBe(1);
    expect(router.pops).toEqual([]);
  });
});
