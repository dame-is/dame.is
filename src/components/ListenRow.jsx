import { useState } from 'react';
import { Link } from 'react-router-dom';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { formatTime } from '../lib/time.js';

/**
 * Single play row. The unified feed collapses runs of consecutive plays into
 * a single row with a `count` and a `plays` array of the underlying records —
 * see `collapseListens` in pages/Home.jsx. When `plays` is present and
 * `count > 1`, the row exposes an inline expand/collapse affordance.
 */
export default function ListenRow({ payload, atUri, count, plays }) {
  const [expanded, setExpanded] = useState(false);

  const recordHref = recordPathFromAtUri(atUri);
  const canExpand = (count || 0) > 1 && Array.isArray(plays) && plays.length > 1;

  return (
    <article className="listen-row feed-card" data-at-uri={atUri}>
      <div className="listen-row-head">
        <span className="listen-row-text">
          <TrackLabel payload={payload} href={recordHref} plays={plays} />
        </span>
        {count > 1 && (
          canExpand ? (
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

      {expanded && canExpand && (
        <ol className="listen-row-children">
          {plays.map((play) => (
            <li key={play.atUri || play.cid} className="listen-row-child">
              <ChildPlay item={play} />
            </li>
          ))}
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
