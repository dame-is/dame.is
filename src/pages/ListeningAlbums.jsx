import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import AlbumCover from '../components/AlbumCover.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { CreatingGridSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import {
  albumPath,
  albumsFromSnapshot,
  buildAlbums,
  compareAlbums,
  compareAlbumsRecent,
  formatListenTime,
} from '../lib/albums.js';
import { getLatestCommit, resolvePds } from '../lib/atproto.js';
import { listTealPlays } from '../lib/teal.js';
import { relativeDayShort } from '../lib/time.js';
import { ME_DID } from '../config.js';
import './Albums.css';

/**
 * Every album in the play history, as a shelf.
 *
 * An album is not a record: teal.fm scrobbles tracks, so what's on this page is
 * what a few thousand plays add up to (`buildAlbums`). It is derived twice from
 * the same function — once at build time into `/data/albums.json`, which paints
 * this page instantly and is what the edge answers crawlers with, and again in
 * the browser from the live play history, which is what you actually see a beat
 * later. So a record played for the first time this morning is here before the
 * next deploy, and the shelf a share card shows is the shelf the page shows.
 */

// Same depth the build pulls (ALBUM_PLAY_MAX in scripts/prefetch.mjs) and the
// same the /listening feed asks for, per lexicon.
const PLAY_MAX = 1000;

const ORDERS = [
  { key: 'played', label: 'most played', sort: compareAlbums },
  { key: 'recent', label: 'recent', sort: compareAlbumsRecent },
];

export default function ListeningAlbums() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const [order, setOrder] = useState('played');

  const { items, status } = useLiveFeed({
    name: 'albums',
    strategy: 'snapshot-first',
    // The same live arrangement /listening uses: ride the shared 30s tick, and
    // let a cheap repo-head probe skip the (ten-page) listRecords fan-out
    // whenever nothing has been scrobbled since the last one.
    live: true,
    getRev: async () => {
      const pds = await resolvePds(ME_DID);
      return (await getLatestCommit(pds, ME_DID))?.rev || null;
    },
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return listTealPlays(pds, { repo: ME_DID, max: PLAY_MAX });
    },
    mapItems: toAlbums,
    arrivalKey: (album) => album?.key,
  });

  const albums = useMemo(() => items || [], [items]);
  const filtered = useMemo(
    () =>
      albums.filter((a) =>
        matchesQuery([a.title, a.artist, (a.artists || []).join(' ')].join(' '), q),
      ),
    [albums, q],
  );
  const sort = ORDERS.find((o) => o.key === order)?.sort || compareAlbums;
  const shelf = useMemo(() => [...filtered].sort(sort), [filtered, sort]);
  const totals = useMemo(() => summarize(albums), [albums]);

  const backToListening = (
    <p className="album-crumb">
      <Link to="/listening">&larr; Listening</Link>
    </p>
  );

  return (
    <PageShell
      above={backToListening}
      title="Albums"
      intro="Every record that has come round here, ranked by how often. teal.fm scrobbles songs, not albums — these are what the plays add up to."
      headTitle="dame.is listening — albums"
    >
      {status === 'loading' ? (
        <CreatingGridSkeleton cells={9} />
      ) : status === 'error' ? (
        <p className="feed-empty">Couldn&rsquo;t load the play history right now.</p>
      ) : albums.length === 0 ? (
        <p className="feed-empty">No albums yet.</p>
      ) : (
        <>
          <section className="album-stats" aria-label="Album totals">
            <Stat value={totals.albums.toLocaleString()} label="albums" />
            <Stat value={totals.artists.toLocaleString()} label="artists" />
            <Stat value={totals.plays.toLocaleString()} label="plays" />
            {totals.listened && <Stat value={totals.listened} label="listening" />}
          </section>

          <div className="album-toolbar">
            <div className="album-order" role="tablist" aria-label="Order">
              {ORDERS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  role="tab"
                  aria-selected={order === o.key}
                  className={`album-order-tab ${order === o.key ? 'is-active' : ''}`}
                  onClick={() => setOrder(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {q && (
              <p className="album-filter-note gutter">
                {shelf.length} matching &ldquo;{q}&rdquo;
              </p>
            )}
          </div>

          {shelf.length === 0 ? (
            <p className="feed-empty">No albums match that search.</p>
          ) : (
            <ol className="album-grid reveal-stagger">
              {shelf.map((album, i) => (
                <li key={album.key} className="album-cell">
                  <Link className="album-link" to={albumPath(album)}>
                    <AlbumCover
                      payload={album.sample}
                      alt={`Cover of ${album.title}`}
                      size={300}
                      className="album-cell-cover"
                    />
                    <span className="album-cell-body">
                      <span className="album-cell-rank" aria-hidden="true">
                        {order === 'played' ? i + 1 : ''}
                      </span>
                      <span className="album-cell-text">
                        <span className="album-cell-title">{album.title}</span>
                        {album.artist && (
                          <span className="album-cell-artist">{album.artist}</span>
                        )}
                      </span>
                      <span className="album-cell-count" title={`${album.plays} plays`}>
                        {album.plays}
                        <span className="album-cell-count-unit">&times;</span>
                      </span>
                    </span>
                  </Link>
                  {album.lastPlayed && (
                    <p className="album-cell-when gutter">{relativeDayShort(album.lastPlayed)}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </PageShell>
  );
}

function Stat({ value, label }) {
  return (
    <div className="album-stat">
      <span className="album-stat-value">{value}</span>
      <span className="album-stat-label small-caps">{label}</span>
    </div>
  );
}

/**
 * Albums out of either source useLiveFeed hands this page: the build snapshot
 * (already an index) or a live pull (raw play records). Returning null for an
 * empty snapshot holds the skeleton rather than flashing "no albums" at a
 * reader whose live pull is a beat away.
 */
function toAlbums(data) {
  if (Array.isArray(data)) return buildAlbums(data);
  const albums = albumsFromSnapshot(data);
  return albums.length ? albums : null;
}

function summarize(albums) {
  const artists = new Set();
  let plays = 0;
  let seconds = 0;
  for (const album of albums) {
    plays += album.plays || 0;
    seconds += album.seconds || 0;
    for (const name of album.artists || []) artists.add(name.toLowerCase());
  }
  return { albums: albums.length, artists: artists.size, plays, listened: formatListenTime(seconds) };
}
