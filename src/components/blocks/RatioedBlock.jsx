import { useEffect, useMemo, useState } from 'react';
import {
  SEED_PIECES,
  SEED_PEOPLE,
  loadPieces,
  aggregate,
  splitParticipants,
  hiddenReplies,
  fetchLiveDeltas,
  fmtDuration,
  fmtSeconds,
  fmtElapsed,
} from '../../lib/ratioed.js';
import { resolvePds } from '../../lib/atproto.js';
import { ME_DID } from '../../config.js';
import './RatioedBlock.css';

const KINDS = ['reply', 'repost', 'quote', 'like'];
const KIND_LABEL = { reply: 'reply', repost: 'repost', quote: 'quote', like: 'like' };
const ABBR = { reply: 'reply', repost: 'RT', quote: 'QT', like: '♥' };

// The measured reaction window, in seconds. Every deleted like landed inside
// it, so the ghost markers are drawn across exactly this band.
const REACTION_LO = 10;
const REACTION_HI = 17;

/**
 * Ratioed data visualisation. Six variants share one data load:
 *
 *   summary      — the project in six figures
 *   lifelines    — every backlink plotted against time, threadgate as a hard rule
 *   reaction     — how long the artist took to close each piece by hand
 *   ledger       — engagement before and after the seal, per piece
 *   hidden       — the replies that landed after the seal and can't be seen
 *   participants — everyone who touched a piece
 *
 * Pieces come from the PDS when reachable and from the bundled seed otherwise.
 * The event log is a separate ~27kB chunk, loaded only by the two variants that
 * need it, so the other four never pay for it.
 */
export default function RatioedBlock({ block, style }) {
  const variant = block?.variant || 'lifelines';
  const [pieces, setPieces] = useState(SEED_PIECES);
  const [events, setEvents] = useState(null);
  const [deltas, setDeltas] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const pds = await resolvePds(ME_DID).catch(() => null);
      const fresh = await loadPieces(pds);
      if (alive && fresh?.length) setPieces(fresh);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (variant !== 'lifelines' && variant !== 'hidden') return undefined;
    let alive = true;
    import('../../data/ratioedEvents.json')
      .then((m) => {
        if (alive) setEvents(m.default || m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [variant]);

  useEffect(() => {
    if (!block?.showLive || !pieces?.length) return undefined;
    let alive = true;
    fetchLiveDeltas(pieces).then((d) => {
      if (alive) setDeltas(d);
    });
    return () => {
      alive = false;
    };
  }, [block?.showLive, pieces]);

  const stats = useMemo(() => aggregate(pieces), [pieces]);

  return (
    <figure className={`ratioed ratioed-${variant}`} style={style || undefined}>
      {variant === 'summary' && <Summary stats={stats} />}
      {variant === 'lifelines' && (
        <Lifelines pieces={pieces} events={events} stats={stats} deltas={deltas} />
      )}
      {variant === 'reaction' && <Reaction pieces={pieces} stats={stats} />}
      {variant === 'ledger' && <Ledger pieces={pieces} deltas={deltas} />}
      {variant === 'hidden' && <Hidden pieces={pieces} events={events} />}
      {variant === 'participants' && <Participants />}
      {block?.alt && <figcaption className="ratioed-alt">{block.alt}</figcaption>}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Summary                                                              */
/* ------------------------------------------------------------------ */

function Summary({ stats }) {
  const { total, living } = splitParticipants();
  const tiles = [
    [String(stats.count), null, 'pieces'],
    [String(Math.round(stats.aliveMs / 60000)), 'min', 'total time alive'],
    [String(total), null, 'people involved'],
    [String(stats.nonLike), `:${stats.likes}`, 'engagement vs. likes, alive'],
    [fmtSeconds(stats.meanReactionMs).replace('s', ''), 's', 'mean reaction to a like'],
    [String(stats.deleted), `/${stats.count}`, 'breakers who deleted the like'],
  ];
  return (
    <div className="ratioed-summary">
      <div className="ratioed-tiles">
        {tiles.map(([v, suffix, label]) => (
          <div className="ratioed-tile" key={label}>
            <span className="ratioed-tile-v">
              {v}
              {suffix && <small>{suffix}</small>}
            </span>
            <span className="ratioed-tile-l">{label}</span>
          </div>
        ))}
      </div>
      <p className="ratioed-note">
        {living} of those {total} showed up while a piece was still alive. The rest only ever
        touched one that was already finished.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hidden replies                                                       */
/* ------------------------------------------------------------------ */

function Hidden({ pieces, events }) {
  const rows = useMemo(() => hiddenReplies(events, pieces), [events, pieces]);
  if (!events) return <p className="ratioed-note">Loading the event log…</p>;
  if (!rows.length) return <p className="ratioed-note">No replies landed after a seal.</p>;
  return (
    <div className="ratioed-hidden-list">
      {rows.map((r, i) => (
        <div className="ratioed-hidden-row" key={`${r.rkey}-${i}`}>
          <div className="ratioed-hidden-when">
            +{Math.round(r.afterSec)}s
            <em>take {String(r.take).padStart(2, '0')}</em>
          </div>
          <div>
            <blockquote className="ratioed-hidden-text">{r.t || '(image, no text)'}</blockquote>
            <div className="ratioed-hidden-attr">
              @{r.h} · {r.n ? 'nested reply' : 'reply to the sealed post'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Participants                                                         */
/* ------------------------------------------------------------------ */

/** Every piece someone touched, each listed once, in order. */
function pieceList(person) {
  return [...new Set([...person.pre, ...person.post])]
    .sort((a, b) => a - b)
    .map((n) => String(n).padStart(2, '0'))
    .join(' ');
}

const PEOPLE_COLUMNS = [
  { key: 'h', label: 'Handle' },
  { key: 'ev', label: 'Events', num: true },
  { key: 'live', label: 'Live', num: true },
  { key: 'after', label: 'After', num: true },
];

function Participants() {
  const [query, setQuery] = useState('');
  const [livingOnly, setLivingOnly] = useState(false);
  const [sort, setSort] = useState('ev');
  const [dir, setDir] = useState(-1);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = SEED_PEOPLE.map((p) => ({ ...p, live: p.pre.length, after: p.post.length }));
    if (q) list = list.filter((p) => p.h.toLowerCase().includes(q) || (p.dn || '').toLowerCase().includes(q));
    if (livingOnly) list = list.filter((p) => p.live > 0);
    const key = sort;
    return list.sort((a, b) => {
      const A = a[key];
      const B = b[key];
      const cmp = typeof A === 'string' ? A.localeCompare(B) * -1 : A - B;
      return cmp * dir || b.ev - a.ev;
    });
  }, [query, livingOnly, sort, dir]);

  const toggleSort = (key) => {
    if (sort === key) setDir(-dir);
    else {
      setSort(key);
      setDir(key === 'h' ? 1 : -1);
    }
  };

  return (
    <div className="ratioed-participants">
      <div className="ratioed-controls">
        <input
          className="ratioed-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter by handle…"
          aria-label="Filter participants"
        />
        <div className="ratioed-chips">
          <button
            type="button"
            className="ratioed-chip"
            aria-pressed={livingOnly}
            onClick={() => setLivingOnly(!livingOnly)}
          >
            <span className="ratioed-sw" aria-hidden="true" />
            only living participation
          </button>
        </div>
      </div>
      <div className="ratioed-tablewrap">
        <table className="ratioed-table">
          <thead>
            <tr>
              {PEOPLE_COLUMNS.map((c) => (
                <th key={c.key} className={c.num ? 'num' : undefined}>
                  <button
                    type="button"
                    className="ratioed-sort"
                    aria-pressed={sort === c.key}
                    onClick={() => toggleSort(c.key)}
                  >
                    {c.label}
                    {sort === c.key && <span aria-hidden="true">{dir === 1 ? ' ↑' : ' ↓'}</span>}
                  </button>
                </th>
              ))}
              <th>Pieces</th>
              <th>Mix</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.did}>
                <td>
                  @{p.h}
                  {p.dn && <span className="ratioed-people-dn">{p.dn}</span>}
                </td>
                <td className="num">{p.ev}</td>
                <td className="num">{p.live || '·'}</td>
                <td className="num">{p.after || '·'}</td>
                <td>{pieceList(p)}</td>
                <td>
                  {KINDS.filter((k) => p.kinds[k]).map((k) => (
                    <span className={`ratioed-k-${k}`} key={k}>
                      {ABBR[k]}×{p.kinds[k]}{' '}
                    </span>
                  ))}
                </td>
                <td>
                  {p.broke ? (
                    <span className="ratioed-tag broke">broke #{String(p.broke).padStart(2, '0')}</span>
                  ) : p.live ? (
                    <span className="ratioed-tag live">participant</span>
                  ) : (
                    <span className="ratioed-tag">after the fact</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ratioed-note">
        Counted by DID, not handle — two deactivated accounts share one placeholder handle.
        Four of the eleven breakers are missing entirely: their only act was a like they later
        deleted, so they left nothing to count.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lifelines                                                            */
/* ------------------------------------------------------------------ */

// Log scale for the afterlife gutter: seconds → years in ~130px. Capped below
// 1 so the widest marker never overhangs the column edge.
const aftPos = (sec, maxSec) =>
  0.93 * (Math.log10(Math.max(sec, 1) + 1) / Math.log10(maxSec + 1));

function Lifelines({ pieces, events, stats, deltas }) {
  const [scale, setScale] = useState('true');
  const [on, setOn] = useState(() => new Set(KINDS));
  const [query, setQuery] = useState('');
  const [openTake, setOpenTake] = useState(null);

  const maxLife = stats.maxLifespanMs / 1000 || 1;
  const maxAft = useMemo(() => {
    if (!events) return 1;
    let m = 1;
    for (const p of pieces) {
      for (const e of events[p.rkey] || []) {
        if (!e.pre && !e.self) m = Math.max(m, e.off - p.lifespanMs / 1000);
      }
    }
    return m;
  }, [events, pieces]);

  const q = query.trim().toLowerCase();

  return (
    <div className="ratioed-lifelines">
      <div className="ratioed-controls">
        <div className="ratioed-seg" role="group" aria-label="Time scale">
          {[
            ['true', 'True'],
            ['norm', 'Stretched'],
          ].map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={scale === v}
              onClick={() => setScale(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ratioed-chips">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`ratioed-chip ratioed-k-${k}`}
              aria-pressed={on.has(k)}
              onClick={() => {
                const next = new Set(on);
                if (next.has(k)) next.delete(k);
                else next.add(k);
                setOn(next);
              }}
            >
              <span className="ratioed-sw" aria-hidden="true" />
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <input
          className="ratioed-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="find a handle…"
          aria-label="Highlight a participant across every piece"
        />
      </div>

      <div className="ratioed-axis">
        <div />
        <div className="ratioed-a2">
          <span className="ratioed-hd">
            {scale === 'true' ? `alive · 0 → ${fmtDuration(stats.maxLifespanMs)}` : 'alive · each row to its own scale'}
          </span>
          {(scale === 'true'
            ? [0, 300, 600, 900, 1200, 1500].map((t) => [t / maxLife, t ? fmtDuration(t * 1000) : '0'])
            : [[0, '0'], [0.25, '¼'], [0.5, '½'], [0.75, '¾'], [1, 'seal']]
          ).map(([pos, label], i, arr) => (
            <span
              key={label}
              className={`ratioed-tick${i === 0 ? ' first' : i === arr.length - 1 && scale !== 'true' ? ' last' : ''}`}
              style={{ left: `${pos * 100}%` }}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="ratioed-a3">
          <span className="ratioed-hd">after the seal</span>
          {[[60, '1m'], [3600, '1h'], [86400, '1d'], [86400 * 365, '1y']].map(([s, l], i) => (
            <span
              key={l}
              className={`ratioed-tick${i === 3 ? ' last' : ''}`}
              style={{ left: `${aftPos(s, maxAft) * 100}%` }}
            >
              {l}
            </span>
          ))}
        </div>
      </div>

      <div className="ratioed-rows">
        {pieces.map((p) => {
          const life = p.lifespanMs / 1000 || 1;
          const pct = scale === 'true' ? (life / maxLife) * 100 : 100;
          const list = events?.[p.rkey] || [];
          const open = openTake === p.take;
          const ghost = p.breaker?.likeSurvives === false;
          return (
            <div className={`ratioed-row${open ? ' open' : ''}`} key={p.rkey}>
              <button
                type="button"
                className="ratioed-rowmain"
                aria-expanded={open}
                onClick={() => setOpenTake(open ? null : p.take)}
              >
                <span className="ratioed-lab">
                  <span className="ratioed-take">{String(p.take).padStart(2, '0')}</span>
                  <span className="ratioed-labmeta">
                    <span className="ratioed-life">{fmtDuration(p.lifespanMs)}</span>
                    <span className="ratioed-date">{(p.postedAt || '').slice(0, 10)}</span>
                  </span>
                </span>
                <span className="ratioed-track">
                  <span className="ratioed-bar" style={{ width: `${pct}%` }} />
                  {ghost && (
                    <span
                      className="ratioed-ghost"
                      title="inferred window for the deleted like"
                      style={{
                        left: `${((life - REACTION_HI) / life) * pct}%`,
                        width: `${Math.max(((REACTION_HI - REACTION_LO) / life) * pct, 0.9)}%`,
                      }}
                    />
                  )}
                  {list
                    .filter((e) => e.pre && !e.self)
                    .map((e, i) => (
                      <Dot
                        key={i}
                        e={e}
                        piece={p}
                        left={(e.off / life) * pct}
                        dim={!on.has(e.k) || (!!q && !e.h.toLowerCase().includes(q))}
                      />
                    ))}
                </span>
                <span className="ratioed-gut">
                  <span className="ratioed-bar ratioed-bar-aft" style={{ width: '100%' }} />
                  {list
                    .filter((e) => !e.pre && !e.self)
                    .map((e, i) => (
                      <Dot
                        key={i}
                        e={e}
                        piece={p}
                        left={aftPos(e.off - life, maxAft) * 100}
                        dim={!on.has(e.k) || (!!q && !e.h.toLowerCase().includes(q))}
                      />
                    ))}
                </span>
              </button>
              {open && <PieceDetail piece={p} delta={deltas?.[p.rkey]} />}
            </div>
          );
        })}
      </div>

      <p className="ratioed-legend">
        {KINDS.map((k) => (
          <span key={k}>
            <i className={`ratioed-key ratioed-k-${k}`} aria-hidden="true" />
            {KIND_LABEL[k]}
          </span>
        ))}
        <span>
          <i className="ratioed-key ratioed-key-ghost" aria-hidden="true" />
          deleted like, inferred window
        </span>
      </p>
    </div>
  );
}

function Dot({ e, piece, left, dim }) {
  const life = piece.lifespanMs / 1000;
  const when = e.pre
    ? `+${fmtDuration(e.off * 1000)} — alive`
    : `+${fmtElapsed(e.off - life)} after the seal`;
  const title = `${KIND_LABEL[e.k]}${e.n ? ' (nested)' : ''} · @${e.h} · ${when}${e.t ? `\n${e.t}` : ''}`;
  return (
    <span
      className={`ratioed-dot ratioed-k-${e.k}${e.self ? ' self' : ''}${dim ? ' dim' : ''}`}
      style={{ left: `${left}%` }}
      title={title}
    />
  );
}

function PieceDetail({ piece, delta }) {
  const b = piece.breaker || {};
  return (
    <div className="ratioed-detail">
      <div className="ratioed-detail-grid">
        <div className="ratioed-card ratioed-card-kill">
          <h4>Cause of death</h4>
          <p className="ratioed-breaker">
            @{b.handle}
            {b.currentHandle && <span className="ratioed-pill">now @{b.currentHandle}</span>}
          </p>
          <dl className="ratioed-kv">
            <dt>sealed</dt>
            <dd>{fmtDuration(piece.lifespanMs)} after posting</dd>
            <dt>reaction</dt>
            <dd className={b.likeSurvives ? 'hot' : ''}>
              {typeof b.reactionMs === 'number'
                ? fmtSeconds(b.reactionMs)
                : `unmeasurable — like deleted`}
            </dd>
            <dt>announced</dt>
            <dd>
              {typeof piece.announceLagMs === 'number'
                ? `${Math.round(piece.announceLagMs / 1000)}s after the gate`
                : '—'}
            </dd>
          </dl>
        </div>
        <div className="ratioed-card">
          <h4>While alive · {piece.preSeal.participants} participants</h4>
          <Mix m={piece.preSeal} />
          <h4 className="ratioed-h4-gap">After the seal · {piece.postSeal.participants} actors</h4>
          <Mix m={piece.postSeal} />
          {delta && delta.total > 0 && (
            <p className="ratioed-delta">+{delta.total} since measured</p>
          )}
          {piece.statedTally && (
            <>
              <h4 className="ratioed-h4-gap">Counted at announcement</h4>
              <p className="ratioed-stated">{piece.statedTally}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Mix({ m }) {
  return (
    <p className="ratioed-mix">
      {KINDS.map((k) => {
        const key = k === 'reply' ? 'threadPosts' : `${k}s`;
        const n = m[key] || 0;
        const noun = k === 'reply' ? 'thread post' : KIND_LABEL[k];
        return (
          <span key={k} className={`ratioed-k-${k}`}>
            <b>{n}</b> {n === 1 ? noun : `${noun}s`}
          </span>
        );
      })}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Reaction                                                             */
/* ------------------------------------------------------------------ */

function Reaction({ pieces, stats }) {
  const MAX = 20000;
  // Chronological, not fastest-first: the point of this chart is that the
  // reaction time holds steady across thirteen months and wildly different
  // lifespans. Sorting by duration would hide exactly that.
  const rows = [...pieces].sort((a, b) => a.take - b.take);
  return (
    <div className="ratioed-reaction">
      {rows.map((p) => {
        const ms = p.breaker?.reactionMs;
        const inferred = typeof ms !== 'number';
        const lo = (REACTION_LO * 1000) / MAX;
        const hi = (REACTION_HI * 1000) / MAX;
        return (
          <div className={`ratioed-react${inferred ? ' inferred' : ''}`} key={p.rkey}>
            <span className="ratioed-react-n">
              #{String(p.take).padStart(2, '0')}{' '}
              <span className="ratioed-react-who">@{(p.breaker?.handle || '').split('.')[0]}</span>
            </span>
            <span className="ratioed-react-bar">
              <span
                className="ratioed-react-fill"
                style={{
                  left: inferred ? `${lo * 100}%` : 0,
                  width: `${(inferred ? hi - lo : ms / MAX) * 100}%`,
                }}
              />
            </span>
            <span className="ratioed-react-v">
              {inferred ? `${REACTION_LO}–${REACTION_HI}s` : fmtSeconds(ms)}
            </span>
          </div>
        );
      })}
      <p className="ratioed-note">
        Mean of the {stats.measured} still on the network: {fmtSeconds(stats.meanReactionMs)}, range{' '}
        {fmtSeconds(stats.minReactionMs)}–{fmtSeconds(stats.maxReactionMs)}, with no relationship to
        how long the piece had been up. The other {stats.deleted} were deleted by the people who cast
        them; those bars are the inferred window.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

function Ledger({ pieces, deltas }) {
  return (
    <div className="ratioed-tablewrap">
      <table className="ratioed-table">
        <thead>
          <tr>
            <th>Piece</th>
            <th>Alive for</th>
            <th className="num" colSpan={5}>
              While alive
            </th>
            <th className="num ratioed-div" colSpan={5}>
              After the seal
            </th>
          </tr>
          <tr className="ratioed-subhead">
            <th />
            <th />
            {['♥', 'RT', 'QT', 'thread', 'people'].map((h) => (
              <th className="num" key={`pre-${h}`}>
                {h}
              </th>
            ))}
            {['♥', 'RT', 'QT', 'thread', 'people'].map((h, i) => (
              <th className={`num${i === 0 ? ' ratioed-div' : ''}`} key={`post-${h}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pieces.map((p) => {
            const d = deltas?.[p.rkey];
            return (
              <tr key={p.rkey}>
                <td>
                  <b>#{String(p.take).padStart(2, '0')}</b>{' '}
                  <span className="ratioed-pill">{(p.postedAt || '').slice(0, 10)}</span>
                </td>
                <td>{fmtDuration(p.lifespanMs)}</td>
                {['likes', 'reposts', 'quotes', 'threadPosts', 'participants'].map((k) => (
                  <td className="num" key={`pre-${k}`}>
                    {p.preSeal[k] || '·'}
                  </td>
                ))}
                {['likes', 'reposts', 'quotes', 'threadPosts', 'participants'].map((k, i) => (
                  <td className={`num${i === 0 ? ' ratioed-div' : ''}`} key={`post-${k}`}>
                    {p.postSeal[k] || '·'}
                    {d && d[k] > 0 && <span className="ratioed-since">+{d[k]}</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
