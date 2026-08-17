import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  SEED_PIECES,
  SEED_PEOPLE,
  loadPieces,
  livingRoster,
  loadPeople,
  roleOf,
  brokenTakes,
  aggregate,
  splitParticipants,
  hiddenReplies,
  composeEventLog,
  fetchLiveDeltas,
  whenMarks,
  areaRadius,
  piecePath,
  finished,
  WEEKDAYS,
  fmtDuration,
  fmtSeconds,
  fmtElapsed,
} from '../../lib/ratioed.js';
import {
  pieceReach,
  projectReach,
  applyAudience,
  audienceFromEvents,
  fmtReach,
} from '../../lib/ratioedReach.js';
import { projectStats } from '../../lib/ratioedStats.js';
import { resolvePds } from '../../lib/atproto.js';
import { paletteForHour } from '../../lib/skyTheme.js';
import { ratioedScaleVars } from '../../lib/ratioedPalette.js';
import { useTheme } from '../../hooks/useTheme.jsx';
import { ME_DID } from '../../config.js';
import './RatioedBlock.css';

const KINDS = ['reply', 'repost', 'quote', 'like'];
// Variants that need the per-record event log — a separate ~27kB chunk, so the
// ones that only read counts never pay for it. Participants is here because a
// person's role turns on WHEN they acted, which only the log knows. Summary is
// here for its second row, which asks about pace and silence and amplifiers —
// none of them countable. Its first row is drawn from recorded figures and
// paints immediately; the second appears when the chunk lands, and is simply
// absent on a page where it never does.
const EVENT_VARIANTS = new Set(['lifelines', 'hidden', 'participants', 'reach', 'summary']);
// Variants that also need the dated audience table, which is what gives the
// pieces measured before follower counts were recorded a reach at all.
const AUDIENCE_VARIANTS = new Set(['reach', 'participants', 'summary']);
const KIND_LABEL = { reply: 'reply', repost: 'repost', quote: 'quote', like: 'like' };
const ABBR = { reply: 'reply', repost: 'RT', quote: 'QT', like: '♥' };

/**
 * The window a deleted like must have fallen in: the range of every reaction
 * that IS still measurable, in seconds. Both charts draw their inferred bars
 * across exactly this band, because it's the only evidence there is about when
 * a like nobody can see any more was cast.
 *
 * Derived, not fixed. It was a hardcoded 10–17s — the observed range at the
 * time — and stopped being true the moment take #13 was measured at 6.4s. The
 * inferred bars then claimed a floor that a measured piece had already gone
 * under, and contradicted the chart's own caption, which reads the range off
 * the data. Null when nothing is measurable, in which case there is nothing to
 * infer from and no band gets drawn.
 */
function reactionBand(pieces) {
  const ms = (pieces || [])
    .map((p) => p.breaker?.reactionMs)
    .filter((v) => typeof v === 'number');
  if (!ms.length) return null;
  return { lo: Math.min(...ms) / 1000, hi: Math.max(...ms) / 1000 };
}

/**
 * What each chart says about itself when the block carries no caption of its
 * own. Functions rather than strings so a default can quote the data it is
 * describing; an authored caption replaces the whole thing.
 *
 * A caption is a label, not an essay. Two sentences is the ceiling: one for
 * what the marks are, one for the thing a reader would otherwise get wrong.
 * Everything else these used to carry — how roles are ranked, why the count is
 * by DID, what a hatched bar stands in for — is either visible in the chart or
 * belongs in the prose around it, and putting it here made a legend into a
 * paragraph nobody finished.
 */
const DEFAULT_CAPTIONS = {
  summary: ({ people }) =>
    `${people.living} of the ${people.total} people involved showed up while a piece was still alive. The rest only ever touched a finished one.`,
  lifelines: () =>
    'Every record pointing at a piece, by the second it arrived. The rule is the threadgate; everything right of it hit a post that was already over.',
  reaction: ({ stats }) =>
    // `count - measured` rather than `deleted`: the bars are hatched when
    // nothing timed the like, and a deleted like the studio watched land was
    // timed. Six of the seven deleted ones now carry a recovered reaction.
    `How long each like went unnoticed: mean ${fmtSeconds(stats.meanReactionMs)}, range ${fmtSeconds(stats.minReactionMs)}–${fmtSeconds(stats.maxReactionMs)}. The ${stats.count - stats.measured} hatched bars are pieces nothing timed, so the window is inferred rather than measured.`,
  ledger: () =>
    'Engagement either side of the seal. Pieces keep accruing the right-hand column indefinitely.',
  hidden: () =>
    'Replies written to the network after their piece sealed. A threadgate hides them at the appview without stopping the records, so nobody reading the thread has seen these.',
  participants: ({ roster, audience }) =>
    `The ${roster.rows.length} accounts present while a piece was alive, ${roster.breakers} of them breakers.${
      audience?.measuredAt
        ? ` Audience is their follower count, read at the seal on a piece whose log recorded one and otherwise as of ${audience.measuredAt.slice(0, 10)}; a dot means nothing could price the account at all.`
        : ''
    }`,
  reach: ({ reach }) => {
    // The alive window only. What a sealed post collects afterwards is a
    // different subject, and the chart no longer plots it.
    const how =
      'Roughly how many people a piece could have reached while it was alive, from the followers of everyone who touched it: a repost or quote counts as a whole following, a reply a tenth, a like a fiftieth.';
    return reach ? `${how} ${fmtReach(reach.aliveRaw)} across the series.` : how;
  },
  when: () =>
    'Every piece by the clock it was made on, in Eastern time. The core is how long it lived, the ring how much it drew, both scaled by area.',
};

/**
 * Ratioed data visualisation. Every variant shares one data load:
 *
 *   summary      — the project in six figures
 *   lifelines    — every backlink plotted against time, threadgate as a hard rule
 *   reaction     — how long the artist took to close each piece by hand
 *   ledger       — engagement before and after the seal, per piece
 *   hidden       — the replies that landed after the seal and can't be seen
 *   participants — everyone who touched a piece
 *   when         — where the pieces fall across a week, sized by scale
 *   reach        — how large an audience each piece was carried to
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
  const [audience, setAudience] = useState(null);
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
      // Only the finished ones. A piece that is up right now has no seal to
      // plot against and no measurement to average, and every chart here reads
      // the project as a completed series.
      const fresh = finished(await loadPieces(pds));
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

  useEffect(() => {
    if (!AUDIENCE_VARIANTS.has(variant)) return undefined;
    let alive = true;
    import('../../data/ratioedAudience.json')
      .then((m) => {
        if (alive) setAudience(m.default || m);
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
  //
  // The audience join runs last and only fills gaps: a log that recorded its
  // own follower counts at measurement time keeps them, and the dated table
  // only reaches the logs that have none.
  const eventLog = useMemo(() => {
    if (!events && !pieces.some((p) => p.events)) return null;
    const merged = { ...(events || {}) };
    // Composed per piece rather than replaced: a repaired piece from the first
    // eleven has an afterlife on its record and its alive window — and all of
    // its replies' text — only in the harvest. See composeEventLog.
    for (const p of pieces) {
      if (p.events) merged[p.rkey] = composeEventLog(p.events, events?.[p.rkey]);
    }
    if (!audience) return merged;
    for (const [rkey, log] of Object.entries(merged)) {
      merged[rkey] = applyAudience(log, audience);
    }
    return merged;
  }, [events, pieces, audience]);

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

  // The series answering the same questions a single piece answers about
  // itself. Null until the log is in — the count tiles above it are drawn from
  // recorded figures and never wait on anything.
  const shape = useMemo(
    () => (variant === 'summary' ? projectStats(pieces, (p) => eventLog?.[p.rkey]) : null),
    [variant, pieces, eventLog],
  );

  // The categorical scale is derived from whatever hour the sky is showing, so
  // it re-derives whenever the hour ticks over or is previewed in the studio.
  const { skyDisplayHour } = useTheme();
  const scale = useMemo(() => ratioedScaleVars(skyDisplayHour), [skyDisplayHour]);

  const split = useMemo(() => splitParticipants(people), [people]);
  // Read off the logs rather than out of the table: `eventLog` has already had
  // the dated table joined onto it, so this is both sources at once — and the
  // recorded figures are the half the table deliberately does not hold.
  const audiences = useMemo(
    () => (variant === 'participants' ? audienceFromEvents(pieces, (p) => eventLog?.[p.rkey]) : null),
    [variant, pieces, eventLog],
  );
  const roster = useMemo(() => livingRoster(pieces, people, eventLog), [pieces, people, eventLog]);
  // Project-wide reach, for the caption to quote. Null until both halves of the
  // join are in, which is what keeps the caption from stating a total drawn
  // from the two pieces that carry their own audience.
  const reachTotals = useMemo(
    () =>
      variant === 'reach' && eventLog && audience
        ? projectReach(pieces, (p) => eventLog[p.rkey])
        : null,
    [variant, pieces, eventLog, audience],
  );

  const fallback = DEFAULT_CAPTIONS[variant];
  const caption =
    block?.caption?.trim() ||
    (fallback ? fallback({ stats, people: split, roster, reach: reachTotals, audience }) : '');
  const showCaption = block?.showCaption !== false && Boolean(caption);

  return (
    <figure
      className={`ratioed ratioed-${variant}`}
      style={{ ...scale, ...(style || {}) }}
      aria-label={block?.alt || undefined}
    >
      {variant === 'summary' && <Summary stats={stats} people={split} shape={shape} roster={roster} />}
      {variant === 'lifelines' && (
        <Lifelines pieces={pieces} events={eventLog} stats={stats} deltas={deltas} parent={parentSlug} />
      )}
      {variant === 'reaction' && <Reaction pieces={pieces} />}
      {variant === 'ledger' && <Ledger pieces={pieces} deltas={deltas} parent={parentSlug} />}
      {variant === 'hidden' && <Hidden pieces={pieces} events={eventLog} />}
      {variant === 'participants' && <Participants rows={roster.rows} audiences={audiences} />}
      {/* Both halves or neither: without the audience table the early pieces
          have no follower counts to score, and a chart drawn from the two
          recent ones alone would read as the whole project. */}
      {variant === 'reach' && (
        <Reach pieces={pieces} events={audience ? eventLog : null} parent={parentSlug} />
      )}
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

function Summary({ stats, people, shape, roster }) {
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

  // Somebody who was there, alive, for more than one take.
  const returned = roster?.rows ? roster.rows.filter((r) => r.live > 1).length : null;

  // What a piece is LIKE, under what the project adds up to. The row above is
  // the work's size; this one is its texture, and it is the same set of
  // questions a single piece answers about itself — so the two pages agree
  // about what is worth measuring, and a take can be read against the middle
  // of the series rather than against nothing.
  //
  // Everything here that needs the event log is dropped rather than zeroed
  // when there isn't one, which is why this row can be shorter than it looks.
  const texture = shape && [
    [
      `${shape.mix.replies}·${shape.mix.reposts}·${shape.mix.quotes}`,
      null,
      'replies · reposts · quotes',
    ],
    [fmtDuration(shape.medianMs), null, 'the middle take'],
    shape.pace && [
      shape.pace >= 10 ? String(Math.round(shape.pace)) : shape.pace.toFixed(1),
      '/min',
      'pace while alive',
    ],
    shape.first && [`${fmtDuration(shape.first.off * 1000)}`, null, 'typical first touch'],
    shape.silence && [
      fmtDuration(shape.silence.ms),
      ` · #${String(shape.silence.take).padStart(2, '0')}`,
      'longest silence anywhere',
    ],
    // From the roster rather than from the logs: it is the thing that knows a
    // handle in an old log and a DID in a new one are one person. Counted off
    // the logs directly this read 20 of 204, under a tile saying 135 involved.
    returned && [String(returned), `/${roster.rows.length}`, 'came back for another'],
    shape.audience?.top && [
      fmtReach(shape.audience.top.followers),
      null,
      `biggest amplifier · @${shape.audience.top.h}`,
    ],
    typeof shape.audience?.median === 'number' && [
      fmtReach(shape.audience.median),
      null,
      'median follower count',
    ],
  ];

  const row = (group) =>
    group.filter(Boolean).map(([v, suffix, label]) => (
      <div className="ratioed-tile" key={label}>
        <span className="ratioed-tile-v">
          {v}
          {suffix && <small>{suffix}</small>}
        </span>
        <span className="ratioed-tile-l">{label}</span>
      </div>
    ));

  return (
    <div className="ratioed-summary">
      <div className="ratioed-tiles">{row(tiles)}</div>
      {texture && <div className="ratioed-tiles is-texture">{row(texture)}</div>}
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
              {/* Only stated when it is known. A backlink index cannot say
                  whether a reply was nested, and only the bundled harvest
                  recorded it — so a row with no flag is a row nothing can
                  answer for, not a reply to the piece itself. */}
              @{r.h}
              {r.n != null && <> · {r.n ? 'nested reply' : 'reply to the sealed post'}</>}
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
  { key: 'fr', label: 'Audience', num: true },
  { key: 'ev', label: 'Events', num: true },
  { key: 'live', label: 'Live', num: true },
  { key: 'after', label: 'After', num: true },
];

// How many people the table shows before the rest are folded away. The list is
// long enough to read as a wall; the top twenty is a readable list, and the
// tail is one click away for anyone who wants to find themselves in it.
const PEOPLE_PREVIEW = 20;

function Participants({ rows: roster, audiences }) {
  const [sort, setSort] = useState('ev');
  const [dir, setDir] = useState(-1);
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(() => {
    const key = sort;
    // The audience each person brought, joined at render rather than stored on
    // the roster: it is a figure about an account, and the roster is a
    // measurement of what people did. Keeping them in separate places is what
    // stops the two being read as one date. Somebody nothing can price sorts as
    // -1, so unknown audiences fall to the bottom instead of tying with the
    // accounts nobody follows.
    const withAudience = roster.map((p) => {
      const found = audiences ? audiences[p.did] || audiences[p.h] : null;
      return { ...p, fr: typeof found?.fr === 'number' ? found.fr : -1 };
    });
    return withAudience.sort((a, b) => {
      const A = a[key];
      const B = b[key];
      // No negation: `dir` has to mean the same thing for a text column as for
      // a numeric one. It didn't, and the two cancelled only for the numbers —
      // so clicking Handle ran z→a under an arrow pointing up.
      const cmp = typeof A === 'string' ? A.localeCompare(B) : A - B;
      return cmp * dir || b.ev - a.ev;
    });
  }, [roster, sort, dir, audiences]);

  // Every breaker stays in the preview whatever the sort says. Ranking is by
  // events, and the ones whose like was deleted have none — they'd sit at the
  // bottom of a list they're the whole subject of.
  const shown = useMemo(() => {
    if (expanded) return rows;
    const top = new Set(rows.slice(0, PEOPLE_PREVIEW).map((p) => p.did));
    return rows.filter((p) => top.has(p.did) || brokenTakes(p).length);
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
                {/* -1 is the marker for an account the audience table doesn't
                    know — deactivated, renamed, or simply never resolved. Not
                    a zero: nobody here is being reported as unfollowed. */}
                <td className="num">{p.fr >= 0 ? fmtReach(p.fr) : '·'}</td>
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
  const band = useMemo(() => reactionBand(pieces), [pieces]);
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
          // Whether the reaction was TIMED, not whether the record still
          // exists. The hatched bar means "this window is inferred"; since
          // `reactionRecovered`, a like can be deleted and still have been
          // timed by the log that watched it land. Take 16 was drawing a
          // hatched inferred window two lines above its own detail panel
          // printing "reaction 4.6s".
          const ghost = typeof p.breaker?.reactionMs !== 'number';
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
                  {ghost && band && (
                    <span
                      className="ratioed-ghost"
                      title="inferred window for the deleted like"
                      style={{
                        left: `${((life - band.hi) / life) * pct}%`,
                        width: `${Math.max(((band.hi - band.lo) / life) * pct, 0.9)}%`,
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
            <dd className={typeof b.reactionMs === 'number' ? 'hot' : ''}>
              {typeof b.reactionMs === 'number'
                ? `${fmtSeconds(b.reactionMs)}${b.likeSurvives === false ? ' (from the log; the like was deleted)' : ''}`
                : 'unmeasurable — nothing timed the like'}
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
          {/* Its own class rather than `ratioed-more`, which is the "show all
              N" toggle's box: wrapping a link in it produced a full-width
              bordered slab with an underlined link floating inside it. */}
          <p className="ratioed-through">
            {/* Label only. An arrow — text or icon — reads as a stray gap at
                this size, and the button is already the only link in the
                card. */}
            <Link className="ratioed-through-btn" to={piecePath(piece, parent)}>
              View take {String(piece.take).padStart(2, '0')}
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
  const band = reactionBand(pieces);
  // Chronological, not fastest-first: the point of this chart is that the
  // reaction time holds steady across thirteen months and wildly different
  // lifespans. Sorting by duration would hide exactly that.
  const rows = [...pieces].sort((a, b) => a.take - b.take);
  return (
    <div className="ratioed-reaction">
      {rows.map((p) => {
        const ms = p.breaker?.reactionMs;
        const inferred = typeof ms !== 'number';
        const lo = ((band?.lo || 0) * 1000) / MAX;
        const hi = ((band?.hi || 0) * 1000) / MAX;
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
              {inferred && band && (
                <span
                  className="ratioed-react-band"
                  style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }}
                />
              )}
            </span>
            <span className="ratioed-react-v">
              {!inferred
                ? fmtSeconds(ms)
                : band
                  ? `${band.lo.toFixed(1)}–${band.hi.toFixed(1)}s`
                  : 'unmeasurable'}
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

/* ------------------------------------------------------------------ */
/* Reach — how big an audience each piece was carried to                */
/* ------------------------------------------------------------------ */

/**
 * One bar per piece, split at the seal, on a shared axis.
 *
 * A shared axis rather than a per-piece one because the disparity IS the
 * finding: most pieces were carried by people with a few hundred followers, and
 * one or two were picked up by an account with sixty thousand. Normalising each
 * row would hide the only thing worth seeing.
 *
 * The named account under each bar is the single largest contributor to it,
 * because a reach figure without one reads as a property of the piece when it
 * is almost always a property of one person who reposted it.
 */
function Reach({ pieces, events, parent }) {
  const rows = useMemo(() => {
    if (!events) return null;
    return (pieces || [])
      .map((p) => ({ piece: p, reach: pieceReach(events[p.rkey]) }))
      // The window this chart actually draws. The whole-piece flag let takes 2
      // and 7 through — nothing touched either while it was alive — to draw a
      // zero-width bar with `·` for the figure and an afterlife account's name
      // under it.
      .filter((r) => r.reach.alive.measurable);
  }, [pieces, events]);

  if (!rows) return <p className="ratioed-note">Loading the event log…</p>;
  if (!rows.length) {
    return <p className="ratioed-note">No piece has an audience measurement yet.</p>;
  }

  // Scaled on the alive window alone, which is the only one this chart draws.
  // What a sealed post goes on collecting is a different subject, and plotting
  // it beside the thing being measured made a piece that travelled after it was
  // over look like a piece that travelled.
  const max = Math.max(...rows.map((r) => r.reach.alive.raw), 1);

  return (
    <div className="ratioed-reach">
      <ol className="ratioed-reach-rows">
        {rows.map(({ piece, reach }) => {
          const alive = reach.alive.raw;
          // This window's own, never the other's: the key underneath reads
          // "approx. reach while alive", and naming an account that only turned
          // up after the seal answers a question nobody asked.
          const top = reach.alive.top;
          return (
            <li className="ratioed-reach-row" key={piece.rkey}>
              <Link className="ratioed-take-link" to={piecePath(piece, parent)}>
                <b>#{String(piece.take).padStart(2, '0')}</b>
              </Link>
              <div className="ratioed-reach-track">
                <span
                  className="ratioed-reach-bar is-alive"
                  style={{ width: `${(alive / max) * 100}%` }}
                  title={`${fmtReach(alive)} while alive`}
                />
              </div>
              <span className="ratioed-reach-figure">{alive > 0 ? fmtReach(alive) : '·'}</span>
              <span className="ratioed-reach-who">
                {top ? `@${top.handle} · ${fmtReach(top.followers)}` : 'nobody with an audience'}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="ratioed-reach-key">
        <span className="ratioed-reach-swatch is-alive" /> approx. reach while alive
      </p>
    </div>
  );
}

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
