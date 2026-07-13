import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import { useAlbumArt } from '../hooks/useAlbumArt.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import './ListeningStats.css';

/**
 * Rich stats header for the /listening page. Rolls the recently-played
 * feed into a dashboard: headline counts (plays, minutes, unique tracks /
 * artists / albums) plus ranked "top" lists over a selectable 7- or 30-day
 * window. Everything is derived on the client from the same play records
 * the feed below already loads — no extra fetch.
 */

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

const TOP_N = 5;

export default function ListeningStats({ items }) {
  const [days, setDays] = useState(7);
  const stats = useMemo(() => computeStats(items, days), [items, days]);

  // Nothing loaded yet — let the page's own skeleton carry the wait.
  if (!items || items.length === 0) return null;

  return (
    <section className="listen-stats" aria-label="Listening statistics">
      <div className="listen-stats-head">
        <h2 className="listen-stats-title">Recent listening</h2>
        <div className="listen-stats-toggle" role="tablist" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              role="tab"
              aria-selected={days === w.days}
              className={`listen-stats-tab ${days === w.days ? 'is-active' : ''}`}
              onClick={() => setDays(w.days)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {stats.totalPlays === 0 ? (
        <p className="listen-stats-empty">No plays in the last {days} days.</p>
      ) : (
        <>
          <div className="listen-stats-tiles">
            <Tile value={stats.totalPlays} label={stats.totalPlays === 1 ? 'play' : 'plays'} />
            <Tile value={stats.minutes} label="minutes" sub={stats.hoursSub} />
            <Tile value={stats.uniqueTracks} label={stats.uniqueTracks === 1 ? 'track' : 'tracks'} />
            <Tile value={stats.uniqueArtists} label={stats.uniqueArtists === 1 ? 'artist' : 'artists'} />
            <Tile value={stats.uniqueAlbums} label={stats.uniqueAlbums === 1 ? 'album' : 'albums'} />
          </div>

          <div className="listen-stats-cols">
            <RankList title="Top tracks" rows={stats.topTracks} kind="track" />
            <RankList title="Top artists" rows={stats.topArtists} kind="artist" />
            <RankList title="Top albums" rows={stats.topAlbums} kind="album" />
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

function Tile({ value, label, sub }) {
  const n = useCountUp(value);
  return (
    <div className="listen-stat-tile">
      <span className="listen-stat-value">{n.toLocaleString()}</span>
      <span className="listen-stat-label">{label}</span>
      {sub && <span className="listen-stat-sub">{sub}</span>}
    </div>
  );
}

/**
 * Short eased count-up whenever the target changes (e.g. toggling the
 * window). Mirrors ProfileStats' animation; respects reduced-motion by
 * snapping straight to the value.
 */
function useCountUp(target, ms = 650) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(typeof target === 'number' ? target : 0);
  const fromRef = useRef(0);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (typeof target !== 'number') return undefined;
    if (reduce) {
      setN(target);
      return undefined;
    }
    cancelAnimationFrame(rafRef.current);
    fromRef.current = n;
    startRef.current = performance.now();
    function tick(t) {
      const p = Math.min(1, (t - startRef.current) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(fromRef.current + (target - fromRef.current) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms, reduce]);

  return reduce && typeof target === 'number' ? target : n;
}

/* ------------------------------------------------------------------ */
/* Ranked lists                                                        */
/* ------------------------------------------------------------------ */

function RankList({ title, rows, kind }) {
  return (
    <div className="listen-rank">
      <h3 className="listen-rank-title">{title}</h3>
      {rows.length === 0 ? (
        <p className="listen-rank-empty">—</p>
      ) : (
        <ol className="listen-rank-list">
          {rows.map((row, i) => (
            <li key={row.key} className="listen-rank-row">
              <span className="listen-rank-num" aria-hidden="true">
                {i + 1}
              </span>
              {kind !== 'artist' && <Cover payload={row.sample} />}
              <span className="listen-rank-text">
                <RankLabel row={row} kind={kind} />
                {row.secondary && <span className="listen-rank-secondary">{row.secondary}</span>}
              </span>
              <span className="listen-rank-count" title={`${row.count} plays`}>
                {row.count}
                <span className="listen-rank-count-unit">×</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RankLabel({ row, kind }) {
  const inner = <span className="listen-rank-primary">{row.primary}</span>;
  if (kind === 'track' && row.href) {
    return <Link to={row.href}>{inner}</Link>;
  }
  if ((kind === 'artist' || kind === 'album') && row.query) {
    return <Link to={`/listening?q=${encodeURIComponent(row.query)}`}>{inner}</Link>;
  }
  return inner;
}

/** Small album-art thumbnail, resolved lazily from the sample play. */
function Cover({ payload }) {
  const state = useAlbumArt(payload, { size: 100 });
  const url = state.status === 'hit' ? state.art?.thumbUrl : null;
  if (url) {
    return <img className="listen-rank-cover" src={url} alt="" loading="lazy" decoding="async" />;
  }
  return <span className="listen-rank-cover listen-rank-cover-empty" aria-hidden="true" />;
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

function computeStats(items, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const tracks = new Map();
  const artists = new Map();
  const albums = new Map();
  let totalPlays = 0;
  let totalSeconds = 0;

  for (const it of items || []) {
    const p = it?.payload;
    if (!p) continue;
    const t = Date.parse(it.createdAt || p.playedTime || '');
    if (!Number.isFinite(t) || t < cutoff) continue;

    totalPlays += 1;
    const dur = Number(p.duration);
    if (Number.isFinite(dur) && dur > 0) totalSeconds += dur;

    // Everything is keyed by the *displayed* text identity, not the
    // MusicBrainz IDs: those come and go play-to-play (the same track can
    // carry a recordingMbId on one scrobble and none on the next), which
    // would split one song/artist/album into two identical-looking rows.
    // Grouping on what the reader sees also matches how listeners count
    // ("I played this song N times" regardless of which release it was).
    const artistLine = artistNames(p);

    // Track — title + primary artist.
    if (p.trackName || p.track) {
      const tKey = `${lower(p.trackName || p.track)}|${lower(firstArtistName(p))}`;
      bump(tracks, tKey, () => ({
        primary: p.trackName || p.track || '—',
        secondary: artistLine,
        sample: p,
        href: recordPathFromAtUri(it.atUri),
        query: p.trackName || p.track || '',
      }));
    }

    // Artists — credit every credited artist on the play.
    for (const a of artistList(p)) {
      if (!a?.artistName) continue;
      bump(artists, lower(a.artistName), () => ({ primary: a.artistName, query: a.artistName }));
    }

    // Album / release — title + primary artist (same-named albums by
    // different artists stay distinct).
    if (p.releaseName) {
      const alKey = `${lower(p.releaseName)}|${lower(firstArtistName(p))}`;
      bump(albums, alKey, () => ({
        primary: p.releaseName,
        secondary: firstArtistName(p),
        sample: p,
        query: p.releaseName,
      }));
    }
  }

  const minutes = Math.round(totalSeconds / 60);
  const hours = totalSeconds / 3600;

  return {
    totalPlays,
    minutes,
    hoursSub: hours >= 1 ? `≈ ${hours.toFixed(hours >= 10 ? 0 : 1)} hrs` : null,
    uniqueTracks: tracks.size,
    uniqueArtists: artists.size,
    uniqueAlbums: albums.size,
    topTracks: topN(tracks),
    topArtists: topN(artists),
    topAlbums: topN(albums),
  };
}

/** Increment a keyed counter, capturing display metadata on first sight. */
function bump(map, key, makeMeta) {
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
  } else {
    map.set(key, { key, count: 1, ...makeMeta() });
  }
}

/** Sort a counter map by play count (ties broken alphabetically) and cap. */
function topN(map, n = TOP_N) {
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || String(a.primary).localeCompare(String(b.primary)))
    .slice(0, n);
}

function artistList(payload) {
  if (Array.isArray(payload?.artists)) return payload.artists;
  if (payload?.artist) return [{ artistName: payload.artist }];
  return [];
}

function firstArtistName(payload) {
  const list = artistList(payload);
  return list[0]?.artistName || '';
}

function artistNames(payload) {
  return artistList(payload)
    .map((a) => a?.artistName)
    .filter(Boolean)
    .join(', ');
}

function lower(s) {
  return String(s || '').toLowerCase();
}
