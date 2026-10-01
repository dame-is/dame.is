// Where the hub opens. Pure, so it is tested without rendering anything.
//
// The old hub had seven tabs named after the code (Overview, Preflight, Audit,
// Plans, Why, List, Voice), and links the bot puts in DMs still use those
// names. They are mapped rather than broken: ?tab=plans&code=… opens that plan,
// ?tab=why&actor=… opens that account.

export const TAB_KEYS = ['queue', 'blocked', 'activity', 'check', 'settings'];

export const DEFAULT_TAB = 'queue';

/** The old hub's tab names, which links in old DMs still carry. */
export const LEGACY_TABS = {
  overview: 'queue',
  audit: 'queue',
  list: 'blocked',
  why: 'blocked',
  plans: 'activity',
  preflight: 'check',
  voice: 'settings',
};

/** Where a URL asks the hub to open, with old tab names mapped. */
export function routeFromParams(params) {
  const get = (k) => params.get(k) || null;
  const raw = get('tab');
  const tab = TAB_KEYS.includes(raw) ? raw : LEGACY_TABS[raw] || DEFAULT_TAB;
  return {
    tab,
    plan: tab === 'activity' ? get('code') : null,
    planFilters: {
      label: get('label') || '',
      band: get('band') || '',
      state: get('state') || '',
    },
    account: get('account') || (raw === 'why' ? get('actor') : null),
  };
}

/** The query string for a route, keeping every parameter the hub does not own. */
export function paramsForRoute(current, { tab, plan, account }) {
  const q = new URLSearchParams(current);
  for (const k of [
    'tab',
    'code',
    'label',
    'band',
    'state',
    'actor',
    'account',
  ]) {
    q.delete(k);
  }
  if (tab !== DEFAULT_TAB) q.set('tab', tab);
  if (plan) q.set('code', plan);
  if (account) q.set('account', account);
  return q;
}
