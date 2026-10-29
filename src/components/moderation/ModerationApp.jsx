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
import Segmented from '../Segmented.jsx';
import { hubOverview } from '../../lib/moderation/client.js';
import AccountSheet from './AccountSheet.jsx';
import ActivityView from './ActivityView.jsx';
import BlockedView from './BlockedView.jsx';
import CheckView from './CheckView.jsx';
import QueueView from './QueueView.jsx';
import SettingsView from './SettingsView.jsx';
import {
  SNAPSHOT_STALE_HOURS,
  ToastHost,
  compact,
  fmt,
  usd,
  useCached,
} from './ui.jsx';
import { TAB_KEYS, paramsForRoute, routeFromParams } from './routes.js';
import '../Figures.css';
import './moderation.css';

const LABELS = {
  queue: 'Queue',
  blocked: 'Blocked',
  activity: 'Activity',
  check: 'Check',
  settings: 'Settings',
};

/** The section keys, built from the same keys the router accepts. */
const TABS = TAB_KEYS.map((key) => ({ key, label: LABELS[key] }));

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

/**
 * The hub in four figures, set as the kit's ruled Figures band.
 *
 * Drawn with Figures' own classes (Figures.css) rather than through the
 * component, because each figure here is a BUTTON: it changes the hub's
 * section, which is state this component owns, not a route the router could
 * follow. Every figure can be followed, so every numeral takes the accent, as
 * the kit gives any figure you can follow. A stale snapshot says so in words
 * under its figure instead of the red edge it used to wear.
 */
function Stats({ data, onGo }) {
  if (!data)
    return <div className="mh-stats mh-stats--loading" aria-hidden="true" />;
  const snapAge = data.snapshot?.ageHours;
  const stale = snapAge > SNAPSHOT_STALE_HOURS;
  const figures = [
    {
      key: 'queue',
      tab: 'queue',
      label: 'To review',
      value: data.queue ? fmt(data.queue.total ?? 0) : '—',
      // A queue that could not be read is not an empty one. The overview
      // answers null for it, and "0 to review" said the opposite.
      title: data.queue ? undefined : 'The queue could not be read',
    },
    {
      key: 'list',
      tab: 'blocked',
      label: 'On the list',
      value: compact(data.listInfo?.count ?? null),
    },
    {
      key: 'spend',
      tab: 'settings',
      label: 'This week',
      value: data.cost?.priced ? usd(data.cost.week) : '—',
    },
    {
      key: 'snapshot',
      tab: 'settings',
      label: 'Snapshot',
      value: snapAge != null ? `${snapAge}h` : '—',
      note: stale ? 'stale' : null,
    },
  ];
  return (
    <div className="figures mh-stats" data-layout="ruled">
      <dl
        className="figures-grid"
        aria-label="The hub in figures"
        style={{ '--figures-cols': figures.length }}
      >
        {figures.map((f) => (
          <div key={f.key} className="figures-cell is-link">
            <dt className="figures-label eyebrow">{f.label}</dt>
            <dd className="figures-value">
              <button
                type="button"
                className="figures-link mh-figure-button"
                title={f.title}
                onClick={() => onGo(f.tab)}
              >
                {f.value}
              </button>
            </dd>
            {f.note && <dd className="figures-note mh-figure-warn">{f.note}</dd>}
          </div>
        ))}
      </dl>
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
          <Segmented
            className="mh-segmented mh-sections"
            label="Sections"
            value={route.tab}
            onChange={go}
            options={TABS.map(({ key, label }) => ({
              value: key,
              label:
                key === 'queue' && queueCount > 0 ? (
                  <>
                    {label}
                    <span className="mh-count">
                      {queueCount > 999 ? '999+' : fmt(queueCount)}
                    </span>
                  </>
                ) : (
                  label
                ),
            }))}
          />
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
              onFilters={(planFilters) =>
                setRoute((r) => ({ ...r, planFilters }))
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
