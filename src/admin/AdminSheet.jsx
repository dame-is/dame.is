// The admin's upward-expanding sheet — the surface directory, the list's
// sort/visibility options, and the action bar's `⋯` menu all ride on this.
//
// WHY NOT `BottomSheet`. That component is the site's shared sheet and it is
// positioned entirely in terms of PUBLIC CHROME constants: `--chrome-h`,
// `--edit-bar-h`, `--chrome-top-h`. None of the three describes `/admin`. The
// route renders no ChromeBar at all, so two of them are simply wrong here, and
// the third is an INLINE style that ChromeBar leaves on `<html>` — no admin
// stylesheet rule can outrank it, which is why arriving at `/admin` from a
// public page used to move the admin's own sticky furniture 157px down the pane.
// Reusing BottomSheet would mean either editing a public stylesheet (forbidden:
// it is shared with every public route) or fighting an inline style on every
// paint.
//
// So this reuses the same HOOKS and the same MOTION CONTRACT — `useFocusTrap`,
// `usePreventScrollChain`, height 0↔auto at 340ms on [0.32, 0.72, 0, 1], zero
// under `prefers-reduced-motion`, a transparent (non-dimming) click-catcher
// because a sheet here reads as chrome rather than as a modal — and positions
// itself against the ADMIN frame instead: it rests on the action bar, and once a
// software keyboard is up it rests on the keyboard. `max()`, not a sum, exactly
// as BottomSheet.css documents: the keyboard covers the bar, so once it is up
// the bar is no longer something to sit on top of.
//
// It is portalled to `document.body` because `.wb-pane-detail` declares
// `container-type: inline-size`, which makes it a containing block for fixed
// descendants — a sheet rendered inside the pane would be trapped in the pane.
// The bar-height and keyboard-inset custom properties it reads are published on
// `<html>` by AdminShell for exactly this reason.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import { usePreventScrollChain } from '../hooks/usePreventScrollChain.js';
import './adminBar.css';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.label     The dialog's accessible name.
 * @param {string} [props.id]      Point the trigger's `aria-controls` at this.
 * @param {import('react').ReactNode} [props.foot]  A sticky foot inside the panel — for a
 *                                 control that must stay reachable however long the list is.
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export default function AdminSheet({
  open,
  onClose,
  label,
  id,
  foot = null,
  className = '',
  children,
}) {
  const reduce = useReducedMotion();
  const panelRef = useRef(null);

  // Keep a touch-drag on the open sheet from scrolling the pane behind it when
  // the panel's content fits without overflowing.
  usePreventScrollChain(panelRef, open);
  // The page behind stays tappable — that is the point of a chrome sheet — so
  // the trap is what makes the keyboard honour the dialog.
  useFocusTrap(panelRef, { active: open });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="wb-sheet-backdrop"
            className="wb-sheet-backdrop"
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
            key="wb-sheet"
            className="wb-sheet-wrap"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: reduce ? 0 : 0.34, ease: [0.32, 0.72, 0, 1] }}
          >
            <div
              ref={panelRef}
              id={id}
              className={`wb-sheet-panel ${className}`.trim()}
              role="dialog"
              aria-label={label}
            >
              {/* Decorative, and deliberately not a drag handle: there is no
                  drag-to-dismiss here, so a grabber would promise a gesture the
                  sheet does not have. It is the site's hairline rule doing what
                  it does everywhere else — marking the top of a surface. */}
              <span className="wb-sheet-grip" aria-hidden="true" />
              <div className="wb-sheet-body">
                {children}
              </div>
              {foot && <div className="wb-sheet-foot">{foot}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
