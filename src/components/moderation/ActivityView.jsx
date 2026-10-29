// What the system has done: every batch, newest first, and inside one, every
// account with the words it was labelled on.
//
// This is where a bulk action is read properly. A DM can show ten quotes as a
// spot check; this shows all 231 with filters, and lets you add exactly the
// ones you read. Adds made here are recorded as `individual`, because on this
// screen that is what happened.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Button from '../Button.jsx';
import Time from '../Time.jsx';
import {
  planAdd,
  planDetail,
  planList,
  planUndo,
} from '../../lib/moderation/client.js';
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
} from './ui.jsx';

const KIND_LABEL = {
  everyone: 'Everyone who engaged',
  likers: 'Likers',
  reposters: 'Reposters',
  repliers: 'Repliers',
  quoters: 'Quoters',
};

/** What a plan was, as a title a person can read. */
function planTitle(p) {
  if (p.kind) return KIND_LABEL[p.kind] || p.kind;
  if (/^bulk /.test(p.note || '')) return 'Scan';
  return 'Direct action';
}

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

function PlanCard({ p, onOpen }) {
  const via = Object.entries(p.via || {}).sort((a, b) => b[1] - a[1]);
  return (
    <li>
      <button type="button" className="mh-plan" onClick={() => onOpen(p.code)}>
        <span className="mh-plan-head">
          <span className="mh-plan-title">{planTitle(p)}</span>
          <Time
            className="mh-plan-when"
            value={p.createdAt}
            variant="relative"
          />
        </span>
        <span className="mh-plan-stats">
          <span>
            <strong>{fmt(p.accounts)}</strong> scored
          </span>
          {(p.added > 0 || !p.removed) && (
            <span>
              <strong>{fmt(p.added)}</strong> on the list
            </span>
          )}
          {p.removed > 0 && (
            <span>
              <strong>{fmt(p.removed)}</strong> taken off
            </span>
          )}
          {p.undone > 0 && (
            <span>
              <strong>{fmt(p.undone)}</strong> undone
            </span>
          )}
          {!p.approvedAt && <Tag tone="muted">not acted on</Tag>}
        </span>
        {p.labelled > 0 && <LabelBar {...p} />}
        {via.length > 0 && (
          <span className="mh-row-tags">
            {via.map(([k, n]) => (
              <Tag key={k} tone={k.includes('triage') ? 'danger' : 'plain'}>
                {k} · {fmt(n)}
              </Tag>
            ))}
          </span>
        )}
        <span className="mh-plan-code ident">{p.code}</span>
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

function PlanDetail({
  agent,
  code,
  initial = {},
  onBack,
  onFilters,
  onOpenAccount,
}) {
  const toast = useToast();
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

  // A new filter starts at the first page. Set together with the filter, not in
  // an effect after it, so changing a filter is one request rather than two.
  // The address bar follows, so a reload or a shared link keeps the view.
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

  const addPicked = async () => {
    setBusy(true);
    try {
      const r = await planAdd(agent, { code, dids: [...picked] });
      toast(r.message || `Added ${r.added}.`);
      invalidate(`plan:${code}`);
      invalidate('plans');
      invalidate('members');
      setPicked(new Set());
      await reload();
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
      const r = await planUndo(agent, { code });
      toast(r.message || 'Undone.');
      invalidate(`plan:${code}`);
      invalidate('plans');
      invalidate('members');
      await reload();
    } catch (err) {
      toast(err.message, { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

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
              <strong>{fmt(data.counts.total)}</strong> accounts scored ·{' '}
              <strong>{fmt(data.counts.added)}</strong> on the list now
              {data.counts.labelled > 0 && (
                <>
                  {' '}
                  · <strong>{fmt(data.counts.labelled)}</strong> read by a model
                </>
              )}
            </p>
            {data.counts.labelled > 0 && <LabelBar {...data.byLabel} />}
            <p className="mh-small mh-muted">
              <Time value={data.createdAt} variant="dateShort" />
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
            <Chips
              options={BAND_FILTERS}
              value={band}
              onChange={filter('band', setBand)}
              label="Band"
            />
          </div>

          <p className="mh-small mh-muted">
            {fmt(data.matched)} match{refreshing ? ' · updating…' : ''}. Most
            connected first.
          </p>

          {!data.rows.length && <Empty title="Nobody matches these filters" />}

          <ul className="mh-rows mh-rows--plan">
            {data.rows.map((r) => {
              const name = r.displayName || r.handle || r.did;
              const canPick =
                !r.added && !r.alreadyListed && r.band !== 'PROTECTED';
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
                      <Avatar src={r.avatar} name={name} size={36} />
                      <span className="mh-row-text">
                        <span className="mh-row-name">{name}</span>
                        <span className="mh-row-sub">
                          @{r.handle || r.did}
                          {r.followers != null &&
                            ` · ${compact(r.followers)} followers`}
                        </span>
                      </span>
                    </span>
                    {r.quote && <q className="mh-quote">{r.quote}</q>}
                    <span className="mh-row-tags">
                      <BandBadge band={r.band} />
                      {r.triage && (
                        <Tag tone={r.triage === 'hostile' ? 'danger' : 'plain'}>
                          {r.triage}
                        </Tag>
                      )}
                      {r.added && (
                        <Tag tone="muted">
                          on the list · {r.approvedVia || '?'}
                        </Tag>
                      )}
                      {r.alreadyListed && (
                        <Tag tone="muted">already on the list</Tag>
                      )}
                      {r.removed && <Tag tone="muted">taken off</Tag>}
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

          {data.counts.added > 0 && (
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
  { key: 'all', label: 'Everything' },
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
  // Pages past the first, which is cached like every other view's first page.
  const [older, setOlder] = useState({
    plans: [],
    next: undefined,
    loading: false,
    error: null,
  });
  const { data, error, loading, reload } = useCached(
    `plans:${kind}`,
    () => planList(agent, { kind }),
    {
      staleMs: 30_000,
    },
  );
  const open = useCallback((code) => onPlan(code), [onPlan]);

  // A new filter, or a refreshed first page, starts the older pages again. The
  // count lets a page still in flight from before that see it is out of date,
  // rather than land under a filter it was not asked for.
  const started = useRef(0);
  useEffect(() => {
    started.current += 1;
    setOlder({ plans: [], next: undefined, loading: false, error: null });
  }, [kind, data]);

  const next = older.next === undefined ? data?.next : older.next;
  const loadOlder = async () => {
    const asked = started.current;
    setOlder((o) => ({ ...o, loading: true, error: null }));
    try {
      const page = await planList(agent, { kind, before: next });
      if (started.current !== asked) return;
      setOlder((o) => ({
        plans: [...o.plans, ...page.plans],
        next: page.next,
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

  const shown = [...(data?.plans || []), ...older.plans];

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
          Every scan the system has run and every block or unblock you asked
          for, newest first, and what became of it. Open a scan to read each
          account beside the words it was labelled on.
        </p>
      </div>
      {loading && <Skeleton rows={4} avatar={false} />}
      <ErrorNote error={error} onRetry={reload} />
      {data && !shown.length && <Empty title="Nothing yet" />}
      {shown.length > 0 && (
        <ul className="mh-plans">
          {shown.map((p) => (
            <PlanCard key={p.code} p={p} onOpen={open} />
          ))}
        </ul>
      )}
      {data && (next || older.loading || older.error) && (
        <div className="mh-more">
          <ErrorNote error={older.error} onRetry={loadOlder} compact />
          {older.loading && <Skeleton rows={2} avatar={false} />}
          {!older.loading && next && (
            <Button size="sm" onClick={loadOlder}>
              Show older
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
