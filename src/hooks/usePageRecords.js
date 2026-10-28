import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { recordCensus } from '../lib/xray.js';

const EMPTY = { total: 0, collections: [] };

function sameCensus(a, b) {
  if (a.total !== b.total || a.collections.length !== b.collections.length) return false;
  return a.collections.every(
    (c, i) => c.nsid === b.collections[i].nsid && c.did === b.collections[i].did && c.count === b.collections[i].count,
  );
}

/**
 * The records the current page is showing, counted by collection, read from
 * the `[data-at-uri]` elements inside <main> (the chrome's live signals are
 * left out: they're the bar's, not the page's). Recounts as the feed loads
 * or pages in, debounced so a long ledger costs one pass per burst. Only
 * runs while `enabled`, so the observer is never attached outside x-ray or
 * the details sheet.
 */
export function usePageCensus(enabled) {
  const [census, setCensus] = useState(EMPTY);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    const root = document.getElementById('main-content') || document.body;
    let timer = 0;
    const read = () => {
      timer = 0;
      const uris = Array.from(root.querySelectorAll('[data-at-uri]'), (el) => el.getAttribute('data-at-uri'));
      const next = recordCensus(uris);
      setCensus((prev) => (sameCensus(prev, next) ? prev : next));
    };
    read();
    const observer = new MutationObserver(() => {
      if (!timer) timer = window.setTimeout(read, 300);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled, pathname]);

  return enabled ? census : EMPTY;
}

/**
 * The record under the pointer or the keyboard focus, anywhere on the page
 * (the bar's signals included): its at:// URI, or null over anything that
 * isn't one. Only listens while `enabled`.
 */
export function useHoveredRecord(enabled) {
  const [uri, setUri] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const pick = (e) => {
      const el = e.target?.closest?.('[data-at-uri]');
      const next = el && !el.closest('.xray-hud-wrap') ? el.getAttribute('data-at-uri') : null;
      setUri((prev) => (prev === next ? prev : next));
    };
    document.addEventListener('pointerover', pick);
    document.addEventListener('focusin', pick);
    return () => {
      document.removeEventListener('pointerover', pick);
      document.removeEventListener('focusin', pick);
      setUri(null);
    };
  }, [enabled]);

  return enabled ? uri : null;
}
