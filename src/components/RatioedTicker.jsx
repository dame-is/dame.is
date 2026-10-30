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
// The rows are a ledger, the same three columns the site's own feeds use: what
// the record did in the margin ("replied", "reposted", "liked"), who and what
// they said in the middle, and when at the right edge. They were a row of
// icons, faces and stamps that read as a dashboard and wrapped differently on
// every row at a phone width; a column of verbs reads in one pass down the
// left edge, which is what the chips were for, and says it in words.
//
// A row is also a post, and until recently it was a post with its text cut off
// mid-sentence and no sign at all that the person had replied with a picture.
// A witness row carries a record key, a DID and up to 300 characters (see
// lib/ratioedLive.js); everything else about the post has to be asked for. So
// the rows are hydrated from the AppView as they arrive, which buys two things:
// a mark on the row saying what is attached, and the embed itself once somebody
// opens the row. Opening it is the only place the controls are, at every width:
// they used to sit at the end of each row as a cluster of icons, hidden on a
// phone because three of them cost a third of a 358px row, and in the ledger
// they are words under what the person said ("reply · like · open elsewhere").
//
// The stylesheet is RatioedLive.css, and the class names are still
// `.ratioed-live-*` — this is that component's markup, moved rather than
// rewritten, and renaming a stylesheet's worth of classes to record the move
// would be a diff nobody could read against a page nobody could check.

import { useMemo, useState } from 'react';
import { ChevronDown, Link2, Play, Quote } from 'lucide-react';
import { fmtDuration } from '../lib/ratioed.js';
import { embedMarks } from '../lib/ratioedEmbed.js';
import { ME_DID } from '../config.js';
import { breakingWitness } from '../lib/ratioedLive.js';
import { rowVerb } from '../lib/ratioedLedger.js';
import RatioedHandle from './RatioedHandle.jsx';
import PostEmbed from './PostEmbed.jsx';
import ScrollFrame from './ScrollFrame.jsx';
import usePostViews from '../hooks/usePostViews.js';
import { useWaypointsModal } from '../hooks/useWaypointsModal.jsx';
import './RatioedLive.css';

// A witnessed row names a DID and a record key; this is the at:// URI they
// spell, so a reader can open the post itself in whatever client they use.
// Only the two kinds that are posts — a like and a repost are records nobody
// wants to look at.
const OPENABLE = { quote: 'app.bsky.feed.post', reply: 'app.bsky.feed.post' };
export const rowUri = (r) =>
  OPENABLE[r?.k] && r.did && r.rkey ? `at://${r.did}/${OPENABLE[r.k]}/${r.rkey}` : '';

// One array for every row that has no embed, so "no marks" is the same value
// between renders rather than a fresh one each time.
const NO_MARKS = [];

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
 * What a post is carrying, on the row that says somebody wrote it.
 *
 * Thumbnails carry the author's own alt text, so a screen reader gets what they
 * wrote rather than the word "image"; the marks with no picture to show carry
 * words instead. Between them every mark says something true out loud, which is
 * why none of this is hidden from assistive tech — a row that replied with a
 * photograph should say so however it is being read.
 */
function EmbedMarks({ marks }) {
  if (!marks.length) return null;
  return (
    <span className="ratioed-live-marks">
      {marks.map((m) => (
        <span key={m.kind} className={`ratioed-live-mark is-${m.kind}`} title={m.label}>
          {m.thumbs.map((t) => (
            <img key={t.src} src={t.src} alt={t.alt} loading="lazy" width="26" height="26" />
          ))}
          {m.kind === 'video' && <Play size={11} aria-hidden="true" />}
          {m.kind === 'link' && <Link2 size={11} aria-hidden="true" />}
          {m.kind === 'quote' && <Quote size={11} aria-hidden="true" />}
          {/* The count is on the thumbnails themselves; saying "2 images" beside
              two of them is the same fact twice. Everything else has no picture
              to show and is only its words. */}
          {m.kind !== 'images' && <span className="ratioed-live-mark-say">{m.label}</span>}
        </span>
      ))}
    </span>
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
 * @param {boolean} [props.openable]  offer "open elsewhere" in an opened row.
 *                                 Off in the replay, where only some rows carry
 *                                 a record key and a control on half of them
 *                                 reads as a fault rather than as an offer
 * @param {(row) => JSX} [props.actions]  the row's controls, drawn under what
 *                                 the person said once the row is open
 * @param {(row) => JSX} [props.below]    drawn under a row's body
 * @param {boolean} [props.bounded] scroll inside a window of its own. The page
 *                                 and the replay keep one so the list does not
 *                                 push everything after it a screen down; the
 *                                 studio lets the thread run in the pane, where
 *                                 the pinned seal bar follows it down.
 * @param {string} [props.label]   what the scroller is, for a reader who
 *                                 reaches it from the keyboard
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
  bounded = true,
  label = 'What has touched this piece',
}) {
  const { openWaypoints } = useWaypointsModal();
  // Which rows are open. A set rather than one at a time: closing somebody
  // else's row because you opened this one is a thing a feed should not do
  // while it is still arriving.
  const [open, setOpen] = useState(() => new Set());
  const toggle = (rkey) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(rkey)) next.add(rkey);
      return next;
    });

  // Memoised on what the list SAYS rather than on the array it arrived in, so
  // the hydrator sees a new list only when the rows actually change: it
  // settles for 400ms on every one it is handed, and a caller that rebuilds its
  // rows with the same contents — the replay, on an arrival — used to restart
  // that wait with each rebuild.
  const uriKey = rows.map(rowUri).filter(Boolean).join('\n');
  const uris = useMemo(() => (uriKey ? uriKey.split('\n') : []), [uriKey]);
  const posts = usePostViews(uris);
  // The like that ends the piece gets its row lit, the same row the sentence
  // above the list names. Not in the replay: a piece that ended a year ago is
  // read, not watched.
  const breaker = useMemo(() => (quiet ? null : breakingWitness(rows)), [quiet, rows]);

  if (!rows.length) return <p className="ratioed-live-empty">{empty}</p>;

  const list = (
    <ul className={`ratioed-live-ticker${quiet ? ' is-quiet' : ''}`}>
      {[...rows].reverse().map((r) => {
        const handle = profiles[r.did]?.handle || r.h || r.did?.slice(0, 18) || 'somebody';
        const avatar = profiles[r.did]?.avatar;
        const mine = r.did === ME_DID;
        const extra = actions?.(r);
        const uri = rowUri(r);
        const post = uri ? posts[uri] : null;
        const marks = post ? embedMarks(post.embed) : NO_MARKS;
        const standing = r.goneMs == null;
        // The reader's one control, where the surface offers it and nothing
        // else has claimed the slot.
        const offerOpen = openable && standing && Boolean(uri) && !extra;
        // Openable when there is something to press and something behind
        // it. Both halves matter: a row with no text and no mark has no
        // target that isn't the whole row, and a row whose panel would come
        // up empty is a disclosure that discloses nothing.
        const pressable = Boolean(r.t) || marks.length > 0;
        const behind = Boolean(post?.embed) || Boolean(extra) || offerOpen;
        const canOpen = standing && Boolean(uri) && pressable && behind;
        // A row's identity. The live feeds' rows are records and their key
        // is the record's; the replay's include measured rows nothing ever
        // gave a key, and it names those itself in `id` rather than
        // inventing an rkey a post could be asked for by.
        const id = r.id ?? r.rkey;
        const isOpen = canOpen && open.has(id);
        const controls =
          extra ||
          (offerOpen && (
            <button
              type="button"
              className="ratioed-live-act"
              onClick={() => openWaypoints(uri)}
              title={`Open @${handle}’s ${r.k} in another client`}
            >
              open elsewhere
            </button>
          ));
        return (
          <li
            key={id}
            className={`ratioed-live-row ratioed-k-${r.k}${standing ? '' : ' is-gone'}${
              mine ? ' is-self' : ''
            }${isOpen ? ' is-open' : ''}${r === breaker ? ' is-breaking' : ''}`}
          >
            <span className="ratioed-live-verb">{rowVerb(r, { selfDid: ME_DID })}</span>
            <div className="ratioed-live-body">
              {/* Titled, because a handle longer than its column is cut to fit
                  rather than broken across two lines. */}
              <span className="ratioed-live-who" title={`@${handle}`}>
                {avatar ? (
                  <img className="ratioed-live-face" src={avatar} alt="" loading="lazy" width="18" height="18" />
                ) : (
                  <span className="ratioed-live-face is-blank" aria-hidden="true" />
                )}
                <span className="ratioed-live-handle">
                  {parent ? <RatioedHandle handle={handle} parent={parent} /> : `@${handle}`}
                </span>
              </span>
              {/* A row from the afterlife. It reads as "+45m12s" beside a piece
                  that stood 41m45s, which is decodable and not obvious; this is
                  the line that makes it obvious. */}
              {r.after && <span className="ratioed-live-after">after the seal</span>}
              {!standing && (
                <span className="ratioed-live-undone">took it back at +{fmtDuration(r.goneMs)}</span>
              )}
              {/* What they said, whole. Where the row opens, these words are
                  also the control that opens it: they are already there and
                  already the width of the column, so making them the target
                  costs nothing. */}
              {canOpen ? (
                <button
                  type="button"
                  className="ratioed-live-text is-toggle"
                  aria-expanded={isOpen}
                  onClick={() => toggle(id)}
                >
                  {r.t}
                  <ChevronDown size={12} className="ratioed-live-caret" aria-hidden="true" />
                  <EmbedMarks marks={marks} />
                </button>
              ) : (
                r.t && <span className="ratioed-live-text">{r.t}</span>
              )}
              {isOpen && (
                <div className="ratioed-live-panel">
                  {post?.embed && <PostEmbed embed={post.embed} did={post.did || r.did} nest={1} />}
                  {controls && <div className="ratioed-live-panel-acts">{controls}</div>}
                </div>
              )}
              {below?.(r)}
            </div>
            <span className="ratioed-live-when">+{fmtDuration(r.offMs)}</span>
          </li>
        );
      })}
    </ul>
  );

  if (!bounded) return <div className="ratioed-live-feed is-open-ended">{list}</div>;
  // Three elements for one list, and each does one thing. The frame scrolls and
  // fades whichever end still has rows behind it (see ScrollFrame.jsx); the
  // list is the list. The wrapper exists because a masked element's own border
  // fades out with everything else in it, and the feed wants a floor that does
  // not — a rule at the bottom, so a row cut in half is visibly a row passing
  // under an edge rather than a row that failed to draw.
  return (
    <div className="ratioed-live-feed">
      <ScrollFrame axis="y" className="ratioed-live-scroll" label={label}>
        {list}
      </ScrollFrame>
    </div>
  );
}
