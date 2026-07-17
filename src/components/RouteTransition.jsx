import { useEffect } from 'react';
import { useLocation, useNavigationType, Routes } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

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
 */
export default function RouteTransition({ children }) {
  const location = useLocation();
  const navType = useNavigationType();
  const reduce = useReducedMotion();

  // Reset scroll to the top on forward navigation so a new page starts at its
  // top rather than inheriting the previous page's scroll offset. POP (back /
  // forward) is left alone so the browser can restore the prior position.
  //
  // Also move focus to the <main> landmark (#main-content) on every navigation
  // so screen-reader users land on the new route's content instead of being
  // stranded on a now-unmounted control. `preventScroll` keeps the focus call
  // from fighting the scroll reset above (or the browser's POP restoration).
  useEffect(() => {
    if (navType !== 'POP') window.scrollTo(0, 0);
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [location.pathname, navType]);

  if (reduce) {
    return <Routes location={location}>{children}</Routes>;
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        className="route-transition"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{
          duration: 0.18,
          ease: [0.4, 0, 0.2, 1],
        }}
      >
        <Routes location={location}>{children}</Routes>
      </motion.div>
    </AnimatePresence>
  );
}
