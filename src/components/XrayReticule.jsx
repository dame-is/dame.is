import { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useSpring, useReducedMotion } from 'motion/react';
import { nsidFromAtUri } from '../lib/verbRegistry.js';

/**
 * Our own take on a magnetic reticule cursor (no motion-plus dependency —
 * just the `motion` primitives already in the bundle). While x-ray is armed
 * on a desktop / fine-pointer device it stands in for the native cursor: a
 * corner-tick target that tracks the pointer and locks onto whatever record-
 * backed element ([data-atproto]) is under it, labelling it with the
 * collection. With no target it shrinks to a small idly-rotating diamond.
 *
 * Responsiveness note: position/size are `useSpring` motion values whose
 * TARGETS we `.set()` on each move — the spring tracks a moving goal in one
 * continuous animation. (An earlier version spawned a fresh `animate()` per
 * move, so the reticule was forever chasing a half-finished spring and felt
 * laggy.) A stiff config keeps idle tracking tight while lock-on still eases.
 *
 * Mounted (and gated to fine pointers + wider viewports) by XrayLayer.
 */
const POS_SPRING = { stiffness: 900, damping: 50, mass: 0.35 };
const SIZE_SPRING = { stiffness: 420, damping: 38, mass: 0.5 };
const IDLE = 22;

export default function XrayReticule() {
  const reduce = useReducedMotion();
  const x = useSpring(0, POS_SPRING);
  const y = useSpring(0, POS_SPRING);
  const w = useSpring(IDLE, SIZE_SPRING);
  const h = useSpring(IDLE, SIZE_SPRING);
  const rotate = useMotionValue(0);
  const [locked, setLocked] = useState(false);
  const [label, setLabel] = useState('');

  const spinRef = useRef(null);
  const lockedRef = useRef(false);
  const rafRef = useRef(0);
  const pending = useRef(null);

  // Keep the collection label upright while the frame rotates: mirror the
  // frame's rotation back off so it reads level even as the reticule settles.
  const counterRotate = useMotionValue(0);
  useEffect(() => rotate.on('change', (v) => counterRotate.set(-v)), [rotate, counterRotate]);

  useEffect(() => {
    // While the reticule is live it IS the cursor — hide the native one
    // (scoped to this attribute in Xray.css). Removed on unmount / suppression
    // so the dock, panels, and touch keep their normal cursor.
    const root = document.documentElement;
    root.setAttribute('data-xray-reticule', 'on');

    // Under reduced motion, snap instantly (no spring travel, no idle spin).
    const move = reduce ? (mv, v) => mv.jump(v) : (mv, v) => mv.set(v);

    function startSpin() {
      if (reduce || spinRef.current) return;
      spinRef.current = animate(rotate, rotate.get() + 360, {
        duration: 3,
        ease: 'linear',
        repeat: Infinity,
      });
    }
    function stopSpin() {
      if (spinRef.current) {
        spinRef.current.stop();
        spinRef.current = null;
      }
    }

    function apply(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      let target = el && el.closest ? el.closest('[data-atproto]') : null;
      // Don't lock onto the already-focused element (its open substrate panel
      // would make an unwieldy frame) — treat it as no target.
      if (target && target.classList.contains('is-xray-focus')) target = null;

      if (target) {
        const r = target.getBoundingClientRect();
        const pad = 6;
        move(x, r.left - pad);
        move(y, r.top - pad);
        move(w, r.width + pad * 2);
        move(h, r.height + pad * 2);
        stopSpin();
        // Settle to the nearest FULL turn (multiple of 360) so the frame lands
        // upright and the label stays in its top-left corner.
        if (reduce) rotate.jump(Math.round(rotate.get() / 360) * 360);
        else animate(rotate, Math.round(rotate.get() / 360) * 360, { type: 'spring', stiffness: 200, damping: 22 });
        if (!lockedRef.current) {
          lockedRef.current = true;
          setLocked(true);
        }
        const uri = target.getAttribute('data-at-uri');
        const nsid = uri ? nsidFromAtUri(uri) : target.getAttribute('data-nsid');
        setLabel(nsid || '');
      } else {
        move(x, e.clientX - IDLE / 2);
        move(y, e.clientY - IDLE / 2);
        move(w, IDLE);
        move(h, IDLE);
        startSpin();
        if (lockedRef.current) {
          lockedRef.current = false;
          setLocked(false);
          setLabel('');
        }
      }
    }

    function onMove(e) {
      pending.current = e;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        if (pending.current) apply(pending.current);
      });
    }

    // Seed at the current center so it doesn't fly in from the corner.
    x.jump(window.innerWidth / 2 - IDLE / 2);
    y.jump(window.innerHeight / 2 - IDLE / 2);
    startSpin();
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopSpin();
      root.removeAttribute('data-xray-reticule');
    };
  }, [reduce, x, y, w, h, rotate]);

  return (
    <motion.div
      className={`xray-reticule${locked ? ' is-locked' : ''}`}
      style={{ x, y, width: w, height: h, rotate }}
      aria-hidden="true"
    >
      <div className="xray-reticule-box">
        <span className="xray-reticule-corner tl" />
        <span className="xray-reticule-corner tr" />
        <span className="xray-reticule-corner bl" />
        <span className="xray-reticule-corner br" />
        <span className="xray-reticule-dot" />
      </div>
      {label && (
        <motion.span className="xray-reticule-label" style={{ rotate: counterRotate }}>
          {label}
        </motion.span>
      )}
    </motion.div>
  );
}
