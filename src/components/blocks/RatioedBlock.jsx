import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  SEED_PIECES,
  SEED_PEOPLE,
  loadPieces,
  livingRoster,
  loadPeople,
  roleOf,
  aggregate,
  splitParticipants,
  hiddenReplies,
  fetchLiveDeltas,
  whenMarks,
  areaRadius,
  piecePath,
  WEEKDAYS,
  fmtDuration,
  fmtSeconds,
  fmtElapsed,
} from '../../lib/ratioed.js';
import { resolvePds } from '../../lib/atproto.js';
import { paletteForHour } from '../../lib/skyTheme.js';
import { ratioedScaleVars } from '../../lib/ratioedPalette.js';
import { useTheme } from '../../hooks/useTheme.jsx';
import { ME_DID } from '../../config.js';
import './RatioedBlock.css';

const KINDS = ['reply', 'repost', 'quote', 'like'];
// Variants that need the per-record event log — a separate ~27kB chunk, so the
// ones that only read counts never pay for it. Participants is here because a
// person's role turns on WHEN they acted, which only the log knows.
const EVENT_VARIANTS = new Set(['lifelines', 'hidden', 'participants']);
const KIND_LABEL = { reply: 'reply', repost: 'repost', quote: 'quote', like: 'like' };
const ABBR = { reply: 'reply', repost: 'RT', quote: 'QT', like: '♥' };

// The measured reaction window, in seconds. Every deleted like landed inside
// it, so the ghost markers are drawn across exactly this band.
const REACTION_LO = 10;
const REACTION_HI = 17;

/**
 * What each chart says about itself when the block carries no caption of its
 * own. Functions rather than strings so a default can quote the data it is
 * describing; an authored caption replaces the whole thing.
 */
const DEFAULT_CAPTIONS = {
  summary: ({ people }) =>
    `${people.living} of those ${people.total} showed up while a piece was still alive. The rest only ever touched one that was already finished.`,
  lifelines: () =>
    'Every record pointing at a piece, plotted against the seconds it arrived after the piece went up. The rule is the threadgate; everything right of it happened to a post that was already finished.',
  reaction: ({ stats }) =>
    `Mean of the ${stats.measured} still on the network: ${fmtSeconds(stats.meanReactionMs)}, range ${fmtSeconds(stats.minReactionMs)}–${fmtSeconds(stats.maxReactionMs)}, with no relationship to how long the piece had been up. The other ${stats.deleted} likes were deleted by the people who cast them, so those reactions can't be measured at all: the solid part of those bars runs to the fastest reaction ever recorded, and the hatched part is the window the like must have fallen in.`,
  ledger: () =>
    'Engagement either side of the seal. Everything right of the second rule arrived at a post that was already finished — pieces keep accruing it indefinitely.',
  hidden: () =>
    'A threadgate hides replies at the appview; it does not stop the records being written. These landed in the seconds after their piece sealed, and no reader of the thread has ever seen them.',
  participants: ({ people, roster }) =>
    `The ${roster.rows.length} accounts that were there while a piece was still alive, all ${roster.breakers} breakers among them. ${roster.deleted} of those breakers deleted the like they cast, which leaves it in no index at all — the reply concluding their piece is the only record it happened, and it's marked as such rather than counted. Each role names the most consequential thing someone did while the piece was still alive, so it can differ from the mix beside it, which counts everything they ever did, whenever they did it. The ${people.afterOnly} accounts that only ever reached a finished piece aren't here. Counted by DID, not handle: two deactivated accounts share one placeholder handle.`,
  when: () =>
    'Every piece placed by the clock it was made on, in Eastern time — the same zone the rest of this site runs on. The solid core is how long a piece stayed alive; the ring around it is how much it drew while it was. Both are scaled by area, so a mark twice the size means twice the quantity, not four times. The strip beside the grid is each hour’s own sky colour. Every mark names itself on hover.',
};

/**
 * Ratioed data visualisation. Six variants share one data load:
 *
 *   summary      — the project in six figures
 *   lifelines    — every backlink plotted against time, threadgate as a hard rule
 *   reaction     — how long the artist took to close each piece by hand
 *   ledger       — engagement before and after the seal, per piece
 *   hidden       — the replies that landed after the seal and can't be seen
 *   participants — everyone who touched a piece
 *   when         — where the pieces fall across a week, sized by scale
 *
 * Pieces come from the PDS when reachable and from the bundled seed otherwise.
 * The event log is a separate ~27kB chunk, loaded only by the two variants that
 * need it, so the other four never pay for it.
 */
export default function RatioedBlock({ block, style }) {
  const variant = block?.variant || 'lifelines';
  // A piece page hangs off whichever address the essay was reached at — its
  // human path or its record key, both of which resolve. Linking through the
  // reader's own address rather than the configured one means the links are
  // right even before the document's `path` and RATIOED_PATH agree, and it
  // keeps a reader who arrived by record key from being bounced to the other
  // form mid-read. The canonical tag still names one of them; that's its job,
  // not this link's. Empty outside a slug route (the admin's block preview),
  // where the configured path is the only sensible answer.
  const { slug: parentSlug } = useParams();
  const [pieces, setPieces] = useState(SEED_PIECES);
  const [people, setPeople] = useState(SEED_PEOPLE);
  const [events, setEvents] = useState(null);
  const [deltas, setDeltas] = useState(null);

  // The roster the build regenerated, which knows about pieces added since the
  // bundle was harvested. Falls back to the bundle it was built from.
  useEffect(() => {
    let alive = true;
    loadPeople().then((fresh) => {
      if (alive && fresh?.length) setPeople(fresh);
    });
    return () => {
      alive = false;
    };
  }, []);

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
    if (!EVENT_VARIANTS.has(variant)) return undefined;
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

  // A piece measured by the admin panel records its own event log; the first
  // eleven predate the field and come from the bundled one. Keyed by rkey, so
  // the two merge without either knowing about the other — and without a new
  // piece plotting as an empty row while it waits for the next build.
  const eventLog = useMemo(() => {
    if (!events && !pieces.some((p) => p.events)) return null;
    const merged = { ...(events || {}) };
    for (const p of pieces) if (p.events) merged[p.rkey] = p.events;
    return merged;
  }, [events, pieces]);

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

  // The categorical scale is derived from whatever hour the sky is showing, so
  // it re-derives whenever the hour ticks over or is previewed in the studio.
  const { skyDisplayHour } = useTheme();
  const scale = useMemo(() => ratioedScaleVars(skyDisplayHour), [skyDisplayHour]);

  const split = useMemo(() => splitParticipants(people), [people]);
  const roster = useMemo(() => livingRoster(pieces, people, eventLog), [pieces, people, eventLog]);
  const fallback = DEFAULT_CAPTIONS[variant];
  const caption =
    block?.caption?.trim() || (fallback ? fallback({ stats, people: split, roster }) : '');
  const showCaption = block?.showCaption !== false && Boolean(caption);

  return (
    <figure
      className={`ratioed ratioed-${variant}`}
      style={{ ...scale, ...(style || {}) }}
      aria-label={block?.alt || undefined}
    >
      {variant === 'summary' && <Summary stats={stats} people={split} />}
      {variant === 'lifelines' && (
        <Lifelines pieces={pieces} events={eventLog} stats={stats} deltas={deltas} parent={parentSlug} />
      )}
      {variant === 'reaction' && <Reaction pieces={pieces} />}
      {variant === 'ledger' && <Ledger pieces={pieces} deltas={deltas} parent={parentSlug} />}
      {variant === 'hidden' && <Hidden pieces={pieces} events={eventLog} />}
      {variant === 'participants' && <Participants rows={roster.rows} />}
      {variant === 'when' && <When pieces={pieces} />}
      {showCaption && <figcaption className="ratioed-caption">{caption}</figcaption>}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* When — day of week x time of day                                     */
/* ------------------------------------------------------------------ */

// Two layouts, same data. A 7-by-24 grid wants its long axis across the screen
// on a desktop and down it on a phone, so the narrow build transposes rather
// than shrinking: days become columns, hours become rows. Sideways scrolling a
// chart is worse than turning it.
const WIDE = {
  w: 720, padL: 42, padR: 14, ribbon: 11, gridStart: 40, cell: 30,
};
const TALL = {
  w: 330, padL: 40, padR: 10, ribbon: 9, gridStart: 30, cell: 19,
};

// A piece's mark is a solid core sized by how long it lived, wrapped in a halo
// sized by how much it drew. The halo is drawn OUTSIDE the core rather than as
// a competing circle, so a long quiet piece can never swallow its own ring.
const CORE_MIN = 2.5;
const CORE_MAX = 9;
const HALO_MAX = 7;

// Where the wide build stops being comfortable rather than where it stops
// fitting. Its viewBox is 720 units, so below roughly this width the browser
// scales the whole thing — labels included — down past legibility. The tall
// build has no such floor: it gets taller, not smaller.
const NARROW_QUERY = '(max-width: 44rem)';

/** Live viewport test, so the chart flips orientation on rotate or resize. */
function useNarrow(query) {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const on = (e) => setNarrow(e.matches);
    setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

const hourLabel = (h) =>
  h === 0 || h === 24 ? '12am' : h === 12 ? 'noon' : `${h % 12}${h < 12 ? 'am' : 'pm'}`;

function markTitle(m) {
  return `Take ${m.take} · ${WEEKDAYS[m.day]} ${String(m.hour).padStart(2, '0')}:${String(
    m.minute,
  ).padStart(2, '0')} · alive ${fmtDuration(m.lifespanMs)} · ${m.engagement} events from ${
    m.participants
  } people`;
}

function Marks({ sized, cx, cy }) {
  return sized.map((m) => (
    <g key={m.rkey} className="ratioed-when-mark">
      <title>{markTitle(m)}</title>
      {m.halo > 0.2 && <circle cx={cx(m)} cy={cy(m)} r={m.outer} className="ratioed-when-halo" />}
      <circle cx={cx(m)} cy={cy(m)} r={m.core} className="ratioed-when-core" />
    </g>
  ));
}

function When({ pieces }) {
  const marks = useMemo(() => whenMarks(pieces), [pieces]);
  const narrow = useNarrow(NARROW_QUERY);
  const maxLife = Math.max(1, ...marks.map((m) => m.lifespanMs));
  const maxEng = Math.max(1, ...marks.map((m) => m.engagement));

  const sized = marks
    .map((m) => {
      const core = areaRadius(m.lifespanMs, maxLife, CORE_MIN, CORE_MAX);
      const halo = areaRadius(m.engagement, maxEng, 0, HALO_MAX);
      return { ...m, core, halo, outer: core + halo };
    })
    // Biggest first so the small marks land on top of the large ones and stay
    // findable where pieces minutes apart overlap.
    .sort((a, b) => b.outer - a.outer);

  const label =
    'Every piece placed by day of week and time of day, sized by how long it lived and how much it drew.';

  return (
    <div className="ratioed-when">
      {narrow ? (
        <WhenTall sized={sized} label={label} />
      ) : (
        <WhenWide sized={sized} label={label} />
      )}

      {/* A scale key, since the whole point of sizing the marks is reading
          magnitude off them. Shows the actual extremes in the data. */}
      <div className="ratioed-when-key">
        <span>
          <SampleMark core={CORE_MIN} halo={0} />
          {fmtDuration(Math.min(...marks.map((m) => m.lifespanMs)))}
          <i>shortest</i>
        </span>
        <span>
          <SampleMark core={CORE_MAX} halo={0} />
          {fmtDuration(maxLife)}
          <i>longest</i>
        </span>
        <span>
          <SampleMark core={CORE_MIN} halo={HALO_MAX} />
          {maxEng} events
          <i>busiest</i>
        </span>
      </div>

    </div>
  );
}

/* --- wide: hours across, days down --------------------------------- */

function WhenWide({ sized, label }) {
  const { w, padL, padR, ribbon, gridStart, cell } = WIDE;
  const plotW = w - padL - padR;
  const h = gridStart + WEEKDAYS.length * cell + 8;
  const x = (atHour) => padL + (atHour / 24) * plotW;
  const y = (day) => gridStart + day * cell + cell / 2;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="ratioed-when-svg" role="img" aria-label={label}>
      {/* The hour axis is an actual strip of sky: each hour filled with that
          hour's colour from the site's palette, so night and midday read
          without a legend. */}
      {Array.from({ length: 24 }, (_, i) => (
        <rect key={`sky-${i}`} x={x(i)} y={0} width={plotW / 24 + 0.5} height={ribbon}
          fill={paletteForHour(i).vars['--sky-page']} />
      ))}
      <rect x={padL} y={0} width={plotW} height={ribbon} className="ratioed-when-ribbon-edge" />
      {[0, 6, 12, 18, 24].map((hr) => (
        <text key={`hl-${hr}`} x={x(hr)} y={ribbon + 14} className="ratioed-when-hour"
          textAnchor={hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle'}>
          {hourLabel(hr)}
        </text>
      ))}
      {WEEKDAYS.map((d, i) => (
        <g key={d}>
          <line x1={padL} x2={w - padR} y1={gridStart + i * cell} y2={gridStart + i * cell}
            className="ratioed-when-rule" />
          <text x={padL - 10} y={y(i) + 3} className="ratioed-when-day" textAnchor="end">{d}</text>
        </g>
      ))}
      <line x1={padL} x2={w - padR} y1={gridStart + WEEKDAYS.length * cell}
        y2={gridStart + WEEKDAYS.length * cell} className="ratioed-when-rule" />
      {[6, 12, 18].map((hr) => (
        <line key={`v-${hr}`} x1={x(hr)} x2={x(hr)} y1={gridStart}
          y2={gridStart + WEEKDAYS.length * cell} className="ratioed-when-rule" />
      ))}
      <Marks sized={sized} cx={(m) => x(m.atHour)} cy={(m) => y(m.day)} />
    </svg>
  );
}

/* --- tall: days across, hours down --------------------------------- */

function WhenTall({ sized, label }) {
  const { w, padL, padR, ribbon, gridStart, cell } = TALL;
  const plotW = w - padL - padR;
  const h = gridStart + 24 * cell + 6;
  const colW = plotW / WEEKDAYS.length;
  const x = (day) => padL + day * colW + colW / 2;
  const y = (atHour) => gridStart + (atHour / 24) * (24 * cell);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="ratioed-when-svg" role="img" aria-label={label}>
      {/* Transposed, the sky becomes a column running down the side — which is
          the more literal reading of it: the day falling past the chart. */}
      {Array.from({ length: 24 }, (_, i) => (
        <rect key={`sky-${i}`} x={padL - ribbon - 5} y={y(i)} width={ribbon} height={cell + 0.5}
          fill={paletteForHour(i).vars['--sky-page']} />
      ))}
      <rect x={padL - ribbon - 5} y={gridStart} width={ribbon} height={24 * cell}
        className="ratioed-when-ribbon-edge" />

      {WEEKDAYS.map((d, i) => (
        <text key={d} x={x(i)} y={gridStart - 9} className="ratioed-when-day" textAnchor="middle">
          {d}
        </text>
      ))}
      {/* Labelling all 24 hours at this row height would collide, so every
          sixth — the ribbon carries the rest. */}
      {[0, 6, 12, 18].map((hr) => (
        <g key={`hr-${hr}`}>
          <line x1={padL} x2={w - padR} y1={y(hr)} y2={y(hr)} className="ratioed-when-rule" />
          <text x={padL - ribbon - 10} y={y(hr) + 8} className="ratioed-when-hour" textAnchor="end">
            {hourLabel(hr)}
          </text>
        </g>
      ))}
      <line x1={padL} x2={w - padR} y1={y(24)} y2={y(24)} className="ratioed-when-rule" />
      {WEEKDAYS.map((d, i) =>
        i === 0 ? null : (
          <line key={`c-${d}`} x1={padL + i * colW} x2={padL + i * colW} y1={gridStart} y2={y(24)}
            className="ratioed-when-rule" />
        ),
      )}
      <Marks sized={sized} cx={(m) => x(m.day)} cy={(m) => y(m.atHour)} />
    </svg>
  );
}

/** One mark at a given size, for the scale key. */
function SampleMark({ core, halo }) {
  const r = core + halo;
  const box = (CORE_MAX + HALO_MAX) * 2 + 2;
  return (
    <svg className="ratioed-when-sample" viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
      {halo > 0 && <circle cx={box / 2} cy={box / 2} r={r} className="ratioed-when-halo" />}
      <circle cx={box / 2} cy={box / 2} r={core} className="ratioed-when-core" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Summary                                                              */
/* ------------------------------------------------------------------ */

function Summary({ stats, people }) {
  // The roster the block loaded, not the bundled one — otherwise the headline
  // count ignores everybody who turned up for a piece added since the bundle.
  const { total } = people;
  const tiles = [
    [String(stats.count), null, 'pieces'],
    [String(Math.round(stats.aliveMs / 60000)), 'min', 'total time alive'],
    [String(total), null, 'people involved'],
    [String(stats.nonLike), `:${stats.likes}`, 'ratio'],
    [fmtSeconds(stats.meanReactionMs).replace('s', ''), 's', 'mean reaction to a like'],
    [String(stats.deleted), `/${stats.count}`, 'breakers that unliked'],
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

// How many people the table shows before the rest are folded away. The list is
// long enough to read as a wall; the top twenty is a readable list, and the
// tail is one click away for anyone who wants to find themselves in it.
const PEOPLE_PREVIEW = 20;

function Participants({ rows: roster }) {
  const [sort, setSort] = useState('ev');
  const [dir, setDir] = useState(-1);
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(() => {
    const key = sort;
    return roster.slice().sort((a, b) => {
      const A = a[key];
      const B = b[key];
      const cmp = typeof A === 'string' ? A.localeCompare(B) * -1 : A - B;
      return cmp * dir || b.ev - a.ev;
    });
  }, [roster, sort, dir]);

  // Every breaker stays in the preview whatever the sort says. Ranking is by
  // events, and the ones whose like was deleted have none — they'd sit at the
  // bottom of a list they're the whole subject of.
  const shown = useMemo(() => {
    if (expanded) return rows;
    const top = new Set(rows.slice(0, PEOPLE_PREVIEW).map((p) => p.did));
    return rows.filter((p) => top.has(p.did) || p.broke);
  }, [rows, expanded]);
  const hidden = rows.length - shown.length;

  const toggleSort = (key) => {
    if (sort === key) setDir(-dir);
    else {
      setSort(key);
      setDir(key === 'h' ? 1 : -1);
    }
  };

  return (
    <div className="ratioed-participants">
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
            {shown.map((p) => (
              <tr key={p.did}>
                <td>
                  @{p.h}
                  {p.dn && <span className="ratioed-people-dn">{p.dn}</span>}
                </td>
                <td className="num">{p.ev || '·'}</td>
                <td className="num">{p.live || '·'}</td>
                <td className="num">{p.after || '·'}</td>
                <td>{pieceList(p)}</td>
                <td>
                  {KINDS.filter((k) => p.kinds[k]).map((k) => (
                    <span className={`ratioed-k-${k}`} key={k}>
                      {ABBR[k]}×{p.kinds[k]}{' '}
                    </span>
                  ))}
                  {/* The one act that isn't in any of the counts, because the
                      record of it was deleted. Named by the announcement. */}
                  {p.likeGone && (
                    <span
                      className="ratioed-k-like ratioed-gone"
                      title="The like that ended the piece. Deleted afterwards, so it appears in no index — the reply concluding the piece is the only record that it happened."
                    >
                      ♥ deleted
                    </span>
                  )}
                </td>
<td>{(() => {
                  // No "after the fact" here any more — everyone in this list
                  // was present while a piece was alive; the tag says how.
                  const role = roleOf(p);
                  return <span className={`ratioed-tag ${role.key}`}>{role.label}</span>;
                })()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          className="ratioed-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {/* Not "top 20" in the label — sort by handle and the first twenty
              are alphabetical, not the busiest. */}
          {expanded ? `Show fewer` : `Show all ${rows.length} — ${hidden} more`}
        </button>
      )}
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

function Lifelines({ pieces, events, stats, deltas, parent }) {
  const [scale, setScale] = useState('true');
  const [on, setOn] = useState(() => new Set(KINDS));
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
                        dim={!on.has(e.k)}
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
                        dim={!on.has(e.k)}
                      />
                    ))}
                </span>
              </button>
              {open && <PieceDetail piece={p} delta={deltas?.[p.rkey]} parent={parent} />}
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

function PieceDetail({ piece, delta, parent }) {
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
          {/* This panel is as far as the essay can go at its own altitude —
              all thirteen share one axis here. The piece's own page has the
              log, the faces and the replay. */}
          <p className="ratioed-more">
            <Link to={piecePath(piece, parent)}>
              Everything on take {String(piece.take).padStart(2, '0')} →
            </Link>
          </p>
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

function Reaction({ pieces }) {
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
              {/* An inferred bar reads as "at least the floor, at most the
                  ceiling": solid up to where the fastest measured reaction
                  landed, then hatched across the window the like must have
                  fallen in. A measured bar is solid to its own value. */}
              <span
                className="ratioed-react-fill"
                style={{ width: `${(inferred ? lo : ms / MAX) * 100}%` }}
              />
              {inferred && (
                <span
                  className="ratioed-react-band"
                  style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }}
                />
              )}
            </span>
            <span className="ratioed-react-v">
              {inferred ? `${REACTION_LO}–${REACTION_HI}s` : fmtSeconds(ms)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

// People leads each window: it's the figure the eye wants first — how many
// were there — with the breakdown of what they did following it.
const LEDGER_COLUMNS = [
  ['participants', 'people'],
  ['likes', '♥'],
  ['reposts', 'RT'],
  ['quotes', 'QT'],
  ['threadPosts', 'thread'],
];

function Ledger({ pieces, deltas, parent }) {
  return (
    <div className="ratioed-tablewrap">
      <table className="ratioed-table">
        <thead>
          <tr>
            <th>Piece</th>
            <th>Alive for</th>
            {/* Group headers sit above their first column, so they read left to
                right into the block they name. The rule marks where each block
                starts. */}
            <th className="ratioed-div" colSpan={5}>
              While alive
            </th>
            <th className="ratioed-div" colSpan={5}>
              After the seal
            </th>
          </tr>
          <tr className="ratioed-subhead">
            <th />
            <th />
            {['pre', 'post'].map((window) =>
              LEDGER_COLUMNS.map(([, label], i) => (
                <th className={`num${i === 0 ? ' ratioed-div' : ''}`} key={`${window}-${label}`}>
                  {label}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {pieces.map((p) => {
            const d = deltas?.[p.rkey];
            return (
              <tr key={p.rkey}>
                <td>
                  <Link className="ratioed-take-link" to={piecePath(p, parent)}>
                    <b>#{String(p.take).padStart(2, '0')}</b>
                  </Link>{' '}
                  <span className="ratioed-pill">{(p.postedAt || '').slice(0, 10)}</span>
                </td>
                <td>{fmtDuration(p.lifespanMs)}</td>
                {LEDGER_COLUMNS.map(([k], i) => (
                  <td className={`num${i === 0 ? ' ratioed-div' : ''}`} key={`pre-${k}`}>
                    {p.preSeal[k] || '·'}
                  </td>
                ))}
                {LEDGER_COLUMNS.map(([k], i) => (
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
