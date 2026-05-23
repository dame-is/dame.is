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
 * AnimatePresence, outside-click + Escape dismissal, and the dialog
 * aria wiring.
 *
 * variant="centered" (default) flex-centers the panel; variant="anchored"
 * leaves positioning to the consumer's `className`.
 *
 * Outside-click dismissal lives on the modal-root div itself (gated by
 * `e.target === e.currentTarget`) rather than a separate scrim button.
 * The transparent variant therefore renders zero scrim elements — no
 * backdrop-filter compositor layer to tear down on close, which is what
 * caused the underlying page to flash darker mid-transition.
 *
 * The dim variant adds a non-interactive motion.div as the visual layer,
 * animating its backgroundColor and backdropFilter directly (not opacity)
 * so both ramp smoothly to 0 instead of snapping off at unmount.
 */
export default function Modal({
  open,
  onClose,
  label,
  variant = 'centered',
  motionPreset = 'rise',
  scrim = 'transparent',
  className = '',
  id,
  children,
  closeOnEscape = true,
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
  const isDim = scrim === 'dim';

  function handleRootClick(e) {
    if (!open || scrim === 'none') return;
    // Only fire when the click actually lands on the root itself — not
    // when it bubbled up from the panel or any descendant.
    if (e.target === e.currentTarget) onClose?.();
  }

  return (
    <div
      className={`modal-root modal-variant-${variant} ${open ? 'is-open' : ''}`}
      aria-hidden={!open}
      onClick={handleRootClick}
    >
      <AnimatePresence>
        {open && isDim && (
          <motion.div
            key="scrim-dim"
            className="modal-scrim modal-scrim-dim"
            initial={{
              backgroundColor: 'rgba(0, 0, 0, 0)',
              backdropFilter: 'blur(0px)',
              WebkitBackdropFilter: 'blur(0px)',
            }}
            animate={{
              backgroundColor: 'rgba(0, 0, 0, 0.16)',
              backdropFilter: 'blur(3px)',
              WebkitBackdropFilter: 'blur(3px)',
            }}
            exit={{
              backgroundColor: 'rgba(0, 0, 0, 0)',
              backdropFilter: 'blur(0px)',
              WebkitBackdropFilter: 'blur(0px)',
            }}
            transition={{ duration: scrimDuration, ease }}
            aria-hidden="true"
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
