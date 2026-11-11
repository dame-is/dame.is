import { useSyncExternalStore } from 'react';

/**
 * The width under which the bench is laid out for a phone. It is the same
 * width culturing.css turns at, so the few things that are built
 * differently there (a picker where a row of keys won't fit, the view's
 * tools on the picture) change with the layout and not a frame after it.
 */
export const COMPACT_QUERY = '(max-width: 700px)';

function subscribe(onChange) {
  if (typeof matchMedia !== 'function') return () => {};
  const list = matchMedia(COMPACT_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

const read = () =>
  typeof matchMedia === 'function' && matchMedia(COMPACT_QUERY).matches;

/** True while the window is phone-width. */
export function useCompact() {
  return useSyncExternalStore(subscribe, read, () => false);
}
