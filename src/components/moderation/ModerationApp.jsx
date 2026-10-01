// The moderation hub.
//
// Five places, in the order they are needed:
//
//   Queue      who on the list needs a decision, most urgent first
//   Blocked    who is on the list, with faces and names, searchable
//   Activity   every batch the system proposed, and what it carried
//   Check      score a post or open an account before acting
//   Settings   health, spend, and how the bot writes
//
// The old hub had seven tabs named after the code (Overview, Preflight, Audit,
// Plans, Why, List, Voice). Links the bot puts in DMs still use those names, so
// they are mapped rather than broken: ?tab=plans&code=… opens that plan,
// ?tab=why&actor=… opens that account.

import { useCallback, useEffect, useState } from 'react';
import { History, Inbox, ScanSearch, Settings2, UserX } from 'lucide-react';
import { hubOverview } from '../../lib/moderation/client.js';
import AccountSheet from './AccountSheet.jsx';
import ActivityView from './ActivityView.jsx';
import BlockedView from './BlockedView.jsx';
import CheckView from './CheckView.jsx';
import QueueView from './QueueView.jsx';
import SettingsView from './SettingsView.jsx';
import { ToastHost, compact, fmt, usd, useCached } from './ui.jsx';
import { TAB_KEYS, paramsForRoute, routeFromParams } from './routes.js';
import './moderation.css';

const ICONS = {
  queue: Inbox,
  blocked: UserX,
  activity: History,
  check: ScanSearch,
  settings: Settings2,
};
const LABELS = {
  queue: 'Queue',
  blocked: 'Blocked',
  activity: 'Activity',
  check: 'Check',
  settings: 'Settings',
};

/** The tab bar, built from the same keys the router accepts. */
const TABS = TAB_KEYS.map((key) => ({
  key,
  label: LABELS[key],
  icon: ICONS[key],
}));

function initialRoute() {
  if (typeof window === 'undefined')
    return routeFromParams(new URLSearchParams());
  return routeFromParams(new URLSearchParams(window.location.search));
}

/**
 * Keep the address bar in step without going through the router. The admin's
 * router owns `view`; this owns the hub's own params and leaves the rest.
 */
function writeUrl(route) {
  if (typeof window === 'undefined') return;
  const q = paramsForRoute(window.location.search, route);
  const next = `${window.location.pathname}?${q}`;
  if (next !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState(window.history.state, '', next);
  }
}

function Stats({ data, onGo }) {
  if (!data)
    return <div className="mh-stats mh-stats--loading" aria-hidden="true" />;
  const snapAge = data.snapshot?.ageHours;
  return (
    <div className="mh-stats">
      <button type="button" className="mh-stat" onClick={() => onGo('queue')}>
        <span className="mh-stat-n">{fmt(data.queue?.total ?? 0)}</span>
        <span className="mh-stat-label">to review</span>
      </button>
      <button type="button" className="mh-stat" onClick={() => onGo('blocked')}>
        <span className="mh-stat-n">
          {compact(data.listInfo?.count ?? null)}
        </span>
        <span className="mh-stat-label">on the list</span>
      </button>
      <button
        type="button"
        className="mh-stat"
        onClick={() => onGo('settings')}
      >
        <span className="mh-stat-n">
          {data.cost?.priced ? usd(data.cost.week) : '—'}
        </span>
        <span className="mh-stat-label">this week</span>
      </button>
      <button
        type="button"
        className={`mh-stat${snapAge > 48 ? ' is-warn' : ''}`}
        onClick={() => onGo('settings')}
      >
        <span className="mh-stat-n">
          {snapAge != null ? `${snapAge}h` : '—'}
        </span>
        <span className="mh-stat-label">snapshot</span>
      </button>
    </div>
  );
}

export default function ModerationApp({ agent }) {
  const [route, setRoute] = useState(initialRoute);
  const overview = useCached('overview', () => hubOverview(agent), {
    staleMs: 30_000,
  });

  useEffect(() => {
    writeUrl(route);
  }, [route]);

  const go = useCallback(
    (tab) =>
      setRoute((r) => ({
        ...r,
        tab,
        plan: tab === 'activity' ? r.plan : null,
      })),
    [],
  );
  const openAccount = useCallback(
    (account) => setRoute((r) => ({ ...r, account })),
    [],
  );
  const closeAccount = useCallback(
    () => setRoute((r) => ({ ...r, account: null })),
    [],
  );
  const openPlan = useCallback(
    (plan) =>
      setRoute((r) => ({
        ...r,
        tab: 'activity',
        plan,
        planFilters: {},
        account: null,
      })),
    [],
  );

  const queueCount = overview.data?.queue?.total;

  return (
    <ToastHost>
      <div className="mh">
        <Stats data={overview.data} onGo={go} />

        <nav className="mh-tabs" aria-label="Moderation">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`mh-tab${route.tab === key ? ' is-on' : ''}`}
              aria-current={route.tab === key ? 'page' : undefined}
              onClick={() => go(key)}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="mh-tab-label">{label}</span>
              {key === 'queue' && queueCount > 0 && (
                <span className="mh-tab-badge">
                  {queueCount > 999 ? '999+' : queueCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="mh-body">
          {route.tab === 'queue' && (
            <QueueView agent={agent} onOpenAccount={openAccount} />
          )}
          {route.tab === 'blocked' && (
            <BlockedView agent={agent} onOpenAccount={openAccount} />
          )}
          {route.tab === 'activity' && (
            <ActivityView
              agent={agent}
              plan={route.plan}
              planFilters={route.planFilters}
              onPlan={(plan) =>
                setRoute((r) => ({ ...r, plan, planFilters: {} }))
              }
              onOpenAccount={openAccount}
            />
          )}
          {route.tab === 'check' && (
            <CheckView agent={agent} onOpenAccount={openAccount} />
          )}
          {route.tab === 'settings' && <SettingsView agent={agent} />}
        </div>

        <AccountSheet
          agent={agent}
          actor={route.account}
          onClose={closeAccount}
          onOpenPlan={openPlan}
        />
      </div>
    </ToastHost>
  );
}
