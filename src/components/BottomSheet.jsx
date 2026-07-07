import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import './BottomSheet.css';

/**
 * The shared "expand up out of the bottom chrome" surface — the single
 * mechanism behind the search / filter / info panels, mirroring how the
 * nav ActionDock and owner EditSheet unfurl from the same edge.
 *
 * A fixed clip box is pinned directly on top of the bottom bar (and above
 * the owner edit action bar via `--edit-bar-h`); framer animates its height
 * 0 ↔ auto with overflow hidden, so the panel inside grows upward out of the
 * bar rather than overlaying as a centered modal. A transparent, non-dimming
 * backdrop below the bars catches outside clicks so the toolbar itself stays
 * live. Portalled to <body> so no transformed feed ancestor can trap the
 * fixed positioning.
 *
 * Sizing:
 *   - 'compact' (default): the panel is content-height (capped to the gap
 *     between the top and bottom chrome, then scrolls) and carries a top
 *     hairline dividing it from the page above. Right for a search field,
 *     a filter grid, a short primer.
 *   - 'fill': the panel fills the whole gap up to the top chrome, butting
 *     its border, for full-surface sheets.
 */
export default function BottomSheet({
  open,
  onClose,
  label,
  id,
  size = 'compact',
  className = '',
  closeOnEscape = true,
  children,
}) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open || !closeOnEscape) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeOnEscape, onClose]);

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
          <motion.div
            key="bottom-sheet"
            className="bottom-sheet-wrap"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: reduce ? 0 : 0.34, ease: [0.32, 0.72, 0, 1] }}
          >
            <div
              id={id}
              className={`bottom-sheet-panel bottom-sheet-panel-${size} ${className}`.trim()}
              role="dialog"
              aria-label={label}
            >
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
