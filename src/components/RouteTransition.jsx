import {
  Suspense,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { useLocation, useNavigationType, Routes } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  createScrollMemory,
  entryKey,
  restoreStep,
} from '../lib/scrollMemory.js';

/**
 * Crossfade + lift between routes. Wraps React Router's <Routes> so the
 * outgoing page fades out while the incoming one fades up — a calmer
 * alternative to the abrupt swap React Router does by default.
 *
 * `location` is captured here and passed to <Routes>; AnimatePresence
 * (mode="wait") keeps the outgoing tree mounted long enough to play its
 * exit, and Routes needs the snapshot location to keep matching the old
 * URL while it animates out.
 *
 * Keyed on pathname only (not search) so filter changes within a page
 * (?filter=posting, ?q=foo) don't re-trigger the whole-page transition.
 *
 * Respects `prefers-reduced-motion`: collapses to an instant swap.
 *
 * Most pages are lazy chunks (see App.jsx), so each keyed page carries its
 * own Suspense boundary. It sits INSIDE the motion.div on purpose: the
 * outgoing page keeps playing its exit untouched, and only the incoming
 * page's own frame waits on its chunk. That frame holds its fade-in until the
 * chunk has landed (RoutePending), so a page that arrives late fades up with
 * its content instead of after an empty frame has already faded in.
 */
export default function RouteTransition({ children }) {
  const location = useLocation();
  const navType = useNavigationType();
  const reduce = useReducedMotion();

  useScrollRecorder();

  if (reduce) {
    return (
      <>
        <Suspense fallback={<RoutePending />}>
          <Routes location={location}>{children}</Routes>
          <RouteSettled key={location.pathname} location={location} />
        </Suspense>
        <RouteScroll
          key={location.pathname}
          location={location}
          navType={navType}
        />
      </>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <RouteFrame key={location.pathname} location={location} navType={navType}>
        {children}
      </RouteFrame>
    </AnimatePresence>
  );
}

// Set by a page's frame so its RoutePending can hold the frame's fade-in.
const RoutePendingContext = createContext(null);

/** One page's animated frame (see RouteTransition). */
function RouteFrame({ location, navType, children }) {
  const [pending, setPending] = useState(false);
  return (
    <motion.div
      className="route-transition"
      initial={{ opacity: 0 }}
      animate={{ opacity: pending ? 0 : 1 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: 0.18,
        ease: [0.4, 0, 0.2, 1],
      }}
    >
      <RoutePendingContext.Provider value={setPending}>
        <Suspense fallback={<RoutePending />}>
          <Routes location={location}>{children}</Routes>
          <RouteSettled location={location} />
        </Suspense>
      </RoutePendingContext.Provider>
      <RouteScroll location={location} navType={navType} />
    </motion.div>
  );
}

/**
 * What a page shows for the moment its chunk is still on the wire. Empty on
 * purpose — a skeleton shaped like one page would be the wrong shape for the
 * next — but tall enough that the footer and bottom chrome don't jump up
 * into the gap and back down when the page lands.
 *
 * It also keeps its frame transparent while it is up. The frame used to fade
 * in over this empty box, so on a slow connection the reader watched a blank
 * page arrive and then the real one pop in over it; now the page's own first
 * paint (a skeleton, usually) is what fades in. Set in a layout effect, before
 * the first frame of the fade.
 */
function RoutePending() {
  const setPending = useContext(RoutePendingContext);
  useLayoutEffect(() => {
    if (!setPending) return undefined;
    setPending(true);
    return () => setPending(false);
  }, [setPending]);
  return <div aria-busy="true" style={{ minHeight: '70vh' }} />;
}

/* ---------- scroll restoration ----------

   The browser's own restoration is switched off (main.jsx sets
   history.scrollRestoration = 'manual'), because it restores at the wrong
   moment for this app. A same-document Back restores at popstate time,
   against whatever is mounted then — and with mode="wait" that is the
   OUTGOING page, still fading out for 180ms. A short record page clamps a
   feed's 4000px offset to a few hundred before the feed even mounts, and
   the feeds then fill in from the network, long after anything would have
   retried. Forward navigation had the mirror problem: resetting to the top
   on the commit that changes the URL scrolled the page that was leaving,
   so it visibly snapped to its hero as it faded.

   So the offsets are ours. Scroll events are recorded against the entry
   whose page is on screen, and the reset or restore runs when the incoming
   page mounts — in a layout effect, so it lands before that page paints. */

let memory = null;

function scrollMemory() {
  if (!memory) {
    let storage = null;
    try {
      storage = window.sessionStorage;
    } catch {
      /* storage blocked — the memory still works for this page's life */
    }
    memory = createScrollMemory(storage);
  }
  return memory;
}

// The entry (and path) whose page is actually on screen. Not the router's
// location: that moves to the new entry while the old page is still fading
// out at its old offset, and the old page's last scroll belongs to the old
// entry.
let shownEntry = null;
let shownPathname = null;

// The entry the document booted on, and whether the reader has left it
// since. Module-level so StrictMode's dev-only remount still reads as the
// first mount rather than as a navigation.
let bootEntry = null;
let navigated = false;

// A restore in flight: the entry and the offset it is heading for. Its own
// scrolls on the way there aren't the reader's, so they aren't recorded —
// otherwise an effect re-run mid-restore (StrictMode's dev-only remount, or
// any remount) would pick up wherever the interrupted attempt had got to,
// say the bottom of a skeleton, as the place to restore to.
let pending = null;

/**
 * Whether the page on screen is still being scrolled back to where the reader
 * left it. A page that moves its own scroll once its content lands (a post's
 * page bringing the linked post of a thread into view) leaves it alone then:
 * a Back or a reload returns the reader to their place, not to the post.
 */
export function restoringScroll() {
  return pending != null && pending.entry === shownEntry;
}

// How long a restore keeps waiting for a page to grow tall enough. Live-first
// feeds wait on the network before they render a single row, so this is
// generous; any input from the reader cancels it at once.
const RESTORE_WINDOW_MS = 4000;
const READER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

function useScrollRecorder() {
  useEffect(() => {
    // Scroll events are already dispatched at most once per frame, and a
    // Map write is cheap, so no throttle.
    const record = () => {
      if (!shownEntry || pending?.entry === shownEntry) return;
      scrollMemory().set(shownEntry, window.scrollY);
    };
    const persist = () => {
      record();
      scrollMemory().persist();
    };
    // Mobile browsers often discard a backgrounded tab without a pagehide,
    // so hiding is the last reliable moment to write.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    window.addEventListener('scroll', record, { passive: true });
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('scroll', record);
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}

/**
 * Scroll `entry` toward `target`, retrying each frame while the page is too
 * short to reach it. Finishes on arrival, after RESTORE_WINDOW_MS, or the
 * moment the reader touches anything — their scroll always beats ours.
 * Returns a cancel for the effect cleanup, which leaves `pending` standing
 * so a re-run resumes the same restore.
 */
function restoreTo(entry, target) {
  let raf = 0;
  let stopped = false;
  const deadline = performance.now() + RESTORE_WINDOW_MS;
  pending = { entry, target };
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    for (const type of READER_INPUT) {
      window.removeEventListener(type, finish, true);
    }
  };
  const finish = () => {
    if (pending?.entry === entry) pending = null;
    stop();
  };
  const attempt = () => {
    if (stopped) return;
    const { y, done } = restoreStep(
      target,
      document.documentElement.scrollHeight,
      window.innerHeight,
    );
    if (Math.abs(window.scrollY - y) >= 1) window.scrollTo(0, y);
    if (done || performance.now() >= deadline) finish();
    else raf = requestAnimationFrame(attempt);
  };
  for (const type of READER_INPUT) {
    window.addEventListener(type, finish, { capture: true, passive: true });
  }
  attempt();
  return stop;
}

/** Was this document itself loaded by a reload or a Back/Forward? */
function bootedFromHistory() {
  try {
    const [nav] = performance.getEntriesByType('navigation');
    return nav?.type === 'reload' || nav?.type === 'back_forward';
  } catch {
    return false;
  }
}

/**
 * Rendered inside each page's keyed frame, so its layout effect runs when
 * that page mounts — not when the URL changes — with the location and
 * navigation type it was rendered for (props, not hooks: an exiting page
 * must keep its own snapshot, not read the router's new one).
 *
 * Outside the page's Suspense boundary on purpose: the outgoing page leaves
 * the DOM the moment this frame mounts, even when the incoming page is
 * still a placeholder, and from then on every scroll event — starting with
 * the browser clamping the old offset to the shorter document — belongs to
 * the new entry, not the old one.
 */
function RouteScroll({ location, navType }) {
  const entry = entryKey(location);
  const { pathname } = location;

  useLayoutEffect(() => {
    if (bootEntry == null) bootEntry = entry;
    if (entry !== bootEntry) navigated = true;
    const initial = !navigated;
    const pathChanged = shownPathname != null && shownPathname !== pathname;
    shownEntry = entry;
    shownPathname = pathname;

    const saved =
      pending?.entry === entry ? pending.target : scrollMemory().get(entry);
    let cancel;
    if (pathname === '/admin') {
      // A fixed, overflow-hidden frame that scrolls its own panes: there is
      // no page offset to reset or restore.
    } else if (initial) {
      // No navigation happened, so the page starts where the browser put it
      // — except that 'manual' also turned off the browser's restore on a
      // reload or a Back from another site, which is ours to do now.
      if (saved > 0 && bootedFromHistory()) cancel = restoreTo(entry, saved);
    } else if (navType === 'POP') {
      // A Back/Forward within the same page (a native fragment link's entry)
      // with nothing recorded is left where the browser scrolled it.
      if (saved != null) cancel = restoreTo(entry, saved);
      else if (pathChanged) window.scrollTo(0, 0);
    } else if (pathChanged) {
      // Forward navigation starts the new page at its top. A search-only
      // change on the same page keeps its place.
      window.scrollTo(0, 0);
    }

    if (!initial && pathChanged) {
      // Move focus to the <main> landmark so screen-reader users land on the
      // new route's content instead of a now-unmounted control. Not on the
      // first load: there is nothing to recover from, and taking focus there
      // would skip the skip link and every chrome control on the first Tab.
      document.getElementById('main-content')?.focus({ preventScroll: true });
    }
    return cancel;
  }, [entry, pathname, navType]);

  return null;
}

/**
 * Announces, as a `route:settled` window event, that a page's content is in
 * the DOM — for anything that measures the page (the chrome's breadcrumb
 * and scroll-position sweeps), which would otherwise have measured the
 * outgoing page, or a lazy page's placeholder. It renders inside the
 * Suspense boundary, so it mounts with the content, and fires a frame later
 * so RouteScroll's reset or restore has landed first.
 */
function RouteSettled({ location }) {
  const { pathname } = location;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent('route:settled', { detail: { pathname } }),
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname]);
  return null;
}
