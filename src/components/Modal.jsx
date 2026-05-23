import { useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import './Modal.css';

const PRESETS = {
  rise: {
    initial: { opacity: 0, y: 10, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 6, scale: 0.99 },
  },
  fall: {
    initial: { opacity: 0, y: -10, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -6, scale: 0.99 },
  },
  scale: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
  },
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
};

/**
 * Reusable overlay shell. Handles enter/exit animation via motion's
 * AnimatePresence (so the close transition is symmetric with the open),
 * scrim click + Escape key dismiss, and the dialog aria wiring.
 *
 * variant="centered" (default) flex-centers the panel in the viewport;
 * variant="anchored" leaves positioning entirely to the consumer's
 * `className` (use it for popovers anchored to a specific UI region).
 *
 * The panel's content-specific styling (sizing, layout, internal spacing)
 * is the consumer's responsibility — pass it via `className`. Background,
 * border, radius, and shadow are provided by the base `.modal-panel` rule.
 *
 * Note: the AnimatePresence wraps the scrim and panel directly — not the
 * outer modal-root wrapper. If the wrapper itself were the conditional
 * child, AnimatePresence would unmount it (and yank the motion children
 * with it) before exit animations could run, causing the close to flash.
 */
export default function Modal({
  open,
  onClose,
  label,
  variant = 'centered',
  motionPreset = 'rise',
  scrim = 'dim',
  className = '',
  id,
  children,
  closeOnEscape = true,
  scrimLabel = 'Close',
}) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeOnEscape, onClose]);

  const preset = PRESETS[motionPreset] || PRESETS.rise;
  const ease = [0.32, 0.72, 0, 1];
  const panelDuration = reduce ? 0 : 0.24;
  const scrimDuration = reduce ? 0 : 0.24;

  return (
    <div
      className={`modal-root modal-variant-${variant} ${open ? 'is-open' : ''}`}
      aria-hidden={!open}
    >
      <AnimatePresence>
        {open && scrim !== 'none' && (
          <motion.button
            key="scrim"
            type="button"
            className={`modal-scrim modal-scrim-${scrim}`}
            onClick={onClose}
            aria-label={scrimLabel}
            tabIndex={-1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: scrimDuration, ease }}
          />
        )}
        {open && (
          <motion.div
            key="panel"
            id={id}
            className={`modal-panel ${className}`}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={preset.initial}
            animate={preset.animate}
            exit={preset.exit}
            transition={{ duration: panelDuration, ease }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
