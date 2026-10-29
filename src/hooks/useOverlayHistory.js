import { useEffect, useRef } from 'react';
import { overlayHistory } from '../lib/overlayHistory.js';

/**
 * Give an overlay a history entry while it's open, so Back closes it rather
 * than leaving the page (MOB-04). One line in each overlay: the bottom
 * sheets (BottomSheet), the nav dock and the lightbox. The entry is consumed
 * when the overlay closes by any other means, and the router never sees any
 * of it — lib/overlayHistory.js says how.
 *
 * Off on /admin, whose shell keeps its own unsaved-changes guard in history
 * (useAdminShell) and must be the only thing reading those popstates there.
 */
export function useOverlayHistory(open, onClose) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    if (window.location.pathname.startsWith('/admin')) return undefined;
    const handle = overlayHistory()?.open(() => closeRef.current?.());
    return () => handle?.release();
  }, [open]);
}
