import { useEffect, useRef } from 'react';

// The overlays Escape can close (bottom sheets, the nav dock, modals), in the
// order they opened. Each used to listen for Escape on its own, so one press
// closed every overlay that happened to be open: the "Open in…" sheet and the
// info sheet over it, or a sheet and the x-ray focus behind it. Now one
// listener hands the key to the overlay on top and nobody else.
//
// One listener rather than one per overlay, because the top overlay's handler
// closes it, and React flushes that close (effects included) before the next
// listener runs. Each overlay checking "am I on top?" would then find the one
// below it on top, and Escape would cascade down the stack anyway.
//
// It listens in the bubble phase, after the event has been through the page,
// so a control inside an overlay that stops Escape's propagation (a menu
// inside an editor, say) still gets to keep the key for itself.
const layers = [];
const claimed = new WeakSet();

function onKeyDown(e) {
  if (e.key !== 'Escape' || layers.length === 0) return;
  claimed.add(e);
  layers[layers.length - 1].current?.(e);
}

/**
 * Register an open overlay for Escape. While `active`, Escape calls `onEscape`
 * only when this overlay is the most recently opened one still open. Pass a
 * null `onEscape` to hold a place in the stack without closing on Escape: an
 * overlay that handles the key itself still keeps the ones beneath it shut.
 */
export function useEscapeLayer(active, onEscape) {
  const handlerRef = useRef(onEscape);
  useEffect(() => {
    handlerRef.current = onEscape;
  });
  useEffect(() => {
    if (!active) return undefined;
    const layer = handlerRef;
    if (layers.length === 0) window.addEventListener('keydown', onKeyDown);
    layers.push(layer);
    return () => {
      const i = layers.lastIndexOf(layer);
      if (i !== -1) layers.splice(i, 1);
      if (layers.length === 0) window.removeEventListener('keydown', onKeyDown);
    };
  }, [active]);
}

/** Is any Escape-closable overlay open? */
export function hasOpenOverlay() {
  return layers.length > 0;
}

/** Did this keydown already go to an overlay? For a global Escape handler
 *  that runs after the overlays' and must not act on the same press. */
export function escapeWentToOverlay(e) {
  return claimed.has(e);
}
