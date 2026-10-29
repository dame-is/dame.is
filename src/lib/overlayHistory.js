/**
 * One history entry per open overlay, so the back gesture (iOS edge swipe,
 * Android's back button) closes the sheet, the nav dock or the lightbox on
 * top instead of leaving the page underneath it.
 *
 * Opening an overlay pushes an entry on the same URL. Back pops it, and the
 * overlay closes. Closing it any other way (its ×, Escape, the backdrop)
 * consumes the entry with a history.back(), so no dead entry is left for the
 * next Back to land on.
 *
 * The router must never notice, which is most of what this module is for.
 * React Router 7's BrowserRouter re-reads the location on every popstate; a
 * pop between two entries of the same page would still hand it a fresh
 * location object and a POP, re-running every effect keyed on the location
 * and RouteTransition's scroll restore. So, only while an overlay is open:
 *
 *   - the overlay's entry copies the router's own state (its `key` and
 *     `idx`), and a popstate that only moves between a page and its overlays
 *     is stopped by a capture listener before the router's listener runs. The
 *     router's location is right throughout: neither URL nor key changed.
 *   - a router push while an overlay's entry is on top (a link tapped in the
 *     menu, a search sent from its sheet) replaces that entry rather than
 *     stacking on it, so Back from the new page goes to the old one, not to a
 *     stale copy of it.
 *   - a router replace on top of an overlay (a filter toggled in the filter
 *     sheet rewrites ?verbs=) is carried on the overlay's entry and written
 *     onto the page's own entry when the overlay closes, by × or by Back.
 *   - an in-app "go back" (the bottom bar's Back, navigate(-1)) steps over the
 *     overlay entries, so it still walks the reader's history page by page.
 *   - a primary click on a same-document link marks the next close as a
 *     navigation. The nav menu closes first and navigates two frames later;
 *     consuming the entry in between would race the push, so the entry is
 *     left for the push to replace (or consumed a moment later if no push
 *     comes).
 *
 * Everything takes the window as an argument, so the logic is tested against
 * a stand-in history (overlayHistory.test.js).
 */

const MARK = '__overlay';
const BASE = '__overlayBase';

/**
 * @param {Window} win
 * @param {{ settleMs?: number }} [options]  how long a close marked as a
 *   navigation waits for that navigation before consuming its entry anyway
 */
export function createOverlayHistory(win, { settleMs = 800 } = {}) {
  const history = win.history;
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  const origGo = history.go.bind(history);
  const origBack = history.back.bind(history);

  // Run ids are unique to this page load: entries outlive a reload, and a
  // stamp left by the last load must never read as one of ours.
  const session = Math.random().toString(36).slice(2, 8);
  let counter = 0;
  const nextId = () => `${session}.${(counter += 1)}`;

  // Open overlays, oldest first: { id, onPop, gone, popped }.
  const stack = [];
  // The current run: one stretch of overlays over one page entry, which is
  // stamped with it so a Back onto that page is recognised as such.
  let run = null;
  // Popstates we caused and must hide from the router.
  let ownPops = 0;
  // A router replace made while an overlay's entry was on top, to be written
  // onto the page's entry once we're back on it.
  let rebase = null;
  // A link was tapped: the next close leaves its entry for a navigation.
  let navIntent = false;
  // The entry a navigation-marked close left behind, awaiting that push.
  let awaitingNav = null;
  // A consume scheduled by a close, which an open in the same task can take
  // over (one sheet closing as another opens reuses the entry).
  let pendingConsume = null;
  // The key of the location the router last rendered.
  let routerKey = 'default';
  let installed = false;

  const stateOf = () => history.state || null;
  const markOf = (state) => (state && typeof state === 'object' && state[MARK]) || null;
  const keyOf = (state) => (state && state.key) || 'default';
  const strip = (state) => {
    if (!state || typeof state !== 'object') return state;
    const rest = { ...state };
    delete rest[MARK];
    delete rest[BASE];
    return rest;
  };
  const ourMark = () => {
    const mark = markOf(stateOf());
    return mark && mark.run === run ? mark : null;
  };

  /* ---- the router's calls ---- */

  function pushState(state, title, url) {
    const mark = ourMark();
    navIntent = false;
    routerKey = keyOf(state);
    if (mark && (stack.length > 0 || awaitingNav === mark.id)) {
      // A navigation from an open overlay takes the overlay's slot. The open
      // overlays' entries are gone; they close on the pathname change, or
      // stay open without one if the page didn't change.
      for (const o of stack) o.gone = true;
      awaitingNav = null;
      rebase = null;
      const result = origReplace(state, title, url);
      if (stack.length === 0) endRun();
      return result;
    }
    return origPush(state, title, url);
  }

  function replaceState(state, title, url) {
    const mark = ourMark();
    routerKey = keyOf(state);
    if (mark && stack.length > 0) {
      rebase = { state, url: url ?? win.location.href };
      return origReplace({ ...state, [MARK]: mark }, title, url);
    }
    return origReplace(state, title, url);
  }

  function go(delta) {
    const mark = ourMark();
    if (typeof delta === 'number' && delta < 0 && mark) {
      // "Back a page" from the app means back a page: past the overlays too.
      return origGo(delta - mark.depth);
    }
    return origGo(delta);
  }

  function back() {
    return go(-1);
  }

  /* ---- ours ---- */

  function consume() {
    ownPops += 1;
    origBack();
  }

  function closeAbove(depth) {
    while (stack.length > depth) {
      const o = stack.pop();
      if (!o.popped) {
        o.popped = true;
        o.onPop?.();
      }
    }
  }

  function applyRebase() {
    if (!rebase) return;
    const { state, url } = rebase;
    rebase = null;
    origReplace({ ...state, [BASE]: run }, '', url);
  }

  // Stop a popstate before the router's listener sees it, but only when the
  // router's location would come out exactly as it already is.
  function hide(event) {
    const key = keyOf(stateOf());
    if (key === routerKey) event.stopImmediatePropagation();
    else routerKey = key;
  }

  function onPopState(event) {
    const state = stateOf();
    const mark = markOf(state);
    const ours = ownPops > 0;
    if (ours) ownPops -= 1;

    if (mark && mark.run === run && run) {
      const depth = stack.findIndex((o) => o.id === mark.id);
      if (depth === -1) {
        // A closed overlay's entry (Forward after a Back): step off it again.
        hide(event);
        consume();
        return;
      }
      // Between overlays of this page: close the ones above this entry.
      closeAbove(depth + 1);
      hide(event);
      return;
    }

    if (state && run && state[BASE] === run) {
      // Back on the page the overlays sat on.
      applyRebase();
      closeAbove(0);
      hide(event);
      endRun();
      return;
    }

    if (mark && !ours) {
      // A stale overlay entry from an earlier run or load. It is a copy of
      // the page below it, so the router may render it; one more step back
      // puts the reader on that page.
      hide(event);
      consume();
      return;
    }

    if (ours) {
      hide(event);
      endRun();
      return;
    }

    // A real navigation (several entries at once, or an in-app back past the
    // overlays): they all close and the router handles the rest.
    closeAbove(0);
    routerKey = keyOf(state);
    endRun();
  }

  function onClickCapture(e) {
    if (!run || e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    try {
      if (new URL(a.href, win.location.href).origin !== win.location.origin) return;
    } catch {
      return;
    }
    navIntent = true;
  }

  // The wrapped methods, as they stood before we wrapped them: an own
  // property (another wrapper, or a test's stand-in) is put back as it was,
  // and one inherited from History.prototype by deleting ours.
  const WRAPPED = { pushState, replaceState, go, back };
  let saved = null;

  function install() {
    if (installed) return;
    installed = true;
    saved = {};
    for (const [name, fn] of Object.entries(WRAPPED)) {
      saved[name] = Object.getOwnPropertyDescriptor(history, name) || null;
      history[name] = fn;
    }
    // Capture on the window runs before the router's own (bubble) popstate
    // listener on the same target.
    win.addEventListener('popstate', onPopState, true);
    win.document?.addEventListener?.('click', onClickCapture, true);
  }

  function uninstall() {
    if (!installed) return;
    installed = false;
    for (const name of Object.keys(WRAPPED)) {
      if (saved[name]) Object.defineProperty(history, name, saved[name]);
      else delete history[name];
    }
    saved = null;
    win.removeEventListener('popstate', onPopState, true);
    win.document?.removeEventListener?.('click', onClickCapture, true);
  }

  // Off duty once nothing is open and nothing of ours is in flight.
  function endRun() {
    if (stack.length > 0 || ownPops > 0 || awaitingNav || pendingConsume) return;
    run = null;
    rebase = null;
    navIntent = false;
    uninstall();
  }

  function flushPendingConsume() {
    const p = pendingConsume;
    pendingConsume = null;
    if (!p) return;
    const mark = ourMark();
    if (mark && mark.id === p.id) consume();
    else endRun();
  }

  /**
   * An overlay opened. Returns its handle, whose `release()` the overlay
   * calls when it closes for any reason. `onPop` is called when Back takes
   * its entry away.
   */
  function open(onPop) {
    install();
    const o = { id: nextId(), onPop, gone: false, popped: false };
    navIntent = false;
    const mark = ourMark();
    if (pendingConsume && mark && mark.id === pendingConsume.id && stack.length === 0) {
      // One overlay closed and this one opened in the same breath: take over
      // its entry rather than going back and pushing again, an order the
      // browser doesn't promise to keep.
      pendingConsume = null;
      stack.push(o);
      origReplace({ ...stateOf(), [MARK]: { run, id: o.id, depth: stack.length } }, '');
      return handle(o);
    }
    if (stack.length === 0 && !mark) {
      run = nextId();
      routerKey = keyOf(stateOf());
      origReplace({ ...strip(stateOf()), [BASE]: run }, '');
    }
    stack.push(o);
    origPush({ ...strip(stateOf()), [MARK]: { run, id: o.id, depth: stack.length } }, '');
    return handle(o);
  }

  function handle(o) {
    return {
      release() {
        const i = stack.indexOf(o);
        if (i !== -1) stack.splice(i, 1);
        if (o.popped || o.gone) {
          endRun();
          return;
        }
        o.popped = true;
        const mark = ourMark();
        if (!mark || mark.id !== o.id) {
          // Not on top (one above it is still open): nothing to consume.
          endRun();
          return;
        }
        if (navIntent) {
          // A link was tapped: its navigation will replace this entry. If it
          // never comes, consume the entry after all.
          navIntent = false;
          awaitingNav = o.id;
          win.setTimeout(() => {
            if (awaitingNav !== o.id) return;
            awaitingNav = null;
            const m = ourMark();
            if (m && m.id === o.id) consume();
            else endRun();
          }, settleMs);
          return;
        }
        pendingConsume = { id: o.id };
        const schedule = win.queueMicrotask || ((fn) => Promise.resolve().then(fn));
        schedule.call(win, flushPendingConsume);
      },
    };
  }

  return {
    open,
    /** How many overlays are open. */
    depth: () => stack.length,
  };
}

let shared = null;

/** The app's one overlay history, over the real window. */
export function overlayHistory() {
  if (!shared && typeof window !== 'undefined' && window.history) {
    shared = createOverlayHistory(window);
  }
  return shared;
}
