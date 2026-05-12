import { relativeTime } from '../lib/time.js';

/**
 * Single play row. The unified feed collapses runs of consecutive plays into
 * a single row with a count — see `collapseListens` in pages/Home.jsx.
 */
export default function ListenRow({ payload, createdAt, atUri, count }) {
  const track = payload?.trackName || payload?.track || '';
  const artist = Array.isArray(payload?.artists)
    ? payload.artists.map((a) => a?.artistName).filter(Boolean).join(', ')
    : (payload?.artist || '');
  const url = payload?.originUrl;
  const ts = createdAt || payload?.playedTime;
  return (
    <article className="listen-row feed-card" data-at-uri={atUri}>
      <span className="small-caps listen-row-prefix">listening</span>
      <span className="listen-row-text">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer noopener">
            <strong>{track}</strong>
            {artist ? ` · ${artist}` : ''}
          </a>
        ) : (
          <>
            <strong>{track}</strong>
            {artist ? ` · ${artist}` : ''}
          </>
        )}
        {count > 1 && <span className="listen-row-count gutter"> · {count} plays</span>}
      </span>
      {ts && <span className="gutter listen-row-time">{relativeTime(ts)}</span>}
    </article>
  );
}
