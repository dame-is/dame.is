import { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { nsidFromAtUri } from '../lib/verbRegistry.js';

/**
 * Our own take on a magnetic reticule cursor (no motion-plus dependency —
 * just the `motion` primitives already in the bundle). While x-ray is armed
 * on a desktop / fine-pointer device, a corner-tick target follows the
 * cursor and springs to lock onto whatever record-backed element ([data-
 * atproto]) is under it, labelling it with the collection. With no target it
 * shrinks to a small idly-rotating diamond.
 *
 * Mounted (and gated to fine pointers + wider viewports) by XrayLayer, so it
 * only ever runs where it makes sense.
 */
export default function XrayReticule() {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const w = useMotionValue(24);
  const h = useMotionValue(24);
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
    // Idle spin management — an endless slow rotation while we have no target.
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

    const springify = (mv, to) =>
      animate(mv, to, reduce ? { duration: 0.12 } : { type: 'spring', bounce: 0.28, duration: 0.5 });

    function apply(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el && el.closest ? el.closest('[data-atproto]') : null;

      if (target) {
        const r = target.getBoundingClientRect();
        const pad = 6;
        springify(x, r.left - pad);
        springify(y, r.top - pad);
        springify(w, r.width + pad * 2);
        springify(h, r.height + pad * 2);
        stopSpin();
        // Settle to the nearest FULL turn (a multiple of 360, not 180) so the
        // frame always lands upright — keeps the collection label the right way
        // up in its top-left corner instead of flipping to the far side.
        animate(rotate, Math.round(rotate.get() / 360) * 360, { type: 'spring', bounce: 0.3 });
        if (!lockedRef.current) {
          lockedRef.current = true;
          setLocked(true);
        }
        const uri = target.getAttribute('data-at-uri');
        const nsid = uri ? nsidFromAtUri(uri) : target.getAttribute('data-nsid');
        setLabel(nsid || '');
      } else {
        // No target — a small diamond centred on the pointer, idly spinning.
        const size = 24;
        springify(x, e.clientX - size / 2);
        springify(y, e.clientY - size / 2);
        springify(w, size);
        springify(h, size);
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
    x.set(window.innerWidth / 2 - 12);
    y.set(window.innerHeight / 2 - 12);
    startSpin();
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopSpin();
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
