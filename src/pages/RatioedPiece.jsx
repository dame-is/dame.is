// One piece of Ratioed, on its own page.
//
// The essay's charts read all thirteen at once, which is the right altitude for
// the argument they make and the wrong one for a single piece: a take that
// lived sixteen seconds is four pixels of a shared axis. Here the axis belongs
// to one piece, so the seconds it was alive are the whole width, and everything
// its record carries — the event log, the roster, the reaction time, the
// afterlife it has accrued since — has room to be read rather than summarised.
//
// Every figure on this page is a DATED MEASUREMENT, for the reason the whole
// project is recorded rather than queried: Constellation indexes live state,
// and the like that ended a piece is usually deleted within minutes. What the
// record says happened is the only evidence it happened. The one live number is
// the afterlife delta, which is additive and clearly labelled as of now.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { InspectMargin } from '../components/XraySubstrate.jsx';
import {
  SEED_PIECES,
  loadPieces,
  findPieceByRef,
  pieceSlug,
  piecePath,
  isRatioedParent,
  fetchLiveDeltas,
  fmtDuration,
  fmtSeconds,
  fmtElapsed,
} from '../lib/ratioed.js';
import { resolvePds, resolveProfiles } from '../lib/atproto.js';
import { ratioedScaleVars } from '../lib/ratioedPalette.js';
import { useTheme } from '../hooks/useTheme.jsx';
import { ME_DID, ME_HANDLE, RATIOED_DOC_RKEY, COLLECTIONS } from '../config.js';
import PieceReplay from '../components/RatioedReplay.jsx';
import PieceFaces from '../components/RatioedFaces.jsx';
import './RatioedPiece.css';

const KIND_LABEL = { like: 'like', repost: 'repost', quote: 'quote', reply: 'reply' };

// How long the live read gets before the page gives up on it and calls what it
// has final. Only "no such piece" turns on this — a piece the snapshot knows
// about is already on screen well before it elapses.
const PDS_DEADLINE_MS = 6000;

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
  const [delta, setDelta] = useState(null);
  const [profiles, setProfiles] = useState({});
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
      const fresh = pds ? await deadline(loadPieces(pds).catch(() => null)) : null;
      if (!alive) return;
      if (fresh?.length) setPieces(fresh);
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
    return () => {
      alive = false;
    };
  }, []);

  const piece = useMemo(() => findPieceByRef(pieces, ref), [pieces, ref]);

  // The record's own log wins; the bundle covers the pieces measured before
  // records carried one.
  const events = useMemo(() => {
    if (!piece) return null;
    return piece.events || bundled?.[piece.rkey] || null;
  }, [piece, bundled]);

  // Faces for everyone in the log. Resolved live rather than recorded: the
  // COUNTS are a measurement and must not drift, but a portrait is only ever a
  // portrait — showing today's is right, and showing a year-old cached one
  // would be worse.
  useEffect(() => {
    if (!events?.length) return undefined;
    let alive = true;
    const dids = events.filter((e) => e.did && !e.self).map((e) => e.did);
    if (!dids.length) return undefined;
    resolveProfiles(dids).then((p) => {
      if (alive) setProfiles(p);
    });
    return () => {
      alive = false;
    };
  }, [events]);

  useEffect(() => {
    if (!piece?.subject) return undefined;
    let alive = true;
    fetchLiveDeltas([piece]).then((d) => {
      if (alive) setDelta(d?.[piece.rkey] || null);
    });
    return () => {
      alive = false;
    };
  }, [piece]);

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
  const atUri = `at://${ME_DID}/${COLLECTIONS.ratioedPiece}/${piece.rkey}`;
  const b = piece.breaker || {};
  const live = events?.filter((e) => e.pre && !e.self) || [];
  const after = events?.filter((e) => !e.pre && !e.self) || [];
  const hidden = after.filter((e) => e.k === 'reply');
  // What the log section makes its case with. Counted rather than written down,
  // so it can't drift from the pieces on screen the way a hardcoded figure did
  // in the essay's reaction chart.
  const deletedLikes = pieces.filter((p) => p.breaker?.likeSurvives === false).length;

  return (
    <PageShell
      title={`Ratioed, take ${take}`}
      atUri={atUri}
      cid={null}
      headTitle={`Ratioed take ${take} — dame.is`}
    >
      <article className="ratioed-piece reveal" style={scale}>
        <InspectMargin atUri={atUri} cid={null} />

        {/* Back to the essay by the same address the reader came in on — its
            path or its record key, both of which resolve. */}
        <p className="ratioed-piece-crumb">
          <Link to={`/creating/${slug}`}>← Ratioed</Link>
        </p>

        {/* The whole piece in one sentence, before any chart asks for
            attention. A reader who leaves here should still know what
            happened. */}
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
          while it was alive, and was ended by <strong>@{b.currentHandle || b.handle}</strong>
          {b.likeSurvives ? (
            <>
              , whose like the artist caught {fmtSeconds(b.reactionMs)} later.
            </>
          ) : (
            <>. Their like has since been deleted, so how fast it was caught can no longer be
            measured.</>
          )}
        </p>

        <dl className="ratioed-piece-figures">
          <div>
            <dt>alive</dt>
            <dd>{fmtDuration(piece.lifespanMs)}</dd>
          </div>
          <div>
            <dt>reaction</dt>
            {/* A recovered time comes from a like that no longer exists — the
                figure is real, the record it was read from is gone. */}
            <dd>
              {typeof b.reactionMs === 'number' ? (
                fmtSeconds(b.reactionMs)
              ) : (
                <span className="ratioed-piece-gone">deleted</span>
              )}
            </dd>
          </div>
          <div>
            <dt>while alive</dt>
            <dd>{live.length || engagementTotal(piece.preSeal)}</dd>
          </div>
          <div>
            <dt>since</dt>
            <dd>
              {engagementTotal(piece.postSeal)}
              {delta?.total > 0 && <span className="ratioed-piece-fresh"> +{delta.total}</span>}
            </dd>
          </div>
        </dl>

        <section className="ratioed-piece-section">
          <h2>Replay</h2>
          <p className="ratioed-piece-note">
            Press play. The rule is the threadgate; everything past it landed on a post that was
            already finished.
          </p>
          <PieceReplay piece={piece} events={events} profiles={profiles} />
        </section>

        <section className="ratioed-piece-section">
          <h2>Who was there</h2>
          <p className="ratioed-piece-note">
            In the order they arrived. Portraits are current; the counts under them are not.
            {b.likeSurvives === false && (
              <>
                {' '}
                @{b.currentHandle || b.handle} is here on the strength of the reply that concluded
                the piece. Their like was deleted, so no index holds any trace of it.
              </>
            )}
          </p>
          <PieceFaces piece={piece} events={events} profiles={profiles} />
        </section>

        <section className="ratioed-piece-section">
          <h2>Either side of the seal</h2>
          <div className="ratioed-piece-split">
            <Window label="alive" figures={piece.preSeal} />
            <Window label="afterlife" figures={piece.postSeal} delta={delta} />
          </div>
          {delta && (
            <p className="ratioed-piece-note">
              Measured {piece.measuredAt.slice(0, 10)}.{' '}
              {delta.total > 0
                ? `${delta.total} more ${delta.total === 1 ? 'has' : 'have'} landed since.`
                : 'Nothing has landed since.'}
            </p>
          )}
        </section>

        {hidden.length > 0 && (
          <section className="ratioed-piece-section">
            <h2>Replies hidden by the threadgate</h2>
            <p className="ratioed-piece-note">
              Written to the network after the seal, and never visible in the thread. A threadgate
              hides replies at the appview; it does not stop the records being made.
            </p>
            <ul className="ratioed-piece-hidden">
              {hidden.map((e, i) => (
                <li key={`${e.did || e.h}-${e.off}-${i}`}>
                  <span className="ratioed-piece-when">
                    +{fmtElapsed(e.off - piece.lifespanMs / 1000)}
                  </span>
                  <span className="ratioed-piece-who">@{e.h}</span>
                  {e.t && <span className="ratioed-piece-text">{e.t}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {events?.length > 0 && (
          <section className="ratioed-piece-section">
            <h2>The log</h2>
            {/* The one place on the page that argues for the whole method, so
                it argues with the count rather than with an adjective. */}
            <p className="ratioed-piece-note">
              Every record pointing at this piece, timed from the moment it went up. Taken at
              measurement time rather than read live
              {deletedLikes > 0
                ? `: ${deletedLikes} of the project's ${pieces.length} breaking likes have since been deleted by the people who cast them, and a deleted record leaves nothing to count.`
                : ', so a record deleted since this was measured is still counted here.'}
            </p>
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
                {events.map((e, i) => (
                  <tr key={`${e.did || e.h}-${e.off}-${i}`} className={e.self ? 'is-self' : ''}>
                    <td className="ratioed-piece-when">
                      {e.off < 0 ? '—' : `+${fmtElapsed(e.off)}`}
                    </td>
                    <td>
                      <span className={`ratioed-piece-kind ratioed-k-${e.k}`}>
                        {KIND_LABEL[e.k] || e.k}
                      </span>
                    </td>
                    <td className="ratioed-piece-who">
                      @{e.h}
                      {e.self ? ' (the artist)' : ''}
                    </td>
                    <td>{e.pre ? 'alive' : 'after the seal'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="ratioed-piece-section">
          <h2>Provenance</h2>
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

        <PieceNav pieces={pieces} take={piece.take} parent={slug} />
      </article>
    </PageShell>
  );
}

function engagementTotal(w) {
  return (w?.threadPosts || 0) + (w?.reposts || 0) + (w?.quotes || 0) + (w?.likes || 0);
}

/** One window's figures, laid out the same either side of the seal. */
function Window({ label, figures, delta }) {
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
              {figures?.[key] || 0}
              {delta?.[key] > 0 && <span className="ratioed-piece-fresh"> +{delta[key]}</span>}
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
