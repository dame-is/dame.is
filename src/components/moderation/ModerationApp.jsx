// The moderation hub, over the bluesky-mod bot's API.
//
// Six places, in the order they are needed:
//
//   Queue      who on the list needs a decision, most urgent first
//   Blocked    who is on the list, with faces and names, searchable, or as a radar
//   Activity   every change to the list, and every scan, with what it carried
//   Check      score a post or open an account before acting
//   Shield     replies and quotes on your own posts, and attack mode
//   Settings   health, model use, and how the bot is set up
//
// The old hub had seven tabs named after the code (Overview, Preflight, Audit,
// Plans, Why, List, Voice). Links the bot put in DMs still use those names, so
// they are mapped rather than broken: ?tab=plans&code=… opens that plan,
// ?tab=why&actor=… opens that account.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Segmented from '../Segmented.jsx';
import { hubOverview } from '../../lib/moderation/client.js';
import AccountSheet from './AccountSheet.jsx';
import ActivityView from './ActivityView.jsx';
import BlockedView from './BlockedView.jsx';
import CheckView from './CheckView.jsx';
import QueueView from './QueueView.jsx';
import SettingsView from './SettingsView.jsx';
import ShieldView from './ShieldView.jsx';
import { ChoiceHost, HubProvider } from './hub.jsx';
import {
  Chips,
  ErrorNote,
  SNAPSHOT_STALE_HOURS,
  ToastHost,
  compact,
  fmt,
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
  shield: 'Shield',
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
 * The hub in four figures, set as the kit's ruled Figures band. Each figure
 * is a button, since it changes the hub's section, which is state this
 * component owns. A stale snapshot says so in words under its figure.
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
      value: fmt(data.queue?.total ?? 0),
    },
    {
      key: 'list',
      tab: 'blocked',
      label: 'On the list',
      value: compact(data.listInfo?.count ?? null),
    },
    {
      key: 'week',
      tab: 'activity',
      label: 'Added this week',
      value: fmt(data.week?.added ?? 0),
    },
    {
      key: 'snapshot',
      tab: 'settings',
      label: 'Snapshot',
      value:
        snapAge != null
          ? snapAge < 48
            ? `${snapAge}h`
            : `${Math.round(snapAge / 24)}d`
          : '—',
      note: stale ? 'stale' : snapAge == null ? 'not built' : null,
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
                onClick={() => onGo(f.tab)}
              >
                {f.value}
              </button>
            </dd>
            {f.note && (
              <dd className="figures-note mh-figure-warn">{f.note}</dd>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function ModerationApp({ agent }) {
  const [route, setRoute] = useState(initialRoute);
  const [list, setList] = useState(null);
  const overview = useCached(
    `overview:${list || 'main'}`,
    () => hubOverview(agent, { list }),
    {
      staleMs: 30_000,
    },
  );
  const data = overview.data;

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

  const me = data?.me || null;
  const hub = useMemo(
    () => ({
      me,
      multi: Boolean(data?.multi),
      lists: data?.lists || [],
      // With one list there is nothing to name; with several, the one shown.
      list: data?.multi ? list || data.lists[0]?.rkey || null : null,
      setList,
      canWrite: Boolean(me?.canWrite),
      isOwner: me?.tier === 'owner' && Boolean(me?.canWrite),
    }),
    [me, data?.multi, data?.lists, list],
  );

  const queueCount = data?.queue?.total;

  return (
    <ToastHost>
      <ChoiceHost>
        <HubProvider value={hub}>
          <div className="mh">
            <Stats data={data} onGo={go} />
            <ErrorNote error={overview.error} onRetry={overview.reload} />

            {hub.multi && (
              <div className="mh-lists">
                <Chips
                  label="Which list"
                  value={hub.list}
                  onChange={setList}
                  options={hub.lists.map((l) => ({
                    key: l.rkey,
                    label: l.name,
                    count: l.n,
                  }))}
                />
              </div>
            )}

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
              {route.tab === 'shield' && <ShieldView agent={agent} />}
              {route.tab === 'settings' && <SettingsView agent={agent} />}
            </div>

            <AccountSheet
              agent={agent}
              actor={route.account}
              onClose={closeAccount}
              onOpenPlan={openPlan}
            />
          </div>
        </HubProvider>
      </ChoiceHost>
    </ToastHost>
  );
}
