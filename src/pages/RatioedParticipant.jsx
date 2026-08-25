// One participant of Ratioed, on their own page.
//
// The essay's participants table is a ranking: a hundred and thirty rows, one
// number per column, sorted by how many pieces somebody turned up for. That is
// the right shape for the finding it carries and the wrong one for a person.
// It cannot say which takes were theirs, in what order, how quickly they got
// there, or that the reply they left on take 6 is the reason take 6 lasted
// eleven minutes.
//
// So the handle in that table is a link, and this is where it goes. Same rule
// as everywhere else in the project: the recorded measurement is the evidence
// and nothing here recomputes it. The roster says which pieces somebody was in
// — it counts by DID and it holds people whose records have since been deleted
// — and the event logs say when and what. The one live read is the portrait,
// because a portrait is only ever a portrait; a year-old cached one would be
// worse than today's.
//
// The split down the middle of this page is the split the whole project turns
// on. Being there while a post was still standing is participation. Touching it
// afterwards is an afterlife, it is counted separately, and it never adds to
// the figure at the top.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import DocumentMeta from '../components/DocumentMeta.jsx';
import RatioedStats from '../components/RatioedStats.jsx';
import {
  SEED_PIECES,
  SEED_PEOPLE,
  loadPieces,
  loadPeople,
  livingRoster,
  composeEventLog,
  brokenTakes,
  roleOf,
  isRatioedParent,
  pieceSlug,
  piecePath,
  fmtDuration,
  fmtElapsed,
} from '../lib/ratioed.js';
import {
  participantSlug,
  participantPath,
  findParticipant,
  participantDossier,
} from '../lib/ratioedParticipant.js';
import { applyAudience, audienceIndex, fmtReach } from '../lib/ratioedReach.js';
import { resolvePds, resolveProfiles } from '../lib/atproto.js';
import { ratioedScaleVars } from '../lib/ratioedPalette.js';
import { useTheme } from '../hooks/useTheme.jsx';
import { formatDateFull } from '../lib/time.js';
import { ME_DID, RATIOED_DOC_RKEY } from '../config.js';
import './RatioedPiece.css';
import './RatioedParticipant.css';

const KIND_LABEL = { like: 'like', repost: 'repost', quote: 'quote', reply: 'reply' };
const KIND_ACTED = { like: 'liked it', repost: 'reposted it', quote: 'quoted it', reply: 'replied' };
const KINDS = ['reply', 'repost', 'quote', 'like'];

// How long a live read gets before the page calls what it has final. Only the
// "no such participant" screen turns on this — anybody the bundled roster
// knows is on screen long before it elapses.
const PDS_DEADLINE_MS = 6000;

function deadline(promise, ms = PDS_DEADLINE_MS) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);
}

export default function RatioedParticipant() {
  const { slug, handle: ref } = useParams();
  const [pieces, setPieces] = useState(SEED_PIECES);
  const [people, setPeople] = useState(SEED_PEOPLE);
  const [bundled, setBundled] = useState(null);
  const [audience, setAudience] = useState(null);
  const [profile, setProfile] = useState(null);
  // The bundle is always there, so `settled` only says whether the network has
  // had its say. It gates the not-found screen, which must never fire on
  // somebody the seed simply predates.
  const [settled, setSettled] = useState(false);

  const { skyDisplayHour } = useTheme();
  const scale = useMemo(() => ratioedScaleVars(skyDisplayHour), [skyDisplayHour]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // The build's snapshot first and on its own: it holds every piece and the
      // roster regenerated alongside them as of the last deploy, and nothing
      // about rendering those should wait on plc.directory.
      const [snapPieces, snapPeople] = await Promise.all([loadPieces(null), loadPeople()]);
      if (!alive) return;
      if (snapPieces?.length) setPieces(snapPieces);
      if (snapPeople?.length) setPeople(snapPeople);

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

  // The harvest behind the first eleven pieces, and the dated audience table.
  // Both are separate chunks, so they land alongside rather than up front.
  useEffect(() => {
    let alive = true;
    import('../data/ratioedEvents.json')
      .then((m) => {
        if (alive) setBundled(m.default || m);
      })
      .catch(() => {});
    import('../data/ratioedAudience.json')
      .then((m) => {
        if (alive) setAudience(m.default || m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // A piece's log: its own recorded one and the bundled harvest composed, with
  // the dated audience table filling whatever gaps in follower counts are left.
  const resolveEvents = useCallback(
    (piece) => {
      const log = composeEventLog(piece?.events, bundled?.[piece?.rkey]);
      if (!log) return null;
      return audience ? applyAudience(log, audience) : log;
    },
    [bundled, audience],
  );

  // Everyone who was there while something was alive, enriched the way the
  // essay's table has them — live counts, living-window kinds, the mark for a
  // breaking like that was deleted.
  const roster = useMemo(() => {
    const byRkey = {};
    for (const p of pieces) {
      const log = resolveEvents(p);
      if (log) byRkey[p.rkey] = log;
    }
    return livingRoster(pieces, people, byRkey);
  }, [pieces, people, resolveEvents]);

  // The living roster first, since its rows carry the extra fields and its
  // named breakers are in no roster at all. Anyone who only ever touched a
  // finished piece still has a page; they are just not a participant, and the
  // page says so rather than 404ing on somebody who is demonstrably there.
  const person = useMemo(
    () => findParticipant(roster.rows, ref) || findParticipant(people, ref),
    [roster.rows, people, ref],
  );

  const dossier = useMemo(
    () => (person ? participantDossier(person, { pieces, resolveEvents }) : null),
    [person, pieces, resolveEvents],
  );

  const audiences = useMemo(
    () => audienceIndex(pieces, resolveEvents, audience),
    [pieces, resolveEvents, audience],
  );

  // Today's portrait, resolved live. By DID where there is one, and by handle
  // for a breaker named in an announcement rather than measured — `getProfiles`
  // takes either as an actor.
  const lookup = person?.did && !String(person.did).startsWith('handle:') ? person.did : person?.h;
  useEffect(() => {
    if (!lookup) return undefined;
    let alive = true;
    resolveProfiles([lookup])
      .then((found) => {
        if (!alive) return;
        setProfile(found[lookup] || Object.values(found)[0] || null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lookup]);

  // A participant page hangs off the essay, so it only answers under the
  // essay's own address — either form of it.
  if (!isRatioedParent(slug, { rkey: RATIOED_DOC_RKEY })) {
    return (
      <PageShell title="Not found" headTitle="Not found — dame.is">
        <p>
          <code>{slug}</code> has no participants. <Link to="/creating">Back to the index.</Link>
        </p>
      </PageShell>
    );
  }

  if (!person) {
    return (
      <PageShell
        title={settled ? 'No such participant' : 'Loading…'}
        headTitle={settled ? 'Not found — dame.is' : 'Ratioed — dame.is'}
      >
        {settled && (
          <p>
            Nobody by the name <code>{ref}</code> is in the Ratioed roster.{' '}
            <Link to={`/creating/${slug}`}>Back to the project.</Link>
          </p>
        )}
      </PageShell>
    );
  }

  const handle = profile?.handle || person.h;
  const name = profile?.displayName || person.dn || '';
  const found = audiences[person.did] || audiences[person.h] || null;
  const followers = typeof profile?.followers === 'number' ? profile.followers : found?.fr;
  const broke = brokenTakes(person);
  const role = roleOf(person);
  const takes = dossier.takes;
  const liveTakes = takes.filter((t) => t.wasAlive);
  const afterTakes = takes.filter((t) => !t.wasAlive);

  // The four that answer "what were they to this project". Pieces first,
  // because that is the figure the essay's table ranks by and the one this page
  // exists to break open.
  const headline = [
    {
      key: 'pieces',
      label: 'pieces',
      value: dossier.live || null,
      note: `of the ${pieces.length} takes, while they were still alive`,
    },
    {
      key: 'records',
      label: 'records',
      value: dossier.acts || null,
      note: 'made while a piece was standing',
    },
    {
      key: 'role',
      label: 'role',
      value: role.label,
      // Not "the furthest they carried one", which asks the reader to take a
      // metaphor on trust. The order is a real rule and short enough to state.
      note: broke.length ? 'the like that ended it' : 'quote outranks repost outranks reply',
    },
    typeof followers === 'number' && {
      key: 'audience',
      label: 'audience',
      value: fmtReach(followers),
      note: profile ? 'followers, as of now' : 'followers, recorded rather than read live',
    },
  ];

  // What their participation was like. Every one of these says something the
  // four above can't: the same three pieces is a different person at four
  // seconds in than at four hours.
  const texture = [
    dossier.debut && {
      key: 'debut',
      label: 'first turned up',
      value: `take ${String(dossier.debut.take).padStart(2, '0')}`,
      note: dossier.debut.piece?.postedAt
        ? formatDateFull(dossier.debut.piece.postedAt)
        : 'the first they were there for',
    },
    dossier.quickest && {
      key: 'quickest',
      label: 'quickest in',
      value: `+${fmtDuration(dossier.quickest.off * 1000)}`,
      note: `they ${KIND_ACTED[dossier.quickest.k] || 'were there'} on take ${String(
        dossier.quickest.take,
      ).padStart(2, '0')}`,
    },
    (dossier.kinds.reply || dossier.kinds.repost || dossier.kinds.quote) && {
      key: 'mix',
      label: 'the mix',
      value: `${dossier.kinds.reply || 0} · ${dossier.kinds.repost || 0} · ${
        dossier.kinds.quote || 0
      }`,
      note: 'replies · reposts · quotes, alive',
    },
    broke.length && {
      key: 'broke',
      label: broke.length === 1 ? 'piece they ended' : 'pieces they ended',
      value: broke.map((t) => `#${String(t).padStart(2, '0')}`).join(' '),
      note: dossier.likeGone ? 'the like has since been deleted' : 'their like sealed it',
    },
    dossier.afterActs && {
      key: 'after',
      label: 'after the seal',
      value: dossier.afterActs,
      note: `on ${afterTakes.length + takes.filter((t) => t.wasAlive && t.after.length).length} ${
        afterTakes.length + takes.filter((t) => t.wasAlive && t.after.length).length === 1
          ? 'piece'
          : 'pieces'
      }, counting towards nothing`,
    },
  ];

  return (
    <PageShell
      title={`@${handle}`}
      headTitle={`@${handle} in Ratioed — dame.is`}
      above={
        <p className="ratioed-piece-crumb">
          <Link to={`/creating/${slug}`}>← Ratioed</Link>
        </p>
      }
    >
      <article className="ratioed-piece ratioed-participant reveal" style={scale}>
        {/* No InspectMargin: this page is a cut through the records rather
            than a record of its own, and there is no at:// URI to inspect. */}
        <DocumentMeta columns={whoColumns(person, handle, dossier)} />

        <header className="ratioed-participant-head">
          {/* An account that no longer answers is an empty frame rather than a
              stand-in face: they were here, and there is nobody left to show.
              Same rule, and the same square frame, as the faces on a piece. */}
          <span className="ratioed-face-frame" data-gone={profile ? undefined : true}>
            {profile?.avatar ? (
              <img src={profile.avatar} alt="" width="72" height="72" />
            ) : (
              <span className="ratioed-face-blank" aria-hidden="true">
                {(handle || '?').slice(0, 1)}
              </span>
            )}
          </span>
          <div>
            {name && <p className="ratioed-participant-name">{name}</p>}
            {handle && handle !== '(unresolvable)' ? (
              <a
                className="ratioed-participant-at"
                href={`https://bsky.app/profile/${handle}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                @{handle}
              </a>
            ) : (
              <span className="ratioed-participant-at">an account that no longer answers</span>
            )}
          </div>
        </header>

        <p className="ratioed-piece-lede">
          {dossier.live > 0 ? (
            <>
              They were there for{' '}
              <strong>
                {dossier.live} {dossier.live === 1 ? 'piece' : 'pieces'}
              </strong>{' '}
              while the post was still standing
              {dossier.acts > 0 && (
                <>
                  , leaving <strong>{dossier.acts}</strong>{' '}
                  {dossier.acts === 1 ? 'record' : 'records'} between them
                </>
              )}
              {broke.length > 0 && (
                <>
                  , and ended{' '}
                  <strong>{broke.map((t) => `#${String(t).padStart(2, '0')}`).join(' and ')}</strong>
                </>
              )}
              .
            </>
          ) : (
            <>
              They have never touched a piece that was still alive. Everything below landed on a
              post that was already over, which is why they are not in the participants table.
            </>
          )}
          {dossier.afterActs > 0 && (
            <>
              {' '}
              Another <strong>{dossier.afterActs}</strong>{' '}
              {dossier.afterActs === 1 ? 'record' : 'records'} arrived after a seal, and{' '}
              {dossier.afterActs === 1 ? 'counts' : 'count'} towards nothing here.
            </>
          )}
        </p>

        <RatioedStats cells={headline} />
        <RatioedStats cells={texture} dense />

        <section className="ratioed-piece-section">
          <h2>Every piece they were in</h2>
          <p className="ratioed-piece-note">
            One row per take, in the order they happened. <em>Alive</em> means the post was still
            standing when they got there; every other row landed on one that had already been
            sealed.
          </p>
          <div className="ratioed-piece-scroll">
            <table className="ratioed-piece-log ratioed-participant-takes">
              <thead>
                <tr>
                  <th scope="col">take</th>
                  <th scope="col">window</th>
                  <th scope="col">what they did</th>
                  <th scope="col">when</th>
                </tr>
              </thead>
              <tbody>
                {takes.map((t) => (
                  <tr key={t.take} className={t.wasAlive ? undefined : 'is-self'}>
                    <td>
                      {t.piece ? (
                        <Link to={piecePath(t.piece, slug)}>{pieceSlug(t.piece)}</Link>
                      ) : (
                        String(t.take).padStart(2, '0')
                      )}
                      {t.broke && <span className="ratioed-participant-broke">broke it</span>}
                    </td>
                    <td>{t.wasAlive ? 'alive' : 'after the seal'}</td>
                    <td>
                      {/* Only the acts from the window the row is in. Folding
                          both together put an after-seal like in a row labelled
                          alive, which is the one confusion this whole page is
                          arranged to prevent; what they did on the other side
                          is counted at the end of the cell. */}
                      <Mix
                        acts={t.wasAlive ? t.alive : t.after}
                        likeGone={t.likeGone}
                        later={t.wasAlive ? t.after.length : 0}
                      />
                    </td>
                    <td className="ratioed-piece-when">{firstSeen(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {liveTakes.length > 0 && afterTakes.length > 0 && (
            <p className="ratioed-piece-note">
              {liveTakes.length} of these {liveTakes.length === 1 ? 'is' : 'are'} participation;{' '}
              {afterTakes.length === 1 ? 'the other is' : `the other ${afterTakes.length} are`} an
              afterlife.
            </p>
          )}
        </section>

        {/* The two doors out: the essay that explains the project, and the
            leaderboard that holds everyone. */}
        <nav className="ratioed-piece-go" aria-label="Ratioed">
          <Link to={`/creating/${slug}`}>Learn more</Link>
          <Link to={`/creating/${slug}/participants`}>View leaderboard</Link>
        </nav>

        <ParticipantNav rows={roster.rows} person={person} parent={slug} />
      </article>
    </PageShell>
  );
}

/**
 * What somebody did to one piece in one window, as chips.
 *
 * `later` is how many records of theirs landed on the other side of the seal —
 * stated rather than drawn, because they are not what the row is about and
 * counting them in would contradict the window column beside it.
 */
function Mix({ acts, likeGone, later = 0 }) {
  const kinds = {};
  for (const a of acts) kinds[a.k] = (kinds[a.k] || 0) + 1;
  const shown = KINDS.filter((k) => kinds[k]);
  if (!shown.length && !likeGone) {
    return (
      <>
        <span className="ratioed-participant-quiet">·</span>
        {later > 0 && <span className="ratioed-participant-quiet"> +{later} after</span>}
      </>
    );
  }
  return (
    <>
      {shown.map((k) => (
        <span className={`ratioed-piece-kind ratioed-k-${k}`} key={k}>
          {KIND_LABEL[k]}
          {kinds[k] > 1 ? `×${kinds[k]}` : ''}{' '}
        </span>
      ))}
      {/* The act that is in none of the counts, because the record of it was
          deleted. Named by the reply that concluded the piece. */}
      {likeGone && (
        <span
          className="ratioed-piece-kind ratioed-k-like ratioed-gone"
          title="The like that ended the piece. Deleted afterwards, so it appears in no index; the reply concluding the piece is the only record that it happened."
        >
          like, deleted
        </span>
      )}
      {later > 0 && <span className="ratioed-participant-quiet"> +{later} after</span>}
    </>
  );
}

/**
 * When they first showed up to a take, in the terms of the window they were in.
 *
 * Two formatters, because the two windows are two scales. An alive offset is
 * bounded by how long the piece stood — minutes and seconds, and the seconds
 * matter on a project whose central finding is a reaction time. An afterlife
 * offset runs to years, so its unit has to float.
 */
function firstSeen(take) {
  const first = take.alive[0];
  if (first) return `+${fmtDuration(first.off * 1000)}`;
  const late = take.after[0];
  if (late) {
    const life = (take.piece?.lifespanMs || 0) / 1000;
    return `+${fmtElapsed(late.off - life)} after`;
  }
  // A take the roster names and no log accounts for — the harvest recorded that
  // they were there and not when. The breaker's case is the common one: the
  // like that ended the piece was deleted, so it is in no index to time.
  return take.broke ? 'at the like' : 'not timed';
}

/** The band under the title: who this is, in the three facts a reader wants
 *  before reading. The same shape every other document on the site wears. */
function whoColumns(person, handle, dossier) {
  const columns = [
    {
      key: 'pieces',
      label: 'Pieces',
      long: `${dossier.live} of ${dossier.takes.length} touched`,
      short: String(dossier.live),
    },
  ];
  if (dossier.debut) {
    const take = String(dossier.debut.take).padStart(2, '0');
    columns.push({ key: 'debut', label: 'Since', long: `take ${take}`, short: take });
  }
  if (person.did && !String(person.did).startsWith('handle:')) {
    columns.push({ key: 'did', label: 'Account', long: person.did, short: `@${handle}` });
  }
  return columns;
}

/**
 * The people either side of this one in the ranking the essay's table uses.
 *
 * Same ordering as that table's default — pieces, then handle — so arriving
 * here from a row and stepping sideways lands where a reader expects rather
 * than in whatever order the roster happens to be stored in.
 */
function ParticipantNav({ rows, person, parent }) {
  const sorted = [...(rows || [])].sort((a, b) => b.live - a.live || a.h.localeCompare(b.h));
  const i = sorted.findIndex((p) => p.did === person.did);
  const prev = i > 0 ? sorted[i - 1] : null;
  const next = i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
  return (
    <nav className="ratioed-piece-nav">
      {prev && participantPath(prev, parent) ? (
        <Link to={participantPath(prev, parent)}>← @{participantSlug(prev)}</Link>
      ) : (
        <span />
      )}
      {next && participantPath(next, parent) ? (
        <Link to={participantPath(next, parent)}>@{participantSlug(next)} →</Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
