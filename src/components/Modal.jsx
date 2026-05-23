import { useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import './Modal.css';

const PRESETS = {
  rise: {
    initial: { opacity: 0, y: 12, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 8, scale: 0.98 },
  },
  fall: {
    initial: { opacity: 0, y: -12, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -8, scale: 0.98 },
  },
  scale: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.97 },
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
  const duration = reduce ? 0 : 0.26;
  const ease = [0.32, 0.72, 0, 1];

  return (
    <AnimatePresence>
      {open && (
        <div className={`modal-root modal-variant-${variant}`}>
          {scrim !== 'none' && (
            <motion.button
              type="button"
              className={`modal-scrim modal-scrim-${scrim}`}
              onClick={onClose}
              aria-label={scrimLabel}
              tabIndex={-1}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.22, ease }}
            />
          )}
          <motion.div
            id={id}
            className={`modal-panel ${className}`}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={preset.initial}
            animate={preset.animate}
            exit={preset.exit}
            transition={{ duration, ease }}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
