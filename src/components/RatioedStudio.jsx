// The Ratioed studio: compose a piece, watch it, seal it, announce it.
//
// A piece has a fixed lifecycle that dame has been running by hand since June
// 2025 — write the post, watch, close replies the instant somebody likes it,
// reply naming them, measure. Every step of that is here except the one that
// matters: the studio never seals on its own. The reaction time is the
// project's central finding and it measures a person noticing; a loop that
// sealed for you would replace it with a polling interval and end the
// measurement without saying so. What the studio does instead is watch hard
// and shout, so the person noticing does it sooner.
//
// The piece's RECORD is written when the post goes up, not when it's sealed.
// That's what makes the link inside the post work while the piece is still
// alive, and it's why the lexicon's seal fields are optional (see the note on
// `isLive`). Sealing fills them in.
//
// As a studio it is a BODY, not a page: the workbench pane draws the title, the
// blurb and the NSID, and the rail is the way back — so this file renders no
// PageShell and no back link of its own. Two things follow from living in a
// shell that never remounts:
//
//  1. **Seal is not routed through the shell's status strip.** Every
//     millisecond between the like and the threadgate write is in the recorded
//     reaction time, so the button stays here, next to the alarm, with no
//     confirm and no debounce in front of it. Nothing in this studio is a
//     staged edit waiting on a generic Save, so it reports no dirty state
//     either.
//  2. **Unmounting is what stops the watch.** The pane keys the studio on the
//     surface, so selecting another surface really does unmount this component
//     — and the effect teardowns below are the only thing that close a ~166
//     KB/s firehose socket, an 8s poll and a 1s clock. Every effect that starts
//     something here returns the thing that stops it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RichText } from '@atproto/api';
import {
  Send,
  Lock,
  RefreshCw,
  ExternalLink,
  ArrowUpRight,
  Radio,
  Wrench,
  Heart,
  HeartOff,
  MessageSquareReply,
  UserPen,
  FileText,
  Coffee,
} from 'lucide-react';
import RatioedChip from './RatioedChip.jsx';
import RatioedClock from './RatioedClock.jsx';
import RatioedRecord from './RatioedRecord.jsx';
import RatioedTicker, { RatioedCounters } from './RatioedTicker.jsx';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import { useWaypointsModal } from '../hooks/useWaypointsModal.jsx';
import { COLLECTIONS, ME_DID, ME_HANDLE, RATIOED_PATH } from '../config.js';
import {
  loadPieces,
  readPieces,
  normalizePiece,
  isLive,
  finished,
  longestPiece,
  piecePath,
  pieceSlug,
  fetchPieceRecords,
  fmtDuration,
  fmtSeconds,
} from '../lib/ratioed.js';
import { measureWindows, buildEventLog, UNRESOLVED_HANDLE } from '../lib/ratioedDiscovery.js';
import { pieceGaps, repairPiece } from '../lib/ratioedRepair.js';
import { COPY_FIELDS, DEFAULT_COPY, mergeCopy } from '../lib/ratioedCopy.js';
import { pieceReach, fmtReach } from '../lib/ratioedReach.js';
import {
  witnessRow,
  witnessToRecord,
  witnessFromRecord,
  mergeWitness,
  mergeWitnessRow,
  withdrawWitness,
  witnessChanged,
  breakingWitness,
  withdrawnOnly,
  tallyWitness,
  resolveBreaker,
} from '../lib/ratioedLive.js';
import {
  DEFAULT_TEMPLATE,
  DEFAULT_ANNOUNCEMENT,
  fillTemplate,
  loadTemplateRecord,
  templateProblems,
  nextTake,
  previousPiece,
  announcementDraft,
  announcementParts,
  announcementProblems,
  shortenPost,
  announcementLengths,
  graphemes,
  ANNOUNCEMENT_TOKENS,
  ANNOUNCEMENT_BREAK,
  FEED_MAX as POST_MAX,
} from '../lib/ratioedStudio.js';
import { watchSubject } from '../lib/jetstream.js';
import {
  resolvePds,
  getRecord,
  getLikes,
  getPosts,
  resolveProfiles,
  resolveHandle,
  rkeyFromAtUri,
  tidToTimestamp,
} from '../lib/atproto.js';
import { ratioedScaleVars } from '../lib/ratioedPalette.js';
import { useTheme } from '../hooks/useTheme.jsx';
import './RatioedStudio.css';

const NSID = COLLECTIONS.ratioedPiece;
const TEMPLATE_NSID = COLLECTIONS.ratioedTemplate;
const COPY_NSID = COLLECTIONS.ratioedCopy;
const POST = 'app.bsky.feed.post';
const GATE = 'app.bsky.feed.threadgate';
const LIKE = 'app.bsky.feed.like';

// How often the live watch asks the AppView whether anybody has liked it.
//
// The stream is the fast reader and the poll is the backstop, which is why this
// stays on even while the socket is open: a websocket can drop, a laptop can
// sleep through a reconnect, and the cost of missing the one like this whole
// panel exists to catch is the piece. Slower than it was, because the stream is
// now doing the noticing.
const WATCH_MS = 8000;

// How many rows the feed keeps. Enough to hold any piece the project has ever
// produced several times over, and a ceiling all the same. Past it the EARLIEST
// rows are the ones kept: the beginning of a piece is where the reaction time
// lives, and the end of a runaway thread is where it doesn't.
const FEED_MAX = 300;

// How long a new arrival waits before the witnessed log is written to the piece's
// record. Short enough that the piece's own page, which reads that record, is
// never far behind what the studio can see; long enough that a burst of replies
// is one write rather than nine.
const WITNESS_SAVE_MS = 2500;

// And how long the log is allowed to go unwritten while arrivals keep resetting
// that timer. A busy piece must still reach the record.
const WITNESS_SAVE_MAX_MS = 12_000;


// How long a live read gets before this panel calls what it has final.
const PDS_DEADLINE_MS = 6000;

/** Resolve to null rather than hang. */
function deadline(promise, ms = PDS_DEADLINE_MS) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);
}

/** The subject post's at:// URI for a piece record key. */
const subjectUri = (rkey) => `at://${ME_DID}/${POST}/${rkey}`;

/** A piece's subject: the field the record carries, or the key it implies. */
const subjectOf = (piece) => piece?.subject || subjectUri(piece?.rkey);

/** `[did, handle]` pairs as a map, dropping the ones missing either half. */
const namedHandles = (pairs) => Object.fromEntries(pairs.filter(([d, h]) => d && h));

// Which collection a witnessed row lives in. A quote and a reply are both
// posts; only the way they point at the piece differs.
const KIND_COLLECTION = {
  like: 'app.bsky.feed.like',
  repost: 'app.bsky.feed.repost',
  quote: POST,
  reply: POST,
};

/**
 * The at:// URI of a witnessed row, which the stream gives us in parts.
 *
 * Wider than the ticker's own `rowUri`, deliberately: that one answers "can a
 * reader open this?" and only a post can be opened, while this one has to
 * address a LIKE and a REPOST as well, because the studio deletes and undoes
 * them.
 */
const rowUri = (row) => (row?.did && row?.rkey ? `at://${row.did}/${KIND_COLLECTION[row.k]}/${row.rkey}` : '');

/** The two kinds you can answer. A like and a repost carry no text to answer. */
const ANSWERABLE = new Set(['reply', 'quote']);

// Whether this browser can hold the display on (the Screen Wake Lock API).
// Checked once at module load: the API arrives with the platform, not
// mid-session, and the checkbox only renders where it can do the thing.
const CAN_WAKE = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

export default function RatioedStudio({ agent, did }) {
  const [pieces, setPieces] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState('');

  const [draft, setDraft] = useState('');
  const [likes, setLikes] = useState(null); // AppView view while a piece is up
  const [announce, setAnnounce] = useState(null); // { text, piece, ref } after a seal
  const [now, setNow] = useState(() => Date.now());
  // Set the instant the threadgate lands, before the measurement that follows
  // it. The gate IS the seal; measuring is a slow read over an index that lags.
  // Without this the panel went on offering "Seal this piece" for as long as
  // the read took, on a piece that was already closed.
  const [sealed, setSealed] = useState(null); // { rkey, sealedAt }
  // Which piece's breaker is being named by hand, and what has been typed.
  const [naming, setNaming] = useState(null); // { rkey, text }
  // The strong ref to the piece a new one will quote. Resolved when the
  // composer opens, not when Post is pressed: an embed needs the target post's
  // CID, and looking it up mid-publish means a momentary network failure takes
  // the piece down with it. Resolving early also makes the composer honest —
  // it can say whether the quote is actually in hand.
  const [quote, setQuote] = useState(undefined); // undefined = looking, null = no

  // The template, as stored on the PDS. `undefined` while it's being read;
  // DEFAULT_TEMPLATE when no record exists yet.
  const [template, setTemplate] = useState(undefined);
  // The concluding reply's opening sentence, from the same record. Declared in
  // the lexicon since the beginning and read by nothing until now — the
  // sentence was hardcoded, so the record's promise that the wording changes
  // without a deploy held for the post and not for the reply.
  const [announceTpl, setAnnounceTpl] = useState(null);
  const [tplDraft, setTplDraft] = useState(null); // non-null while editing
  const [annDraft, setAnnDraft] = useState(null);
  // The piece page's own prose. `null` until read; a draft while being edited.
  const [copy, setCopy] = useState(null);
  const [copyDraft, setCopyDraft] = useState(null);

  // What the stream has seen on the live piece, earliest first. Separate from
  // the measurement — this is a witness, not an index — and its value is that
  // it arrives in real time and carries rkeys, so at seal time the breaking
  // like's exact write time is already in hand without waiting for the backlink
  // index to catch up.
  //
  // It is no longer thrown away when the panel closes. It's written to the
  // piece's record as it happens (see saveWitness), which survives this tab,
  // feeds the piece's own public page while it runs, and is the only account
  // that will exist of a like somebody cast and took back.
  const [feed, setFeed] = useState([]);
  // Milliseconds after postedAt at which watching began. Everything before it
  // is unwitnessed rather than empty, and the record says which.
  const [witnessFrom, setWitnessFrom] = useState(null);
  // What has actually reached the record, so a tick of the clock isn't a write.
  // `stop` is the measurement taking the record over at seal time.
  // A post that landed with no record behind it. Blocks a second publish, and
  // offers the one write that is missing.
  const [orphan, setOrphan] = useState(null);
  const askedProfiles = useRef(new Set());
  const savedWitness = useRef({ rows: null, at: 0, busy: false, stop: false });
  const [stream, setStream] = useState(null); // { state, bytes, seen, msgs, rate }
  const [profiles, setProfiles] = useState({});

  // Set when the PLC read misses its deadline and the series is therefore the
  // bundled snapshot rather than a live one. `resolvePds` is an un-timed fetch
  // of a third-party directory — measured here at 8.0s on one run and 24–28s on
  // another — so this says plainly which of the two you are looking at.
  const [pdsSlow, setPdsSlow] = useState(false);

  // Answering the thread from here rather than from the app. Keyed by the
  // target's record key: what has been liked (so it can be un-liked), what is
  // being worked on, and which row has the composer open.
  const [acted, setActed] = useState({}); // rkey → { likeUri }
  const [acting, setActing] = useState(null); // rkey
  const [replyTo, setReplyTo] = useState(null); // a row, plus `text`

  // The chips in the feed use the same scale the charts do, derived from
  // whatever hour the sky is showing: reply, repost and quote are an analogous
  // trio around that hour's hue, and the like is its complement. The studio is
  // where that matters most — it's the one screen somebody reads at a glance
  // while deciding whether to act in the next four seconds.
  const { skyDisplayHour } = useTheme();
  const scale = useMemo(() => ratioedScaleVars(skyDisplayHour), [skyDisplayHour]);

  // The site's own "Open in…" picker, so a row in the feed can be opened in
  // whichever client you actually want to read it in — the same sheet every
  // at:// link on the site goes through.
  const { openWaypoints } = useWaypointsModal();

  const refresh = useCallback(async () => {
    setError(null);
    setPdsSlow(false);
    try {
      // The snapshot first and on its own. Resolving the PDS goes to
      // plc.directory, and waiting on that before showing anything meant a slow
      // or unreachable directory left this panel reading "Reading the series…"
      // indefinitely — with the answer already in hand, and at the one moment
      // it matters most, which is while a piece is up.
      const fromSnap = await loadPieces(null);
      if (fromSnap?.length) setPieces(fromSnap);

      // Then the PDS, which is the only place a piece published since the last
      // build exists. Worth waiting for; not worth waiting for forever.
      const pds = await deadline(resolvePds(did).catch(() => null));
      const read = pds ? await deadline(readPieces(pds).catch(() => null)) : null;
      // Only a read the PDS itself answered counts as current. `loadPieces`
      // swallows a failure and falls through to the snapshot, which is never
      // empty — so testing the result for emptiness detected a slow PLC lookup
      // and nothing else, and a 500 from the PDS installed the build's snapshot
      // in silence while a piece published since that build stood unwatched.
      const fresh = read?.source === 'pds' ? read.pieces : null;
      if (!fresh?.length) setPdsSlow(true);
      setPieces(fresh?.length ? fresh : (prev) => prev ?? fromSnap ?? []);
    } catch (err) {
      setError(err?.message || String(err));
      setPieces((prev) => prev ?? []);
    }
  }, [did]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    // No record yet is the normal state until one is saved, not a fault, so
    // loadTemplate answers with the default rather than throwing. The scan
    // reads the same record through the same function, which is what keeps the
    // post this composes and the post that scan looks for in step.
    loadTemplateRecord(agent, did).then(({ text, announcement }) => {
      if (!alive) return;
      setTemplate(text);
      setAnnounceTpl(announcement);
    });
    // The page's prose, read through the same agent rather than the public
    // snapshot: this studio edits it, so it wants what is on the PDS now.
    agent.com.atproto.repo
      .getRecord({ repo: did, collection: COPY_NSID, rkey: 'self' })
      .then((res) => {
        if (alive) setCopy(mergeCopy(res?.data?.value));
      })
      // No record yet is the ordinary state, and the defaults are the answer.
      .catch(() => {
        if (alive) setCopy(mergeCopy(null));
      });
    return () => {
      alive = false;
    };
  }, [agent, did]);

  const live = useMemo(() => (pieces || []).find(isLive) || null, [pieces]);

  // Whether the piece on screen is the one this session just sealed.
  //
  // `sealed` holds the last seal this tab performed and is cleared in exactly
  // one place — after the announcement reply posts. Dismiss the announcement,
  // or have that reply throw, and it stands. The effects below then read it as
  // "the live piece is sealed" for the whole rest of the session, so publishing
  // the NEXT take opened no socket, ran no poll and wrote no witnessed rows: no
  // alarm could fire, the panel read "Nobody has liked it yet", and the clock
  // counted backwards off a `now` that had stopped ticking. The render already
  // asked the right question further down; the effects were asking a different
  // one.
  const sealedNow = Boolean(live && sealed?.rkey === live.rkey);
  const done = useMemo(() => finished(pieces), [pieces]);
  const take = useMemo(() => nextTake(pieces), [pieces]);
  const prev = useMemo(() => previousPiece(done), [done]);
  // The record a live piece is running at: the longest one that has ended.
  const longest = useMemo(() => longestPiece(done), [done]);

  useEffect(() => {
    if (!prev || live) {
      setQuote(null);
      return undefined;
    }
    let alive = true;
    setQuote(undefined);
    (async () => {
      // Bounded by the same deadline the series read uses. Unbounded, this
      // could sit in "looking" indefinitely against a PLC directory this file
      // has measured at 8s and at 24–28s — and the Post button beside it is
      // disabled for exactly as long, so an untimed lookup is a locked panel.
      const rec = await deadline(
        resolvePds(did)
          .then((pds) => getRecord(pds, { repo: did, collection: POST, rkey: prev.rkey }))
          .catch(() => null),
      );
      if (!alive) return;
      setQuote(rec?.cid ? { uri: subjectUri(prev.rkey), cid: rec.cid } : null);
    })();
    return () => {
      alive = false;
    };
  }, [prev, live, did]);

  // Seed the composer once the take number is known, and leave it alone after —
  // it's a draft, and a background refresh must not overwrite typing.
  useEffect(() => {
    if (!pieces || live || draft || template === undefined) return;
    setDraft(fillTemplate(template, take));
  }, [pieces, live, draft, take, template]);

  // A ticking clock while a piece is up, so "alive for" counts rather than
  // sits. It stops at the seal: after that the number is the lifespan, and a
  // lifespan does not keep growing.
  useEffect(() => {
    if (!live || sealedNow) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live, sealedNow]);

  // The watch. Only runs while something is actually up and unsealed.
  // Either reader will do; the stream simply gets there first.
  const streamLike = breakingWitness(feed);
  const seenLike = Boolean(streamLike) || Boolean(likes?.likes?.length);
  // Somebody liked it and took it back before it was sealed. The alarm must not
  // simply go quiet on that: it's the project's own subject matter happening in
  // front of you, and whether a withdrawn like still ends a piece is a question
  // for the artist, not for a boolean.
  const withdrawn = !seenLike && withdrawnOnly(feed);
  useEffect(() => {
    if (!live || sealedNow) {
      if (!live) setLikes(null);
      return undefined;
    }
    let alive = true;
    const poll = async () => {
      const res = await getLikes(subjectOf(live)).catch(() => null);
      if (alive && res) setLikes(res);
    };
    poll();
    const id = setInterval(poll, WATCH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [live, sealedNow]);

  // A new piece starts a new log. Keyed on the record key rather than on the
  // object, which a background refresh replaces without anything having changed.
  const liveKey = live?.rkey || null;
  const livePostedMs = live ? Date.parse(live.postedAt) : NaN;
  useEffect(() => {
    setFeed([]);
    setWitnessFrom(null);
    setActed({});
    setReplyTo(null);
    savedWitness.current = { rows: null, at: 0, busy: false, stop: false };
  }, [liveKey]);

  // Keeping the vigil on a phone. An untouched screen dims and locks on the
  // OS's own schedule, and a dark screen is a watch that has stopped without
  // saying so — this panel exists so a person sees the like the second it
  // lands. While the box is checked and a piece is up, hold a screen wake
  // lock. The OS drops the lock every time the tab leaves the screen, so the
  // visibility listener takes it back on return; if the platform refuses while
  // the tab is right there on screen (battery saver, mostly), the box unchecks
  // itself rather than claim a vigil it isn't keeping.
  const [keepAwake, setKeepAwake] = useState(false);
  useEffect(() => {
    if (!keepAwake || !liveKey || !CAN_WAKE) return undefined;
    let on = true;
    let lock = null;
    const grab = async () => {
      try {
        const held = await navigator.wakeLock.request('screen');
        if (!on) {
          held.release().catch(() => {});
          return;
        }
        lock = held;
      } catch {
        if (on && document.visibilityState === 'visible') setKeepAwake(false);
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') grab();
    };
    grab();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      on = false;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, [keepAwake, liveKey]);

  // What the record already holds, folded in. This is what makes the studio
  // survivable: a tab closed and reopened mid-piece, or a second one on another
  // machine, picks up everything the first witnessed instead of starting blind
  // and then overwriting it with less.
  const recordedWitness = live?.witnessed;
  const recordedFrom = live?.witnessFromMs;
  useEffect(() => {
    if (!liveKey || !recordedWitness?.length) return;
    // What's already on the record counts as written, so reopening the studio
    // mid-piece doesn't write the same log straight back to it.
    if (!savedWitness.current.rows) {
      savedWitness.current.rows = witnessToRecord(recordedWitness);
    }
    setFeed((f) => {
      const next = mergeWitness(f, recordedWitness);
      return witnessChanged(f, next) ? next : f;
    });
    setWitnessFrom((v) =>
      typeof recordedFrom === 'number' ? Math.min(v ?? recordedFrom, recordedFrom) : v,
    );
  }, [liveKey, recordedWitness, recordedFrom]);

  // The stream. Open only while a piece is actually up and unsealed — it is a
  // firehose, ~180 KB/s, and it exists to shave four seconds off noticing one
  // like. The moment the piece is sealed there is nothing left to notice.
  useEffect(() => {
    if (!live || sealedNow) return undefined;
    setWitnessFrom((v) => v ?? Math.max(0, Date.now() - livePostedMs));
    const close = watchSubject(subjectOf(live), {
      // No budget here. A cap made sense while this was a curiosity; it does not
      // survive contact with a piece that stands for an hour, because the thing
      // the cap ends is the watch, and the watch is the measurement. The bytes
      // are the artist's own and are reported as they accrue; the socket closes
      // with the panel, and on the seal, which is when there is nothing left to
      // notice. There is no switch, because there was never a moment during a
      // piece when throwing it was the right thing to do.
      budgetBytes: null,
      onStatus: setStream,
      onEvent: (ev) => {
        setFeed((f) => {
          if (ev.op === 'delete') {
            // Somebody taking it back, watched rather than inferred. Six of the
            // thirteen breaking likes were deleted; this is the only way to see
            // one happen — and now the only way it gets recorded.
            return withdrawWitness(f, ev.rkey, ev.time ? Date.parse(ev.time) : Date.now(), livePostedMs);
          }
          const row = witnessRow(ev, livePostedMs);
          if (!row) return f;
          // Bounded: a piece draws tens of records, but this is pointed at
          // whatever post it's given and must not grow forever.
          if (f.length >= FEED_MAX && !f.some((x) => x.rkey === row.rkey)) return f;
          return mergeWitnessRow(f, row);
        });
      },
    });
    return close;
  }, [live, sealedNow, livePostedMs]);

  // Faces for whoever turns up. Resolved in batches as new DIDs appear.
  //
  // Cancellable: on a busy piece this re-runs every time the stream delivers an
  // unknown DID, so a surface flip can leave several of these in flight against
  // an AppView that answers in its own time. Without the guard each one lands
  // on an unmounted component.
  useEffect(() => {
    // Asked-for rather than answered-for: `resolveProfiles` omits a DID it
    // could not resolve instead of throwing, so a single deactivated
    // participant kept `missing` non-empty and this effect re-armed itself
    // against the AppView for the rest of the piece.
    const missing = feed
      .map((e) => e.did)
      .filter((d) => d && !profiles[d] && !askedProfiles.current.has(d));
    if (!missing.length) return undefined;
    const batch = Array.from(new Set(missing));
    for (const d of batch) askedProfiles.current.add(d);
    let alive = true;
    resolveProfiles(batch).then((p) => {
      if (alive) setProfiles((old) => ({ ...old, ...p }));
    });
    return () => {
      alive = false;
    };
  }, [feed, profiles]);

  /**
   * Write the witnessed log onto the piece's record, mid-piece.
   *
   * A read-modify-write rather than a blind put: the record is small and the
   * piece is live, but the seal writes the same key and losing a measurement to
   * a late witness write would be much worse than losing a witness row. If the
   * record has been sealed since this was scheduled, the measurement owns it
   * from here and this backs off entirely.
   *
   * Never surfaces an error. The log is a bonus on top of the watch; a PDS
   * hiccup must not put a red line across the panel at the one moment its job
   * is to show one like.
   */
  async function saveWitness(piece, rows, fromMs) {
    if (!piece || !rows.length || savedWitness.current.busy || savedWitness.current.stop) return;
    savedWitness.current.busy = true;
    try {
      const current = await readPiece(piece.rkey);
      if (current.sealedAt) return; // measured since; not ours to write
      // Folded over what the record already holds, not written in place of it.
      // Two tabs can watch one piece — a laptop open since it went up and a
      // phone opened forty seconds in — and Jetstream only reports a delete to
      // a subscription that saw the create, so the phone never learns that a
      // like from +10s was taken back at +60s. Writing this panel's rows flat
      // would erase the laptop's `goneMs`, and if the phone is the tab that
      // seals, the withdrawal is gone for good. `mergeWitnessRow` keeps a row
      // known to be gone gone, which is exactly the rule this needs.
      const merged = witnessToRecord(
        mergeWitness(witnessFromRecord(current.witnessed) || [], witnessFromRecord(rows) || []),
      );
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: NSID,
        rkey: piece.rkey,
        record: {
          ...current,
          witnessed: merged,
          ...(fromMs != null
            ? {
                // The earliest watch wins: a tab that started later must not
                // narrow the window the record claims to have covered.
                witnessFromMs: Math.round(
                  typeof current.witnessFromMs === 'number'
                    ? Math.min(current.witnessFromMs, fromMs)
                    : fromMs,
                ),
              }
            : {}),
        },
      });
      savedWitness.current.rows = rows;
      savedWitness.current.at = Date.now();
    } catch {
      /* try again on the next arrival */
    } finally {
      savedWitness.current.busy = false;
    }
  }

  // The log, on its way to the record while the piece is still running. The
  // first arrival goes immediately — a viewer on the piece's own page should
  // see it — and a burst after that is collected for a couple of seconds so a
  // busy thread is one write rather than nine.
  useEffect(() => {
    if (!live || sealedNow || !feed.length) return undefined;
    const rows = witnessToRecord(feed, { profiles });
    if (!witnessChanged(savedWitness.current.rows, rows)) return undefined;
    const since = Date.now() - savedWitness.current.at;
    const id = setTimeout(
      () => saveWitness(live, rows, witnessFrom),
      since > WITNESS_SAVE_MAX_MS ? 0 : WITNESS_SAVE_MS,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, sealedNow, feed, profiles, witnessFrom]);

  /* ---------------------------------------------------------------- */
  /* Answering the thread from the dashboard                            */
  /* ---------------------------------------------------------------- */

  /**
   * A strong ref for something the stream just reported.
   *
   * Liking or replying needs the target's CID, and a stream event carries a
   * record key and no hash. The AppView has both and is one call — but it is
   * also the index the stream exists to beat, and a reply written four seconds
   * ago may not be in it yet. So the author's own PDS is the fallback: slower
   * (a DID document, then the record) and always right.
   */
  async function strongRef(uri, { did: author, collection, rkey }) {
    const viaApp = await getPosts([uri]).catch(() => ({}));
    if (viaApp[uri]?.cid) return { uri, cid: viaApp[uri].cid };
    const pds = await resolvePds(author);
    const rec = await getRecord(pds, { repo: author, collection, rkey });
    if (!rec?.cid) throw new Error('could not read that post’s CID to act on it');
    return { uri, cid: rec.cid };
  }

  /**
   * Like a reply or a quote. Not the piece — nothing here can like the piece,
   * and a like on somebody's reply is a like on their post, which is neither a
   * backlink of the piece nor in any of its counts.
   *
   * Toggles, because the reason to have this at all is that the piece is up and
   * you are moving fast, and moving fast is how you like the wrong row.
   */
  async function likeRow(row) {
    const uri = rowUri(row);
    if (!uri || acting) return;
    setActing(row.rkey);
    setError(null);
    try {
      const existing = acted[row.rkey]?.likeUri;
      if (existing) {
        await agent.com.atproto.repo.deleteRecord({
          repo: did,
          collection: LIKE,
          rkey: rkeyFromAtUri(existing),
        });
        setActed((a) => ({ ...a, [row.rkey]: {} }));
        return;
      }
      const subject = await strongRef(uri, {
        did: row.did,
        collection: KIND_COLLECTION[row.k],
        rkey: row.rkey,
      });
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: LIKE,
        record: { $type: LIKE, subject, createdAt: new Date().toISOString() },
      });
      setActed((a) => ({ ...a, [row.rkey]: { likeUri: res?.data?.uri || '' } }));
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setActing(null);
    }
  }

  /**
   * Answer a row, in the thread it belongs to.
   *
   * A reply to the piece is in the piece's thread, so the root is the piece. A
   * quote is the root of its own thread somewhere else entirely, so it is its
   * own root. Getting that backwards doesn't fail — it posts into the wrong
   * conversation, which is worse.
   */
  async function sendReply() {
    const target = replyTo;
    if (!target?.text?.trim() || !live) return;
    setActing(target.rkey);
    setError(null);
    try {
      const parent = await strongRef(rowUri(target), {
        did: target.did,
        collection: KIND_COLLECTION[target.k],
        rkey: target.rkey,
      });
      const root =
        target.k === 'reply'
          ? await strongRef(subjectOf(live), { did, collection: POST, rkey: live.rkey })
          : parent;
      const rt = new RichText({ text: target.text.trim() });
      await rt.detectFacets(agent);
      await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: POST,
        record: {
          $type: POST,
          text: rt.text,
          ...(rt.facets?.length ? { facets: rt.facets } : {}),
          reply: { root, parent },
          langs: ['en'],
          createdAt: new Date().toISOString(),
        },
      });
      setReplyTo(null);
      setNote(`Replied to @${profiles[target.did]?.handle || target.h || 'them'}.`);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setActing(null);
    }
  }

  // The tab title carries the alarm, so a piece that gets liked while this is
  // in a background tab still says so in the tab strip.
  //
  // It sits ON TOP of the shell's title rather than replacing it: the surface's
  // own "Ratioed studio — Admin — dame.is" is set by the pane, this captures
  // whatever is there and puts it back on the way out, and React flushes every
  // cleanup in a commit before any effect — so leaving the surface restores the
  // shell's title a beat before the next surface sets its own. With no piece
  // live this effect does nothing at all, which is why the tab reads correctly
  // on arrival.
  useEffect(() => {
    if (!live) return undefined;
    const prevTitle = document.title;
    document.title = sealed
      ? `sealed · take ${live.take}`
      : seenLike
        ? '● LIKED — seal it'
        : withdrawn
          ? '○ un-liked · take ' + live.take
          : `alive · take ${live.take}`;
    return () => {
      document.title = prevTitle;
    };
  }, [live, seenLike, withdrawn, sealed]);

  /* ---------------------------------------------------------------- */

  /** Write the post, then its record. The piece is alive from here. */
  async function publish() {
    if (!draft.trim()) return;
    if (!window.confirm(`Post take ${take} to Bluesky now?\n\nThe piece is live the moment this lands.`)) {
      return;
    }
    setBusy('publish');
    setError(null);
    try {
      const rt = new RichText({ text: draft.trim() });
      await rt.detectFacets(agent);

      const embed = quote ? { $type: 'app.bsky.embed.record', record: quote } : undefined;

      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: POST,
        record: {
          $type: POST,
          text: rt.text,
          ...(rt.facets?.length ? { facets: rt.facets } : {}),
          ...(embed ? { embed } : {}),
          langs: ['en'],
          createdAt: new Date().toISOString(),
        },
      });
      const rkey = rkeyFromAtUri(res?.data?.uri);
      if (!rkey) throw new Error('the post was written but its record key came back empty');

      // Held from here on, because the post now EXISTS. Everything downstream
      // — the stream, the poll, the seal button, this page's whole reason to be
      // open — hangs off the record below, and a failure writing it used to
      // leave the composer exactly as it was: same draft, same take number,
      // same button. Pressing it again posted a byte-identical duplicate, and
      // only the second one got a record. The first was invisible to the studio
      // and to the scan until it was threadgated by hand, while the link inside
      // it 404'd.
      setOrphan({ rkey, take });
      await writePieceRecord(rkey, take);
      setOrphan(null);
      setDraft('');
      setNote(`Take ${take} is up. Watching for the like.`);
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /** The record a live piece needs: itself, and nothing measured. */
  async function writePieceRecord(rkey, forTake) {
    await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: NSID,
      rkey,
      record: {
        $type: NSID,
        take: forTake,
        subject: subjectUri(rkey),
        // The PDS write time, decoded from the key it just assigned — the same
        // clock every other piece's postedAt was read from.
        postedAt: tidToTimestamp(rkey) || new Date().toISOString(),
      },
    });
  }

  /** Finish a post whose record never landed. */
  async function finishOrphan() {
    if (!orphan) return;
    setBusy('publish');
    setError(null);
    try {
      await writePieceRecord(orphan.rkey, orphan.take);
      setOrphan(null);
      setDraft('');
      setNote(`Take ${orphan.take} is up. Watching for the like.`);
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Close replies, then measure.
   *
   * The gate goes first and alone: it is the artwork, and every millisecond
   * between the like and this write is in the recorded reaction time. Measuring
   * is a read and can wait the extra second.
   */
  async function seal() {
    if (!live) return;
    setBusy('seal');
    setError(null);
    try {
      const sealedAt = new Date().toISOString();
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: GATE,
        rkey: live.rkey,
        record: {
          $type: GATE,
          post: subjectOf(live),
          allow: [],
          createdAt: sealedAt,
        },
      });
      // The artwork is finished as of this line. Say so before the read.
      setSealed({ rkey: live.rkey, sealedAt });
      setNote('Sealed. Measuring…');

      // When it ended, written before anything is measured.
      //
      // The measurement can fail — the backlink index goes down, a token
      // expires — and everything after this point used to be one write at the
      // end, so a failure left a record with no `sealedAt` at all. `isLive`
      // stayed true while `justSealed` hid both seal buttons, and the series
      // list iterates finished pieces, so nothing could reach it. Reloading
      // re-offered "Seal this piece", which putRecords a fresh `createdAt` over
      // the same threadgate rkey — destroying both witnesses to when the gate
      // actually landed, and inflating the lifespan and the reaction time by
      // however long the recovery took.
      const held = await readPiece(live.rkey).catch(() => null);
      await agent.com.atproto.repo
        .putRecord({
          repo: did,
          collection: NSID,
          rkey: live.rkey,
          record: {
            ...(held || {}),
            $type: NSID,
            sealedAt,
            lifespanMs: Date.parse(sealedAt) - Date.parse(live.postedAt),
          },
        })
        .catch(() => {}); // the measurement below is the one that must land
      await measureAndFinish(live, sealedAt);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Read the piece's backlinks and fill in everything the record was missing.
   *
   * Separate from `seal` and re-runnable, because the backlink index lags: a
   * like cast eight seconds ago may not be indexed yet, and the reaction time
   * depends on its record key. Pressing this again a minute later is how a
   * measurement that came back empty gets taken properly.
   */
  async function measureAndFinish(piece, sealedAtIso) {
    const sealedAt = sealedAtIso || piece.sealedAt;
    if (!sealedAt) return;
    const subject = subjectOf(piece);
    const records = await fetchPieceRecords(subject);
    const sealedMs = Date.parse(sealedAt);
    const postedMs = Date.parse(piece.postedAt);
    const windows = measureWindows(records, sealedMs, did);
    // Profiles rather than handles alone: the same call carries how many
    // followers each participant had, which is the one figure on the record
    // that would be a different number tomorrow. Reading it now is what makes
    // the reach score a measurement instead of a guess about the past.
    const measuredProfiles = await resolveProfiles(records.map((r) => r.did));
    const handles = Object.fromEntries(
      Object.entries(measuredProfiles).map(([k, p]) => [k, p.handle]).filter(([, h]) => h),
    );

    // From here the measurement owns this record. A pending witness write is
    // cancelled by the effect that scheduled it, but one already in flight read
    // an unsealed record and would put the piece back to alive if it landed
    // last, so it gets waited out rather than raced.
    savedWitness.current.stop = true;
    for (let i = 0; i < 40 && savedWitness.current.busy; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // The witnessed log, as it will be written: whatever is in this panel now,
    // folded over whatever the record already holds. Read back rather than
    // assumed, because a re-measure minutes later runs with an empty feed — the
    // piece stopped being live and the panel let it go — and the log written
    // while it ran must survive that.
    const held = await readPiece(piece.rkey).catch(() => null);
    const witnessRows = mergeWitness(witnessFromRecord(held?.witnessed) || [], feed);
    const witnessed = witnessToRecord(witnessRows, { profiles });
    const witnessFromMs =
      typeof held?.witnessFromMs === 'number'
        ? held.witnessFromMs
        : witnessFrom != null
          ? Math.round(witnessFrom)
          : null;

    // Every name this pass has any claim on, weakest first.
    //
    // The measurement's own read is the freshest and wins, but it is one call
    // to one AppView and it can simply fail — and when it does, `buildEventLog`
    // labels every row "(unresolvable)" and writes that onto the record, where
    // it is indistinguishable from an account that has since been deleted. It
    // happened on take 16: thirteen people, all of them named in the witnessed
    // log by the stream that watched them arrive, all of them recorded as
    // unresolvable because one getProfiles call didn't answer.
    //
    // So the log's own handles, the profiles the panel resolved while the piece
    // was running, and — on a re-measure — whatever the record already says,
    // stand behind it. None of them is a measurement; a handle isn't one either.
    const knownHandles = {
      ...namedHandles((held?.events || []).map((e) => [e.did, e.h === UNRESOLVED_HANDLE ? '' : e.h])),
      ...namedHandles(witnessRows.map((r) => [r.did, r.h])),
      ...namedHandles(Object.entries(profiles).map(([d, p]) => [d, p?.handle])),
      ...handles,
    };
    const events = buildEventLog(records, {
      postedAtMs: postedMs,
      sealedAtMs: sealedMs,
      selfDid: did,
      profiles: measuredProfiles,
      handles: knownHandles,
    });

    // Who to name, and when they did it. See resolveBreaker: the index first,
    // the standing witnessed like when the index is only lagging, and the
    // withdrawn one when there is nothing left for any index to hold.
    const breaking = resolveBreaker({
      indexLike: windows.breakingLike,
      rows: witnessRows,
      postedMs,
      sealedMs,
    });

    const breakerDid = breaking?.did || likes?.likes?.[0]?.actor?.did || null;
    const handle =
      (breakerDid && knownHandles[breakerDid]) ||
      breaking?.handle ||
      likes?.likes?.[0]?.actor?.handle ||
      'unknown';
    const likeSurvives = Boolean(breaking?.likeSurvives);
    const measuredAt = new Date().toISOString();
    const hasAudience = events.some((e) => typeof e.fr === 'number');

    // Who broke it, with the held answer underneath: a name this pass cannot
    // find must not erase one somebody entered by hand, and a re-measure runs
    // with no live piece, so it finds no breaker of its own.
    const breaker = { ...(held?.breaker || {}) };
    if (handle !== 'unknown' || !breaker.handle) breaker.handle = handle;
    if (breakerDid) breaker.did = breakerDid;
    breaker.likeSurvives = likeSurvives;
    // Present with `likeSurvives: false` when the log timed a like the index
    // can no longer be shown — the lexicon's `reactionRecovered` case, and the
    // reason the log is written to the record at all.
    if (breaking) breaker.reactionMs = sealedMs - breaking.at;
    if (breaking?.recovered) breaker.reactionRecovered = true;
    // Cleared by a pass that found the like standing, so the flag can never
    // outlive the condition it describes.
    else if (likeSurvives) delete breaker.reactionRecovered;

    // Whatever the record already holds, with this pass's measurement over it.
    //
    // This used to be a bare literal, which made "Measure again" the one writer
    // in the subsystem that replaced instead of patching — every other one
    // ({...current}, {...held}, {...v}) merges. The cost was specific and
    // silent: a piece measured while the index lagged offers "name the breaker"
    // and "Measure again" side by side, and pressing the second after the first
    // put back `{handle: 'unknown', likeSurvives: false}` over the name and DID
    // just entered by hand, because a re-measure runs with no live piece and so
    // finds no breaker of its own. `lede`, `statedTally` and `announceLagMs` —
    // none of which this pass produces — went the same way.
    const value = {
      ...(held || {}),
      $type: NSID,
      take: piece.take,
      subject,
      postedAt: piece.postedAt,
      sealedAt,
      lifespanMs: sealedMs - postedMs,
      breaker,
      preSeal: windows.preSeal,
      postSeal: windows.postSeal,
      ...(events.length ? { events } : {}),
      // Measured and witnessed side by side, never merged. The index can only
      // report what still exists; the log can only report what something was
      // watching for. The piece's page shows both and says which is which.
      ...(witnessed.length ? { witnessed } : {}),
      ...(witnessFromMs != null ? { witnessFromMs } : {}),
      measuredAt,
      // Measured in the same pass, so the audiences are as current as the
      // counts are. Stamped anyway — a backfilled piece carries a date years
      // off its own, and only this field says which kind a piece is.
      ...(hasAudience ? { audienceAt: measuredAt } : {}),
      source: 'constellation.microcosm.blue',
    };
    await agent.com.atproto.repo.putRecord({ repo: did, collection: NSID, rkey: piece.rkey, record: value });

    const shaped = normalizePiece(piece.rkey, value);
    // The reply needs a strong ref to the post it concludes. Read it here,
    // while already on the network, so pressing "Post the reply" is one write
    // and can't fail on a lookup.
    const pds = await resolvePds(did).catch(() => null);
    const post = pds
      ? await getRecord(pds, { repo: did, collection: POST, rkey: piece.rkey }).catch(() => null)
      : null;
    setAnnounce({
      piece: shaped,
      ref: post?.cid ? { uri: subject, cid: post.cid } : null,
      text: announcementDraft({
        handle,
        piece: shaped,
        others: finished(pieces),
        announcement: announceTpl,
      }),
    });
    // How far it got before the gate closed, said here because this is the one
    // moment the figure is worth acting on: an amplifier who has just carried
    // the piece to a real audience is the difference between a take nobody saw
    // and a take that travelled, and the announcement is still unwritten.
    const reach = pieceReach(shaped.events);
    const reachNote = reach.measurable
      ? ` Reach while alive: ${fmtReach(reach.alive.raw)}${
          reach.alive.top ? ` — mostly @${reach.alive.top.handle}.` : '.'
        }`
      : '';
    setNote(
      (!breaking
        ? 'Measured, but neither the index nor the log has a like — measure again in a minute.'
        : breaking.recovered
          ? `Measured. @${handle} liked it and deleted the like; the reaction time — ${fmtSeconds(
              sealedMs - breaking.at,
            )} — is off the log the stream kept, and the record says so.`
          : `Measured. Reaction ${fmtSeconds(sealedMs - breaking.at)}${
              windows.breakingLike
                ? '.'
                : ', from the like the stream witnessed — measure again once the index catches up.'
            }`) + reachNote,
    );
    await refresh();
  }

  /** Measure a sealed piece. Defaults to the one the announcement panel is
   *  holding; also reachable from a piece whose measurement failed at the seal,
   *  which has no announcement panel because it never got that far. */
  async function remeasure(target) {
    const piece = target || announce?.piece;
    if (!piece?.sealedAt) return;
    setBusy('measure');
    setError(null);
    try {
      await measureAndFinish(piece, piece.sealedAt);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Save the page's words.
   *
   * A field left at its default is written as an empty string rather than as
   * the default's text: the record then says "the site's own sentence" rather
   * than freezing a copy of it, and rewording the built-in later reaches every
   * page that never overrode it. Nothing here is validated against anything —
   * it is prose, and the only thing it can break is a sentence.
   */
  async function saveCopy() {
    setBusy('copy');
    setError(null);
    try {
      const record = { $type: COPY_NSID, updatedAt: new Date().toISOString() };
      for (const { key } of COPY_FIELDS) {
        const written = (copyDraft?.[key] ?? '').trim();
        if (written && written !== DEFAULT_COPY[key]) record[key] = written;
      }
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: COPY_NSID,
        rkey: 'self',
        record,
      });
      setCopy(mergeCopy(record));
      setCopyDraft(null);
      setNote('Saved. The piece pages read it on their next load.');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Save the template.
   *
   * Refused if the discovery scan wouldn't recognise what it produces. That is
   * the failure this whole editor risks introducing and the one the project
   * has already had: take #13 reworded the opening line, the scan stopped
   * seeing it, and it went unmeasured until somebody checked by hand.
   */
  async function saveTemplate() {
    const announcement = annDraft ?? announceTpl ?? DEFAULT_ANNOUNCEMENT;
    const problems = [...templateProblems(tplDraft, take), ...announcementProblems(announcement)];
    if (problems.length) {
      setError(problems.join(' '));
      return;
    }
    setBusy('template');
    setError(null);
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: TEMPLATE_NSID,
        rkey: 'self',
        record: {
          $type: TEMPLATE_NSID,
          text: tplDraft,
          announcement,
          updatedAt: new Date().toISOString(),
        },
      });
      setTemplate(tplDraft);
      setAnnounceTpl(announcement);
      setAnnDraft(null);
      setDraft(fillTemplate(tplDraft, take));
      setTplDraft(null);
      setNote('Template saved. The composer above is rewritten from it.');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Repair one piece: fill in whatever it is missing, break nothing.
   *
   * This replaced four buttons — recover the reaction, put names back, backfill
   * audiences, read the afterlife — each of which knew a different amount about
   * what was safe to touch, and between them made the artist diagnose a record
   * before fixing it. What is missing is something the record can be asked (see
   * lib/ratioedRepair.js), so it is asked, and the answer decides what is
   * written.
   *
   * It cannot damage a measurement. Every step either fills a gap or replaces
   * the window the lexicon defines as re-readable — everything after the seal.
   * The alive figures, the reaction time and the witnessed log are never
   * re-derived, because a like cast and deleted while a piece was up is gone
   * from every index and a second reading of that window is always the smaller
   * one.
   */
  async function repair(piece) {
    setBusy(`repair:${piece.rkey}`);
    setError(null);
    try {
      const value = await readPiece(piece.rkey);
      const { changes, written } = await repairPiece({
        agent,
        did,
        collection: NSID,
        rkey: piece.rkey,
        value,
        onProgress: (m) => setNote(`Take ${pieceSlug(piece)}: ${m}…`),
      });
      setNote(
        written
          ? `Take ${pieceSlug(piece)}: ${changes.join(', ')}.`
          : `Take ${pieceSlug(piece)} has nothing missing.`,
      );
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }


  /** The record as it stands, so a recovery patches rather than rewrites. */
  async function readPiece(rkey) {
    const res = await agent.com.atproto.repo.getRecord({ repo: did, collection: NSID, rkey });
    const value = res?.data?.value;
    if (!value) throw new Error('could not read the piece record to update it');
    return value;
  }

  /**
   * Say who ended a piece, by hand.
   *
   * Everything else on a record is measured or witnessed, and this is neither:
   * it is the artist naming somebody the apparatus lost. Take 16 is why it
   * exists — a like deleted 329ms after it landed, recorded as "unknown", and
   * with no name on the record the breaker is in no roster, has no face on the
   * piece's page, and cannot be replayed against, because the replay filters
   * the firehose by the account it is looking for.
   *
   * The DID is resolved and stored alongside the handle, which is the point of
   * doing this in a form rather than by editing JSON: a handle is a rented name
   * and the roster is keyed by DID. Nothing else on the record is touched, and
   * a reaction time is NOT invented — if one is recoverable it comes from the
   * log or the replay, both of which are measurements.
   */
  async function nameBreaker(piece, typed) {
    const handle = String(typed || '').trim().replace(/^@+/, '').toLowerCase();
    if (!handle) return;
    setBusy(`name:${piece.rkey}`);
    setError(null);
    try {
      const breakerDid = handle.startsWith('did:')
        ? handle
        : await resolveHandle(handle).catch(() => null);
      if (!breakerDid) throw new Error(`@${handle} doesn’t resolve to a DID`);
      const held = await readPiece(piece.rkey);
      const b = held.breaker || {};
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: NSID,
        rkey: piece.rkey,
        record: {
          ...held,
          breaker: {
            ...b,
            handle: handle.startsWith('did:') ? b.handle || handle : handle,
            did: breakerDid,
            // Untouched unless it was never set: whether the like still exists
            // is a fact about the network, and naming somebody is not evidence
            // either way.
            likeSurvives: b.likeSurvives ?? false,
          },
        },
      });
      setNaming(null);
      setNote(`Take ${pieceSlug(piece)} was ended by @${handle}. ${breakerDid} is on the record.`);
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }


  /** Post the concluding reply, in the thread it concludes. */
  async function postAnnouncement() {
    if (!announce?.text.trim() || !announce.piece) return;
    setBusy('announce');
    setError(null);
    try {
      let ref = announce.ref;
      if (!ref) {
        // The seal-time lookup didn't land. One retry, since without a strong
        // ref there is no reply.
        const pds = await resolvePds(did);
        const post = await getRecord(pds, { repo: did, collection: POST, rkey: announce.piece.rkey });
        if (!post?.cid) throw new Error('could not read the piece post’s CID to reply to it');
        ref = { uri: subjectUri(announce.piece.rkey), cid: post.cid };
      }

      // One reply, or a thread of them. What a piece has to say about itself
      // as it ends outgrew a single post once it started carrying links — see
      // ANNOUNCEMENT_BREAK — so the template says where it breaks and each
      // part is posted as a reply to the one before it. The root stays the
      // piece throughout, which is what keeps the whole thing one thread.
      //
      // The first is the one that matters: it carries the blame sentence the
      // site reads the breaker back out of, and it is the one the record is
      // stamped from. A later part that fails leaves a posted announcement and
      // a reported error rather than an unposted piece.
      const parts = announcementParts(announce.text);
      let posted = null;
      let parent = ref;
      for (const part of parts) {
        // The draft carries whole URLs, because a link somebody cannot read the
        // end of is one they cannot check. The post carries the short form and
        // the whole URL in a facet beside it, which is how the client that
        // composes these posts by hand does it and why its counter and ours now
        // agree. See shortenPost.
        const { text, links } = shortenPost(part);
        const rt = new RichText({ text });
        await rt.detectFacets(agent);
        // Whatever the detector made of a shortened URL is wrong by
        // construction — it is a plausible host and it points at itself — so
        // our spans win over anything overlapping them. The mentions it found
        // are the reason it runs at all.
        const overlaps = (f) =>
          links.some((l) => f.index.byteStart < l.end && l.start < f.index.byteEnd);
        const facets = [
          ...(rt.facets || []).filter((f) => !overlaps(f)),
          ...links.map((l) => ({
            index: { byteStart: l.start, byteEnd: l.end },
            features: [{ $type: 'app.bsky.richtext.facet#link', uri: l.uri }],
          })),
        ].sort((a, b) => a.index.byteStart - b.index.byteStart);
        const res = await agent.com.atproto.repo.createRecord({
          repo: did,
          collection: POST,
          record: {
            $type: POST,
            text: rt.text,
            ...(facets.length ? { facets } : {}),
            reply: { root: ref, parent },
            langs: ['en'],
            createdAt: new Date().toISOString(),
          },
        });
        posted ||= res;
        if (res?.data?.uri && res?.data?.cid) parent = { uri: res.data.uri, cid: res.data.cid };
      }

      // How long the piece stood finished before it was announced.
      //
      // Takes 1–13 all carry this; 14 onwards carry none, because the only
      // thing that ever wrote it was the legacy scan path — this function
      // created the reply, discarded the response and never touched the record.
      // There is no later pass that could backfill it either: `pieceGaps` has
      // no case for it, and posting the announcement is what clears this panel.
      // Read off the reply's own key, like every other time in the project.
      const replyRkey = rkeyFromAtUri(posted?.data?.uri);
      const announcedMs = Date.parse(tidToTimestamp(replyRkey) || '');
      const sealedMs = Date.parse(announce.piece.sealedAt || '');
      if (Number.isFinite(announcedMs) && Number.isFinite(sealedMs)) {
        const held = await readPiece(announce.piece.rkey).catch(() => null);
        if (held) {
          await agent.com.atproto.repo
            .putRecord({
              repo: did,
              collection: NSID,
              rkey: announce.piece.rkey,
              record: { ...held, $type: NSID, announceLagMs: Math.max(0, announcedMs - sealedMs) },
            })
            .catch(() => {}); // the reply is posted; this is a footnote to it
        }
      }

      setAnnounce(null);
      setSealed(null);
      setNote(
        `Take ${announce.piece.take} is finished.${
          parts.length > 1 ? ` The reply went out as ${parts.length} posts.` : ''
        }`,
      );
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /* ---------------------------------------------------------------- */

  // The log is held earliest-first, the way it's recorded and replayed. It's
  // read newest-first, the way a feed is watched.
  // The same counts the public deck shows, by the same rule: the artist's own
  // records are in the log and in none of the figures.
  const tally = useMemo(() => tallyWitness(feed, { selfDid: did }), [feed, did]);

  const justSealed = sealedNow;
  const aliveMs = live
    ? (justSealed ? Date.parse(sealed.sealedAt) : now) - Date.parse(live.postedAt)
    : 0;
  const firstLike = likes?.likes?.[0] || null;
  // Who ended it, and how long ago. The second number is the reaction time
  // accruing in front of you: it stops when you press the button, and what it
  // reads at that moment is what the record will carry forever.
  const breakerName =
    (streamLike && (profiles[streamLike.did]?.handle || streamLike.h)) ||
    firstLike?.actor?.handle ||
    'somebody';
  // When the like landed, on the same clock the record will subtract from.
  // Null when only the AppView poll has seen it: that answers WHO but not the
  // instant, and a stopwatch counting from a guess is worse than no stopwatch.
  const likeAtMs = streamLike && live ? Date.parse(live.postedAt) + streamLike.offMs : null;

  return (
    // `.rs-root` earns its place twice over. It is where the three --ratioed-*
    // hues are defined (see RatioedStudio.css — they belong to the .ratioed
    // chart block, which is not on this page, so the studio was rendering their
    // fallbacks by accident). And as a plain block it keeps the studio's own
    // vertical rhythm: the sections below space themselves with collapsing
    // margins, which only happens inside a block container — the pane itself is
    // a flex column with a gap.
    <div className="rs-root">
      {error && <p className="admin-error">{error}</p>}
      {note && <p className="admin-field-hint">{note}</p>}

      {/* Said once the wait is over, not during it: the series below is the
          bundled measurement, which is right for every sealed piece and stale
          only for one published in the last few minutes. Retry re-runs the same
          read rather than reloading the page. */}
      {pdsSlow && pieces !== null && (
        <div className="rs-degraded">
          <p className="admin-field-hint">
            The PDS didn’t answer, so this is the build’s snapshot rather than a fresh read —
            anything published since the last deploy is missing from it, including a piece that
            might be live right now. Don’t post from this state.
          </p>
          <button type="button" className="admin-link-subtle" onClick={refresh}>
            try again
          </button>
        </div>
      )}

      {pieces === null ? (
        /* The same skeleton the catalogue draws for the same wait — a shape
           where the series is about to be, rather than one line of grey text
           that reads as the finished answer. */
        <AdminRecordListSkeleton rows={4} label="Reading the series" />
      ) : live ? (
        <section
          style={scale}
          className={`rs-live${justSealed ? '' : seenLike ? ' liked' : withdrawn ? ' withdrawn' : ''}`}
        >
          <header className="rs-live-head">
            <span className="rs-live-take">take {pieceSlug(live)}</span>
            <span className="rs-live-clock">{fmtDuration(aliveMs)}</span>
          </header>

          {/* How this one is doing, in the only unit the project has: the
              longest piece so far. */}
          <RatioedRecord elapsedMs={aliveMs} record={longest} pieces={done} />

          {/* The alarm. A like is the end of the piece and the start of the one
              measurement this project exists to take, so it does not arrive as
              one more row in a feed — it takes the top of the panel, in the
              complement of the hour every other mark here is drawn in, with the
              button that ends it inside the same box. */}
          {seenLike && !justSealed && (
            <div className="rs-alarm" role="alert">
              <RatioedChip kind="like" size="lg" />
              <span className="rs-alarm-who">
                @{breakerName}
                {streamLike && (
                  <span className="rs-alarm-when">liked it at +{fmtDuration(streamLike.offMs)}</span>
                )}
              </span>
              {/* The measurement, running. Frozen the moment the seal is
                  pressed, because that is the moment it stops being a display
                  and becomes what the record says. */}
              {likeAtMs != null && (
                <span className="rs-alarm-race">
                  <RatioedClock fromMs={likeAtMs} running={!busy} className="rs-alarm-clock" />
                  <span className="rs-alarm-race-label">
                    your reaction, as the record will carry it
                  </span>
                </span>
              )}
              <button type="button" className="rs-alarm-seal" onClick={seal} disabled={!!busy}>
                <Lock size={16} aria-hidden="true" />
                {busy === 'seal' ? 'Sealing…' : 'Seal it'}
              </button>
            </div>
          )}

          <p className="rs-live-state">
            {justSealed && error ? (
              <>
                Sealed at {new Date(sealed.sealedAt).toLocaleTimeString()}, and the measurement
                failed. The seal is on the record; nothing else is. Measure it again — the index is
                the part that was unreachable, and it is the only part still missing.
              </>
            ) : justSealed ? (
              <>Sealed. Reading its records&hellip;</>
            ) : withdrawn ? (
              <>
                Somebody liked it and <strong>un-liked it</strong>. Nothing is standing against it
                now — seal it or let it run.
              </>
            ) : firstLike ? (
              <>
                <strong>@{firstLike.actor?.handle || 'somebody'}</strong> liked it. Seal it.
              </>
            ) : (
              'Nobody has liked it yet.'
            )}
          </p>

          <div className="rs-actions">
            {/* One seal button at a time: when the alarm is up it owns that
                click, and two identical buttons a foot apart is how you hesitate
                over which one is real. */}
            {!justSealed && !seenLike && (
              <button type="button" className="rs-seal" onClick={seal} disabled={!!busy}>
                <Lock size={15} aria-hidden="true" />
                {busy === 'seal' ? 'Sealing…' : 'Seal this piece'}
              </button>
            )}
            {/* A seal that landed and a measurement that did not. Without this
                the only way back is a reload, which re-offers "Seal this piece"
                and writes a second threadgate over the first — moving the one
                timestamp the lifespan is measured from. */}
            {justSealed && error && (
              <button
                type="button"
                className="rs-seal"
                onClick={() => {
                  setError(null);
                  remeasure();
                }}
                disabled={!!busy}
              >
                <RefreshCw size={15} aria-hidden="true" />
                {busy === 'measure' ? 'Measuring…' : 'Measure this piece'}
              </button>
            )}
            {/* The rest of the row is one glyph each — the words live in the
                title and the label — and the three squares sit flush as one
                segment so the whole row still fits a phone beside the seal. */}
            <div className="rs-live-acts">
              <a
                className="rs-live-act"
                href={`https://bsky.app/profile/${ME_HANDLE}/post/${live.rkey}`}
                target="_blank"
                rel="noreferrer noopener"
                title="Open the post on Bluesky"
                aria-label="Open the post on Bluesky"
              >
                <ExternalLink size={15} aria-hidden="true" />
              </a>
              <Link
                className="rs-live-act"
                to={piecePath(live)}
                title="The piece’s own page"
                aria-label="The piece’s own page"
              >
                <FileText size={15} aria-hidden="true" />
              </Link>
              {CAN_WAKE && (
                <button
                  type="button"
                  className={`rs-live-act${keepAwake ? ' on' : ''}`}
                  onClick={() => setKeepAwake((v) => !v)}
                  aria-pressed={keepAwake}
                  title={
                    keepAwake
                      ? 'The screen is being held awake — tap to let it sleep'
                      : 'Keep the screen awake'
                  }
                  aria-label="Keep the screen awake"
                >
                  <Coffee size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {justSealed && (
            <p className="admin-field-hint">
              Replies are closed. The figures below come from the backlink index, which lags — but
              the stream already witnessed the like, so the reaction time is in hand either way.
            </p>
          )}

          <div className="rs-feed">
            {/* Throughput, not just cost. A piece nobody has touched matches
                nothing for minutes and a byte counter that only moved on a
                match read as broken for exactly as long as it was working. The
                rate is resampled about once a second inside the socket, on a
                64-message mask — cheaper than the timestamp parse already
                happening on every message.

                Four words have come off this line. "As it happens" labelled a
                feed that is visibly happening. "Live" said what the lit radio
                beside it says. "N matched" is the number of rows directly under
                it, counted twice. What is left is the two figures that are NOT
                on screen anywhere else: what the socket is pulling, and how
                much of the network it has been through to find those rows. */}
            <header className="rs-feed-head">
              <span className={`rs-feed-state is-${stream?.state || 'connecting'}`}>
                <Radio size={12} aria-hidden="true" />
                {stream?.state === 'open'
                  ? `${(stream.rate || 0).toLocaleString()} rec/s · ${((stream.bytes || 0) / 1024 / 1024).toFixed(1)} MB`
                  : stream?.state || 'connecting'}
              </span>
              {stream?.msgs > 0 && (
                <span className="rs-feed-scan">{stream.msgs.toLocaleString()} scanned</span>
              )}
            </header>

            {/* The counts the public deck shows, on the same rows it shows
                them on: this feed and that one are the same list of the same
                records, and until now they were two implementations that had
                drifted apart on avatars, spacing and what a withdrawn row
                looks like. What the studio adds is the three buttons and the
                composer, which arrive as render props. */}
            <RatioedCounters tally={tally} />
            <RatioedTicker
              rows={feed}
              profiles={profiles}
              empty="Nothing yet."
              actions={(e) => {
                const mine = e.did === did;
                // A post that still exists can be opened anywhere. Acting on
                // one is narrower: not your own, not deleted, not after the
                // seal.
                const openable = ANSWERABLE.has(e.k) && e.goneMs == null && Boolean(e.did);
                if (!openable) return null;
                const answerable = !mine && !justSealed;
                const liked = Boolean(acted[e.rkey]?.likeUri);
                return (
                  <>
                    <button
                      type="button"
                      className="rs-act"
                      onClick={() => openWaypoints(rowUri(e))}
                      title="Open this post in another client"
                      aria-label="Open this post in another client"
                    >
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </button>
                    {answerable && (
                      <>
                        {/* On the row, not the piece: this likes somebody's
                            reply, which is not a backlink of the piece and is
                            in none of its counts. */}
                        <button
                          type="button"
                          className={`rs-act${liked ? ' on' : ''}`}
                          onClick={() => likeRow(e)}
                          disabled={Boolean(acting)}
                          title={liked ? 'Undo that like' : 'Like this reply — not the piece'}
                          aria-label={liked ? 'Undo that like' : 'Like this reply'}
                        >
                          {liked ? (
                            <HeartOff size={13} aria-hidden="true" />
                          ) : (
                            <Heart size={13} aria-hidden="true" />
                          )}
                        </button>
                        <button
                          type="button"
                          className={`rs-act${replyTo?.rkey === e.rkey ? ' on' : ''}`}
                          onClick={() =>
                            setReplyTo((r) => (r?.rkey === e.rkey ? null : { ...e, text: '' }))
                          }
                          disabled={Boolean(acting)}
                          title={
                            e.k === 'quote' ? 'Reply in their thread' : 'Reply in the piece’s thread'
                          }
                          aria-label="Reply to this"
                        >
                          <MessageSquareReply size={13} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </>
                );
              }}
              below={(e) =>
                replyTo?.rkey === e.rkey ? (
                  <div className="rs-reply-box">
                    <textarea
                      className="admin-input"
                      rows={3}
                      autoFocus
                      placeholder={
                        e.k === 'quote'
                          ? 'Replying under their quote post…'
                          : 'Replying in the piece’s own thread…'
                      }
                      value={replyTo.text}
                      onChange={(ev) => setReplyTo((r) => ({ ...r, text: ev.target.value }))}
                    />
                    <div className="rs-reply-acts">
                      <button
                        type="button"
                        className="admin-gate-button"
                        onClick={sendReply}
                        disabled={Boolean(acting) || !replyTo.text.trim()}
                      >
                        <Send size={13} aria-hidden="true" />
                        {acting === e.rkey ? 'Posting…' : 'Reply'}
                      </button>
                      <button
                        type="button"
                        className="admin-link-subtle"
                        onClick={() => setReplyTo(null)}
                      >
                        cancel
                      </button>
                      <span className="rs-reply-where">
                        {e.k === 'quote'
                          ? 'their thread — this piece never sees it'
                          : 'this piece’s thread, and your own records are excluded from every count'}
                      </span>
                    </div>
                  </div>
                ) : null
              }
            />
          </div>
        </section>
      ) : announce ? null : (
        <section className="rs-compose">
          <h2 className="rs-h2">Take {String(take).padStart(2, '0')}</h2>
          <p className="admin-field-hint">
            {!prev ? (
              <>Nothing to quote yet. </>
            ) : quote === undefined ? (
              <>Reading take {pieceSlug(prev)} to quote it… </>
            ) : quote ? (
              <>Quoting take {pieceSlug(prev)}. </>
            ) : (
              <>
                <strong>Take {pieceSlug(prev)} couldn&rsquo;t be read, so this will post without
                the quote.</strong>{' '}
              </>
            )}
            The link resolves to this piece&rsquo;s own page, which works from the moment it&rsquo;s
            posted because the record is written with it.
          </p>
          <textarea
            className="admin-input rs-draft"
            rows={13}
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {/* The post landed; its record did not. Nothing else can be done
              from here until that write goes through — the piece is standing on
              Bluesky right now with a link in it to a page that needs this
              record to resolve, and posting again would only duplicate it. */}
          {orphan && (
            <p className="rs-degraded">
              Take {String(orphan.take).padStart(2, '0')} is posted, but its record was not
              written — so nothing is watching it and its own page does not exist yet.{' '}
              <a
                href={`https://bsky.app/profile/${ME_HANDLE}/post/${orphan.rkey}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                the post
              </a>
            </p>
          )}
          <div className="rs-actions">
            {orphan ? (
              <button
                type="button"
                className="admin-gate-button"
                onClick={finishOrphan}
                disabled={!!busy}
              >
                <Send size={14} aria-hidden="true" />
                {busy === 'publish'
                  ? 'Writing…'
                  : `Finish take ${String(orphan.take).padStart(2, '0')}'s record`}
              </button>
            ) : (
              /* Disabled while the quote lookup is outstanding. `quote` is
                 tri-state and the hint below distinguishes all three, but
                 `publish` collapses `undefined` into "no quote" — and the
                 lookup runs against a `resolvePds` this file has measured at
                 eight seconds and at twenty-eight. */
              <button
                type="button"
                className="admin-gate-button"
                onClick={publish}
                disabled={!!busy || quote === undefined}
              >
                <Send size={14} aria-hidden="true" />
                {busy === 'publish'
                  ? 'Posting…'
                  : quote === undefined
                    ? 'Reading the take to quote…'
                    : `Post take ${String(take).padStart(2, '0')}`}
              </button>
            )}
            <button
              type="button"
              className="admin-link-subtle"
              onClick={() => setDraft(fillTemplate(template ?? DEFAULT_TEMPLATE, take))}
              disabled={!!busy}
            >
              reset to the template
            </button>
          </div>
        </section>
      )}

      {announce && (
        <section className="rs-announce">
          <h2 className="rs-h2">Take {pieceSlug(announce.piece)} is sealed</h2>
          <dl className="rs-figures">
            <div>
              <dt>alive</dt>
              <dd>{fmtDuration(announce.piece.lifespanMs)}</dd>
            </div>
            <div>
              <dt>broken by</dt>
              <dd>@{announce.piece.breaker?.handle}</dd>
            </div>
            <div>
              <dt>reaction</dt>
              <dd>
                {typeof announce.piece.breaker?.reactionMs === 'number' ? (
                  <>
                    {fmtSeconds(announce.piece.breaker.reactionMs)}
                    {/* Same number, different provenance, and the record says
                        which: a like nothing can be shown any more, timed by
                        the log that watched it land. */}
                    {announce.piece.breaker.likeSurvives ? '' : ' — off the log; the like is gone'}
                  </>
                ) : (
                  'not indexed yet'
                )}
              </dd>
            </div>
          </dl>
          <p className="admin-field-hint">
            The first line is the one every take has carried, and it&rsquo;s what the site reads
            the breaker back out of — keep its shape. The rest is computed and yours to cut.
          </p>
          <textarea
            className="admin-input rs-draft"
            rows={10}
            value={announce.text}
            onChange={(e) => setAnnounce((a) => ({ ...a, text: e.target.value }))}
          />
          {/* This one is the real thing rather than a worst case, and it is the
              last moment before a post is made: a reply over the limit is
              rejected by the PDS, and finding that out here costs an edit
              rather than a failed seal. */}
          <p className="rs-count">
            {announcementParts(announce.text).map((part, i, all) => {
              const n = graphemes(shortenPost(part).text);
              return (
                <span key={i} className={n > POST_MAX ? 'is-over' : undefined}>
                  {all.length > 1 ? `reply ${i + 1}: ` : ''}
                  {n}/{POST_MAX}
                </span>
              );
            })}
          </p>
          <div className="rs-actions">
            <button
              type="button"
              className="admin-gate-button"
              onClick={postAnnouncement}
              disabled={!!busy}
            >
              <Send size={14} aria-hidden="true" />
              {busy === 'announce' ? 'Replying…' : 'Post the reply'}
            </button>
            <button type="button" className="admin-gate-button" onClick={remeasure} disabled={!!busy}>
              <RefreshCw size={14} aria-hidden="true" />
              {busy === 'measure' ? 'Measuring…' : 'Measure again'}
            </button>
            <button
              type="button"
              className="admin-link-subtle"
              onClick={() => {
                // Both, or the panel goes but the seal state stays and the next
                // piece of the session runs unwatched.
                setAnnounce(null);
                setSealed(null);
              }}
            >
              dismiss
            </button>
          </div>
        </section>
      )}

      {!live && (
        <section className="rs-template">
          {/* No glyph. Its two siblings — "Take 12" and "The series" — are the
              same `.rs-h2` with none, and one iconised heading in three reads as
              an accident rather than a system. */}
          <h2 className="rs-h2">The template</h2>
          {tplDraft === null ? (
            <>
              <p className="admin-field-hint">
                Stored on your PDS at <code>{TEMPLATE_NSID}/self</code>, so the wording can change
                without a deploy. <code>{'{take}'}</code> becomes the number and{' '}
                <code>{'{link}'}</code> the piece&rsquo;s own page.
              </p>
              <pre className="rs-template-preview">{template ?? '…'}</pre>
              <div className="rs-actions">
                <button
                  type="button"
                  className="admin-gate-button"
                  onClick={() => setTplDraft(template ?? DEFAULT_TEMPLATE)}
                  disabled={template === undefined}
                >
                  Edit the template
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="admin-field-hint">
                Checked against the scan that measures pieces before it saves. A template the scan
                can&rsquo;t recognise makes pieces the site never finds — which is exactly how take
                13 went missing.
              </p>
              <textarea
                className="admin-input rs-draft"
                rows={13}
                spellCheck={false}
                value={tplDraft}
                onChange={(e) => setTplDraft(e.target.value)}
              />
              {templateProblems(tplDraft, take).map((p) => (
                <p className="admin-error-inline" key={p}>{p}</p>
              ))}

              {/* The other half of the record, and the reason it is here rather
                  than in the code: on a piece whose like was deleted, this
                  sentence is the only evidence the like ever existed. */}
              <label className="admin-field-label" htmlFor="rs-announce-tpl">
                The concluding reply
              </label>
              <p className="admin-field-hint">
                The whole of it, figures included. A line of{' '}
                <code>{ANNOUNCEMENT_BREAK}</code> on its own starts a second reply in the same
                thread, which is how it carries more than a post holds.
              </p>
              <ul className="rs-tokens">
                {ANNOUNCEMENT_TOKENS.map(([token, what]) => (
                  <li key={token}>
                    <code>{token}</code> {what}
                  </li>
                ))}
              </ul>
              <textarea
                id="rs-announce-tpl"
                className="admin-input rs-draft"
                rows={10}
                spellCheck={false}
                value={annDraft ?? announceTpl ?? DEFAULT_ANNOUNCEMENT}
                onChange={(e) => setAnnDraft(e.target.value)}
              />
              {/* What it comes to for the longest handle the project has drawn,
                  which is the case it fails on and the case nobody writing it
                  has in mind. */}
              <p className="admin-field-hint">
                {announcementLengths(annDraft ?? announceTpl ?? DEFAULT_ANNOUNCEMENT)
                  .map((n, i, all) => `${all.length > 1 ? `reply ${i + 1}: ` : ''}${n}/${POST_MAX}`)
                  .join(' · ')}{' '}
                at its longest
              </p>
              {announcementProblems(annDraft ?? announceTpl ?? DEFAULT_ANNOUNCEMENT).map((p) => (
                <p className="admin-error-inline" key={p}>{p}</p>
              ))}
              <div className="rs-actions">
                <button
                  type="button"
                  className="admin-gate-button"
                  onClick={saveTemplate}
                  disabled={
                    !!busy ||
                    templateProblems(tplDraft, take).length > 0 ||
                    announcementProblems(annDraft ?? announceTpl ?? DEFAULT_ANNOUNCEMENT).length > 0
                  }
                >
                  {busy === 'template' ? 'Saving…' : 'Save the template'}
                </button>
                <button
                  type="button"
                  className="admin-link-subtle"
                  onClick={() => {
                    setTplDraft(null);
                    setAnnDraft(null);
                  }}
                >
                  cancel
                </button>
                <button
                  type="button"
                  className="admin-link-subtle"
                  onClick={() => {
                    setTplDraft(DEFAULT_TEMPLATE);
                    setAnnDraft(DEFAULT_ANNOUNCEMENT);
                  }}
                >
                  restore the built-in
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/* The words on the piece pages, which are the artist's rather than the
          build's — the same argument the template makes, and the same shape:
          a record, edited here, read by the page with the built-in sentence
          behind every field.
          Not gated on there being no live piece, unlike the template beside it:
          composing a post while one is up is meaningless, but rewording the
          page a piece is being READ on while it runs is the likeliest moment
          anybody would want to. */}
      <section className="rs-copy">
        <h2 className="rs-h2">The page&rsquo;s words</h2>
        {copyDraft === null ? (
          <>
            <p className="admin-field-hint">
              The captions on a piece&rsquo;s own page, stored at <code>{COPY_NSID}/self</code>{' '}
              so they can be rewritten without a deploy. The figures are not here: they are
              measured, and a caption is not.
            </p>
            <div className="rs-actions">
              <button
                type="button"
                className="admin-gate-button"
                onClick={() => setCopyDraft({ ...(copy || DEFAULT_COPY) })}
                disabled={copy === null}
              >
                {copy === null ? 'Reading…' : 'Edit the words'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="admin-field-hint">
              Every field falls back to the site&rsquo;s own sentence, so clearing one restores it
              rather than emptying it.
            </p>
            {COPY_FIELDS.map((f) => (
              <label className="rs-copy-field" key={f.key}>
                <span className="rs-copy-label">{f.label}</span>
                <span className="admin-field-hint">{f.hint}</span>
                <textarea
                  className="admin-input"
                  rows={2}
                  value={copyDraft[f.key] ?? ''}
                  placeholder={DEFAULT_COPY[f.key]}
                  onChange={(e) =>
                    setCopyDraft((d) => ({ ...d, [f.key]: e.target.value }))
                  }
                />
              </label>
            ))}
            <div className="rs-actions">
              <button
                type="button"
                className="admin-gate-button"
                onClick={saveCopy}
                disabled={!!busy}
              >
                {busy === 'copy' ? 'Saving…' : 'Save the words'}
              </button>
              <button
                type="button"
                className="admin-link-subtle"
                onClick={() => setCopyDraft(null)}
              >
                cancel
              </button>
              <button
                type="button"
                className="admin-link-subtle"
                onClick={() => setCopyDraft({ ...DEFAULT_COPY })}
              >
                restore the built-ins
              </button>
            </div>
          </>
        )}
      </section>

      <section className="rs-series">
        <h2 className="rs-h2">The series</h2>
        <ul className="rs-series-list">
          {[...done]
            .sort((a, b) => b.take - a.take)
            .slice(0, 6)
            .map((p) => {
              const b = p.breaker || {};
              const timed = typeof b.reactionMs === 'number';
              // What this piece is missing, asked of the record rather than
              // worked out here. `needsAName` is the one gap a repair cannot
              // close on its own: nothing watched the like and no reply named
              // whoever cast it, so only a person can say.
              const gaps = pieceGaps(p);
              const unnamed = !b.handle || b.handle === 'unknown';
              const isNaming = naming?.rkey === p.rkey;
              return (
                <li key={p.rkey}>
                  <Link to={piecePath(p)}>take {pieceSlug(p)}</Link>
                  <span className="rs-series-meta">
                    {fmtDuration(p.lifespanMs)} · @{b.handle || 'unknown'}
                    {b.did ? '' : ' (no did)'}
                    {timed
                      ? ` · ${fmtSeconds(b.reactionMs)}${b.reactionRecovered ? ' (recovered)' : ''}`
                      : ' · like deleted'}
                  </span>
                  <span className="rs-series-acts">
                    {/* A seal that landed with no measurement behind it: the
                        index was unreachable in the seconds after the gate.
                        Repair cannot fix this one — it never re-derives the
                        alive window — so the measurement has to be offered
                        again, and it is the only button here that writes a
                        pre-seal figure. */}
                    {!p.measuredAt && (
                      <button
                        type="button"
                        className="admin-link-subtle rs-series-wanted"
                        onClick={() => remeasure(p)}
                        disabled={!!busy}
                        title="This piece was sealed but never measured. Read its records now."
                      >
                        <RefreshCw size={12} aria-hidden="true" />
                        {busy === 'measure' ? 'measuring…' : 'measure'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="admin-link-subtle"
                      onClick={() => repair(p)}
                      disabled={!!busy}
                      title="Fill in whatever this record is missing: the breaker's name and DID, a reaction time the log or the replay still holds, handles and audiences on the log, and everything that has landed since the seal. The alive window is never re-read."
                    >
                      <Wrench size={12} aria-hidden="true" />
                      {busy === `repair:${p.rkey}` ? 'repairing…' : 'repair'}
                    </button>
                    {/* Offered on any piece, not only the unnamed ones: a
                        breaker recorded by handle alone predates the DID being
                        stored, and the roster is keyed by DID. */}
                    <button
                      type="button"
                      className={`admin-link-subtle${gaps.needsAName ? ' rs-series-wanted' : ''}`}
                      onClick={() =>
                        setNaming(isNaming ? null : { rkey: p.rkey, text: unnamed ? '' : b.handle })
                      }
                      disabled={!!busy}
                      title="Say who ended this piece. The handle is resolved to a DID and both go on the record; nothing else is touched. The one repair nothing can do for you."
                    >
                      <UserPen size={12} aria-hidden="true" />
                      {unnamed ? 'name the breaker' : 'rename'}
                    </button>
                  </span>
                  {isNaming && (
                    <span className="rs-series-name">
                      <input
                        className="admin-input"
                        value={naming.text}
                        autoFocus
                        placeholder="handle.example.com"
                        onChange={(e) => setNaming((n) => ({ ...n, text: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') nameBreaker(p, naming.text);
                          if (e.key === 'Escape') setNaming(null);
                        }}
                      />
                      <button
                        type="button"
                        className="admin-gate-button"
                        onClick={() => nameBreaker(p, naming.text)}
                        disabled={!!busy || !naming.text.trim()}
                      >
                        {busy === `name:${p.rkey}` ? 'Resolving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="admin-link-subtle"
                        onClick={() => setNaming(null)}
                      >
                        cancel
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
        </ul>
        {/* Both links lowercase. They are one caption, and "The essay · the
            full catalogue" set one of them as a title and the other as a
            phrase. */}
        <p className="admin-field-hint">
          A breaking like that was deleted can still have its reaction time recovered. A piece the
          studio watched carries the answer on its own record — the log saw the like land and saw
          it go — and that never expires. A piece nothing was watching has 36 hours, for as long as
          Jetstream&rsquo;s lookback holds the like and the reply naming the breaker lets the replay
          be filtered down to one account. After that the number is gone, as it is for six of the
          first thirteen.
        </p>
        <p className="admin-field-hint">
          <Link to={`/creating/${RATIOED_PATH}`}>the essay</Link> ·{' '}
          {/* An ordinary <Link>: it is a whole-query replacement rather than a
              merge, so it cannot leave a stale `c` or `r` behind, and this
              studio never holds an unsaved edit for the shell's `go` guard to
              protect. */}
          <Link to="/admin?view=ratioed">the full catalogue</Link>
        </p>
      </section>
    </div>
  );
}
