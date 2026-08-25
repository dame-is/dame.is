// One piece of Ratioed, on its own page.
//
// The essay's charts read all thirteen at once, which is the right altitude for
// the argument they make and the wrong one for a single piece: a take that
// lived sixteen seconds is four pixels of a shared axis. Here the axis belongs
// to one piece, so the seconds it was alive are the whole width, and everything
// its record carries — the event log, the roster, the reaction time, the
// afterlife it has accrued since — has room to be read rather than summarised.
//
// Every figure on a FINISHED piece is a DATED MEASUREMENT, for the reason the
// whole project is recorded rather than queried: Constellation indexes live
// state, and the like that ended a piece is usually deleted within minutes.
// What the record says happened is the only evidence it happened. The one live
// number is the afterlife delta, which is additive and labelled as of now.
//
// A piece that is still up is the exception, and gets a different page: there
// is no seal to measure against, so none of the sections below can be drawn,
// and what can be shown instead is the thing that will never be available
// again — the piece happening. That view is a witness rather than a
// measurement and says so. It comes from two readers: the piece's own record,
// which the studio writes its live log onto as it watches, and optionally the
// visitor's own firehose. When the record turns up sealed, the page becomes
// the measurement under the reader, and the log it was watching is kept —
// folded away, replayable, never merged into the measured figures.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import DocumentMeta from '../components/DocumentMeta.jsx';
import { formatDateFull } from '../lib/time.js';
import { InspectMargin } from '../components/XraySubstrate.jsx';
import {
  SEED_PIECES,
  loadPieces,
  composeEventLog,
  findPieceByRef,
  pieceSlug,
  piecePath,
  isRatioedParent,
  isLive,
  longestPiece,
  normalizePiece,
  fetchLiveDeltas,
  fmtDuration,
  fmtSeconds,
  fmtElapsed,
} from '../lib/ratioed.js';
import {
  pieceReach,
  applyAudience,
  audienceIsFresh,
  fmtReach,
} from '../lib/ratioedReach.js';
import { aturiUniversalUrl, getRecord, resolvePds, resolveProfiles } from '../lib/atproto.js';
import { DEFAULT_COPY, loadCopy, fillCopy } from '../lib/ratioedCopy.js';
import { pieceStats } from '../lib/ratioedStats.js';
import RatioedStats from '../components/RatioedStats.jsx';
import RatioedHandle from '../components/RatioedHandle.jsx';
import { ratioedScaleVars } from '../lib/ratioedPalette.js';
import { useTheme } from '../hooks/useTheme.jsx';
import { ME_DID, ME_HANDLE, RATIOED_DOC_RKEY, COLLECTIONS } from '../config.js';
import PieceReplay from '../components/RatioedReplay.jsx';
import PieceFaces from '../components/RatioedFaces.jsx';
import RatioedLive from '../components/RatioedLive.jsx';
import './RatioedPiece.css';

const KIND_LABEL = { like: 'like', repost: 'repost', quote: 'quote', reply: 'reply' };
// What somebody did, as something a sentence can say. "reposted it", never the
// "repostd it" that comes of gluing a suffix onto the kind.
const KIND_ACTED = { like: 'liked it', repost: 'reposted it', quote: 'quoted it', reply: 'replied' };

// How long the live read gets before the page gives up on it and calls what it
// has final. Only "no such piece" turns on this — a piece the snapshot knows
// about is already on screen well before it elapses.
const PDS_DEADLINE_MS = 6000;

// How often a live piece's record is re-read. The studio writes to it every
// couple of seconds while something is happening, so this is the lag on the
// cheap reader — the firehose, for anyone who opens it, is instant.
const LIVE_POLL_MS = 10_000;

/** Resolve to null rather than hang. */
function deadline(promise, ms = PDS_DEADLINE_MS) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);
}

/** `at://…/app.bsky.feed.post/<rkey>` → the bsky.app URL for the same post. */
function bskyUrl(rkey) {
  return `https://bsky.app/profile/${ME_HANDLE}/post/${rkey}`;
}

export default function RatioedPiece() {
  const { slug, piece: ref } = useParams();
  const [pieces, setPieces] = useState(SEED_PIECES);
  const [bundled, setBundled] = useState(null);
  const [audience, setAudience] = useState(null);
  const [delta, setDelta] = useState(null);
  const [profiles, setProfiles] = useState({});
  // The page's own words. Defaults until the record answers, so nothing here
  // ever renders blank or waits on a fetch to say anything.
  const [copy, setCopy] = useState(DEFAULT_COPY);
  // The seed is bundled, so there is always something to render; `settled`
  // only says whether the PDS has had its say. It gates the not-found screen,
  // which must never fire on a piece the seed simply predates.
  const [settled, setSettled] = useState(false);

  // The categorical scale is derived from whatever hour the sky is showing, so
  // a piece page's marks agree with the essay's charts at the same moment.
  const { skyDisplayHour } = useTheme();
  const scale = useMemo(() => ratioedScaleVars(skyDisplayHour), [skyDisplayHour]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // The snapshot first, and on its own: it already holds every piece as of
      // the last build, and nothing about rendering those should wait on the
      // network. Reading it through the PDS branch meant a resolution that
      // never answered left the page reading "Loading…" indefinitely with the
      // answer sitting in hand.
      const fromSnap = await loadPieces(null);
      if (!alive) return;
      if (fromSnap?.length) setPieces(fromSnap);

      // Then the PDS, which is the only place a piece published since that
      // build exists. Worth waiting for; not worth waiting for forever.
      const pds = await deadline(resolvePds(ME_DID).catch(() => null));
      const [fresh, words] = await Promise.all([
        pds ? deadline(loadPieces(pds).catch(() => null)) : null,
        deadline(loadCopy(pds).catch(() => null)),
      ]);
      if (!alive) return;
      if (fresh?.length) setPieces(fresh);
      if (words) setCopy(words);
      setSettled(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The first eleven pieces predate the `events` field and draw their log from
  // the bundle. A ~27kB chunk, so it loads alongside rather than up front.
  useEffect(() => {
    let alive = true;
    import('../data/ratioedEvents.json')
      .then((m) => {
        if (alive) setBundled(m.default || m);
      })
      .catch(() => {});
    // The dated audience table, which is what gives a piece measured before
    // follower counts were recorded a reach figure at all. Its own timestamp
    // travels with it, because a figure taken a year after the piece ran has
    // to be labelled as one.
    import('../data/ratioedAudience.json')
      .then((m) => {
        if (alive) setAudience(m.default || m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const piece = useMemo(() => findPieceByRef(pieces, ref), [pieces, ref]);

  // The record's own log wins; the bundle covers the pieces measured before
  // records carried one. The audience join only ever fills gaps — a log that
  // recorded its own follower counts at measurement time keeps them.
  const events = useMemo(() => {
    if (!piece) return null;
    // Composed rather than chosen — see composeEventLog. A repaired piece from
    // the first eleven carries an afterlife of its own and takes its alive
    // window, and every reply's text, from the harvest.
    const log = composeEventLog(piece.events, bundled?.[piece.rkey]);
    if (!log) return null;
    return audience ? applyAudience(log, audience) : log;
  }, [piece, bundled, audience]);

  const reach = useMemo(() => (events ? pieceReach(events) : null), [events]);

  // Every other take's log, for the one figure that can only be read across
  // the series: who had never turned up before. Same composition the page uses
  // for its own — a repaired piece from the first eleven keeps its alive
  // window in the harvest and its afterlife on the record.
  const resolveEvents = useCallback(
    (p) => composeEventLog(p.events, bundled?.[p.rkey]),
    [bundled],
  );
  const stats = useMemo(
    () => pieceStats(piece, events, { pieces, resolveEvents }),
    [piece, events, pieces, resolveEvents],
  );

  // Faces for everyone in the log. Resolved live rather than recorded: the
  // COUNTS are a measurement and must not drift, but a portrait is only ever a
  // portrait — showing today's is right, and showing a year-old cached one
  // would be worse.
  // The breaker rides along, by DID if the record has one and by handle if it
  // doesn't. On a piece whose breaking like was deleted they are in no log and
  // no index, so resolving only the log's DIDs left the one person the piece is
  // *about* as a blank frame beside twelve portraits — and the records that
  // predate DIDs being stored carry a handle alone, which `getProfiles` will
  // take as an actor just as happily.
  const breakerDid = piece?.breaker?.did || null;
  const breakerHandle = piece?.breaker?.currentHandle || piece?.breaker?.handle || '';
  useEffect(() => {
    let alive = true;
    const named = breakerHandle && breakerHandle !== 'unknown' ? breakerHandle : '';
    const actors = [
      ...(events || []).filter((e) => e.did && !e.self).map((e) => e.did),
      ...(breakerDid ? [breakerDid] : named ? [named] : []),
    ];
    if (!actors.length) return undefined;
    resolveProfiles(actors).then((p) => {
      if (!alive) return;
      // Keyed by handle as well as by DID. The faces grid looks a person up by
      // whichever identifier it holds, and for a breaker named by hand that is
      // sometimes only the name.
      const byHandle = {};
      for (const profile of Object.values(p)) {
        if (profile.handle) byHandle[profile.handle] = profile;
      }
      setProfiles({ ...byHandle, ...p });
    });
    return () => {
      alive = false;
    };
  }, [events, breakerDid, breakerHandle]);

  // Is this piece still up? A record written the moment the post goes up and
  // sealed later, so `sealedAt` is the whole test — and while it's absent this
  // page is a dashboard rather than a measurement.
  const running = isLive(piece);

  useEffect(() => {
    // Nothing to add to a piece that is still accruing its first anything, and
    // the delta is defined against a measurement that hasn't been taken.
    if (!piece?.subject || running) return undefined;
    let alive = true;
    fetchLiveDeltas([piece]).then((d) => {
      if (alive) setDelta(d?.[piece.rkey] || null);
    });
    return () => {
      alive = false;
    };
  }, [piece, running]);

  // While a piece is up, its record is the one thing on this site that changes
  // as you watch: the studio writes what it witnesses onto it as the piece
  // runs, and sealing writes the measurement. So it's re-read on a timer — one
  // small fetch, and it's what turns this page from a dashboard into a record
  // at the moment the piece ends, without anybody reloading anything.
  useEffect(() => {
    if (!running || !piece?.rkey) return undefined;
    const rkey = piece.rkey;
    let on = true;
    let timer = null;
    (async () => {
      const pds = await resolvePds(ME_DID).catch(() => null);
      if (!pds || !on) return;
      const read = async () => {
        const res = await getRecord(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.ratioedPiece,
          rkey,
        }).catch(() => null);
        const fresh = res?.value ? normalizePiece(rkey, res.value) : null;
        if (!on || !fresh) return;
        setPieces((prev) => prev.map((p) => (p.rkey === rkey ? fresh : p)));
      };
      await read();
      if (on) timer = setInterval(read, LIVE_POLL_MS);
    })();
    return () => {
      on = false;
      if (timer) clearInterval(timer);
    };
  }, [running, piece?.rkey]);

  // A piece page hangs off the essay, so it only answers under the essay's own
  // address — either form of it. Anything else is somebody else's work with a
  // number bolted on.
  if (!isRatioedParent(slug, { rkey: RATIOED_DOC_RKEY })) {
    return (
      <PageShell title="Not found" headTitle="Not found — dame.is">
        <p>
          <code>{slug}</code> has no pieces. <Link to="/creating">Back to the index.</Link>
        </p>
      </PageShell>
    );
  }

  if (!piece) {
    return (
      <PageShell
        title={settled ? 'No such piece' : 'Loading…'}
        headTitle={settled ? 'Not found — dame.is' : 'Ratioed — dame.is'}
      >
        {settled && (
          <p>
            Ratioed has no piece <code>{ref}</code>.{' '}
            <Link to={`/creating/${slug}`}>Back to the project.</Link>
          </p>
        )}
      </PageShell>
    );
  }

  const take = pieceSlug(piece);
  // Every piece that has ended, for the ticks along the record bar.
  const finishedPieces = pieces.filter((p) => p.lifespanMs > 0);

  const atUri = `at://${ME_DID}/${COLLECTIONS.ratioedPiece}/${piece.rkey}`;
  const b = piece.breaker || {};
  // The four that answer "how did this one go", at the size the answer
  // deserves. The ratio is the project's own — everything that isn't a like,
  // against the likes — and it is first because it is the thing the work is
  // named for and the only figure here that is a verdict rather than a
  // measurement.
  const headline = [
    // Absent, not zeroed, on the two takes nothing touched at all: "0 : 0" in
    // a grid of figures reads as a measurement that failed rather than as the
    // finding, which is that in 68 seconds nobody did anything. A piece with a
    // like and no replies still ratios — that one is 0 : 1 and says so.
    (stats.ratio.nonLike || stats.ratio.likes) && {
      key: 'ratio',
      label: 'the ratio',
      value: `${stats.ratio.nonLike} : ${stats.ratio.likes}`,
      note: 'everything else, against the likes',
    },
    {
      key: 'reaction',
      label: 'reaction',
      // A recovered time comes from a like that no longer exists — the figure
      // is real, the record it was read from is gone.
      value:
        typeof b.reactionMs === 'number' ? (
          fmtSeconds(b.reactionMs)
        ) : (
          <span className="ratioed-piece-gone">deleted</span>
        ),
      note: 'from the like to the seal',
    },
    {
      key: 'people',
      label: 'participants',
      value: stats.people || null,
      // The two counts that used to sit six inches apart contradicting each
      // other: the lede's people against the figures' records.
      note: `${stats.records} record${stats.records === 1 ? '' : 's'} between them`,
    },
    // Only when there is an audience to report. A piece whose participants
    // have all deactivated has no reach that can be measured, and a zero here
    // would read as one that reached nobody.
    // The alive window's own measurability, not the piece's: takes 2 and 7 drew
    // nothing while they stood, and "approx. reach 0" is a confident figure for
    // a piece nobody carried — exactly what the comment above forbids.
    reach?.alive?.measurable && {
      key: 'reach',
      label: 'approx. reach',
      value: fmtReach(reach.alive.raw),
      note: reach.alive.unknown
        ? `${reach.alive.known} of ${reach.alive.people} audiences known`
        : 'weighted by how each act travels',
    },
  ];

  // What it was like while it stood. Eight smaller figures, every one of them
  // something the four above can't say: the same 41 minutes is a different
  // piece at 1.9 records a minute than at nine, and different again if four of
  // those minutes were silence.
  const texture = [
    (stats.mix.replies || stats.mix.reposts || stats.mix.quotes) && {
      key: 'mix',
      label: 'the mix',
      value: `${stats.mix.replies} · ${stats.mix.reposts} · ${stats.mix.quotes}`,
      note: 'replies · reposts · quotes',
    },
    stats.vsMedian && {
      key: 'median',
      label: 'vs median',
      value: `${stats.vsMedian >= 10 ? Math.round(stats.vsMedian) : stats.vsMedian.toFixed(1)}×`,
      note: `the middle take stood ${fmtDuration(stats.medianMs)}`,
    },
    stats.first && {
      key: 'first',
      label: 'first touch',
      value: `+${fmtDuration(stats.first.off * 1000)}`,
      note: `somebody ${KIND_ACTED[stats.first.k] || 'was there'}`,
    },
    stats.silence && {
      key: 'silence',
      label: 'longest silence',
      value: fmtDuration(stats.silence.ms),
      note: stats.silence.fromMs ? `from +${fmtDuration(stats.silence.fromMs)}` : 'from the start',
    },
    stats.pace && {
      key: 'pace',
      label: 'pace',
      value: `${stats.pace >= 10 ? Math.round(stats.pace) : stats.pace.toFixed(1)}/min`,
      note: 'records while it was alive',
    },
    // Held back while any earlier take's log is missing: with a gap in the
    // history everybody from that take reads as new.
    stats.newcomers?.blind === 0 && {
      key: 'new',
      label: 'first-timers',
      value: stats.newcomers.n,
      note: `of ${stats.newcomers.of}, never in a take before`,
    },
    stats.audience?.top && {
      key: 'amp',
      label: 'biggest amplifier',
      value: fmtReach(stats.audience.top.followers),
      note: `@${stats.audience.top.h} ${KIND_ACTED[stats.audience.top.kind] || 'was there'}`,
    },
    typeof stats.audience?.median === 'number' && {
      key: 'med',
      label: 'median follower count',
      value: fmtReach(stats.audience.median),
      note: 'what the reach is made of',
    },
  ];
  const after = events?.filter((e) => !e.pre && !e.self) || [];
  const hidden = after.filter((e) => e.k === 'reply');
  // What the log section makes its case with. Counted rather than written down,
  // so it can't drift from the pieces on screen the way a hardcoded figure did
  // in the essay's reaction chart.
  const deletedLikes = pieces.filter((p) => p.breaker?.likeSurvives === false).length;
  // Records somebody made and unmade while the piece was being watched. The
  // measured log has no row for any of them, by construction: a record that no
  // longer exists is in no index.
  //
  // Which is why they are folded into the log rather than left to the witnessed
  // panel alone. The breaker's like is the case that matters — on take 16 it
  // stood for 329ms — and a log that shows every reply and no like reads as a
  // piece that ended for no reason. They are marked as what they are: struck
  // through, in the window column, and in the note above the table. Measured
  // and witnessed still say which is which; they are just no longer on
  // different screens.
  const witnessRows = (piece.witnessed || []).map((w) => ({
    k: w.k,
    h: w.h || '',
    did: w.did || null,
    off: w.offMs / 1000,
    pre: w.offMs <= piece.lifespanMs,
    rkey: w.rkey,
    ...(w.t ? { t: w.t } : {}),
    ...(w.goneMs != null ? { goneMs: w.goneMs, gone: true } : {}),
  }));
  // Composed by the same function that folds in the bundled harvest, and for
  // the same two reasons: the withdrawn records exist in no index and are here
  // only because they were watched, and the text of a reply is on the watched
  // row where the measured one has only a count. On take 17 that is the
  // difference between three rows carrying what somebody said and forty-three.
  const logRows = composeEventLog(events, witnessRows) || [];
  const withdrawn = logRows.filter((r) => r.gone);

  // A piece that is still up gets the whole page as a dashboard. None of the
  // sections below it can be drawn yet — every one of them is defined against
  // the seal — and the one thing that CAN be shown is the only thing that will
  // never be available again afterwards: the piece happening.
  if (running) {
    return (
      <PageShell
        title={`Ratioed, take ${take}`}
        atUri={atUri}
        cid={null}
        headTitle={`Ratioed take ${take} is live — dame.is`}
        above={
          <p className="ratioed-piece-crumb">
            <Link to={`/creating/${slug}`}>← Ratioed</Link>
          </p>
        }
      >
        <article className="ratioed-piece reveal" style={scale}>
          <InspectMargin atUri={atUri} cid={null} />

          <DocumentMeta columns={provenanceColumns(piece)} />

          {piece.lede ? (
            <p className="ratioed-piece-lede">{piece.lede}</p>
          ) : (
            <p className="ratioed-piece-lede">{fillCopy(copy.liveLede, { take })}</p>
          )}

          <RatioedLive
            piece={piece}
            record={longestPiece(pieces)}
            series={finishedPieces}
            copy={copy}
          />


          <section className="ratioed-piece-section">
            <h2>Provenance</h2>
            <dl className="ratioed-piece-kv">
              <dt>posted</dt>
              <dd>
                <time dateTime={piece.postedAt}>
                  {piece.postedAt.replace('T', ' ').slice(0, 19)}Z
                </time>
              </dd>
              <dt>sealed</dt>
              <dd>not yet</dd>
              <dt>the piece</dt>
              <dd>
                <a href={bskyUrl(piece.rkey)} target="_blank" rel="noreferrer noopener">
                  bsky.app/…/{piece.rkey}
                </a>
              </dd>
            </dl>
          </section>

          {/* The two doors out: the essay that explains the project, and the
              leaderboard that holds everyone. */}
          <nav className="ratioed-piece-go" aria-label="Ratioed">
            <Link to={`/creating/${slug}`}>Learn more</Link>
            <Link to={`/creating/${slug}/participants`}>View leaderboard</Link>
          </nav>

          <PieceNav pieces={pieces} take={piece.take} parent={slug} />
        </article>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={`Ratioed, take ${take}`}
      atUri={atUri}
      cid={null}
      headTitle={`Ratioed take ${take} — dame.is`}
      /* The way back up sits above the title, where a breadcrumb belongs: a
         reader who wants the parent wants it before reading, not after. It
         used to be the first line of the body, which also made the lede a
         second paragraph and got it indented by the article prose rule. */
      above={
        <p className="ratioed-piece-crumb">
          <Link to={`/creating/${slug}`}>← Ratioed</Link>
        </p>
      }
    >
      <article className="ratioed-piece reveal" style={scale}>
        <InspectMargin atUri={atUri} cid={null} />

        {/* The document's own dates, in the band every other document page on
            the site wears under its title. A piece is dated three times and no
            one of them is the publication date the two-column form assumes. */}
        <DocumentMeta columns={provenanceColumns(piece)} />

        {/* The whole piece in one sentence, before any chart asks for
            attention. A reader who leaves here should still know what
            happened. Authored copy on the record wins: the generated sentence
            is a floor that is always true, not a thing dame is stuck with. */}
        {piece.lede ? (
          <p className="ratioed-piece-lede">{piece.lede}</p>
        ) : (
          <p className="ratioed-piece-lede">
            It stood for <strong>{fmtDuration(piece.lifespanMs)}</strong>, drew{' '}
            {piece.preSeal.participants === 0 ? (
              <strong>nobody</strong>
            ) : (
              <>
                <strong>{piece.preSeal.participants}</strong>{' '}
                {piece.preSeal.participants === 1 ? 'person' : 'people'}
              </>
            )}{' '}
            while it was alive, and was ended by{' '}
            <strong>
              <RatioedHandle handle={b.currentHandle || b.handle} parent={slug} />
            </strong>
            {/* Three endings, not two. A like that still stands is measured; a
                like that was deleted after something had already timed it is
                measured and gone, which is the case the record's
                `reactionRecovered` exists for; a like that was deleted before
                anything saw it takes the number with it. */}
            {typeof b.reactionMs === 'number' ? (
              b.likeSurvives ? (
                <>
                  , whose like the artist caught {fmtSeconds(b.reactionMs)} later.
                </>
              ) : (
                <>
                  , whose like the artist caught {fmtSeconds(b.reactionMs)} later. They deleted it
                  afterwards; the timing is off the log below.
                </>
              )
            ) : (
              <>. Their like was deleted, so the reaction time is gone with it.</>
            )}
          </p>
        )}

        {/* No "alive" row: the band under the title says how long it stood,
            and printing it twice on one screen was the thing that made the
            band's own column look like it was saying something else. */}
        <RatioedStats cells={headline} />
        <RatioedStats cells={texture} dense />

        {/* One player, one clock. The dashboard the studio kept while this ran
            used to be a second replay in a folded section below this one, with
            its own play button and its own idea of how fast to go; it is now
            the list under the track, arriving off the same playhead. */}
        <section className="ratioed-piece-section">
          <h2>Replay</h2>
          <p className="ratioed-piece-note">
            {copy.replay}
            {piece.witnessed?.length > 0 && <> {copy.witnessed}</>}
            {piece.witnessFromMs > 1000 && (
              <> Watching began {fmtDuration(piece.witnessFromMs)} in.</>
            )}
          </p>
          {/* Keyed, because RouteTransition's reduced-motion path renders the
              routes with no key of its own — so for those readers the replay's
              state initialisers never re-ran and `realTime`, `progress` and
              `playing` travelled between pieces. Arrive from take 13 (16.7s, so
              Real is selected) and take 14 opened ready to start a 42-minute
              replay. */}
          <PieceReplay key={piece.rkey} piece={piece} events={logRows} profiles={profiles} parent={slug} />
        </section>

        <section className="ratioed-piece-section">
          <h2>Who was there</h2>
          <p className="ratioed-piece-note">
            {copy.roster}
            {b.likeSurvives === false && (
              <>
                {' '}
                <RatioedHandle handle={b.currentHandle || b.handle} parent={slug} /> is here without
                a like to show for it.
              </>
            )}
          </p>
          <PieceFaces piece={piece} events={events} profiles={profiles} parent={slug} />
        </section>

        <section className="ratioed-piece-section">
          <h2>Either side of the seal</h2>
          <div className="ratioed-piece-split">
            <Window label="alive" figures={piece.preSeal} />
            <Window
              label="afterlife"
              figures={piece.postSeal}
              delta={delta}
              atSeal={measuredAtTheSeal(piece)}
            />
          </div>
          {delta && (
            <p className="ratioed-piece-note">
              {/* Two clauses that used to be written independently and could
                  contradict each other: a piece measured at its own seal read
                  "everything on that side has landed since. Nothing has landed
                  since." */}
              {measuredAtTheSeal(piece)
                ? 'Measured at the seal, so the afterlife column was empty when it was taken.'
                : `Measured ${piece.measuredAt.slice(0, 10)}.`}{' '}
              {delta.total > 0
                ? `${delta.total} more ${delta.total === 1 ? 'has' : 'have'} landed since.`
                : 'Nothing has landed since.'}
            </p>
          )}
        </section>

        {(reach?.alive?.measurable || reach?.after?.measurable) && (
          <ReachSection
            reach={reach}
            audienceAt={piece.audienceAt || audience?.measuredAt || ''}
            piece={piece}
            copy={copy}
            parent={slug}
          />
        )}

        {/* Folded, like the witnessed log above: both are the raw evidence
            under the figures, and a reader who wants them opens them. Left
            open, the two of them were most of the page's height on a phone. */}
        {hidden.length > 0 && (
          <section className="ratioed-piece-section">
            <details className="ratioed-piece-witness">
              <summary>
                <span>Replies hidden by the threadgate</span>
                <span className="ratioed-piece-witness-count">{hidden.length}</span>
              </summary>
            <p className="ratioed-piece-note">{copy.hidden}</p>
            <ul className="ratioed-piece-hidden">
              {hidden.map((e, i) => (
                <li key={`${e.did || e.h}-${e.off}-${i}`}>
                  <span className="ratioed-piece-when">
                    +{fmtElapsed(e.off - piece.lifespanMs / 1000)}
                  </span>
                  <RatioedHandle className="ratioed-piece-who" handle={e.h} parent={slug} />
                  {e.t && <span className="ratioed-piece-text">{e.t}</span>}
                </li>
              ))}
            </ul>
            </details>
          </section>
        )}

        {/* Gated on what it renders. `measureAndFinish` writes `witnessed`
            unconditionally but `events` only when non-empty, so a piece sealed
            after its breaking like was deleted — with nobody else acting —
            produces exactly a witnessed log and no events. The replay still
            showed the struck-through like and the roster still named the
            breaker, while the section that labels the withdrawal and makes the
            case for the method vanished. */}
        {logRows.length > 0 && (
          <section className="ratioed-piece-section">
            <details className="ratioed-piece-witness">
              <summary>
                <span>The log</span>
                <span className="ratioed-piece-witness-count">
                  {logRows.length} record{logRows.length === 1 ? '' : 's'}
                </span>
              </summary>
            {/* The one place on the page that argues for the whole method, so
                it argues with the count rather than with an adjective. */}
            <p className="ratioed-piece-note">
              {copy.log}
              {withdrawn.length > 0 &&
                ' The struck-through rows are from the log the studio kept: those records were deleted, so no index holds them.'}
              {deletedLikes > 0 &&
                ` ${deletedLikes} of the project's ${pieces.length} breaking likes ${
                  deletedLikes === 1 ? 'has' : 'have'
                } since been deleted by the people who cast them.`}
            </p>
            <div className="ratioed-piece-scroll">
            <table className="ratioed-piece-log">
              <thead>
                <tr>
                  <th scope="col">at</th>
                  <th scope="col">what</th>
                  <th scope="col">who</th>
                  <th scope="col">window</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((e, i) => (
                  <tr
                    key={`${e.did || e.h}-${e.off}-${i}`}
                    className={`${e.self ? 'is-self' : ''}${e.gone ? ' is-gone' : ''}`}
                  >
                    <td className="ratioed-piece-when">
                      {e.off < 0 ? '—' : `+${fmtElapsed(e.off)}`}
                    </td>
                    <td>
                      <span className={`ratioed-piece-kind ratioed-k-${e.k}`}>
                        {KIND_LABEL[e.k] || e.k}
                      </span>
                    </td>
                    <td className="ratioed-piece-who">
                      <RatioedHandle handle={e.h} parent={slug} />
                      {e.self ? ' (the artist)' : ''}
                    </td>
                    <td>
                      {e.gone ? 'deleted' : e.pre ? 'alive' : 'after the seal'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </details>
          </section>
        )}

        <section className="ratioed-piece-section">
          <h2>Provenance</h2>
          {/* The dates live in the band under the title now. What stays here is
              everything that needs a sentence rather than a column: the exact
              timestamps to the second, which is the precision the reaction-time
              finding turns on and which a date alone throws away. */}
          <dl className="ratioed-piece-kv">
            <dt>posted</dt>
            <dd>
              <time dateTime={piece.postedAt}>{piece.postedAt.replace('T', ' ').slice(0, 19)}Z</time>
            </dd>
            <dt>sealed</dt>
            <dd>
              <time dateTime={piece.sealedAt}>{piece.sealedAt.replace('T', ' ').slice(0, 19)}Z</time>
            </dd>
            {piece.announceLagMs != null && (
              <>
                <dt>announced</dt>
                <dd>{fmtDuration(piece.announceLagMs)} after the seal</dd>
              </>
            )}
            {piece.statedTally && (
              <>
                <dt>the artist&rsquo;s own count</dt>
                <dd>{piece.statedTally}</dd>
              </>
            )}
            <dt>measured</dt>
            <dd>
              {piece.measuredAt.slice(0, 10)}
              {piece.source ? ` · ${piece.source}` : ''}
            </dd>
            <dt>the piece</dt>
            <dd>
              <a href={bskyUrl(piece.rkey)} target="_blank" rel="noreferrer noopener">
                bsky.app/…/{piece.rkey}
              </a>
            </dd>
          </dl>
        </section>

        {/* The two doors out: the essay that explains the project, and the
            leaderboard that holds everyone. */}
        <nav className="ratioed-piece-go" aria-label="Ratioed">
          <Link to={`/creating/${slug}`}>Learn more</Link>
          <Link to={`/creating/${slug}/participants`}>View leaderboard</Link>
        </nav>

        <PieceNav pieces={pieces} take={piece.take} parent={slug} />
      </article>
    </PageShell>
  );
}

// Inside this, a measurement taken "at the seal" — the studio measures as soon
// as it has closed replies, so the gap is a network round trip and a backlink
// index catching up, not a window anything could land in.
const MEASURED_AT_SEAL_MS = 5 * 60 * 1000;

/** Was this piece measured close enough to its seal that its afterlife window
 *  is empty by construction rather than by finding? */
function measuredAtTheSeal(piece) {
  const sealed = Date.parse(piece?.sealedAt || '');
  const measured = Date.parse(piece?.measuredAt || '');
  if (!Number.isFinite(sealed) || !Number.isFinite(measured)) return false;
  return measured - sealed < MEASURED_AT_SEAL_MS;
}

/**
 * A recorded figure, and whatever has landed since it was taken.
 *
 * The two are never added together — that is the rule the whole project turns
 * on, since one of them is evidence and the other is whatever Constellation
 * says this minute. But `0 +3` reads badly when the zero is not a finding: a
 * piece measured seconds after its seal has an afterlife window that is empty
 * BY CONSTRUCTION, because no time had passed for anything to land in. There,
 * printing the zero gives a reader a number to interpret where there is nothing
 * to interpret, and puts it first.
 *
 * `atSeal` is what says which kind of zero this is, and it has to be asked
 * rather than assumed. The docblock here used to assert that "every piece is
 * measured within a minute or two of its seal" — true of a piece the studio
 * has just sealed, and false of all seventeen stored records: take 17's gap is
 * six minutes, take 16's is over three hours, and the first nine were measured
 * more than a year later. On a fourteen-month window a recorded `threadPosts:
 * 0` is evidence, and suppressing it hid the finding it was meant to protect.
 */
function Figure({ recorded, since, atSeal = false }) {
  const fresh = since > 0;
  if (!fresh) return recorded;
  if (recorded === 0 && !atSeal) {
    return (
      <>
        0 <span className="ratioed-piece-fresh">+{since}</span>
      </>
    );
  }
  return (
    <>
      {recorded > 0 ? `${recorded} ` : ''}
      <span className={`ratioed-piece-fresh${recorded > 0 ? '' : ' is-only'}`}>+{since}</span>
    </>
  );
}

/**
 * A piece's provenance, for the header band under the title.
 *
 * The same three-column shape a blog post wears, answering the questions a
 * reader has before reading: when it happened, how long ago that was, and where
 * the record itself is.
 *
 * The third column used to be the measurement date, and it was the wrong fact
 * to put third — the same date as the first one on every recent piece, and
 * already stated twice below, once beside the delta that depends on it and once
 * in Provenance with its source. What a reader can't get anywhere else on the
 * page is the record: this whole project is an argument that the record is the
 * artwork, so the band that dates the document links to it.
 *
 * Deliberately not the lifespan, which was the first thing to go in here and
 * read as provenance for about a second: the figures row directly below already
 * leads with `alive`, and a band that repeats the number under it is furniture.
 * The exact timestamps stay in the Provenance section at the foot, where there
 * is room for the seconds the reaction-time finding depends on.
 */
function provenanceColumns(piece) {
  const day = (iso) => (iso || '').slice(0, 10);
  // The middle column is "Elapsed" on every other document on the site, where
  // it means how long ago the thing was published and "3 months ago" is worth
  // knowing. On a piece it read "today" beside a headline about fifteen
  // minutes, which is both useless and, on a page whose entire subject is a
  // duration, actively misleading — the one elapsed time a piece has is how
  // long it stood.
  const columns = [
    { key: 'date', label: 'Posted', long: formatDateFull(piece.postedAt), short: day(piece.postedAt) },
    piece.sealedAt
      ? {
          key: 'stood',
          label: 'Stood for',
          long: fmtDuration(piece.lifespanMs),
          short: fmtDuration(piece.lifespanMs),
        }
      : { key: 'stood', label: 'Standing', long: 'still up', short: 'still up' },
  ];
  // One element, handed in as both renderings: DocumentMeta shows a single
  // value when the long and short forms are the same thing, and a record key is
  // already as short as it gets.
  const record = aturiUniversalUrl(`at://${ME_DID}/${COLLECTIONS.ratioedPiece}/${piece.rkey}`);
  if (record) {
    const link = (
      <a href={record} target="_blank" rel="noreferrer noopener">
        {piece.rkey}
      </a>
    );
    columns.push({ key: 'record', label: 'Record', long: link, short: link });
  }
  return columns;
}

const REACH_ACT = { repost: 'reposted', quote: 'quoted', reply: 'replied', like: 'liked' };

// How many contributors the reach table lists before the rest are summed into
// one line. Twelve is where the list stops being a ranking and starts being a
// second copy of the log below it.
const REACH_ROWS = 12;

/**
 * How large an audience the piece was put in front of, either side of the seal.
 *
 * The one figure on this page that is an interpretation rather than a
 * measurement, so it carries its own arithmetic: every contributor is listed
 * with the audience they brought and what it was multiplied by, and the total
 * is the sum of that column.
 */
function ReachSection({ reach, audienceAt, piece, copy = DEFAULT_COPY, parent }) {
  const fresh = audienceIsFresh(audienceAt, piece?.sealedAt || piece?.postedAt);
  const { alive, after } = reach;

  const top = alive.top || after.top;
  // Tagged by window on the way in: the same account can carry a piece while
  // it is alive and again after the seal, and those are two separate rows
  // rather than one person listed twice by accident.
  // Sorted after the two windows are joined, not before. Each window arrives
  // already descending, and concatenating two descending runs does not make a
  // descending list — so `slice(0, 12)` below took the alive window first
  // whatever the numbers were. Take 16 listed twelve alive rows down to 25 and
  // folded smokeyjmirror's 20,119 — half the piece's whole reach — into "and 10
  // more". The window column already says which side each row is from.
  const all = [
    ...alive.contributors.map((p) => ({ ...p, window: 'alive' })),
    ...after.contributors.map((p) => ({ ...p, window: 'after' })),
  ]
    .filter((p) => p.known && p.raw > 0)
    .sort((a, b) => b.raw - a.raw);
  const unknown = alive.unknown + after.unknown;

  // The head of the list is the whole story — a piece is carried by two or
  // three accounts with an audience and a long tail contributing a few hundred
  // between them. The tail is summed rather than dropped, so the column still
  // adds up to the total and nothing is quietly truncated.
  const rows = all.slice(0, REACH_ROWS);
  const tail = all.slice(REACH_ROWS);
  const tailReach = tail.reduce((sum, p) => sum + p.raw, 0);

  return (
    <section className="ratioed-piece-section">
      <h2>How far it got</h2>
      <p className="ratioed-piece-lede">
        While it was alive it was carried to{' '}
        <strong>{alive.raw > 0 ? fmtReach(alive.raw) : 'nobody'}</strong>
        {alive.raw > 0 && ' people'}
        {top && alive.raw > 0 && alive.topShare > 0.5 && (
          <>
            , {Math.round(alive.topShare * 100)}% of it through{' '}
            <strong>
              <RatioedHandle handle={top.handle} parent={parent} />
            </strong>
          </>
        )}
        . Since the seal it has reached{' '}
        <strong>{after.raw > 0 ? fmtReach(after.raw) : 'nobody new'}</strong>
        {after.raw > 0 && ' more'}.
      </p>

      {/* One figure, not four. The raw score and the discounted one were both
          shown because the discount is a judgement and its size is worth
          seeing; two numbers within 10% of each other under different labels
          only ever read as a discrepancy. The approximation is what the score
          is, so the label says so and the row below shows the arithmetic. */}
      {/* Not the reach again: the band at the top of the page carries it and
          the sentence above says it in words. What is left is the only figure
          neither of them holds — how many accounts it was carried by. */}
      {/* One window per row. The figure used to be the alive window's, the
          "+N unknown" beside it the sum of both, and the table below drawn from
          both — three populations in one line, so take 8 read "10 +1 unknown"
          where the unresolved account only ever acted after the seal, and takes
          2 and 7 read "0" above a table with rows in it. */}
      <dl className="ratioed-piece-figures">
        <div>
          <dt>carried it while alive</dt>
          <dd>
            {alive.known}
            {alive.unknown > 0 && (
              <span className="ratioed-piece-fresh"> +{alive.unknown} unknown</span>
            )}
          </dd>
        </div>
        {(after.known > 0 || after.unknown > 0) && (
          <div>
            <dt>since the seal</dt>
            <dd>
              {after.known}
              {after.unknown > 0 && (
                <span className="ratioed-piece-fresh"> +{after.unknown} unknown</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {/* Four columns, and on a phone they become rows: the cells carry their
          own labels (see `data-label`) and the stylesheet re-lays them as a
          block per account under 34rem. `.ratioed-piece-scroll` is the backstop
          for the widths in between.

          It was six. An "audience" column sat beside the reach one and printed
          the same number in every row anybody ever saw — a repost or a quote
          counts as a whole following, so for those two acts reach IS the
          follower count, and the table is sorted by reach, so the reposts and
          quotes are the whole top of it. Only the replies down in the tail
          differed, at a tenth. Two columns agreeing all the way down don't
          read as an identity, they read as a bug. The reach column is the one
          that carries the finding, because it is the one the total is the sum
          of, and what each act is multiplied by is in the note underneath.

          The ratio column went with it: followers over follows was there to
          show why a farm-looking account gets discounted, and both numbers it
          is made of are now off the row. */}
      {rows.length > 0 && (
        <div className="ratioed-piece-scroll">
          <table className="ratioed-piece-log ratioed-piece-reach">
            <thead>
              <tr>
                <th scope="col">who</th>
                <th scope="col">act</th>
                <th scope="col">reach</th>
                <th scope="col">window</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={`${p.window}-${p.key}`}>
                  <td className="ratioed-piece-who">
                    <RatioedHandle handle={p.handle} parent={parent} />
                  </td>
                  <td>
                    <span className={`ratioed-piece-kind ratioed-k-${p.kind}`}>
                      {REACH_ACT[p.kind] || p.kind}
                    </span>
                  </td>
                  <td data-label="reach">{fmtReach(p.raw)}</td>
                  <td>{p.window === 'alive' ? 'alive' : 'after the seal'}</td>
                </tr>
              ))}
              {tail.length > 0 && (
                <tr className="is-self">
                  <td className="ratioed-piece-who">and {tail.length} more</td>
                  <td />
                  <td data-label="reach">{fmtReach(tailReach)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="ratioed-piece-note">
        {copy.reach}
        {/* The discount, which the weights above do not include: an account
            with twenty thousand followers and twenty-one thousand follows has
            an audience that is mostly reciprocal and mostly not looking. It was
            being computed for every row and shown nowhere, so the judgement was
            made and never stated. */}
        {alive.weighted > 0 && alive.weighted < alive.raw && (
          <>
            {' '}
            Discounting the followings that look reciprocal rather than chosen brings the alive
            figure to {fmtReach(alive.weighted)}.
          </>
        )}
        {unknown > 0 && (
          <>
            {' '}
            {unknown} {unknown === 1 ? 'account' : 'accounts'} went unresolved and{' '}
            {unknown === 1 ? 'is' : 'are'} missing rather than zero.
          </>
        )}
        {audienceAt && (
          <>
            {' '}
            Followers read {audienceAt.slice(0, 10)}
            {fresh ? '.' : ', long after this piece ran.'}
          </>
        )}
      </p>
    </section>
  );
}

/** One window's figures, laid out the same either side of the seal. */
function Window({ label, figures, delta, atSeal = false }) {
  const rows = [
    ['thread', 'threadPosts'],
    ['reposts', 'reposts'],
    ['quotes', 'quotes'],
    ['likes', 'likes'],
  ];
  return (
    <div className="ratioed-piece-window">
      <h3 className="small-caps">{label}</h3>
      <dl>
        {rows.map(([human, key]) => (
          <div key={key}>
            <dt>{human}</dt>
            <dd>
              <Figure recorded={figures?.[key] || 0} since={delta?.[key] || 0} atSeal={atSeal} />
            </dd>
          </div>
        ))}
        <div>
          <dt>people</dt>
          <dd>{figures?.participants || 0}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Previous / next by take, so the thirteen can be read straight through. */
function PieceNav({ pieces, take, parent }) {
  const sorted = [...(pieces || [])].sort((a, b) => a.take - b.take);
  const i = sorted.findIndex((p) => p.take === take);
  const prev = i > 0 ? sorted[i - 1] : null;
  const next = i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
  return (
    <nav className="ratioed-piece-nav">
      {prev ? (
        <Link to={piecePath(prev, parent)}>← take {pieceSlug(prev)}</Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link to={piecePath(next, parent)}>take {pieceSlug(next)} →</Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
