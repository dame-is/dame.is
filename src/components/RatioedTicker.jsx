// The live feed of a Ratioed piece, and the counters over it.
//
// One list, two places. The piece's own page shows it to whoever is watching;
// the studio shows it to the artist, with three buttons per row — open it, like
// it, answer it — and a composer under the row being answered. Those are the
// only differences, and they are the reason this took two implementations to
// begin with: the studio's grew its own row markup for the buttons, and by the
// time both had been through a mobile pass they disagreed about avatars,
// spacing, chip placement, what a withdrawn row looks like and whether the
// counters existed at all.
//
// So the rows live here and the differences arrive as render props. `actions`
// draws whatever belongs at the end of a row; `below` draws whatever belongs
// under it. The public deck passes neither and gets exactly the feed it had.
//
// The stylesheet is RatioedLive.css, and the class names are still
// `.ratioed-live-*` — this is that component's markup, moved rather than
// rewritten, and renaming a stylesheet's worth of classes to record the move
// would be a diff nobody could read against a page nobody could check.

import { ArrowUpRight } from 'lucide-react';
import { fmtDuration } from '../lib/ratioed.js';
import { ME_DID } from '../config.js';
import RatioedChip from './RatioedChip.jsx';
import RatioedHandle from './RatioedHandle.jsx';
import { useWaypointsModal } from '../hooks/useWaypointsModal.jsx';
import './RatioedLive.css';

// A witnessed row names a DID and a record key; this is the at:// URI they
// spell, so a reader can open the post itself in whatever client they use.
// Only the two kinds that are posts — a like and a repost are records nobody
// wants to look at.
const OPENABLE = { quote: 'app.bsky.feed.post', reply: 'app.bsky.feed.post' };
export const rowUri = (r) =>
  OPENABLE[r?.k] && r.did && r.rkey ? `at://${r.did}/${OPENABLE[r.k]}/${r.rkey}` : '';

/** The counts, with the like given the weight the project gives it. */
export function RatioedCounters({ tally }) {
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

/**
 * Newest first, the way a feed is read.
 *
 * @param {object} props
 * @param {Array}  props.rows      witnessed rows, earliest first
 * @param {object} props.profiles  did → { handle, avatar }
 * @param {boolean} [props.quiet]  mute a replayed alarm: a like that ended a
 *                                 piece a year ago should not throb about it
 * @param {string} [props.empty]   what to say when nothing has happened
 * @param {string} [props.parent]  the Ratioed essay's own segment. Set on a
 *                                 finished piece, where every account in the
 *                                 list has a page; absent in the studio, where
 *                                 the piece is still running and nobody is in
 *                                 the roster yet.
 * @param {boolean} [props.openable]  draw the "open it elsewhere" button. Off
 *                                 in the replay, where only some rows carry a
 *                                 record key and a button on half of them
 *                                 reads as a fault rather than as an offer
 * @param {(row) => JSX} [props.actions]  drawn at the end of a row
 * @param {(row) => JSX} [props.below]    drawn under a row, full width
 */
export default function RatioedTicker({
  rows,
  profiles = {},
  quiet = false,
  empty = 'Nothing has touched it yet. That is the piece working.',
  openable = true,
  actions = null,
  below = null,
  parent = null,
}) {
  const { openWaypoints } = useWaypointsModal();
  if (!rows.length) return <p className="ratioed-live-empty">{empty}</p>;
  return (
    <ul className="ratioed-live-ticker">
      {[...rows].reverse().map((r) => {
        const handle = profiles[r.did]?.handle || r.h || r.did?.slice(0, 18) || 'somebody';
        const avatar = profiles[r.did]?.avatar;
        const mine = r.did === ME_DID;
        const extra = actions?.(r);
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
              {parent ? <RatioedHandle handle={handle} parent={parent} /> : `@${handle}`}
              {mine && <span className="ratioed-live-self"> the artist</span>}
            </span>
            <RatioedChip kind={r.k} muted={quiet || r.goneMs != null} />
            {/* A row from the afterlife. It reads as "+45m12s" beside a piece
                that stood 41m45s, which is decodable and not obvious; this is
                the sentence that makes it obvious. */}
            {r.after && <span className="ratioed-live-after">after the seal</span>}
            {r.goneMs != null && (
              <span className="ratioed-live-undone">deleted it at +{fmtDuration(r.goneMs)}</span>
            )}
            {r.t && <span className="ratioed-live-text">{r.t}</span>}
            {/* The studio's buttons, or the reader's one button. Both sit in
                the same slot at the end of the row, so the two feeds keep a
                single right edge. */}
            {extra ? (
              <span className="ratioed-live-acts">{extra}</span>
            ) : (
              openable &&
              r.goneMs == null &&
              rowUri(r) && (
                <button
                  type="button"
                  className="ratioed-live-open"
                  onClick={() => openWaypoints(rowUri(r))}
                  title={`Open @${handle}’s ${r.k} in another client`}
                  aria-label={`Open this ${r.k} in another client`}
                >
                  <ArrowUpRight size={13} aria-hidden="true" />
                </button>
              )
            )}
            {below?.(r)}
          </li>
        );
      })}
    </ul>
  );
}
