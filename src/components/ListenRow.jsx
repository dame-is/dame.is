import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { formatTime } from '../lib/time.js';
import { useEditMode } from '../hooks/useEditMode.jsx';

/** The individually-addressable teal play records behind a row: a collapsed
 *  batch exposes them as `plays`; a lone row is its own single play. */
function playItemsOf({ payload, atUri, plays, createdAt }) {
  if (Array.isArray(plays) && plays.length) return plays;
  if (atUri) return [{ verb: 'listening', atUri, payload, createdAt: createdAt || payload?.playedTime }];
  return [];
}

/** A small check box shown beside a selectable play (or play group) in edit
 *  mode: filled when fully selected, a dash when only some of a group is. */
function SelectMark({ state }) {
  return (
    <span className={`listen-row-select-mark is-${state}`} aria-hidden="true">
      {state === 'all' && <Check size={11} strokeWidth={2.5} />}
      {state === 'some' && <span className="listen-row-select-dash" />}
    </span>
  );
}

/**
 * Single play row. The unified feed collapses runs of consecutive plays into
 * a single row with a `count` and a `plays` array of the underlying records —
 * see `collapseListens` in pages/Home.jsx. When `plays` is present and
 * `count > 1`, the row exposes an inline expand/collapse affordance.
 *
 * In owner edit mode the row becomes selectable: tapping the group selects
 * every teal play record behind it at once (and reveals the song list), or
 * you can expand and tap individual songs to select them one by one.
 */
export default function ListenRow(props) {
  const { payload, atUri, count, plays } = props;
  const edit = useEditMode();
  const [expanded, setExpanded] = useState(false);

  const recordHref = recordPathFromAtUri(atUri);
  const canExpand = (count || 0) > 1 && Array.isArray(plays) && plays.length > 1;

  const playItems = playItemsOf(props);
  const isBatch = canExpand;
  const selectable = edit.active && playItems.length > 0;
  // A batch auto-reveals its songs in edit mode so each is tappable; a manual
  // expand still works when not selecting.
  const showChildren = isBatch && (expanded || (selectable && isBatch));

  const selectedInGroup = selectable
    ? playItems.filter((p) => p.atUri && edit.isSelected(p.atUri)).length
    : 0;
  const groupState =
    selectedInGroup === 0 ? 'none' : selectedInGroup === playItems.length ? 'all' : 'some';

  function toggleGroup(e) {
    if (!selectable) return;
    e.preventDefault();
    e.stopPropagation();
    if (isBatch) {
      if (groupState === 'all') edit.deselectMany(playItems.map((p) => p.atUri).filter(Boolean));
      else edit.selectMany(playItems);
    } else {
      edit.toggleSelect(playItems[0]);
    }
  }

  function toggleOne(play, e) {
    if (!selectable) return;
    e.preventDefault();
    e.stopPropagation();
    edit.toggleSelect(play);
  }

  const articleClass = [
    'listen-row',
    'feed-card',
    selectable ? 'listen-row-selectable' : '',
    selectable && groupState === 'all' ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={articleClass} data-at-uri={atUri}>
      <div
        className="listen-row-head"
        onClickCapture={selectable ? toggleGroup : undefined}
        role={selectable ? 'button' : undefined}
        aria-pressed={selectable ? groupState !== 'none' : undefined}
      >
        {selectable && <SelectMark state={groupState} />}
        <span className="listen-row-text">
          <TrackLabel payload={payload} href={recordHref} plays={plays} />
        </span>
        {count > 1 && (
          canExpand && !selectable ? (
            <button
              type="button"
              className="listen-row-toggle gutter"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} all ${count} songs`}
            >
              {count} songs
              <span className="listen-row-toggle-caret" aria-hidden="true">
                {expanded ? '−' : '+'}
              </span>
            </button>
          ) : (
            <span className="listen-row-count gutter">{count} songs</span>
          )
        )}
      </div>

      {showChildren && (
        <ol className="listen-row-children">
          {plays.map((play) => {
            const childSelected = selectable && play.atUri && edit.isSelected(play.atUri);
            return (
              <li
                key={play.atUri || play.cid}
                className={`listen-row-child${childSelected ? ' is-selected' : ''}`}
                onClickCapture={selectable ? (e) => toggleOne(play, e) : undefined}
                role={selectable ? 'button' : undefined}
                aria-pressed={selectable ? !!childSelected : undefined}
              >
                {selectable && <SelectMark state={childSelected ? 'all' : 'none'} />}
                <ChildPlay item={play} />
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}

// When a row represents a batched listening session, surface the
// pool's variety in the top-line: latest track + a deduped list of
// artists from across the batch (latest first). Single-play rows
// keep the simple "track · artist" form.
const ARTIST_DISPLAY_MAX = 4;

function TrackLabel({ payload, href, plays }) {
  const track = payload?.trackName || payload?.track || '';
  const isBatch = Array.isArray(plays) && plays.length > 1;
  const artists = isBatch ? uniqueArtistNames(plays) : null;
  // When a batched session spans multiple unique artists, the song
  // title from the most recent play isn't very representative — drop
  // it and let the artist pool carry the line. Single-artist batches
  // (and unbatched rows) still lead with "<track> · <artist>".
  if (isBatch && artists.length > 1) {
    const shown = artists.slice(0, ARTIST_DISPLAY_MAX).join(', ');
    const extra = artists.length > ARTIST_DISPLAY_MAX
      ? ` + ${artists.length - ARTIST_DISPLAY_MAX} more`
      : '';
    const inner = <strong>{shown + extra}</strong>;
    return href ? <Link to={href}>{inner}</Link> : <span>{inner}</span>;
  }
  const artistLine = isBatch ? (artists[0] || '') : formatArtist(payload);
  const inner = (
    <>
      <strong>{track || <em>—</em>}</strong>
      {artistLine ? ` · ${artistLine}` : ''}
    </>
  );
  return href ? <Link to={href}>{inner}</Link> : <span>{inner}</span>;
}

function uniqueArtistNames(plays) {
  const seen = new Set();
  const out = [];
  for (const play of plays) {
    const arr = play?.payload?.artists;
    if (Array.isArray(arr)) {
      for (const a of arr) {
        const name = a?.artistName;
        if (name && !seen.has(name)) {
          seen.add(name);
          out.push(name);
        }
      }
    } else if (play?.payload?.artist) {
      const name = play.payload.artist;
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

function ChildPlay({ item }) {
  const href = recordPathFromAtUri(item?.atUri);
  const ts = item?.createdAt || item?.payload?.playedTime;
  return (
    <div className="listen-row-child-row">
      <span className="listen-row-child-text">
        <TrackLabel payload={item?.payload} href={href} />
      </span>
      {ts && <span className="gutter listen-row-child-time">{formatTime(ts)}</span>}
    </div>
  );
}

function formatArtist(payload) {
  if (!payload) return '';
  if (Array.isArray(payload.artists)) {
    return payload.artists.map((a) => a?.artistName).filter(Boolean).join(', ');
  }
  return payload.artist || '';
}
