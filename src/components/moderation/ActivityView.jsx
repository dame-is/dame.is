// What has been done: every change to the list and every scan, newest first,
// and inside a plan, every account with the words it was labelled on.
//
// This is where a bulk action is read properly. A DM can show ten quotes as a
// spot check; this shows all 231 with filters, and lets you add exactly the
// ones you read. Adds made here go to the bot as approvals by name, because on
// this screen that is what happened.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { addable, KIND_WORDS, primaryKind } from 'bluesky-mod-client';
import Button from '../Button.jsx';
import Time from '../Time.jsx';
import {
  activityPage,
  planAdd,
  planDetail,
  planUndo,
  scanPage,
} from '../../lib/moderation/client.js';
import { useCommand, useHub } from './hub.jsx';
import Radar from './Radar.jsx';
import {
  Avatar,
  BandBadge,
  Chips,
  Empty,
  ErrorNote,
  Skeleton,
  Tag,
  compact,
  fmt,
  invalidate,
  useCached,
  useToast,
  addedText,
  isCarried,
} from './ui.jsx';

/** The three labels as a proportional bar, with the numbers beside it. */
function LabelBar({ hostile = 0, arguing = 0, neutral = 0 }) {
  const total = hostile + arguing + neutral;
  if (!total) return null;
  const pct = (n) => `${(100 * n) / total}%`;
  return (
    <div
      className="mh-labelbar"
      aria-label={`${hostile} hostile, ${arguing} arguing, ${neutral} neutral`}
    >
      <div className="mh-labelbar-track" aria-hidden="true">
        <span className="mh-labelbar-hostile" style={{ width: pct(hostile) }} />
        <span className="mh-labelbar-arguing" style={{ width: pct(arguing) }} />
        <span className="mh-labelbar-neutral" style={{ width: pct(neutral) }} />
      </div>
      <span className="mh-small">
        {fmt(hostile)} hostile · {fmt(arguing)} arguing · {fmt(neutral)} neutral
      </span>
    </div>
  );
}

const STATE_WORDS = {
  waiting: 'waiting for you',
  adding: 'adding now',
  added: 'on the list',
  cancelled: 'cancelled',
  undone: 'undone',
};

/** One scan in the list: what it collected and what became of it. */
function ScanCard({ s, onOpen }) {
  const labelled =
    (s.labels?.hostile || 0) +
    (s.labels?.arguing || 0) +
    (s.labels?.neutral || 0);
  return (
    <li>
      <button type="button" className="mh-plan" onClick={() => onOpen(s.code)}>
        <span className="mh-plan-head">
          <span className="mh-plan-title">{KIND_WORDS[s.kind] || 'Scan'}</span>
          <Time
            className="mh-plan-when"
            value={s.createdAt}
            variant="relative"
          />
        </span>
        <span className="mh-plan-stats">
          <span>
            <strong>{fmt(s.total)}</strong> scored
          </span>
          {s.live > 0 && (
            <span>
              <strong>{fmt(s.live)}</strong> on the list
            </span>
          )}
          <Tag tone="muted">{STATE_WORDS[s.state] || s.state}</Tag>
        </span>
        {labelled > 0 && <LabelBar {...s.labels} />}
        <span className="mh-plan-code ident">{s.code}</span>
      </button>
    </li>
  );
}

const EVENT_WORDS = {
  added: (n) => `Added ${fmt(n)}`,
  removed: (n) => `Took ${fmt(n)} off`,
  undone: (n) => `Undid ${fmt(n)}`,
};

/** One change to the list: a batch is one line. */
function EventCard({ e, onOpen }) {
  return (
    <li>
      <button type="button" className="mh-plan" onClick={() => onOpen(e.code)}>
        <span className="mh-plan-head">
          <span className="mh-plan-title">
            {EVENT_WORDS[e.kind]?.(e.n) || e.kind}
          </span>
          <Time className="mh-plan-when" value={e.at} variant="relative" />
        </span>
        <span className="mh-plan-stats">
          {e.band && <BandBadge band={e.band} />}
          {e.kind === 'added' && e.via && <span>{addedText(e)}</span>}
          {e.scan && <Tag tone="muted">from a scan</Tag>}
          {e.undone > 0 && <Tag tone="muted">{fmt(e.undone)} undone since</Tag>}
        </span>
        {e.words?.length > 0 && !isCarried(e.words) && (
          <q className="mh-quote">{e.words.join(' · ')}</q>
        )}
        <span className="mh-plan-code ident">{e.code}</span>
      </button>
    </li>
  );
}

const STATES = [
  { key: 'pending', label: 'Not on the list' },
  { key: 'added', label: 'On the list' },
  { key: 'all', label: 'Everyone' },
];
const LABELS = [
  { key: '', label: 'Any label' },
  { key: 'hostile', label: 'Hostile' },
  { key: 'arguing', label: 'Arguing' },
  { key: 'neutral', label: 'Neutral' },
];
const BAND_FILTERS = [
  { key: '', label: 'Any band' },
  { key: 'CONNECTED', label: 'Connected' },
  { key: 'PERIPHERAL', label: 'Peripheral' },
  { key: 'NOTABLE', label: 'Notable' },
  { key: 'UNKNOWN', label: 'Stranger' },
];

const SECTORS = [
  { key: 'quote', label: 'Quoted' },
  { key: 'reply', label: 'Replied' },
  { key: 'repost', label: 'Reposted' },
  { key: 'like', label: 'Liked' },
  { key: 'other', label: 'Elsewhere' },
];

/** A scan's rows on the radar, sliced by the loudest thing each account did. */
function PlanRadar({ rows, onOpen }) {
  const drawn = useMemo(() => {
    const keys = SECTORS.filter((s) =>
      rows.some((r) => primaryKind(r.kinds) === s.key),
    );
    const index = (r) => keys.findIndex((s) => s.key === primaryKind(r.kinds));
    return {
      sectors: keys,
      points: rows
        .filter((r) => r.band !== 'UNKNOWN' && r.band !== 'UNSCORED')
        .map((r) => ({
          did: r.did,
          band: r.band,
          sector: index(r),
        })),
      far: keys.map(
        (s) =>
          rows.filter(
            (r) => r.band === 'UNKNOWN' && primaryKind(r.kinds) === s.key,
          ).length,
      ),
    };
  }, [rows]);
  if (!drawn.sectors.length) return null;
  return (
    <Radar
      label="Who engaged, by how close they are"
      {...drawn}
      onOpen={onOpen}
    />
  );
}

function PlanDetail({
  agent,
  code,
  initial = {},
  onBack,
  onFilters,
  onOpenAccount,
}) {
  const toast = useToast();
  const hub = useHub();
  const run = useCommand(agent);
  const [state, setState] = useState(initial.state || 'pending');
  const [label, setLabel] = useState(initial.label || '');
  const [band, setBand] = useState(initial.band || '');
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const key = `plan:${code}:${state}:${label}:${band}:${offset}`;
  const { data, error, loading, reload, refreshing } = useCached(
    key,
    () => planDetail(agent, { code, state, label, band, offset }),
    { staleMs: 30_000 },
  );

  useEffect(() => {
    setPicked(new Set());
  }, [key]);

  // A new filter starts at the first page, and the address bar follows, so a
  // reload or a shared link keeps the view.
  const filter = (name, setter) => (value) => {
    setter(value);
    setOffset(0);
    onFilters?.({ state, label, band, [name]: value });
  };

  const toggle = (did) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(did)) n.delete(did);
      else n.add(did);
      return n;
    });

  const after = async () => {
    invalidate(`plan:${code}`);
    invalidate('activity');
    invalidate('scans');
    invalidate('members');
    invalidate('overview');
    await reload();
  };

  const addPicked = async () => {
    setBusy(true);
    try {
      const reply = await planAdd(
        agent,
        { code, dids: [...picked], list: data.list },
        { run },
      );
      if (!reply) return;
      toast(reply.text || 'Added.');
      setPicked(new Set());
      await after();
    } catch (err) {
      toast(err.message, { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const undoAll = async () => {
    if (!window.confirm(`Take everyone plan ${code} added back off the list?`))
      return;
    setBusy(true);
    try {
      const reply = await planUndo(agent, { code });
      toast(reply.text || 'Undone.');
      await after();
    } catch (err) {
      toast(err.message, { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const listName = data?.list
    ? hub.lists.find((l) => l.rkey === data.list)?.name
    : null;

  return (
    <section className="mh-view" aria-label={`Plan ${code}`}>
      <div className="mh-detail-head">
        <Button size="sm" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" /> All activity
        </Button>
        <span className="mh-plan-code ident">{code}</span>
      </div>

      {loading && <Skeleton rows={5} />}
      <ErrorNote error={error} onRetry={reload} />

      {data && (
        <>
          <div className="mh-plan-summary">
            <p>
              <strong>{fmt(data.counts.total)}</strong>{' '}
              {data.scan ? 'accounts scored' : 'accounts'} ·{' '}
              <strong>{fmt(data.counts.added)}</strong> on the list now
              {data.counts.labelled > 0 && (
                <>
                  {' '}
                  · <strong>{fmt(data.counts.labelled)}</strong> read by a model
                </>
              )}
            </p>
            {data.counts.labelled > 0 && <LabelBar {...data.byLabel} />}
            {data.words.length > 0 && (
              <q className="mh-quote">{data.words.join(' · ')}</q>
            )}
            <p className="mh-small mh-muted">
              <Time value={data.createdAt} variant="dateShort" />
              {listName && ` · ${listName}`}
              {data.webUrl && (
                <>
                  {' · '}
                  <Button
                    as="a"
                    variant="text"
                    size="sm"
                    href={data.webUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    the post it came from{' '}
                    <ExternalLink size={11} aria-hidden="true" />
                  </Button>
                </>
              )}
            </p>
            {data.counts.labelled > 0 && (
              <p className="mh-small">
                A label is a model reading a post. It is not a band and cannot
                change one; the words it was read from are beside it.
              </p>
            )}
          </div>

          {data.scan && (
            <PlanRadar rows={data.allRows} onOpen={onOpenAccount} />
          )}

          <div className="mh-filters">
            <Chips
              options={STATES}
              value={state}
              onChange={filter('state', setState)}
              label="On the list"
            />
            {data.counts.labelled > 0 && (
              <Chips
                options={LABELS}
                value={label}
                onChange={filter('label', setLabel)}
                label="Label"
              />
            )}
            {data.scan && (
              <Chips
                options={BAND_FILTERS}
                value={band}
                onChange={filter('band', setBand)}
                label="Band"
              />
            )}
          </div>

          <p className="mh-small mh-muted">
            {fmt(data.matched)} match{refreshing ? ' · updating…' : ''}. Most
            connected first.
          </p>

          {!data.rows.length && <Empty title="Nobody matches these filters" />}

          <ul className="mh-rows mh-rows--plan">
            {data.rows.map((r) => {
              const p = r.profile || {};
              const name = p.displayName || p.handle || r.did;
              const canPick = hub.canWrite && addable(r);
              return (
                <li
                  key={r.did}
                  className={`mh-planrow${picked.has(r.did) ? ' is-picked' : ''}`}
                >
                  <label className="mh-check" aria-label={`Select ${name}`}>
                    <input
                      type="checkbox"
                      checked={picked.has(r.did)}
                      disabled={!canPick}
                      onChange={() => toggle(r.did)}
                    />
                  </label>
                  <button
                    type="button"
                    className="mh-planrow-body"
                    onClick={() => onOpenAccount(r.did)}
                  >
                    <span className="mh-planrow-who">
                      <Avatar src={p.avatar} name={name} size={36} />
                      <span className="mh-row-text">
                        <span className="mh-row-name">{name}</span>
                        <span className="mh-row-sub">
                          @{p.handle || r.did}
                          {p.followers != null &&
                            ` · ${compact(p.followers)} followers`}
                        </span>
                      </span>
                    </span>
                    {r.quote && <q className="mh-quote">{r.quote}</q>}
                    <span className="mh-row-tags">
                      <BandBadge band={r.band} />
                      {r.label && (
                        <Tag tone={r.label === 'hostile' ? 'danger' : 'plain'}>
                          {r.label}
                        </Tag>
                      )}
                      {r.added && <Tag tone="muted">on the list</Tag>}
                      {r.listed && !r.added && (
                        <Tag tone="muted">already on the list</Tag>
                      )}
                      {r.undone && <Tag tone="muted">taken off</Tag>}
                      {r.protected && r.band !== 'PROTECTED' && (
                        <Tag tone="danger">protected now</Tag>
                      )}
                      {r.vouches > 0 && (
                        <span className="mh-row-when">
                          {r.vouches} shared follows
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mh-pager">
            <Button
              size="sm"
              disabled={!data.offset}
              onClick={() =>
                setOffset(Math.max(0, data.offset - data.pageSize))
              }
            >
              Previous
            </Button>
            <span className="mh-small mh-muted">
              {data.matched
                ? `${fmt(data.offset + 1)}–${fmt(Math.min(data.matched, data.offset + data.pageSize))} of ${fmt(data.matched)}`
                : ''}
            </span>
            <Button
              size="sm"
              disabled={data.offset + data.pageSize >= data.matched}
              onClick={() => setOffset(data.offset + data.pageSize)}
            >
              Next
            </Button>
          </div>

          {hub.canWrite && data.counts.added > 0 && (
            <div className="mh-danger-zone">
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={undoAll}
              >
                Undo everything this plan added ({fmt(data.counts.added)})
              </Button>
            </div>
          )}

          {picked.size > 0 && (
            <div className="mh-actionbar" role="region" aria-label="Selection">
              <span>
                <strong>{picked.size}</strong> selected
              </span>
              <Button size="sm" onClick={() => setPicked(new Set())}>
                Clear
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={addPicked}
              >
                {busy ? 'Adding…' : `Add ${picked.size} to the list`}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const KINDS = [
  { key: 'all', label: 'Every change' },
  { key: 'scans', label: 'Scans' },
  { key: 'direct', label: 'Direct actions' },
];

export default function ActivityView({
  agent,
  plan,
  planFilters,
  onPlan,
  onFilters,
  onOpenAccount,
}) {
  const [kind, setKind] = useState('all');
  const scans = kind === 'scans';
  // Pages past the first, which is cached like every other view's first page.
  const [older, setOlder] = useState({
    items: [],
    next: undefined,
    more: undefined,
    loading: false,
    error: null,
  });
  const fetchPage = useCallback(
    (from) =>
      scans
        ? scanPage(agent, { before: from }).then((p) => ({
            items: p.scans,
            more: p.more,
            next: p.next,
          }))
        : activityPage(agent, {
            offset: from || 0,
            direct: kind === 'direct',
          }).then((p) => ({
            items: p.events,
            more: p.more,
            next: p.next,
          })),
    [agent, scans, kind],
  );
  const { data, error, loading, reload } = useCached(
    `${scans ? 'scans' : 'activity'}:${kind}`,
    () => fetchPage(null),
    {
      staleMs: 30_000,
    },
  );
  const open = useCallback((code) => onPlan(code), [onPlan]);

  // A new filter, or a refreshed first page, starts the older pages again. The
  // count lets a page still in flight from before that see it is out of date.
  const started = useRef(0);
  useEffect(() => {
    started.current += 1;
    setOlder({
      items: [],
      next: undefined,
      more: undefined,
      loading: false,
      error: null,
    });
  }, [kind, data]);

  const next = older.next === undefined ? data?.next : older.next;
  const more = older.more === undefined ? data?.more : older.more;
  const loadOlder = async () => {
    const asked = started.current;
    setOlder((o) => ({ ...o, loading: true, error: null }));
    try {
      const page = await fetchPage(next);
      if (started.current !== asked) return;
      setOlder((o) => ({
        items: [...o.items, ...page.items],
        next: page.next,
        more: page.more,
        loading: false,
        error: null,
      }));
    } catch (err) {
      if (started.current !== asked) return;
      setOlder((o) => ({ ...o, loading: false, error: err }));
    }
  };

  if (plan) {
    return (
      <PlanDetail
        key={plan}
        agent={agent}
        code={plan}
        initial={planFilters}
        onBack={() => onPlan(null)}
        onFilters={onFilters}
        onOpenAccount={onOpenAccount}
      />
    );
  }

  const shown = [...(data?.items || []), ...older.items];

  return (
    <section className="mh-view" aria-label="Activity">
      <div className="mh-view-intro">
        <Chips
          options={KINDS}
          value={kind}
          onChange={setKind}
          label="What to show"
        />
        <p className="mh-small">
          {scans
            ? 'Every post the bot scanned, newest first, and what became of it. Open one to read each account beside the words it was labelled on.'
            : 'Every change to the list, newest first: a batch is one line. Open one to see who it carried.'}
        </p>
      </div>
      {loading && <Skeleton rows={4} avatar={false} />}
      <ErrorNote error={error} onRetry={reload} />
      {data && !shown.length && <Empty title="Nothing yet" />}
      {shown.length > 0 && (
        <ul className="mh-plans">
          {shown.map((x, i) =>
            scans ? (
              <ScanCard key={x.code} s={x} onOpen={open} />
            ) : (
              <EventCard
                key={`${x.code}-${x.kind}-${x.at}-${i}`}
                e={x}
                onOpen={open}
              />
            ),
          )}
        </ul>
      )}
      {data && (more || older.loading || older.error) && (
        <div className="mh-more">
          <ErrorNote error={older.error} onRetry={loadOlder} compact />
          {older.loading && <Skeleton rows={2} avatar={false} />}
          {!older.loading && more && (
            <Button size="sm" onClick={loadOlder}>
              Show older
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
