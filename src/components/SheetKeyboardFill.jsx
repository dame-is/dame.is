import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import './SheetKeyboardFill.css';

/**
 * A sheet's surface, painted behind it while it rides on the on-screen
 * keyboard. Rendered inside the sheet's portal, after its backdrop.
 *
 * A sheet hosting a text field is lifted by `inset` (see useKeyboardInset) so
 * the field clears the keyboard, which leaves the bottom of the layout viewport
 * under the sheet uncovered. Most browsers hide all of that behind the
 * keyboard. iOS 26 Safari doesn't: the visual viewport the inset is measured
 * from ends above its floating glass controls (the minimized address bar and
 * the keyboard's ˄ ˅ ✓ bar), and the page stays visible between and around
 * them. The sheet sat on that edge with a band of the feed showing under it.
 * This fills the band with the sheet's own surface, so the sheet runs down
 * into the keyboard instead.
 *
 * `full` covers the whole viewport instead, for a sheet that normally conceals
 * the page but shrink-wraps to its content while the keyboard is up (the nav
 * dock's account view), which would otherwise leave the page showing above it
 * as well.
 *
 * Same z-index as the backdrop (29) and later in the DOM, so it paints over
 * the page and the backdrop but under the chrome bars (30) and the sheet (31).
 * It takes taps and drags itself: they neither close the sheet the way the
 * backdrop would nor scroll the page underneath.
 */
export default function SheetKeyboardFill({ inset, full = false }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {inset > 0 && (
        <motion.div
          key="sheet-kb-fill"
          className={`sheet-kb-fill${full ? ' is-full' : ''}`}
          style={{ '--kb-inset': `${inset}px` }}
          aria-hidden="true"
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
        />
      )}
    </AnimatePresence>
  );
}
