// Everyone who touched one piece, as faces.
//
// The essay's participants table counts the roster across the whole project,
// which is the right shape for a finding and the wrong one for a single piece:
// nine people is a list, not a distribution. Faces, in the order they arrived,
// with the breaker ringed.
//
// Two kinds of absence get drawn rather than dropped, because both are part of
// what the project found. An account that has since deactivated resolves to no
// profile at all and shows as an empty frame — it was there, and there is no
// longer anyone to show. And a breaker whose like was deleted appears in no
// index at all: the only evidence they were here is the reply that concluded
// the piece, so their frame is drawn from that reply and marked as such.

import { useMemo } from 'react';
import { fmtDuration, fmtElapsed } from '../lib/ratioed.js';
import './RatioedFaces.css';

const KIND_VERB = { like: 'liked', repost: 'reposted', quote: 'quoted', reply: 'replied' };

/**
 * One row per account, not per record: somebody who replied four times is one
 * face. Their arrival is the first thing they did, and their label is the most
 * consequential — the same ordering the essay's roster uses, for the same
 * reason (ending a piece outranks carrying it, which outranks talking in it).
 */
function foldByAccount(events) {
  const byKey = new Map();
  for (const e of events || []) {
    if (e.self) continue;
    const key = e.did || `handle:${e.h}`;
    const found = byKey.get(key);
    if (found) {
      found.kinds[e.k] = (found.kinds[e.k] || 0) + 1;
      found.count += 1;
      if (e.off < found.off) found.off = e.off;
      if (e.pre) found.pre = true;
    } else {
      byKey.set(key, {
        key,
        did: e.did || null,
        handle: e.h,
        off: e.off,
        pre: Boolean(e.pre),
        count: 1,
        kinds: { [e.k]: 1 },
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.off - b.off);
}

/** The one word a face wears: the most consequential thing they did here. */
function labelFor(person) {
  if (person.broke) return 'broke it';
  if (person.kinds.like) return KIND_VERB.like;
  if (person.kinds.quote) return KIND_VERB.quote;
  if (person.kinds.repost) return KIND_VERB.repost;
  if (person.kinds.reply) return KIND_VERB.reply;
  return 'was there';
}

export default function RatioedFaces({ piece, events, profiles = {} }) {
  const lifeSec = (piece?.lifespanMs || 0) / 1000;

  const people = useMemo(() => {
    const breaker = piece?.breaker || {};
    const folded = foldByAccount(events);
    // Mark the breaker wherever they turn up. Matched on either identifier:
    // the log is keyed by DID, the announcement recorded a handle, and handles
    // get renamed between the two.
    const names = new Set([breaker.did, breaker.handle, breaker.currentHandle].filter(Boolean));
    for (const p of folded) {
      if (names.has(p.did) || names.has(p.handle)) p.broke = true;
    }
    // A breaker whose like was deleted left nothing to fold, so they aren't in
    // the log at all. Add them from the announcement — the only record of it.
    if (breaker.handle && breaker.handle !== 'unknown' && !folded.some((p) => p.broke)) {
      folded.push({
        key: breaker.did || `handle:${breaker.handle}`,
        did: breaker.did || null,
        handle: breaker.currentHandle || breaker.handle,
        off: lifeSec,
        pre: true,
        count: 0,
        kinds: {},
        broke: true,
        named: true,
      });
    }
    return folded;
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
        />
      )}
      {after.length > 0 && (
        <Group
          title={`${after.length} since the seal`}
          people={after}
          profiles={profiles}
          lifeSec={lifeSec}
          muted
        />
      )}
    </div>
  );
}

function Group({ title, people, profiles, lifeSec, muted }) {
  return (
    <div className={`ratioed-faces-group${muted ? ' muted' : ''}`}>
      <h3 className="small-caps">{title}</h3>
      <ul className="ratioed-faces-grid">
        {people.map((p) => (
          <Face key={p.key} person={p} profile={profiles[p.did]} lifeSec={lifeSec} />
        ))}
      </ul>
    </div>
  );
}

function Face({ person, profile, lifeSec }) {
  const handle = profile?.handle || person.handle;
  // The harvest's own label for an account that no longer answers. Kept rather
  // than prettified — it says exactly what is and isn't known.
  const gone = !profile && (!handle || handle === '(unresolvable)');
  const name = profile?.displayName || (gone ? 'deactivated' : handle);
  const when = person.named
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

  return (
    <li className={`ratioed-face${person.broke ? ' broke' : ''}`} title={`@${handle} · ${when}`}>
      {gone || !handle ? (
        <span className="ratioed-face-link">{body}</span>
      ) : (
        <a
          className="ratioed-face-link"
          href={`https://bsky.app/profile/${handle}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          {body}
        </a>
      )}
      {person.named && <span className="ratioed-face-note">like deleted</span>}
    </li>
  );
}
