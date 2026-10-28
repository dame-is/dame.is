import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { usePreventScrollChain } from '../hooks/usePreventScrollChain.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import { useEscapeLayer } from '../hooks/useEscapeLayer.js';
import { useScrollLock } from '../hooks/useScrollLock.js';
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
    initial: { opacity: 0, scale: 0.92 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.96 },
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
 * Default modals therefore render zero scrim elements — no dim, no blur,
 * no backdrop-filter compositor layer to tear down on close. The panel's
 * own drop-shadow is the sole depth cue separating it from the page.
 *
 * The "dark" variant (image lightbox) is the lone exception: it adds a
 * non-interactive motion.div as the visual layer, animating its
 * backgroundColor and backdropFilter directly (not opacity) so both ramp
 * smoothly to 0 instead of snapping off at unmount.
 *
 * The dialog role lives on modal-root, not on the panel. The panel scales as
 * it opens, and a transform makes it the containing block for anything fixed
 * inside it, so controls that pin to the viewport (the lightbox's bar) can't
 * live in the panel. They used to be portalled to <body> instead, outside the
 * dialog, where a screen reader that honours aria-modal (VoiceOver) never
 * reaches them: Close, Previous and Next couldn't be swiped to. modal-root is
 * never transformed, so `outside` renders them inside it, beside the panel and
 * within the dialog.
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
  focusTrapRef,
  outside = null,
}) {
  const reduce = useReducedMotion();
  const panelRef = useRef(null);
  // Keep a touch-drag on the panel from scrolling the page behind it when
  // its content fits without overflowing, and a wheel or PageDown too.
  usePreventScrollChain(panelRef, open);
  useScrollLock(open);
  // Make the aria-modal="true" claim true: pull focus into the panel on open,
  // trap Tab within it, and restore focus to the opener on close. `focusTrapRef`
  // extends the trap over controls outside the panel itself (the lightbox's
  // bar, rendered through `outside` — see Lightbox.jsx).
  useFocusTrap(panelRef, { active: open, extraContainers: focusTrapRef });
  // Escape closes this modal only while it's the top overlay.
  useEscapeLayer(open, closeOnEscape ? onClose : null);

  const preset = PRESETS[motionPreset] || PRESETS.rise;
  const ease = [0.32, 0.72, 0, 1];
  const panelDuration = reduce ? 0 : 0.24;
  const scrimDuration = reduce ? 0 : 0.24;
  // Only the "dark" variant paints a scrim — an immersive tint + blur for
  // surfaces like the image lightbox where the photo needs to read against
  // the page rather than alongside it. The default ("dim") and "none"
  // modes render no visual layer; default modals lean on the panel's
  // drop-shadow alone, while still dismissing on outside click because
  // that's owned by modal-root (see handleRootClick), not the scrim.
  const paintsScrim = scrim === 'dark';
  // Theme-aware backdrop: --scrim is a near-black tint in dark themes and a
  // bright frosted tint in light themes, so the photo reads against a
  // surround that matches the mode. --scrim-clear is the same color at zero
  // alpha, so the enter/exit fade only ramps opacity (no gray midtones).
  const dimColor = 'var(--scrim)';
  const dimColorClear = 'var(--scrim-clear)';
  const dimBlur = 'blur(8px)';

  function handleRootClick(e) {
    if (!open || scrim === 'none') return;
    // Only fire when the click actually lands on the root itself — not
    // when it bubbled up from the panel or any descendant.
    if (e.target === e.currentTarget) onClose?.();
  }

  // Portal to <body>. Inside the React tree, the Modal often ends up
  // nested under elements that create a containing block — most notably
  // the feed's <motion.li layout> entries (Framer Motion keeps a
  // transform on those), which would otherwise trap our `position:
  // fixed` modal-root inside the feed item's box.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`modal-root modal-variant-${variant} ${open ? 'is-open' : ''}`}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? 'true' : undefined}
      aria-label={open ? label : undefined}
      aria-hidden={!open}
      onClick={handleRootClick}
    >
      <AnimatePresence>
        {open && paintsScrim && (
          <motion.div
            key="scrim-dim"
            className={`modal-scrim modal-scrim-${scrim}`}
            initial={{
              backgroundColor: dimColorClear,
              backdropFilter: 'blur(0px)',
              WebkitBackdropFilter: 'blur(0px)',
            }}
            animate={{
              backgroundColor: dimColor,
              backdropFilter: dimBlur,
              WebkitBackdropFilter: dimBlur,
            }}
            exit={{
              backgroundColor: dimColorClear,
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
            ref={panelRef}
            id={id}
            className={`modal-panel ${className}`}
            initial={preset.initial}
            animate={preset.animate}
            exit={preset.exit}
            transition={{ duration: panelDuration, ease }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
      {outside}
    </div>,
    document.body,
  );
}
