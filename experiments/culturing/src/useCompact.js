import { useSyncExternalStore } from 'react';

/**
 * The width under which the bench is laid out for a phone (Workbench.jsx):
 * a bar along the top, tabs along the bottom and sheets between them,
 * instead of a menu bar. It is the site's own line between a desk and
 * everything narrower (stylelint.config.js), because the menu bar needs a
 * desk's width to hold its menus, and a tablet held upright is better off
 * with the sheets. culturing.css follows the class this sets, not a width.
 */
export const COMPACT_QUERY = '(max-width: 61.99rem)';

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
