// The Analytics studio's Graph tab: where the people around you sit, and the
// Bluesky lists kept in step with it.
//
// Unlike the rest of the studio this tab reads from the server, not from the
// browser's archive. Two reasons. Proximity comes from the moderation gate's
// vouch snapshot, which lives in Supabase behind the service key. And the lists
// are written by a cron that has no browser to ask, so the preview here has to
// come from the same code the cron runs, or it would be a guess about what the
// cron will do. See api/graph-lists.js.
//
// Vocabulary, shared with the moderation docs: 1st degree is someone you
// follow; 2nd degree is someone at least one of your follows follows, and the
// count of how many is the "vouch" the moderation bands are built on.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Orbit, ListChecks } from 'lucide-react';
import Button from './Button.jsx';
import Figures from './Figures.jsx';
import SectionHead from './SectionHead.jsx';
import Segmented from './Segmented.jsx';
import { BAND_META, graphLists } from '../lib/moderation/client.js';
import {
  DEGREE_BUCKETS,
  ENGAGEMENT_EVENT_KINDS,
  LIST_KINDS,
  MAX_LIST_SIZE,
  PRESETS,
  describeRule,
  normalizeDefinition,
  orbitRadius,
} from '../lib/graphLists.js';
import { formatDateShort, relativeTime } from '../lib/time.js';
import './AnalyticsGraph.css';

const BAND_LABEL = Object.fromEntries(BAND_META.map((b) => [b.key, b.label]));

const KIND_PLURAL = {
  like: 'likes',
  repost: 'reposts',
  reply: 'replies',
  quote: 'quotes',
  mention: 'mentions',
};

/** "Mutual", "You follow them", "2nd degree · 14 of your follows", … */
export function placeLabel(p) {
  if (p.mutual) return 'Mutual';
  if (p.youFollow) return 'You follow them';
  if (p.vouches > 0) {
    return `2nd degree · ${p.vouches.toLocaleString('en-US')} of your follows`;
  }
  return 'None of your follows follow them';
}

function profileHref(card) {
  return `https://bsky.app/profile/${encodeURIComponent(card?.handle || card?.did)}`;
}

function listHref(uri) {
  const m = /^at:\/\/(did:[^/]+)\/app\.bsky\.graph\.list\/([^/]+)$/.exec(
    uri || '',
  );
  return m ? `https://bsky.app/profile/${m[1]}/lists/${m[2]}` : null;
}

export default function GraphTab({ agent }) {
  const [orbit, setOrbit] = useState({
    data: null,
    loading: true,
    error: null,
  });
  const [lists, setLists] = useState({
    data: null,
    loading: true,
    error: null,
  });

  const loadOrbit = useCallback(async () => {
    setOrbit((o) => ({ ...o, loading: true, error: null }));
    try {
      const data = await graphLists(agent, { action: 'orbit', windowDays: 30 });
      setOrbit({ data, loading: false, error: null });
    } catch (err) {
      setOrbit((o) => ({
        ...o,
        loading: false,
        error: err?.message || String(err),
      }));
    }
  }, [agent]);

  const loadLists = useCallback(async () => {
    setLists((l) => ({ ...l, loading: true, error: null }));
    try {
      const data = await graphLists(agent, { action: 'status' });
      setLists({ data, loading: false, error: null });
    } catch (err) {
      setLists((l) => ({
        ...l,
        loading: false,
        error: err?.message || String(err),
      }));
    }
  }, [agent]);

  useEffect(() => {
    loadOrbit();
    loadLists();
  }, [loadOrbit, loadLists]);

  return (
    <section className="an-panel" aria-label="Graph">
      <OrbitPanel state={orbit} onReload={loadOrbit} />
      <ListsPanel agent={agent} state={lists} onReload={loadLists} />
    </section>
  );
}

/* ================================================================== */
/* Where people sit                                                     */
/* ================================================================== */

const ORBIT_FILTERS = [
  { value: 'all', label: 'Everyone' },
  { value: 'engaged', label: 'Engaged' },
  { value: 'new', label: 'Not following' },
];

function OrbitPanel({ state, onReload }) {
  const { data, loading, error } = state;
  const [filter, setFilter] = useState('all');
  const [focus, setFocus] = useState(null);

  const nodes = useMemo(() => {
    const all = data?.nodes || [];
    if (filter === 'engaged') return all.filter((n) => n.in + n.out > 0);
    if (filter === 'new') return all.filter((n) => !n.youFollow);
    return all;
  }, [data, filter]);

  const closest = useMemo(
    () =>
      (data?.nodes || [])
        .filter((n) => !n.youFollow && n.vouches > 0)
        .sort((a, b) => b.vouches - a.vouches || b.in + b.out - (a.in + a.out))
        .slice(0, 12),
    [data],
  );

  const focused = focus
    ? (data?.nodes || []).find((n) => n.did === focus)
    : null;

  return (
    <div className="an-card">
      <SectionHead
        as="h3"
        title={
          <>
            <Orbit size={18} aria-hidden="true" className="an-card-glyph" />
            Where people sit
          </>
        }
        meta={
          <Button
            size="sm"
            variant="text"
            onClick={onReload}
            disabled={loading}
          >
            {loading ? 'Reading…' : 'Refresh'}
          </Button>
        }
      />
      {error && (
        <p className="gr-error" role="alert">
          {error}
        </p>
      )}
      {!data && loading && (
        <p className="an-empty">
          Reading the last 30 days and the follow-graph snapshot. This takes a
          few seconds.
        </p>
      )}
      {data && (
        <>
          <Figures
            className="an-figures"
            label="Your graph in figures"
            items={[
              { key: 'f', label: 'You follow', value: data.following },
              { key: 'm', label: 'Mutuals', value: data.mutuals },
              {
                key: 'in',
                label: 'Engaged with you',
                value: data.breakdown.inbound.total,
                note: '30 days',
              },
              {
                key: 'out',
                label: 'You engaged with',
                value: data.breakdown.outbound.total,
                note: '30 days',
              },
            ]}
          />

          <div className="gr-bars">
            <DegreeBar
              label="Who engages with you"
              counts={data.breakdown.inbound}
            />
            <DegreeBar
              label="Who you engage with"
              counts={data.breakdown.outbound}
            />
          </div>
          <ul className="gr-legend" aria-label="Key">
            {DEGREE_BUCKETS.map((b) => (
              <li key={b.key} title={b.hint}>
                <span
                  className={`gr-swatch gr-swatch--${b.key}`}
                  aria-hidden="true"
                />
                {b.label}
              </li>
            ))}
          </ul>

          <div className="gr-orbit-head">
            <Segmented
              label="Show in the orbit"
              value={filter}
              onChange={setFilter}
              options={ORBIT_FILTERS}
            />
            <span className="gr-orbit-count">
              {nodes.length.toLocaleString('en-US')} accounts
            </span>
          </div>
          <div className="gr-orbit-wrap">
            <OrbitChart
              nodes={nodes}
              maxVouches={data.maxVouches}
              focus={focus}
              onFocus={setFocus}
            />
            <OrbitDetail node={focused} />
          </div>
          <p className="an-card-caption">
            You at the centre. Mutuals on the inner ring, people you follow just
            outside it, 2nd-degree accounts across the middle (the more of your
            follows follow them, the closer), and accounts with no measured
            connection on the rim. Dot size is how much you engaged either way
            in 30 days. Follow-graph snapshot from{' '}
            {data.snapshotAt ? formatDateShort(data.snapshotAt) : 'nowhere yet'}
            ; it refreshes weekly with the moderation gate’s.
          </p>

          <SectionHead as="h4" title="Closest you don’t follow" />
          <ol className="gr-people">
            {closest.map((n) => (
              <PersonRow key={n.did} card={n} />
            ))}
          </ol>
          {!closest.length && (
            <p className="an-empty">Nobody in the drawn set.</p>
          )}
          <Coverage coverage={data.coverage} />
        </>
      )}
    </div>
  );
}

function DegreeBar({ label, counts }) {
  const total = counts.total || 0;
  return (
    <figure className="gr-bar">
      <figcaption className="gr-bar-label">
        {label}
        <span className="gr-bar-total">{total.toLocaleString('en-US')}</span>
      </figcaption>
      <div className="gr-bar-track" aria-hidden="true">
        {DEGREE_BUCKETS.map((b) =>
          counts[b.key] ? (
            <span
              key={b.key}
              className={`gr-bar-seg gr-swatch--${b.key}`}
              style={{ flexGrow: counts[b.key] }}
              title={`${b.label}: ${counts[b.key]}`}
            />
          ) : null,
        )}
      </div>
      <dl className="gr-bar-table">
        {DEGREE_BUCKETS.map((b) => (
          <div key={b.key}>
            <dt>{b.label}</dt>
            <dd>
              {(counts[b.key] || 0).toLocaleString('en-US')}
              {total > 0 && (
                <span className="gr-pct">
                  {' '}
                  {Math.round(((counts[b.key] || 0) / total) * 100)}%
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}

/** A stable angle for a DID, so a node keeps its place between loads. */
function angleOf(did) {
  let h = 2166136261;
  for (let i = 0; i < did.length; i += 1) {
    h ^= did.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

const R = 480;

/** Which ring family a node belongs to, for spreading each family evenly. */
function familyOf(n) {
  if (n.mutual) return 'mutual';
  if (n.youFollow) return 'following';
  return n.vouches > 0 ? 'second' : 'beyond';
}

/**
 * Angles that spread each family around its ring. The hash only fixes the
 * ORDER (so an account keeps roughly its place between loads); the angle is
 * the golden-angle step by rank, which never clumps the way raw hashes of
 * similar DIDs can.
 */
function spreadAngles(nodes) {
  const out = new Map();
  const families = new Map();
  for (const n of nodes) {
    const f = familyOf(n);
    if (!families.has(f)) families.set(f, []);
    families.get(f).push(n);
  }
  for (const group of families.values()) {
    group
      .map((n) => ({ did: n.did, h: angleOf(n.did) }))
      .sort((a, b) => a.h - b.h)
      .forEach(({ did }, i) =>
        out.set(did, (i * 2.399963229728653) % (Math.PI * 2)),
      );
  }
  return out;
}

function OrbitChart({ nodes, maxVouches, focus, onFocus }) {
  const placed = useMemo(() => {
    const angles = spreadAngles(nodes);
    return (
      nodes
        .map((n) => {
          const r = orbitRadius(n, { maxVouches }) * R;
          const a = angles.get(n.did);
          const weight = n.in + n.out;
          return {
            n,
            x: Math.cos(a) * r,
            y: Math.sin(a) * r,
            size: weight ? Math.min(26, 6 + Math.sqrt(weight) * 3) : 5,
            weight,
          };
        })
        // Small dots last, so a big one never hides a small one under it.
        .sort((a, b) => b.size - a.size)
    );
  }, [nodes, maxVouches]);

  return (
    <svg
      className="gr-orbit"
      viewBox={`${-R - 20} ${-R - 20} ${2 * R + 40} ${2 * R + 40}`}
      role="group"
      aria-label="Orbit of the accounts around you"
    >
      {[0.2, 0.32, 0.66, 0.96].map((f) => (
        <circle key={f} className="gr-ring" r={f * R} />
      ))}
      <circle className="gr-you" r={14} />
      {placed.map(({ n, x, y, size, weight }) => {
        const cls = [
          'gr-node',
          n.mutual
            ? 'gr-node--mutual'
            : n.youFollow
              ? 'gr-node--following'
              : n.vouches > 0
                ? 'gr-node--second'
                : 'gr-node--beyond',
          weight ? 'is-engaged' : '',
          focus === n.did ? 'is-focus' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const name = n.displayName || n.handle || n.did;
        return (
          <circle
            key={n.did}
            className={cls}
            cx={x}
            cy={y}
            r={size}
            tabIndex={0}
            role="img"
            aria-label={`${name}: ${placeLabel(n)}; ${n.in} to you, ${n.out} from you in 30 days`}
            onMouseEnter={() => onFocus(n.did)}
            onFocus={() => onFocus(n.did)}
            onClick={() => onFocus(n.did)}
          />
        );
      })}
      {/* Over the dots, with a halo in the page colour, so a dot on the
          ring line never swallows the words. */}
      <text className="gr-ring-label" x={0} y={-0.66 * R - 8}>
        2nd degree
      </text>
      <text className="gr-ring-label" x={0} y={-0.96 * R - 8}>
        no connection
      </text>
    </svg>
  );
}

function OrbitDetail({ node }) {
  if (!node) {
    return (
      <p className="gr-detail an-empty">
        Point at a dot, or tab to one, to see who it is.
      </p>
    );
  }
  return (
    <div className="gr-detail" aria-live="polite">
      <PersonRow card={node} big />
      <dl className="gr-detail-facts">
        <div>
          <dt>To you</dt>
          <dd>{node.in}</dd>
        </div>
        <div>
          <dt>From you</dt>
          <dd>{node.out}</dd>
        </div>
        <div>
          <dt>Band</dt>
          <dd>{BAND_LABEL[node.band] || node.band}</dd>
        </div>
      </dl>
    </div>
  );
}

function PersonRow({ card, big = false, aside = null }) {
  const name = card.displayName || card.handle || card.did;
  return (
    <li className={`gr-person${big ? ' gr-person--big' : ''}`}>
      {card.avatar ? (
        <img
          className="an-actor-avatar"
          src={card.avatar}
          alt=""
          loading="lazy"
        />
      ) : (
        <span
          className="an-actor-avatar an-actor-avatar-empty"
          aria-hidden="true"
        />
      )}
      <span className="an-actor-main">
        <a
          className="an-actor-name"
          href={profileHref(card)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {name}
        </a>
        <span className="an-actor-handle">
          {card.handle ? `@${card.handle} · ` : ''}
          <span className="an-actor-rel">{placeLabel(card)}</span>
        </span>
      </span>
      {aside != null && <span className="gr-person-aside">{aside}</span>}
    </li>
  );
}

function Coverage({ coverage }) {
  if (!coverage) return null;
  const notes = [];
  if (coverage.inboundTruncated) {
    notes.push(
      `Notifications ran past what one read covers; inbound counts reach back to ${formatDateShort(coverage.inboundReachedMs)}.`,
    );
  }
  if (!coverage.snapshotAt)
    notes.push(
      'No follow-graph snapshot yet, so nobody is placed past 1st degree.',
    );
  if (!coverage.modListRead)
    notes.push(
      'The moderation list could not be read, so its members were not filtered out.',
    );
  if (!notes.length) return null;
  return <p className="an-card-caption gr-coverage">{notes.join(' ')}</p>;
}

/* ================================================================== */
/* Managed lists                                                        */
/* ================================================================== */

function ListsPanel({ agent, state, onReload }) {
  const { data, loading, error } = state;
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [lastRun, setLastRun] = useState(null);

  async function run(label, fn) {
    setBusy(label);
    setActionError(null);
    try {
      return await fn();
    } catch (err) {
      setActionError(err?.message || String(err));
      return null;
    } finally {
      setBusy(null);
    }
  }

  const syncNow = (key = null) =>
    run(key ? `sync:${key}` : 'sync', async () => {
      const result = await graphLists(agent, { action: 'sync', key });
      setLastRun(result);
      await onReload();
    });

  const toggle = (def) =>
    run(`toggle:${def.key}`, async () => {
      await graphLists(agent, {
        action: 'save',
        definition: { ...def, enabled: !def.enabled },
      });
      await onReload();
    });

  const remove = (def, deleteList) => {
    const msg = deleteList
      ? `Delete the Bluesky list “${def.name}” and everyone on it? This can’t be undone.`
      : `Stop syncing “${def.name}”? The Bluesky list stays exactly as it is now.`;
    if (!window.confirm(msg)) return;
    run(`remove:${def.key}`, async () => {
      await graphLists(agent, { action: 'remove', key: def.key, deleteList });
      await onReload();
    });
  };

  const lists = data?.lists || [];
  const runFor = (key) => lastRun?.lists?.find((l) => l.key === key) || null;

  return (
    <div className="an-card">
      <SectionHead
        as="h3"
        title={
          <>
            <ListChecks
              size={18}
              aria-hidden="true"
              className="an-card-glyph"
            />
            Managed lists
          </>
        }
        meta={
          lists.length > 0 && (
            <Button
              size="sm"
              onClick={() => syncNow()}
              disabled={Boolean(busy)}
              aria-busy={busy === 'sync' || undefined}
            >
              {busy === 'sync' ? 'Syncing…' : 'Sync all now'}
            </Button>
          )
        }
      />
      {(error || actionError) && (
        <p className="gr-error" role="alert">
          {actionError || error}
        </p>
      )}
      {loading && !data && (
        <p className="an-empty">Reading your managed lists…</p>
      )}

      {lists.length > 0 && (
        <ul className="gr-lists">
          {lists.map((def) => (
            <ListCard
              key={def.key}
              def={def}
              run={runFor(def.key)}
              busy={busy}
              onSync={() => syncNow(def.key)}
              onEdit={() => setDraft({ ...def })}
              onToggle={() => toggle(def)}
              onRemove={(deleteList) => remove(def, deleteList)}
            />
          ))}
        </ul>
      )}
      {data && !lists.length && !draft && (
        <p className="an-empty">
          No managed lists yet. Start from one of these:
        </p>
      )}

      {!draft && (
        <div className="gr-presets" role="group" aria-label="New list">
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              onClick={() => setDraft({ ...p, key: undefined, preset: p.key })}
            >
              + {p.name}
            </Button>
          ))}
        </div>
      )}

      {draft && (
        <ListEditor
          agent={agent}
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null);
            await onReload();
          }}
        />
      )}

      <p className="an-note">
        Each list is a public Bluesky curation list in your account, rebuilt
        from its rule every six hours over a rolling window. A run writes at
        most {data?.maxWritesPerRun ?? 600} list changes and finishes the rest
        on the next one; current members keep their place against newcomers who
        only just edge past them, so a list doesn’t churn at its cutoff.
        Accounts on your moderation list are never added. These lists don’t
        count as curation for the moderation gate’s protected set unless you
        tick that on a list.
      </p>
    </div>
  );
}

function ListCard({ def, run, busy, onSync, onEdit, onToggle, onRemove }) {
  const href = listHref(def.listUri);
  const s = def.lastSync;
  const mine = (what) => busy === `${what}:${def.key}`;
  return (
    <li className={`gr-list${def.enabled ? '' : ' is-paused'}`}>
      <div className="gr-list-head">
        <span className="gr-list-name">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {def.name}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          ) : (
            def.name
          )}
        </span>
        <span className="gr-list-size">
          {def.members.toLocaleString('en-US')}
          <span className="gr-list-size-unit"> on the list</span>
        </span>
      </div>
      <p className="gr-list-rule">{describeRule(def)}</p>
      <p className="gr-list-status">
        {!def.enabled && <strong>Paused. </strong>}
        {s?.error ? (
          <span className="gr-error-inline">
            Last sync failed {relativeTime(s.at)}: {s.error}
          </span>
        ) : s?.at ? (
          <>
            Synced {relativeTime(s.at)}: +{s.added} −{s.removed}
            {s.pending > 0 &&
              `, ${s.pending.toLocaleString('en-US')} still to write`}
            {s.eligible != null &&
              ` · ${s.eligible.toLocaleString('en-US')} qualified`}
          </>
        ) : (
          'Not synced yet.'
        )}
        {def.protects && ' · Protects its members in moderation.'}
      </p>
      {def.history?.length > 1 && <SizeSpark history={def.history} />}
      {run &&
        !run.error &&
        (run.addedDids?.length > 0 || run.removedDids?.length > 0) && (
          <p className="gr-list-status">
            This run: {run.addedDids.length} joined, {run.removedDids.length}{' '}
            left.
          </p>
        )}
      <div className="gr-list-actions">
        <Button
          size="sm"
          onClick={onSync}
          disabled={Boolean(busy) || !def.listUri}
          aria-busy={mine('sync') || undefined}
        >
          {mine('sync') ? 'Syncing…' : 'Sync now'}
        </Button>
        <Button size="sm" onClick={onEdit} disabled={Boolean(busy)}>
          Edit
        </Button>
        <Button size="sm" onClick={onToggle} disabled={Boolean(busy)}>
          {def.enabled ? 'Pause' : 'Resume'}
        </Button>
        <Button
          size="sm"
          variant="text"
          onClick={() => onRemove(false)}
          disabled={Boolean(busy)}
        >
          Stop syncing
        </Button>
        <Button
          size="sm"
          variant="text"
          className="gr-danger"
          onClick={() => onRemove(true)}
          disabled={Boolean(busy)}
        >
          Delete list
        </Button>
      </div>
    </li>
  );
}

/** List size over the last runs, oldest left. A sparkline with its own label. */
function SizeSpark({ history }) {
  const pts = [...history].reverse().filter((h) => h.size != null);
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((p) => p.size), 1);
  const w = 120;
  const h = 24;
  const d = pts
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - (p.size / max) * h).toFixed(1)}`,
    )
    .join(' ');
  const first = pts[0];
  const last = pts[pts.length - 1];
  return (
    <p className="gr-spark">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
        <path d={d} />
      </svg>
      <span>
        {first.size} → {last.size} over the last {pts.length} syncs
      </span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Editor + preview                                                     */
/* ------------------------------------------------------------------ */

function NumberField({ label, value, min, max, onChange, hint }) {
  return (
    <label className="gr-field">
      <span className="gr-field-label">{label}</span>
      <input
        className="admin-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) =>
          onChange(e.target.value === '' ? '' : Number(e.target.value))
        }
      />
      {hint && <span className="gr-field-hint">{hint}</span>}
    </label>
  );
}

function ListEditor({ agent, draft, onChange, onCancel, onSaved }) {
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState({ busy: null, error: null });
  const def = normalizeDefinition(draft) || {};
  const family = LIST_KINDS[def.kind]?.family;
  const set = (patch) => {
    onChange({ ...draft, ...patch });
    setPreview(null);
  };

  async function go(what) {
    setState({ busy: what, error: null });
    try {
      if (what === 'preview') {
        setPreview(
          await graphLists(agent, {
            action: 'preview',
            definition: { ...draft, ...def },
          }),
        );
        setState({ busy: null, error: null });
      } else {
        await graphLists(agent, {
          action: 'save',
          definition: { ...draft, ...def },
        });
        setState({ busy: null, error: null });
        await onSaved();
      }
    } catch (err) {
      setState({ busy: null, error: err?.message || String(err) });
    }
  }

  const toggleKind = (k) => {
    const kinds = new Set(def.kinds);
    if (kinds.has(k)) kinds.delete(k);
    else kinds.add(k);
    set({ kinds: ENGAGEMENT_EVENT_KINDS.filter((x) => kinds.has(x)) });
  };

  return (
    <div className="gr-editor">
      <SectionHead
        as="h4"
        title={draft.key ? `Edit “${draft.name}”` : 'New list'}
        meta={LIST_KINDS[def.kind]?.label}
      />
      <div className="gr-fields">
        <label className="gr-field gr-field--wide">
          <span className="gr-field-label">Name</span>
          <input
            className="admin-input"
            maxLength={64}
            value={draft.name || ''}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className="gr-field gr-field--wide">
          <span className="gr-field-label">Description</span>
          <textarea
            className="admin-input"
            rows={2}
            maxLength={300}
            value={draft.description || ''}
            onChange={(e) => set({ description: e.target.value })}
          />
        </label>
        <NumberField
          label="Most members"
          value={draft.size ?? def.size}
          min={1}
          max={MAX_LIST_SIZE}
          onChange={(size) => set({ size })}
        />
        {family === 'engagement' && (
          <NumberField
            label="At least this many interactions"
            value={draft.minInteractions ?? def.minInteractions}
            min={1}
            max={1000}
            onChange={(minInteractions) => set({ minInteractions })}
            hint={`in the last ${def.windowDays} days`}
          />
        )}
        {family === 'proximity' && (
          <NumberField
            label="Followed by at least this many of your follows"
            value={draft.minVouches ?? def.minVouches}
            min={1}
            max={500}
            onChange={(minVouches) => set({ minVouches })}
            hint="3 is where the moderation gate draws CONNECTED"
          />
        )}
      </div>

      {family === 'engagement' && (
        <fieldset className="gr-kinds">
          <legend className="gr-field-label">Counts</legend>
          {ENGAGEMENT_EVENT_KINDS.filter(
            (k) => !(def.kind === 'engaged-out' && k === 'mention'),
          ).map((k) => (
            <label key={k} className="admin-checkbox">
              <input
                type="checkbox"
                checked={def.kinds.includes(k)}
                onChange={() => toggleKind(k)}
              />
              <span>{KIND_PLURAL[k]}</span>
            </label>
          ))}
          {def.kind === 'engaged-in' && (
            <span className="gr-field-hint">
              Replies and quotes include pile-ons. A list for people who like
              your work might count likes and reposts only.
            </span>
          )}
        </fieldset>
      )}

      <div className="gr-checks">
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={def.notFollowing}
            onChange={(e) => set({ notFollowing: e.target.checked })}
          />
          <span>Only people I don’t follow yet</span>
        </label>
        {family === 'proximity' && !def.notFollowing && (
          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={def.maxDegree === 1}
              onChange={(e) => set({ maxDegree: e.target.checked ? 1 : 2 })}
            />
            <span>1st degree only (people I follow)</span>
          </label>
        )}
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={def.protects}
            onChange={(e) => set({ protects: e.target.checked })}
          />
          <span>Members count as protected in the moderation gate</span>
        </label>
      </div>

      <p className="gr-list-rule">{describeRule(def)}</p>
      {state.error && (
        <p className="gr-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="gr-list-actions">
        <Button
          size="sm"
          onClick={() => go('preview')}
          disabled={Boolean(state.busy)}
          aria-busy={state.busy === 'preview' || undefined}
        >
          {state.busy === 'preview' ? 'Working it out…' : 'Preview'}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => go('save')}
          disabled={Boolean(state.busy) || !def.name}
        >
          {state.busy === 'save'
            ? 'Saving…'
            : draft.key
              ? 'Save'
              : 'Create list'}
        </Button>
        <Button
          size="sm"
          variant="text"
          onClick={onCancel}
          disabled={Boolean(state.busy)}
        >
          Cancel
        </Button>
      </div>
      {!draft.key && (
        <p className="an-card-caption">
          Creating makes the Bluesky list now and fills it on the next sync (or
          press Sync now).
        </p>
      )}
      {preview && <Preview result={preview} family={family} />}
    </div>
  );
}

function Preview({ result, family }) {
  const isNew = !result.definition.listUri;
  return (
    <div className="gr-preview">
      <p className="gr-preview-sum">
        Would hold <strong>{result.size.toLocaleString('en-US')}</strong> of{' '}
        {result.eligible.toLocaleString('en-US')} who qualify
        {!isNew && (
          <>
            {' '}
            · +{result.adds} −{result.removes} against the list as it stands
          </>
        )}
        .
      </p>
      <ol className="gr-people">
        {result.members.map((m) => (
          <PersonRow
            key={m.did}
            card={m}
            aside={
              family === 'engagement'
                ? `${m.total} ${m.total === 1 ? 'interaction' : 'interactions'}${m.onList ? '' : isNew ? '' : ' · new'}`
                : `${BAND_LABEL[m.band] || m.band}${m.onList || isNew ? '' : ' · new'}`
            }
          />
        ))}
      </ol>
      {result.size > result.members.length && (
        <p className="an-card-caption">
          Showing the first {result.members.length}.
        </p>
      )}
      {result.leaving?.length > 0 && (
        <>
          <SectionHead as="h4" title="Would leave" meta={result.removes} />
          <ol className="gr-people">
            {result.leaving.map((m) => (
              <PersonRow key={m.did} card={m} />
            ))}
          </ol>
        </>
      )}
      <Coverage coverage={result.coverage} />
    </div>
  );
}
