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
  breakingWitness,
  withdrawnOnly,
} from '../lib/ratioedLive.js';
import { fmtDuration } from '../lib/ratioed.js';
import { DEFAULT_COPY } from '../lib/ratioedCopy.js';
import { ME_DID } from '../config.js';
import RatioedStanding, { RatioedCounts } from './RatioedStanding.jsx';
import RatioedTicker from './RatioedTicker.jsx';
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

  const breaking = useMemo(() => breakingWitness(rows), [rows]);
  const takenBack = useMemo(() => withdrawnOnly(rows), [rows]);
  const aliveMs = Number.isFinite(postedMs) ? Math.max(0, now - postedMs) : 0;
  // Likes cast and taken back, where on the piece's clock they landed.
  const marks = useMemo(
    () =>
      rows
        .filter((r) => r.k === 'like' && r.goneMs != null && r.did !== ME_DID)
        .map((r) => ({
          offMs: r.offMs,
          title: `liked at +${fmtDuration(r.offMs)}, taken back at +${fmtDuration(r.goneMs)}`,
        })),
    [rows],
  );
  const reading = streamReading({
    on: streamOn,
    spent,
    paused: streamOn && !spent && !visible,
    stream,
  });

  // The ledger, as the studio reads it: a head, a statement, the artist's own
  // sentence for the state it is in, what it has drawn, and the thread. The
  // artist's own records are in the log and in none of the counts — the same
  // rule every measured figure on this project follows, and it matters more
  // here than anywhere: the studio can reply from the dashboard, and those
  // replies would otherwise read as the piece drawing a crowd.
  return (
    <div className={`ratioed-live${breaking ? ' is-broken' : takenBack ? ' is-withdrawn' : ''}`}>
      <header className="ratioed-live-head">
        <p className="ratioed-live-label">
          <span className="ratioed-live-pulse" aria-hidden="true" />
          {breaking ? 'Liked' : 'Live'}
        </p>
        {/* The switch for the firehose, at the head where it is found; what it
            is reading, and what that costs, are at the thread's head below. */}
        {reading.state === 'spent' ? (
          <button
            type="button"
            className="ratioed-live-act"
            onClick={() => {
              spentBytes.current = 0;
              setSpent(false);
              setRun((n) => n + 1);
            }}
          >
            start it again
          </button>
        ) : (
          <button
            type="button"
            className="ratioed-live-act"
            onClick={() => setStreamOn((v) => !v)}
            title={reading.explain}
          >
            {streamOn ? 'stop the firehose' : 'watch the firehose'}
          </button>
        )}
      </header>

      {/* How long it has stood and how that compares, or — once somebody has
          liked it — who, and the reaction time being taken: it stops when the
          artist closes replies, and where it stops is what the record says. */}
      <RatioedStanding
        aliveMs={aliveMs}
        record={record}
        pieces={series}
        marks={marks}
        like={
          breaking
            ? {
                handle: profiles[breaking.did]?.handle || breaking.h || 'somebody',
                offMs: breaking.offMs,
                atMs: postedMs + breaking.offMs,
              }
            : null
        }
        clockLabel="unsealed, and being timed"
        clockFirst
      />

      {/* Three sentences, one per state, and all three are the artist's rather
          than the build's — see lib/ratioedCopy.js. */}
      <p className="ratioed-live-say" aria-live="polite">
        {breaking ? copy.deckLiked : takenBack ? copy.deckWithdrawn : copy.deckAlive}
      </p>
      <RatioedCounts rows={rows} selfDid={ME_DID} className="ratioed-live-counts" />

      <div className="ratioed-live-thread-head">
        <h2 className="ratioed-live-thread-label">What has touched it</h2>
        <span className={`ratioed-live-state is-${reading.state}`} title={reading.explain}>
          {reading.state !== 'off' && <Radio size={12} aria-hidden="true" />}
          {reading.label}
        </span>
      </div>
      <RatioedTicker rows={rows} profiles={profiles} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

/**
 * What the stream is doing, in numbers that move, for the thread's head.
 *
 * The rate is the honest one: a watch on a piece nobody has touched matches
 * nothing for minutes, and a reading whose only number is a byte count that
 * also only moved on a match looked broken for exactly as long as it was
 * working. `explain` is what used to be a paragraph of apparatus under the
 * deck; it rides on the reading's title now, where somebody who wants it can
 * ask for it.
 */
function streamReading({ on, spent, paused, stream }) {
  const mb = ((stream?.bytes || 0) / 1024 / 1024).toFixed(1);
  const state = !on ? 'off' : spent ? 'spent' : paused ? 'paused' : stream?.state || 'connecting';
  const label = !on
    ? 'from the record, seconds behind'
    : state === 'paused'
      ? 'paused in a background tab'
      : state === 'spent'
        ? `stopped at ${mb} MB`
        : state === 'open'
          ? `firehose · ${(stream?.rate || 0).toLocaleString()}/s · ${mb} MB`
          : state;
  const explain = on
    ? `Your browser is testing every record on the network against this post, about 166 KB/s. It pauses in a background tab and stops at ${BUDGET_BYTES / 1024 / 1024} MB.`
    : 'Reading the piece’s own record, a few seconds behind.';
  return { state, label, explain };
}
