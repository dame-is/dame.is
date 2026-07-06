import { useEffect, useState } from 'react';

/**
 * Preload a set of image URLs and report when they've all settled (loaded
 * or errored), so a page can hold its skeleton until its cover images are
 * actually ready to paint instead of swapping the skeleton for a grid of
 * blank cells that pop in as they download.
 *
 * A timeout caps the wait so a single slow or broken image can't strand
 * the skeleton indefinitely. Readiness is tied to the exact URL set: when
 * the set changes the hook reports not-ready until the new set settles
 * (so a stale "ready" from a previous set can't leak through for a frame).
 *
 * Pass a bounded slice (e.g. the first couple of rows) rather than every
 * cover — that's enough for a clean first paint, and the rest keep
 * lazy-loading in the grid as usual.
 */
export function useImagesReady(urls, { timeout = 6000 } = {}) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const key = list.join('\n');
  const [state, setState] = useState(() => ({ key, ready: list.length === 0 }));

  useEffect(() => {
    const items = key ? key.split('\n') : [];
    if (items.length === 0) {
      setState({ key, ready: true });
      return undefined;
    }
    setState({ key, ready: false });

    let cancelled = false;
    let settled = 0;
    const imgs = [];
    const bump = () => {
      settled += 1;
      if (!cancelled && settled >= items.length) setState({ key, ready: true });
    };
    for (const url of items) {
      const img = new Image();
      let once = false;
      const settle = () => {
        if (once) return;
        once = true;
        bump();
      };
      img.onload = settle;
      img.onerror = settle;
      img.src = url;
      // A cached image is already complete the instant src is set — onload
      // won't fire again, so count it now.
      if (img.complete) settle();
      imgs.push(img);
    }

    const timer = setTimeout(() => {
      if (!cancelled) setState({ key, ready: true });
    }, timeout);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      for (const img of imgs) {
        img.onload = null;
        img.onerror = null;
      }
    };
  }, [key, timeout]);

  // Only treat as ready when the settled set matches the current urls.
  return state.key === key && state.ready;
}
