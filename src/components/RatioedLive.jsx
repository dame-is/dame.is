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
// A sealed piece has no use for any of this: there is nothing left to notice.
// Its log lives on under the replay, arriving off the replay's own playhead —
// same rows, same component, one clock.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { watchSubject } from '../lib/jetstream.js';
import { useProfiles } from '../hooks/useProfiles.js';
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
import { DEFAULT_COPY } from '../lib/ratioedCopy.js';
import { ME_DID } from '../config.js';
import RatioedChip from './RatioedChip.jsx';
import RatioedClock from './RatioedClock.jsx';
import RatioedRecord from './RatioedRecord.jsx';
import RatioedTicker, { RatioedCounters } from './RatioedTicker.jsx';
import './RatioedLive.css';

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

/* ------------------------------------------------------------------ */

/**
 * The live deck. `piece` is the record as it stands; its `witnessed` log seeds
 * the ticker, so somebody arriving forty seconds in sees the forty seconds they
 * missed rather than an empty panel.
 */
export default function RatioedLive({ piece, record = null, series = null, copy = DEFAULT_COPY }) {
  const postedMs = Date.parse(piece?.postedAt || '');
  const [rows, setRows] = useState(() => piece?.witnessed || []);
  const [now, setNow] = useState(() => Date.now());
  // Off until somebody turns it on, as the header says. It used to start on
  // any connection that didn't report itself as slow — and Safari and every
  // browser on iOS report nothing at all, while a phone on 4G reports "4g" —
  // so the visitors arriving from a Bluesky link on a phone, which is most of
  // them, were reading 166 KB/s of other people's posts without being asked.
  const [streamOn, setStreamOn] = useState(false);
  const [stream, setStream] = useState(null);
  const [run, setRun] = useState(0);
  // What every socket this deck has opened has cost between them. The budget
  // is the deck's, not one socket's: each `watchSubject` counts from zero, so
  // when backgrounding the tab closed the stream and coming back reopened it,
  // a stream that had spent its 256 MB came back with another 256 MB, and
  // again on every switch, without "start it again" ever being pressed.
  const spentBytes = useRef(0);
  const [spent, setSpent] = useState(false);
  // Reading a firehose into a tab nobody is looking at is the one kind of
  // waste here with nothing on the other side of it. The record poll backfills
  // whatever the socket missed the moment the tab is back, so a visitor who
  // returns to it has lost nothing but the milliseconds.
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
    if (!streamOn || spent || !visible || !piece?.subject || !Number.isFinite(postedMs)) {
      return undefined;
    }
    const before = spentBytes.current;
    const left = BUDGET_BYTES - before;
    // Never opened on nothing: `watchSubject` reads a budget of zero as no
    // budget at all.
    if (left <= 0) {
      setSpent(true);
      return undefined;
    }
    return watchSubject(piece.subject, {
      budgetBytes: left,
      onStatus: (status) => {
        spentBytes.current = before + (status.bytes || 0);
        setStream({ ...status, bytes: spentBytes.current });
        if (status.state === 'spent') setSpent(true);
      },
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
  }, [streamOn, spent, visible, run, piece?.subject, postedMs]);

  // Faces and names for whoever turns up, resolved as new DIDs appear. The log
  // carries the handle the studio stamped in; this is what makes it a face.
  // Each account is asked about once, an answer is kept whenever it lands, and
  // a miss is asked again a few times and then left; see profileAsker.
  const profiles = useProfiles(rows.map((r) => r.did));

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
          spent={spent}
          paused={streamOn && !spent && !visible}
          stream={stream}
          onToggle={() => setStreamOn((v) => !v)}
          onRestart={() => {
            spentBytes.current = 0;
            setSpent(false);
            setRun((n) => n + 1);
          }}
        />
      </header>

      {/* The clock says how long. This says whether that is a lot. */}
      <RatioedRecord elapsedMs={aliveMs} record={record} pieces={series} />

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

      <RatioedCounters tally={tally} />
      <RatioedTicker rows={rows} profiles={profiles} />

    </div>
  );
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

/**
 * What the stream is doing, in numbers that move.
 *
 * The rate is the honest one: a watch on a piece nobody has touched matches
 * nothing for minutes, and a panel whose only number is a byte count that also
 * only moved on a match looked broken for exactly as long as it was working.
 */
function StreamState({ on, spent, paused, stream, onToggle, onRestart }) {
  const mb = ((stream?.bytes || 0) / 1024 / 1024).toFixed(1);
  const state = !on
    ? 'off'
    : spent
      ? 'spent'
      : paused
        ? 'paused'
        : stream?.state || 'connecting';
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
  // The paragraph that used to spell this out is gone from the page — it was
  // four sentences of apparatus under a dashboard whose whole point is the one
  // thing happening on it. What it said that a reader might actually want is
  // kept here, on the chip that already shows the cost and offers the switch.
  const explain = on
    ? `Your browser is testing every record on the network against this post, about 166 KB/s. It pauses in a background tab and stops at ${BUDGET_BYTES / 1024 / 1024} MB.`
    : 'Reading the piece’s own record, a few seconds behind.';
  return (
    <span className="ratioed-live-stream">
      <span className={`ratioed-live-state is-${state}`} title={explain}>
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
