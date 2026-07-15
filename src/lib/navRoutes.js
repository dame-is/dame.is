// The nav-menu (dock sheet) route list. This hardcoded default is the fallback;
// an is.dame.nav/self PDS record can override it (select / reorder / relabel /
// hide) when its `enabled` flag is set — see useNavRoutes + the admin Nav menu
// panel. Shared by ActionDock (render) and NavMenuPanel (its "reset to
// defaults" seed).

export const DEFAULT_ROUTES = [
  { to: '/', label: 'home' },
  { to: '/themself', label: 'themself' },
  { to: '/available', label: 'available' },
  { to: '/logging', label: 'logging' },
  { to: '/blogging', label: 'blogging' },
  { to: '/creating', label: 'creating' },
  { to: '/listening', label: 'listening' },
  { to: '/curating', label: 'curating' },
  { to: '/mothing', label: 'mothing' },
  { to: '/welcoming', label: 'welcoming' },
  { to: '/exploring', label: 'exploring' },
];

/**
 * The routes the menu should show for a given is.dame.nav record (or null).
 * Uses the record's items only when it's present AND enabled AND yields at
 * least one visible, well-formed entry; otherwise falls back to DEFAULT_ROUTES.
 */
export function effectiveNavRoutes(record) {
  const v = record?.value;
  if (v?.enabled && Array.isArray(v.items)) {
    const items = v.items
      .filter(
        (it) =>
          it &&
          typeof it.to === 'string' &&
          it.to.trim() &&
          typeof it.label === 'string' &&
          it.label.trim() &&
          !it.hidden,
      )
      .map((it) => ({ to: it.to.trim(), label: it.label.trim() }));
    if (items.length) return items;
  }
  return DEFAULT_ROUTES;
}
