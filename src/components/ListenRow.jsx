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
          <TrackLabel payload={payload} href={recordHref} />
        </span>
        {count > 1 && (
          canExpand ? (
            <button
              type="button"
              className="listen-row-toggle gutter"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} all ${count} plays`}
            >
              {count} plays
              <span className="listen-row-toggle-caret" aria-hidden="true">
                {expanded ? '−' : '+'}
              </span>
            </button>
          ) : (
            <span className="listen-row-count gutter">{count} plays</span>
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

function TrackLabel({ payload, href }) {
  const track = payload?.trackName || payload?.track || '';
  const artist = formatArtist(payload);
  const inner = (
    <>
      <strong>{track || <em>—</em>}</strong>
      {artist ? ` · ${artist}` : ''}
    </>
  );
  return href ? <Link to={href}>{inner}</Link> : <span>{inner}</span>;
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
