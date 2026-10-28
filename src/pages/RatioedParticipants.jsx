// Everyone who has been in a Ratioed piece, as a ranking.
//
// The essay carries a participants table, and a table is the right shape
// inside an argument: five columns, twenty rows, sortable, and the reader gets
// back to the prose. This is the same roster asked as its own question. Who
// turned up most, who came back, who ended one, and how big the audience is
// that all of it happened in front of.
//
// A leaderboard, then, with what a leaderboard needs: a place per person, a
// bar that makes the distribution visible without a chart, and a name that
// leads to the page holding their whole history. The ranking is pieces —
// pieces somebody was there for while the post was still standing. Records
// that landed after a seal are counted on nobody's row here, which is the same
// rule the rest of the project measures under.
//
// The figures above the board are the ones the ranking can't show: that most
// people came once, that a handful came back, and what the whole roster adds up
// to. Nothing here is recomputed on load. The roster and the logs are dated
// measurements, and the only live read on the page is the portraits.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import RatioedStats from '../components/RatioedStats.jsx';
import {
  SEED_PIECES,
  SEED_PEOPLE,
  loadPieces,
  loadLivePieces,
  loadPeople,
  livingRoster,
  composeEventLog,
  splitParticipants,
  brokenTakes,
  roleOf,
  isRatioedParent,
  finished,
  fmtDuration,
} from '../lib/ratioed.js';
import { participantPath, participantBoard } from '../lib/ratioedParticipant.js';
import { medianOf } from '../lib/ratioedStats.js';
import { applyAudience, audienceIndex, fmtReach } from '../lib/ratioedReach.js';
import { resolveProfiles } from '../lib/atproto.js';
import { avatarThumb } from '../lib/avatarThumb.js';
import { UNRESOLVED } from '../lib/ratioedIdentity.js';
import { ratioedScaleVars } from '../lib/ratioedPalette.js';
import { useTheme } from '../hooks/useTheme.jsx';
import { RATIOED_DOC_RKEY } from '../config.js';
import './RatioedPiece.css';
import './RatioedParticipants.css';

// How many rows are on screen before the rest are asked for. Twenty-five is
// where the ranking stops being a ranking and starts being a directory; the
// filter below the board is the way to a specific person, and "show all" is
// there for anyone who wants to read the tail.
const PAGE = 25;

// How many portraits to resolve before the reader has asked for the whole
// board. Each request covers 25 accounts, so this is four of them; past that,
// re-sorting is fetching pictures nobody has scrolled to. Once "show all" is
// pressed, or the filter is in use, every row on screen is one somebody asked
// for — the cap used to hold there too, and left everybody past the hundredth
// wearing an initial for good.
const PORTRAIT_CAP = 100;
// What one getProfiles request covers.
const PROFILES_PER_ASK = 25;

// Two axes, matching the two figures a row carries. Records are still what
// breaks a tie in the ranking and still the second figure on somebody's own
// page; they are just not a column here, so there is nothing to sort by.
const SORTS = [
  { key: 'live', label: 'pieces' },
  { key: 'fr', label: 'audience' },
];

export default function RatioedParticipants() {
  const { slug } = useParams();
  const [pieces, setPieces] = useState(SEED_PIECES);
  const [people, setPeople] = useState(SEED_PEOPLE);
  const [bundled, setBundled] = useState(null);
  const [audience, setAudience] = useState(null);
  const [profiles, setProfiles] = useState({});
  // The accounts the AppView was asked about and had nothing for. Kept apart
  // from "not asked yet", because only the first is an account that no longer
  // answers — see `Who`.
  const [absent, setAbsent] = useState(() => new Set());
  // Which of the slower inputs have had their say, landed or failed. The figure
  // tiles hold a place for what they are waiting on rather than appearing when
  // it lands, which re-wrapped the grid and shoved the board down the page.
  const [loaded, setLoaded] = useState({ snapshot: false, events: false, audience: false });
  const [sort, setSort] = useState('live');
  const [dir, setDir] = useState(-1);
  const [shown, setShown] = useState(PAGE);
  const [query, setQuery] = useState('');

  const { skyDisplayHour } = useTheme();
  const scale = useMemo(() => ratioedScaleVars(skyDisplayHour), [skyDisplayHour]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // The build's snapshot first and on its own: it holds every piece and the
      // roster regenerated alongside them, and nothing about drawing the board
      // should wait on plc.directory.
      const [snapPieces, snapPeople] = await Promise.all([loadPieces(null), loadPeople()]);
      if (!alive) return;
      if (snapPieces?.length) setPieces(finished(snapPieces));
      if (snapPeople?.length) setPeople(snapPeople);
      setLoaded((l) => ({ ...l, snapshot: true }));

      const fresh = await loadLivePieces().catch(() => null);
      if (alive && fresh?.length) setPieces(finished(fresh));
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const done = (key) => {
      if (alive) setLoaded((l) => ({ ...l, [key]: true }));
    };
    import('../data/ratioedEvents.json')
      .then((m) => {
        if (alive) setBundled(m.default || m);
      })
      .catch(() => {})
      .finally(() => done('events'));
    import('../data/ratioedAudience.json')
      .then((m) => {
        if (alive) setAudience(m.default || m);
      })
      .catch(() => {})
      .finally(() => done('audience'));
    return () => {
      alive = false;
    };
  }, []);

  const resolveEvents = useCallback(
    (piece) => {
      const log = composeEventLog(piece?.events, bundled?.[piece?.rkey]);
      if (!log) return null;
      return audience ? applyAudience(log, audience) : log;
    },
    [bundled, audience],
  );

  const roster = useMemo(() => {
    const byRkey = {};
    for (const p of pieces) {
      const log = resolveEvents(p);
      if (log) byRkey[p.rkey] = log;
    }
    return livingRoster(pieces, people, byRkey);
  }, [pieces, people, resolveEvents]);

  const audiences = useMemo(
    () => audienceIndex(pieces, resolveEvents, audience),
    [pieces, resolveEvents, audience],
  );

  const board = useMemo(
    () => participantBoard(roster.rows, { audiences, sort, dir }),
    [roster.rows, audiences, sort, dir],
  );

  // How the whole roster divides, which is the one figure here the board
  // itself can't hold: it lists the people who were there, and this counts the
  // ones who weren't.
  const split = useMemo(() => splitParticipants(people), [people]);

  const wanted = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!wanted) return board.rows;
    return board.rows.filter(
      (p) => p.h.toLowerCase().includes(wanted) || (p.dn || '').toLowerCase().includes(wanted),
    );
  }, [board.rows, wanted]);
  const visible = useMemo(
    () => (wanted ? rows : rows.slice(0, shown)),
    [rows, wanted, shown],
  );

  // Portraits for the rows a reader can actually see, accumulated rather than
  // refetched: re-sorting brings different people to the top, and the ones
  // already resolved stay resolved.
  //
  // Keyed on who has been ASKED about rather than who came back. A deactivated
  // account resolves to no profile at all, and this roster is full of them —
  // gating on the answer would leave them permanently missing, so every render
  // would ask again, forever.
  const asked = useRef(new Set());
  const everything = Boolean(wanted) || shown >= rows.length;
  useEffect(() => {
    const room = everything ? Infinity : PORTRAIT_CAP - asked.current.size;
    if (room <= 0) return;
    const missing = visible
      .map((p) => p.did)
      .filter((did) => did && !did.startsWith('handle:') && !asked.current.has(did))
      .slice(0, room);
    if (!missing.length) return;
    for (const did of missing) asked.current.add(did);
    // No cancellation, deliberately. `visible` changes identity several times
    // in the first moments of the page — the snapshot, the fresh read, the
    // event and audience JSONs each re-render the list — and an answer
    // cancelled by the pass that asked for it never comes back: its DIDs are
    // already in `asked`, so those rows wore the initial forever. That was
    // every avatar on the board. A late answer is safe to apply — the merge
    // is idempotent, and applying after unmount is a no-op.
    //
    // Asked a request's worth at a time, and each answer read on its own.
    // `resolveProfiles` swallows a failed chunk and returns the rest, so asked
    // for the whole board at once, one 429 among a dozen requests came back as
    // twenty-five accounts with no profile — and drew all of them as gone.
    (async () => {
      for (let i = 0; i < missing.length; i += PROFILES_PER_ASK) {
        const ask = missing.slice(i, i + PROFILES_PER_ASK);
        const found = await resolveProfiles(ask).catch(() => ({}));
        // Nothing back at all is a failed call, not a batch of deactivated
        // accounts, and says nothing about any of them.
        if (!Object.keys(found).length) continue;
        setProfiles((prev) => ({ ...prev, ...found }));
        const none = ask.filter((did) => !found[did]);
        if (none.length) setAbsent((prev) => new Set([...prev, ...none]));
      }
    })();
  }, [visible, everything]);

  if (!isRatioedParent(slug, { rkey: RATIOED_DOC_RKEY })) {
    return (
      <PageShell title="Not found" headTitle="Not found — dame.is">
        <p>
          <code>{slug}</code> has no participants. <Link to="/creating">Back to the index.</Link>
        </p>
      </PageShell>
    );
  }

  const { totals } = board;
  // The middle piece, not the mean one: the series runs from 16 seconds to 42
  // minutes, and an average across that says nothing about what a typical take
  // was like to be in.
  const medianLife = medianOf(pieces.map((p) => p.lifespanMs).filter(Boolean));
  const most = totals.mostPieces;
  const biggest = totals.biggestAudience;
  // Named apart from the per-row `broke` inside the board below, which is a
  // different person's takes.
  const topBreaker = totals.mostBroken;
  const mostBroken = topBreaker ? brokenTakes(topBreaker).length : 0;
  const maxPieces = most?.live || 1;
  // What a tile shows while the input it reads has not arrived: the place it
  // will take, holding the same label and note, so the grid is the shape it
  // will end up rather than growing a row when the audience table lands.
  const pending = '—';
  const logsIn = loaded.snapshot && loaded.events;

  const headline = [
    {
      key: 'people',
      label: 'people',
      value: totals.people || null,
      note: `were there while a piece was still standing, across ${pieces.length} takes`,
    },
    {
      key: 'returned',
      label: 'came back',
      value: totals.returned || null,
      note: `the other ${totals.once} turned up for exactly one`,
    },
    {
      key: 'breakers',
      label: 'ended one',
      value: totals.breakers || null,
      note: 'liked a post and sealed it',
    },
    (totals.audience > 0 || !loaded.audience) && {
      key: 'audience',
      label: 'between them',
      // Held until the dated table is in. Before it, the total is the handful
      // of logs that recorded their own follower counts, which is a real
      // number that is not this one.
      value: loaded.audience ? fmtReach(totals.audience) : pending,
      // Not "N accounts unpriced". The four it was counting are accounts that
      // have since been deleted or deactivated, so there is nothing to read and
      // nothing a reader can do about it; the total is a floor either way, and
      // the rows themselves already show a dash rather than a zero.
      note: 'followers, counted once each',
    },
  ];

  const texture = [
    (totals.records > 0 || !logsIn) && {
      key: 'records',
      label: 'records',
      value: logsIn ? totals.records : pending,
      note: totals.recordsBlind
        ? `made while a piece stood; ${totals.recordsBlind} rows no log covers`
        : 'made while a piece was standing',
    },
    most && {
      key: 'most',
      // Not "most pieces". Beside a tile counting the people who ended one, a
      // bare count of pieces under somebody's handle reads as pieces they
      // ended; this is the opposite of that, and the ranking's own measure.
      label: 'showed up most',
      value: most.live,
      note: `@${most.h}, of ${pieces.length} takes`,
    },
    // The counterpart, when there is one to name: the twenty people who ended a
    // piece each ended one, so this appears only for somebody who ended more.
    topBreaker && {
      key: 'broke',
      label: 'ended the most',
      value: mostBroken,
      note: `@${topBreaker.h}`,
    },
    (biggest || !loaded.audience) && {
      key: 'biggest',
      label: 'biggest audience',
      value: biggest && loaded.audience ? fmtReach(biggest.fr) : pending,
      // A blank line rather than none, so the tile is already its full height.
      note: biggest && loaded.audience ? `@${biggest.h}` : '\u00a0',
    },
    split.afterOnly > 0 && {
      key: 'late',
      label: 'too late',
      value: split.afterOnly,
      note: 'only ever touched a finished piece',
    },
  ];

  return (
    <PageShell
      title="Participants"
      headTitle="Ratioed participants — dame.is"
    >
      <article className="ratioed-piece ratioed-board-page reveal" style={scale}>
        <p className="ratioed-piece-lede">
          {totals.people} people have been in a Ratioed piece while it was still standing.
          {medianLife
            ? ` The median piece stood ${fmtDuration(medianLife)}, and the ranking below counts how
               often somebody got there inside a window that short.`
            : ' The ranking below counts how many times each of them got there before the seal.'}
        </p>

        <RatioedStats cells={headline} />
        <RatioedStats cells={texture} dense />

        <section className="ratioed-piece-section">
          <div className="ratioed-board-controls">
            <div className="ratioed-board-seg" role="group" aria-label="Rank by">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={sort === s.key}
                  onClick={() => {
                    if (sort === s.key) setDir(-dir);
                    else {
                      setSort(s.key);
                      setDir(-1);
                    }
                  }}
                >
                  {s.label}
                  {sort === s.key && <span aria-hidden="true">{dir === 1 ? ' ↑' : ' ↓'}</span>}
                </button>
              ))}
            </div>
            <input
              className="ratioed-board-find"
              type="search"
              value={query}
              aria-label="Find a handle"
              placeholder="find a handle"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="ratioed-board-head" aria-hidden="true">
            <span />
            <span>who</span>
            <span>pieces</span>
            <span className="num">audience</span>
            <span>role</span>
          </div>

          <ol className="ratioed-board">
            {visible.map((p) => {
              const path = participantPath(p, slug);
              const role = roleOf(p);
              const profile = profiles[p.did];
              const broke = brokenTakes(p);
              return (
                <li
                  className="ratioed-board-row"
                  key={p.did}
                  /* The top three are the only rows that get a different
                     weight. Past that a leaderboard that decorates every place
                     is just a table with more ink in it. */
                  data-top={p.rank <= 3 || undefined}
                  data-broke={broke.length ? '' : undefined}
                >
                  <span className="ratioed-board-rank">{p.rank}</span>
                  <Who person={p} profile={profile} absent={absent.has(p.did)} path={path} />
                  <span className="ratioed-board-bar">
                    {/* The bar is the distribution: one person at six, a
                        handful at three, and everybody else at one. A chart
                        would say the same thing and take a screen to do it. */}
                    <i style={{ width: `${(p.live / maxPieces) * 100}%` }} />
                    <b>{p.live}</b>
                  </span>
                  {/* `display: contents` on a wide screen, so these three stay
                      grid cells lining up with the header; a flex row under the
                      handle on a narrow one, where six columns don't fit and
                      dropping two of them would be the alternative. */}
                  <span className="ratioed-board-figures">
                    {/* -1 is an account the audience table doesn't know:
                        deactivated, renamed, or never resolved. Not a zero. */}
                    <span className="num" data-label="followers">
                      {p.fr >= 0 ? fmtReach(p.fr) : '·'}
                    </span>
                    <span className="ratioed-board-role">
                      <span className={`ratioed-tag ${role.key}`} title={role.label}>
                        {role.label}
                      </span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>

          {wanted ? (
            <p className="ratioed-piece-note">
              {rows.length === 0
                ? `Nobody here matches “${query.trim()}”.`
                : `${rows.length} of ${board.rows.length} ${rows.length === 1 ? 'matches' : 'match'} “${query.trim()}”.`}
            </p>
          ) : (
            shown < rows.length && (
              <button
                type="button"
                className="ratioed-board-more"
                onClick={() => setShown(rows.length)}
              >
                Show all {rows.length} ({rows.length - shown} more)
              </button>
            )
          )}
        </section>

      </article>
    </PageShell>
  );
}

/** A person's cell: portrait, handle, and the name they were carrying when the
 *  roster was harvested. Linked wherever there is a handle to address. */
function Who({ person, profile, absent, path }) {
  const handle = profile?.handle || person.h;
  const name = profile?.displayName || person.dn || '';
  // Dashed means an account that no longer answers — the AppView was asked and
  // had nobody, or the harvest could never name them — which is what the same
  // frame means on a piece's roster. It used to mean "no portrait yet", which
  // drew every row of the board as deactivated while the portraits loaded. A
  // profile in hand outranks the log: an account logged as unresolvable that
  // answers today is not gone.
  const gone = !profile && (absent || !person.h || person.h === UNRESOLVED);
  const body = (
    <>
      <span className="ratioed-face-frame" data-gone={gone || undefined}>
        {profile?.avatar ? (
          <img src={avatarThumb(profile.avatar)} alt="" loading="lazy" width="36" height="36" />
        ) : (
          <span className="ratioed-face-blank" aria-hidden="true">
            {(handle || '?').slice(0, 1)}
          </span>
        )}
      </span>
      <span className="ratioed-board-name">
        <span className="ratioed-board-handle">@{handle}</span>
        {name && <span className="ratioed-board-dn">{name}</span>}
      </span>
    </>
  );
  return path ? (
    <Link className="ratioed-board-who" to={path}>
      {body}
    </Link>
  ) : (
    <span className="ratioed-board-who">{body}</span>
  );
}
