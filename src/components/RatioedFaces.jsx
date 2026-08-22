// Everyone who touched one piece, as faces.
//
// The essay's participants table counts the roster across the whole project,
// which is the right shape for a finding and the wrong one for a single piece:
// nine people is a list, not a distribution. Faces in the order the piece met
// them, with the breaker ringed and last.
//
// Two kinds of absence get drawn rather than dropped, because both are part of
// what the project found. An account that has since deactivated resolves to no
// profile at all and shows as an empty frame — it was there, and there is no
// longer anyone to show. And a breaker whose like was deleted appears in no
// index at all: the only evidence they were here is the reply that concluded
// the piece, so their frame is drawn from that reply and marked as such.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fmtDuration, fmtElapsed, foldFaces } from '../lib/ratioed.js';
import { participantHref } from '../lib/ratioedParticipant.js';
import './RatioedFaces.css';

const KIND_VERB = { like: 'liked', repost: 'reposted', quote: 'quoted', reply: 'replied' };

/** The one word a face wears: the act `foldFaces` picked it out for, which is
 *  also the act the time beside it belongs to. */
function labelFor(person) {
  if (person.broke) return 'broke it';
  return KIND_VERB[person.kind] || 'was there';
}

export default function RatioedFaces({ piece, events, profiles = {}, parent }) {
  const lifeSec = (piece?.lifespanMs || 0) / 1000;

  const people = useMemo(() => {
    const breaker = piece?.breaker || {};
    const folded = foldFaces(events);
    // Mark the breaker wherever they turn up. Matched on either identifier:
    // the log is keyed by DID, the announcement recorded a handle, and handles
    // get renamed between the two.
    const names = new Set([breaker.did, breaker.handle, breaker.currentHandle].filter(Boolean));
    let broke = null;
    for (const p of folded) {
      if (names.has(p.did) || names.has(p.handle)) {
        p.broke = true;
        broke ||= p;
      }
    }
    // When the reaction time is known, so is the moment of the like: the seal,
    // less the seconds it took the artist to answer it.
    const timed = typeof breaker.reactionMs === 'number';
    const likeAt = timed ? Math.max(0, lifeSec - breaker.reactionMs / 1000) : lifeSec;

    if (broke && broke.kind !== 'like') {
      // In the log, but not for the like — that one was deleted, and no index
      // holds a deleted record. The face is still the breaker's, so it belongs
      // at the like rather than at whatever they did on the way to it.
      broke.off = likeAt;
      broke.timed = timed;
      broke.named = breaker.likeSurvives === false;
    } else if (!broke && breaker.handle && breaker.handle !== 'unknown') {
      // Not in the log at all — the deleted like was everything they left.
      // Added from whatever named them: the reply that concluded the piece, the
      // log the studio kept, or the artist by hand.
      folded.push({
        key: breaker.did || `handle:${breaker.handle}`,
        did: breaker.did || null,
        handle: breaker.currentHandle || breaker.handle,
        off: likeAt,
        pre: true,
        count: 0,
        kind: null,
        kinds: {},
        broke: true,
        named: true,
        timed,
      });
    }
    return folded.sort((a, b) => a.off - b.off);
  }, [events, piece, lifeSec]);

  if (!people.length) {
    return <p className="ratioed-faces-empty">Nobody touched this piece before it was measured.</p>;
  }

  const live = people.filter((p) => p.pre);
  const after = people.filter((p) => !p.pre);

  return (
    <div className="ratioed-faces">
      {live.length > 0 && (
        <Group
          title={`${live.length} while it was alive`}
          people={live}
          profiles={profiles}
          lifeSec={lifeSec}
          parent={parent}
        />
      )}
      {after.length > 0 && (
        <Group
          title={`${after.length} since the seal`}
          people={after}
          profiles={profiles}
          lifeSec={lifeSec}
          parent={parent}
          muted
        />
      )}
    </div>
  );
}

function Group({ title, people, profiles, lifeSec, muted, parent }) {
  return (
    <div className={`ratioed-faces-group${muted ? ' muted' : ''}`}>
      <h3 className="small-caps">{title}</h3>
      <ul className="ratioed-faces-grid">
        {people.map((p) => (
          <Face
            key={p.key}
            person={p}
            /* By DID, or by handle for the one person who may have neither a
               row in the log nor a DID on the record: a breaker whose like was
               deleted and who was named rather than measured. */
            profile={profiles[p.did] || profiles[p.handle]}
            lifeSec={lifeSec}
            parent={parent}
          />
        ))}
      </ul>
    </div>
  );
}

function Face({ person, profile, lifeSec, parent }) {
  const handle = profile?.handle || person.handle;
  // The harvest's own label for an account that no longer answers. Kept rather
  // than prettified — it says exactly what is and isn't known.
  const gone = !profile && (!handle || handle === '(unresolvable)');
  const name = profile?.displayName || (gone ? 'deactivated' : handle);
  const when =
    person.named && !person.timed
      ? 'named in the concluding reply'
      : person.pre
        ? `at +${fmtDuration(person.off * 1000)}`
        : `+${fmtElapsed(person.off - lifeSec)} after the seal`;

  const body = (
    <>
      <span className="ratioed-face-frame" data-gone={gone || undefined}>
        {profile?.avatar ? (
          <img src={profile.avatar} alt="" loading="lazy" width="48" height="48" />
        ) : (
          <span className="ratioed-face-blank" aria-hidden="true">
            {gone ? '·' : (handle || '?').slice(0, 1)}
          </span>
        )}
      </span>
      <span className="ratioed-face-name">{name}</span>
      <span className="ratioed-face-role">{labelFor(person)}</span>
      <span className="ratioed-face-when">{when}</span>
    </>
  );

  // Their own page rather than their Bluesky profile. Both are one click from
  // a face, and only one of them answers the question a roster raises — what
  // else were they in — which is a question about this project and not about
  // the account. The page itself links out to Bluesky.
  const href = participantHref(handle, parent);
  return (
    <li className={`ratioed-face${person.broke ? ' broke' : ''}`} title={`@${handle} · ${when}`}>
      {gone || !href ? (
        <span className="ratioed-face-link">{body}</span>
      ) : (
        <Link className="ratioed-face-link" to={href}>
          {body}
        </Link>
      )}
      {person.named && <span className="ratioed-face-note">like deleted</span>}
    </li>
  );
}
