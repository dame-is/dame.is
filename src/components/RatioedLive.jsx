// A Ratioed piece while it is still happening.
//
// Every other view of this project is retrospective, and has to be: the numbers
// are a dated measurement, the like that ended a piece is usually deleted within
// minutes, and the whole apparatus exists because live state cannot be trusted
// to still be there tomorrow. This is the one view that is not. For the seconds
// or minutes a piece is up there is nothing to reconstruct, because it is
// happening — and the argument the essay makes with charts ("these things were
// over before most people saw them") is available here as an experience rather
// than a claim, which is a different and better way to make it.
//
// Two readers, and a visitor gets to choose how much they spend on this.
//
//   The record. The studio writes what it witnesses onto the piece's own record
//   as the piece runs, so this page can show the same log a few seconds behind
//   for the cost of one small fetch. That is the default, and on a phone on a
//   train it is the whole thing.
//
//   The firehose. Jetstream can't filter by what a record points at, so
//   watching one post means reading everything and testing each one — ~166 KB/s
//   for sub-second notice. The studio pays that because a reaction time is
//   being measured. Nothing is being measured here, so it is offered, labelled
//   with what it costs, and stopped at a budget.
//
// Sealed pieces get the same deck under RatioedWitness, closed by default and
// replayable — by then the piece is over and expanding it automatically would
// be showing an emergency that has already ended.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Radio, ArrowUpRight } from 'lucide-react';
import { watchSubject } from '../lib/jetstream.js';
import { resolveProfiles } from '../lib/atproto.js';
import {
  witnessRow,
  mergeWitness,
  mergeWitnessRow,
  withdrawWitness,
  witnessChanged,
  tallyWitness,
  breakingWitness,
  withdrawnOnly,
} from '../lib/ratioedLive.js';
import { fmtDuration } from '../lib/ratioed.js';
import { DEFAULT_COPY, fillCopy } from '../lib/ratioedCopy.js';
import { ME_DID } from '../config.js';
import RatioedChip from './RatioedChip.jsx';
import RatioedClock from './RatioedClock.jsx';
import RatioedRecord from './RatioedRecord.jsx';
import { useWaypointsModal } from '../hooks/useWaypointsModal.jsx';
import './RatioedLive.css';

// A witnessed row names a DID and a record key; this is the at:// URI they
// spell, so a reader can open the post itself in whatever client they use.
// Only the two kinds that are posts — a like and a repost are records nobody
// wants to look at.
const OPENABLE = { quote: 'app.bsky.feed.post', reply: 'app.bsky.feed.post' };
const rowUri = (r) =>
  OPENABLE[r?.k] && r.did && r.rkey ? `at://${r.did}/${OPENABLE[r.k]}/${r.rkey}` : '';

// What one visitor's stream is allowed to cost before it stops itself: about
// half an hour at the measured rate, several times the longest piece the series
// has produced. The studio runs with no budget at all, because the studio is
// the artist's own machine and stopping is how a piece gets missed. This is
// somebody else's machine, and a page that reads a firehose indefinitely
// because it was left open is not a thing anybody agreed to.
//
// Spending it is not the end of the deck either way: the piece's record is
// still being polled underneath, the ticker keeps filling from it, and starting
// the stream again keeps every row already on screen.
const BUDGET_BYTES = 256 * 1024 * 1024;

// How often the deck's own clock ticks. The piece's record is polled by the
// page that owns it, not here.
const TICK_MS = 1000;

/** Is this a connection somebody would want a firehose on by default? */
function firehoseIsPolite() {
  if (typeof navigator === 'undefined') return false;
  const c = navigator.connection;
  if (c?.saveData) return false;
  if (c?.effectiveType && /2g|3g/.test(c.effectiveType)) return false;
  return true;
}

/* ------------------------------------------------------------------ */

/**
 * The live deck. `piece` is the record as it stands; its `witnessed` log seeds
 * the ticker, so somebody arriving forty seconds in sees the forty seconds they
 * missed rather than an empty panel.
 */
export default function RatioedLive({ piece, record = null, copy = DEFAULT_COPY }) {
  const postedMs = Date.parse(piece?.postedAt || '');
  const [rows, setRows] = useState(() => piece?.witnessed || []);
  const [profiles, setProfiles] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const [streamOn, setStreamOn] = useState(firehoseIsPolite);
  const [stream, setStream] = useState(null);
  const [run, setRun] = useState(0);
  // Reading a firehose into a tab nobody is looking at is the one kind of
  // waste here with nothing on the other side of it. The record poll carries
  // on regardless and backfills whatever the socket missed, so a visitor who
  // comes back to the tab has lost nothing but the milliseconds.
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Whatever the record has picked up since. The studio is a second witness
  // with a better view — it has been watching since the piece went up — so its
  // log is folded in rather than competed with.
  const recorded = piece?.witnessed;
  useEffect(() => {
    if (!recorded?.length) return;
    setRows((r) => {
      const next = mergeWitness(r, recorded);
      return witnessChanged(r, next) ? next : r;
    });
  }, [recorded]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!streamOn || !visible || !piece?.subject || !Number.isFinite(postedMs)) return undefined;
    return watchSubject(piece.subject, {
      budgetBytes: BUDGET_BYTES,
      onStatus: setStream,
      onEvent: (ev) => {
        setRows((r) => {
          if (ev.op === 'delete') {
            return withdrawWitness(r, ev.rkey, ev.time ? Date.parse(ev.time) : Date.now(), postedMs);
          }
          const row = witnessRow(ev, postedMs);
          return row ? mergeWitnessRow(r, row) : r;
        });
      },
    });
  }, [streamOn, visible, run, piece?.subject, postedMs]);

  // Faces and names for whoever turns up, resolved as new DIDs appear. The log
  // carries the handle the studio stamped in; this is what makes it a face.
  useEffect(() => {
    const missing = rows.map((r) => r.did).filter((d) => d && !profiles[d]);
    if (!missing.length) return;
    resolveProfiles(Array.from(new Set(missing))).then((p) =>
      setProfiles((old) => ({ ...old, ...p })),
    );
  }, [rows, profiles]);

  // The artist's own records are in the log and in none of the counts — the
  // same rule every measured figure on this project follows, and it matters
  // more here than anywhere: the studio can now reply from the dashboard, and
  // those replies would otherwise read as the piece drawing a crowd.
  const tally = useMemo(() => tallyWitness(rows, { selfDid: ME_DID }), [rows]);
  const breaking = useMemo(() => breakingWitness(rows), [rows]);
  const takenBack = useMemo(() => withdrawnOnly(rows), [rows]);
  const aliveMs = Number.isFinite(postedMs) ? Math.max(0, now - postedMs) : 0;

  return (
    <div className={`ratioed-live${breaking ? ' is-broken' : takenBack ? ' is-withdrawn' : ''}`}>
      <header className="ratioed-live-head">
        <span className="ratioed-live-pulse" aria-hidden="true" />
        <span className="ratioed-live-clock">
          <span className="ratioed-live-clock-value">{fmtDuration(aliveMs)}</span>
          <span className="ratioed-live-clock-label">alive, and counting</span>
        </span>
        <StreamState
          on={streamOn}
          paused={streamOn && !visible}
          stream={stream}
          onToggle={() => setStreamOn((v) => !v)}
          onRestart={() => setRun((n) => n + 1)}
        />
      </header>

      {/* The clock says how long. This says whether that is a lot. */}
      <RatioedRecord elapsedMs={aliveMs} record={record} />

      {/* The like is not one more row in the feed. It is the end of the piece,
          and this is where the page says so at the size it deserves. */}
      {breaking && (
        <div className="ratioed-live-alarm" role="status">
          <RatioedChip kind="like" size="lg" />
          <span className="ratioed-live-alarm-who">
            @{profiles[breaking.did]?.handle || breaking.h || 'somebody'}
            <span className="ratioed-live-alarm-when">at +{fmtDuration(breaking.offMs)}</span>
          </span>
          {/* The measurement, running. This is the reaction time being taken —
              it stops when the artist closes replies, and where it stops is
              what the record will say. */}
          <span className="ratioed-live-alarm-race">
            <RatioedClock fromMs={postedMs + breaking.offMs} className="ratioed-live-alarm-clock" />
            <span className="ratioed-live-alarm-label">unsealed, and being timed</span>
          </span>
        </div>
      )}

      {/* Three sentences, one per state, and all three are the artist's rather
          than the build's — see lib/ratioedCopy.js. */}
      <p className="ratioed-live-say" aria-live="polite">
        {breaking ? copy.deckLiked : takenBack ? copy.deckWithdrawn : copy.deckAlive}
      </p>

      <Counters tally={tally} />
      <Ticker rows={rows} profiles={profiles} />

      <p className="ratioed-live-note">
        {stream?.msgs > 0 && streamOn && (
          <>
            {stream.msgs.toLocaleString()} records read, {tally.total + tally.withdrawn} of them
            about this post.{' '}
          </>
        )}
        {streamOn
          ? fillCopy(copy.deckStream, { budget: BUDGET_BYTES / 1024 / 1024 })
          : copy.deckRecord}{' '}
        This is a witness. The figures after the seal are read from a backlink index and will not
        match.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The same deck for a piece that is over: closed, and replayable.
 *
 * A sealed piece has nothing to watch, so nothing opens by itself here — the
 * page's own replay and figures are the retrospective view, and this is the
 * live one kept as it ran. What it holds that nothing else does is the
 * withdrawals: a like cast and deleted leaves no record for any index to
 * report, and this log saw it.
 */
export function RatioedWitness({ piece }) {
  // Memoised because the effects below key off it: a fresh [] every render
  // would re-resolve every profile on every render, forever.
  const rows = useMemo(() => piece?.witnessed || [], [piece?.witnessed]);
  const lifespanMs = piece?.lifespanMs || 0;
  const [profiles, setProfiles] = useState({});
  const [head, setHead] = useState(Infinity); // ms after postedAt that has "happened"
  const [playing, setPlaying] = useState(false);
  const frame = useRef(0);

  // The full span the log covers, which can run past the seal by whatever the
  // studio was still watching when the gate went up.
  const spanMs = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.goneMs ?? r.offMs), lifespanMs) || 1,
    [rows, lifespanMs],
  );
  // Real time up to a couple of minutes; past that, a fixed sweep. Same rule the
  // replay above it plays by, and for the same reason: a piece that stood for
  // seventeen seconds should take seventeen seconds to watch.
  const rate = spanMs <= 120_000 ? 1 : spanMs / 8000;

  useEffect(() => {
    const dids = rows.map((r) => r.did).filter(Boolean);
    if (!dids.length) return;
    resolveProfiles(Array.from(new Set(dids))).then(setProfiles);
  }, [rows]);

  useEffect(() => {
    if (!playing) return undefined;
    let last = null;
    const step = (t) => {
      if (last == null) last = t;
      const dt = t - last;
      last = t;
      setHead((h) => {
        const next = h + dt * rate;
        if (next >= spanMs) {
          setPlaying(false);
          return Infinity;
        }
        return next;
      });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [playing, rate, spanMs]);

  const play = useCallback(() => {
    setHead(0);
    setPlaying(true);
  }, []);

  // Withdrawals only strike through once the playhead reaches them, so the
  // moment somebody took their like back is a thing that happens rather than a
  // thing that was always true.
  const shown = useMemo(
    () =>
      rows
        .filter((r) => r.offMs <= head)
        .map((r) => (r.goneMs != null && r.goneMs > head ? { ...r, goneMs: undefined } : r)),
    [rows, head],
  );
  const tally = useMemo(() => tallyWitness(shown, { selfDid: ME_DID }), [shown]);

  if (!rows.length) return null;

  return (
    <div className="ratioed-live is-replay">
      <div className="ratioed-live-controls">
        <button type="button" className="ratioed-live-play" onClick={() => (playing ? setPlaying(false) : play())}>
          {playing ? 'Pause' : 'Watch it run'}
        </button>
        <span className="ratioed-live-clock-value">
          {head === Infinity ? fmtDuration(spanMs) : `+${fmtDuration(head)}`}
        </span>
        {head !== Infinity && !playing && (
          <button type="button" className="ratioed-live-skip" onClick={() => setHead(Infinity)}>
            show all of it
          </button>
        )}
      </div>
      <Counters tally={tally} />
      {/* Quiet: the like that ended this one ended it a long time ago, and a
          chip that throbs about it now would be theatre. */}
      <Ticker rows={shown} profiles={profiles} quiet />
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * What the stream is doing, in numbers that move.
 *
 * The rate is the honest one: a watch on a piece nobody has touched matches
 * nothing for minutes, and a panel whose only number is a byte count that also
 * only moved on a match looked broken for exactly as long as it was working.
 */
function StreamState({ on, paused, stream, onToggle, onRestart }) {
  const mb = ((stream?.bytes || 0) / 1024 / 1024).toFixed(1);
  const state = !on ? 'off' : paused ? 'paused' : stream?.state || 'connecting';
  const rate = stream?.rate ? `${stream.rate.toLocaleString()}/s · ` : '';
  const label = !on
    ? 'from the record'
    : paused
      ? 'paused, this tab is in the background'
      : state === 'spent'
        ? `stopped at ${mb} MB`
        : state === 'open'
          ? `${rate}${mb} MB read`
          : state;
  return (
    <span className="ratioed-live-stream">
      <span className={`ratioed-live-state is-${state}`}>
        <Radio size={12} aria-hidden="true" />
        {label}
      </span>
      {state === 'spent' ? (
        <button type="button" onClick={onRestart}>start it again</button>
      ) : (
        <button type="button" onClick={onToggle}>
          {on ? 'stop the firehose' : 'watch the firehose'}
        </button>
      )}
    </span>
  );
}

/** The counts, with the like given the weight the project gives it. */
function Counters({ tally }) {
  const cells = [
    ['replies', tally.replies],
    ['reposts', tally.reposts],
    ['quotes', tally.quotes],
    ['likes', tally.likes],
    ['people', tally.people],
  ];
  return (
    <dl className="ratioed-live-counters">
      {cells.map(([label, value]) => (
        <div key={label} className={label === 'likes' && value > 0 ? 'is-fatal' : undefined}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      {tally.withdrawn > 0 && (
        <div className="is-gone">
          <dt>taken back</dt>
          <dd>{tally.withdrawn}</dd>
        </div>
      )}
    </dl>
  );
}

/** Newest first, the way a feed is read. `quiet` mutes a replayed alarm. */
function Ticker({ rows, profiles, quiet = false }) {
  const { openWaypoints } = useWaypointsModal();
  if (!rows.length) {
    return (
      <p className="ratioed-live-empty">
        Nothing has touched it yet. That is the piece working.
      </p>
    );
  }
  return (
    <ul className="ratioed-live-ticker">
      {[...rows].reverse().map((r) => {
        const handle = profiles[r.did]?.handle || r.h || r.did?.slice(0, 18) || 'somebody';
        const avatar = profiles[r.did]?.avatar;
        const mine = r.did === ME_DID;
        return (
          <li
            key={r.rkey}
            className={`ratioed-live-row ratioed-k-${r.k}${r.goneMs != null ? ' is-gone' : ''}${
              mine ? ' is-self' : ''
            }`}
          >
            <span className="ratioed-live-when">+{fmtDuration(r.offMs)}</span>
            {avatar ? (
              <img className="ratioed-live-face" src={avatar} alt="" loading="lazy" width="22" height="22" />
            ) : (
              <span className="ratioed-live-face is-blank" aria-hidden="true" />
            )}
            <span className="ratioed-live-who">
              @{handle}
              {mine && <span className="ratioed-live-self"> the artist</span>}
            </span>
            <RatioedChip kind={r.k} muted={quiet || r.goneMs != null} />
            {r.goneMs != null && (
              <span className="ratioed-live-undone">deleted it at +{fmtDuration(r.goneMs)}</span>
            )}
            {r.t && <span className="ratioed-live-text">{r.t}</span>}
            {/* Read it where you read things. The picker is the same one every
                at:// link on this site goes through. */}
            {r.goneMs == null && rowUri(r) && (
              <button
                type="button"
                className="ratioed-live-open"
                onClick={() => openWaypoints(rowUri(r))}
                title={`Open @${handle}’s ${r.k} in another client`}
                aria-label={`Open this ${r.k} in another client`}
              >
                <ArrowUpRight size={13} aria-hidden="true" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
