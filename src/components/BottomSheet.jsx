import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { usePreventScrollChain } from '../hooks/usePreventScrollChain.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import { useEscapeLayer } from '../hooks/useEscapeLayer.js';
import { useScrollLock } from '../hooks/useScrollLock.js';
import { useOverlayHistory } from '../hooks/useOverlayHistory.js';
import './BottomSheet.css';

/**
 * The shared "rise up out of the bottom chrome" surface — the single
 * mechanism behind the search / filter / info / guestbook panels, mirroring
 * how the nav ActionDock unfurls from the same edge.
 *
 * A fixed clip box is pinned directly on top of the bottom bar (and above
 * the owner edit action bar via `--edit-bar-h`), and the panel inside slides
 * up out of it (SHEET_SLIDE). The clip used to animate its own height
 * 0 ↔ auto instead, which cut the panel's top edge off (so its top hairline
 * only appeared once the sheet had settled) and ran on the main thread, so a
 * page rendering underneath could freeze a closing sheet mid-way. A
 * transform carries the panel's real top edge, border and all, and the
 * browser runs it off the main thread.
 *
 * A backdrop below the bars catches outside clicks, so the toolbar itself
 * stays live. It is a quiet veil of the page's own colour rather than
 * transparent: with nothing over it, the page above a sheet looked as live as
 * ever, and a tap meant for it closed the sheet instead. Portalled to <body>
 * so no transformed feed ancestor can trap the fixed positioning.
 *
 * Every sheet shares one header (SheetHeader): pass `title`, and optionally
 * `meta` and `actions`. It is one 44px row: the title as an eyebrow at the
 * gutter, the meta and text actions after it, and a 28px hairline × whose
 * right edge sits over the compass chip in the bar below. Each sheet used to
 * build its own and they had drifted (SYS-06).
 *
 * While open, the sheet holds a history entry, so Back closes it rather than
 * leaving the page (useOverlayHistory).
 *
 * Sizing:
 *   - 'compact' (default): the panel is content-height (capped to the gap
 *     between the top and bottom chrome, then scrolls) and carries a top
 *     hairline dividing it from the page above. Right for a search field,
 *     a filter grid, a short primer.
 *   - 'fill': the panel fills the whole gap up to the top chrome, butting
 *     its border, for full-surface sheets.
 *
 * The sheet stays on the bar when the on-screen keyboard comes up, so the
 * keyboard can cover the bottom of it; ActionDock.css says why the sheet
 * doesn't chase the keyboard instead.
 */
/**
 * How every bottom-chrome sheet comes and goes: the panel slides up out of
 * the bar from fully below it, and back down. Animated as a `transform`
 * string (not motion's `y`), which motion hands to the browser's own
 * animation engine, so it keeps moving while the main thread is busy.
 * Shared with the nav dock and the x-ray HUD.
 */
export const SHEET_SLIDE = {
  initial: { transform: 'translateY(100%)' },
  animate: { transform: 'translateY(0%)' },
  exit: { transform: 'translateY(100%)' },
  transition: { duration: 0.34, ease: [0.32, 0.72, 0, 1] },
};

export default function BottomSheet({
  open,
  onClose,
  label,
  id,
  size = 'compact',
  className = '',
  closeOnEscape = true,
  restoreFocusTo,
  // The shared header (SheetHeader below). With a `title` the sheet draws it
  // and wraps its children in `.bottom-sheet-body` (styled by
  // `bodyClassName`); without one, as the admin's sheets do, the children are
  // the whole panel, as before.
  title,
  meta,
  actions,
  bodyClassName = '',
  // A second Close at the foot of the sheet, for a finger (coarse pointers
  // only, in CSS). On by default for full-height sheets, where the × is a
  // stretch away at the top of the screen; a sheet opened from a bottom-bar
  // chip doesn't need it, because that chip, in the thumb's reach, closes it.
  thumbClose = size === 'fill',
  children,
}) {
  const reduce = useReducedMotion();
  const panelRef = useRef(null);
  const titleId = useId();
  // Back closes the sheet instead of leaving the page (MOB-04).
  useOverlayHistory(open, onClose);
  // Keep a touch-drag on the open sheet from scrolling the page behind it
  // when the panel's content fits without overflowing.
  usePreventScrollChain(panelRef, open);
  // A fill sheet conceals the page entirely, so a wheel or PageDown over it
  // has no business scrolling what's behind. A compact one leaves the page
  // showing above it and usable, so the page keeps scrolling.
  useScrollLock(open && size === 'fill');
  // Move focus into the sheet on open, trap Tab within it, and restore focus
  // to the trigger on close — the panel declares role="dialog" but the page
  // behind stays tappable, so the trap is what makes the keyboard honor it.
  // `restoreFocusTo` names somewhere to land when the trigger is gone by then.
  useFocusTrap(panelRef, { active: open, fallbackFocus: restoreFocusTo });
  // Escape closes this sheet only while it's the top overlay.
  useEscapeLayer(open, closeOnEscape ? onClose : null);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="bottom-sheet-backdrop"
            className="bottom-sheet-backdrop"
            onClick={onClose}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="bottom-sheet" className="bottom-sheet-wrap">
            <motion.div
              ref={panelRef}
              id={id}
              className={`bottom-sheet-panel bottom-sheet-panel-${size} ${className}`.trim()}
              role="dialog"
              aria-label={title != null && !label ? undefined : label}
              aria-labelledby={title != null && !label ? titleId : undefined}
              {...SHEET_SLIDE}
              transition={{ ...SHEET_SLIDE.transition, duration: reduce ? 0 : SHEET_SLIDE.transition.duration }}
            >
              {title != null ? (
                <>
                  <SheetHeader id={titleId} title={title} meta={meta} actions={actions} onClose={onClose} />
                  <div className={`bottom-sheet-body ${bodyClassName}`.trim()}>{children}</div>
                </>
              ) : (
                children
              )}
              {thumbClose && (
                <div className="bottom-sheet-foot">
                  <button type="button" className="btn btn--text bottom-sheet-foot-close" onClick={onClose}>
                    Close
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}

/**
 * The one sheet header. The title is a heading (it labels the dialog) in the
 * eyebrow voice; `meta` is quiet text after it ("14 of 17 kinds", "Live ·
 * 1 pm"); `actions` are text buttons set before the × ("All · None ·
 * Defaults", "Return to live").
 */
export function SheetHeader({ id, title, meta, actions, onClose }) {
  return (
    <div className="sheet-head">
      <h2 id={id} className="sheet-head-title eyebrow">
        {title}
      </h2>
      {meta != null && meta !== '' && <span className="sheet-head-meta">{meta}</span>}
      {actions && <div className="sheet-head-actions">{actions}</div>}
      <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
