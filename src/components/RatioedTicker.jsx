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
// A row is also a post, and until recently it was a post with its text cut off
// mid-sentence and no sign at all that the person had replied with a picture.
// A witness row carries a record key, a DID and up to 300 characters (see
// lib/ratioedLive.js); everything else about the post has to be asked for. So
// the rows are hydrated from the AppView as they arrive, which buys two things:
// a mark on the row saying what is attached, and the embed itself once somebody
// opens the row. Opening it is also where the controls go, which is how a phone
// gets them back — the row's own buttons are hidden below 34rem, and have been
// since they were costing a third of the width of a 358px row.
//
// The stylesheet is RatioedLive.css, and the class names are still
// `.ratioed-live-*` — this is that component's markup, moved rather than
// rewritten, and renaming a stylesheet's worth of classes to record the move
// would be a diff nobody could read against a page nobody could check.

import { useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, Link2, Play, Quote } from 'lucide-react';
import { fmtDuration } from '../lib/ratioed.js';
import { embedMarks } from '../lib/ratioedEmbed.js';
import { ME_DID } from '../config.js';
import RatioedChip from './RatioedChip.jsx';
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
 * @param {boolean} [props.openable]  offer the "open it elsewhere" button. Off
 *                                 in the replay, where only some rows carry a
 *                                 record key and a button on half of them
 *                                 reads as a fault rather than as an offer
 * @param {(row) => JSX} [props.actions]  the row's controls: at the end of it
 *                                 while it is closed, inside the panel once it
 *                                 is open. One place at a time, never both
 * @param {(row) => JSX} [props.below]    drawn under a row, full width
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

  // Memoised so the hydrator sees a new list only when the rows actually
  // change: it settles for 400ms on every one it is handed, and the replay
  // rebuilds this component's rows on every frame of its playhead.
  const uris = useMemo(() => rows.map(rowUri).filter(Boolean), [rows]);
  const posts = usePostViews(uris);

  if (!rows.length) return <p className="ratioed-live-empty">{empty}</p>;
  // Three elements for one list, and each does one thing. The frame scrolls and
  // fades whichever end still has rows behind it (see ScrollFrame.jsx); the
  // list is the list. The wrapper exists because a masked element's own border
  // fades out with everything else in it, and the feed wants a floor that does
  // not — a rule at the bottom, so a row cut in half is visibly a row passing
  // under an edge rather than a row that failed to draw.
  return (
    <div className="ratioed-live-feed">
      <ScrollFrame axis="y" className="ratioed-live-scroll" label={label}>
        <ul className="ratioed-live-ticker">
          {[...rows].reverse().map((r) => {
            const handle = profiles[r.did]?.handle || r.h || r.did?.slice(0, 18) || 'somebody';
            const avatar = profiles[r.did]?.avatar;
            const mine = r.did === ME_DID;
            const extra = actions?.(r);
            const uri = rowUri(r);
            const post = uri ? posts[uri] : null;
            const marks = post ? embedMarks(post.embed) : NO_MARKS;
            const standing = r.goneMs == null;
            // The reader's one button, where the surface offers it and nothing
            // else has claimed the slot.
            const offerOpen = openable && standing && Boolean(uri) && !extra;
            // Openable when there is something to press and something behind
            // it. Both halves matter: a row with no text and no mark has no
            // target that isn't the whole row, and a row whose panel would come
            // up empty is a disclosure that discloses nothing.
            const pressable = Boolean(r.t) || marks.length > 0;
            const behind = Boolean(post?.embed) || Boolean(extra) || offerOpen;
            const canOpen = standing && Boolean(uri) && pressable && behind;
            const isOpen = canOpen && open.has(r.rkey);
            // The controls live in one place at a time: at the end of the row
            // while it is closed, in the panel once it is open. Rendered once
            // either way, because two copies with one of them hidden is two
            // sets of labels for a screen reader to read out.
            const controls = extra || (
              offerOpen && (
                <button
                  type="button"
                  className="ratioed-live-open"
                  onClick={() => openWaypoints(uri)}
                  title={`Open @${handle}’s ${r.k} in another client`}
                  aria-label={`Open this ${r.k} in another client`}
                >
                  <ArrowUpRight size={13} aria-hidden="true" />
                  <span className="ratioed-live-open-say">Open in another client</span>
                </button>
              )
            );
            return (
              <li
                key={r.rkey}
                className={`ratioed-live-row ratioed-k-${r.k}${r.goneMs != null ? ' is-gone' : ''}${
                  mine ? ' is-self' : ''
                }${isOpen ? ' is-open' : ''}`}
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
                {/* What they said, whole — it used to be one line under an
                    ellipsis, which on a phone was four words of a reply. Where
                    the row opens, these words are also the control that opens
                    it: they are already there and already the width of the row,
                    so making them the target costs nothing, where a button of
                    its own would cost the width the handle needs. */}
                {canOpen ? (
                  <button
                    type="button"
                    className="ratioed-live-text is-toggle"
                    aria-expanded={isOpen}
                    onClick={() => toggle(r.rkey)}
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
                    {post?.embed && (
                      <PostEmbed embed={post.embed} did={post.did || r.did} nest={1} />
                    )}
                    {controls && <div className="ratioed-live-panel-acts">{controls}</div>}
                  </div>
                )}
                {!isOpen && controls && <span className="ratioed-live-acts">{controls}</span>}
                {below?.(r)}
              </li>
            );
          })}
        </ul>
      </ScrollFrame>
    </div>
  );
}
