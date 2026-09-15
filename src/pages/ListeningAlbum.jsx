import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import AlbumCover from '../components/AlbumCover.jsx';
import MusicServiceLinks from '../components/MusicServiceLinks.jsx';
import { CreatingWorkSkeleton } from '../components/Skeleton.jsx';
import { useAlbumArt } from '../hooks/useAlbumArt.js';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import {
  albumsFromSnapshot,
  buildAlbums,
  findAlbum,
  formatListenTime,
} from '../lib/albums.js';
import { resolvePds } from '../lib/atproto.js';
import { albumLinksFor } from '../lib/musicLinks.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { listTealPlays } from '../lib/teal.js';
import { formatDateLong, relativeDayShort } from '../lib/time.js';
import { ME_DID } from '../config.js';
import './Albums.css';

/**
 * One album — its cover, its arithmetic, and the tracks off it that have
 * actually been played.
 *
 * Like a mothing night, an album is a grouping rather than a record, so this
 * page has no at:// URI of its own to advertise: the records are the plays, and
 * each track below links to whichever one of them came round most recently.
 * That is also why a track missing from the list isn't a gap in the data — it
 * means that song has never been played here.
 */

const PLAY_MAX = 1000;

export default function ListeningAlbum() {
  const { slug } = useParams();

  const { items, status } = useLiveFeed({
    name: 'albums',
    strategy: 'snapshot-first',
    deps: [slug],
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return listTealPlays(pds, { repo: ME_DID, max: PLAY_MAX });
    },
    // A snapshot miss returns null, which holds the skeleton: the album may
    // simply be newer than the last build, and flashing "no album here" before
    // the live pull answers would be a lie for the length of a fetch. The live
    // pull IS the answer, so it reports a miss as `{ album: null }`.
    mapItems: (data) => {
      if (Array.isArray(data)) return { album: findAlbum(buildAlbums(data), slug) };
      const found = findAlbum(albumsFromSnapshot(data), slug);
      return found ? { album: found } : null;
    },
  });

  const album = items?.album || null;
  const tracks = useMemo(() => album?.trackList || [], [album]);

  // Resolved here rather than left to <AlbumCover> below, because the answer is
  // two things: the artwork, and Apple's id for the release — which is what
  // turns "search Apple Music for this" into a link straight to the record.
  // Both hooks ask `albumArtFor` for the same key, which de-duplicates the
  // request and caches it, so this costs one lookup between them.
  const art = useAlbumArt(album?.sample, { size: 600 });
  const links = useMemo(
    () => (album ? albumLinksFor(album, { albumId: art.art?.albumId }) : []),
    [album, art.art],
  );

  const backToAlbums = (
    <p className="album-crumb">
      <Link to="/listening/albums">&larr; Albums</Link>
    </p>
  );

  if (status === 'loading') {
    return (
      <PageShell above={backToAlbums} headTitle="Album — dame.is">
        <CreatingWorkSkeleton />
      </PageShell>
    );
  }

  if (!album) {
    const unreachable = status === 'error';
    return (
      <PageShell
        above={backToAlbums}
        title={unreachable ? 'Album unavailable' : 'No album here'}
        headTitle="Not found — dame.is"
      >
        <p>
          {unreachable ? (
            <>Couldn&rsquo;t load the play history right now. </>
          ) : (
            <>
              Nothing in the play history answers to <strong>{slug}</strong>. An album only has a
              page here once something off it has been played.{' '}
            </>
          )}
          <Link to="/listening/albums">Back to every album.</Link>
        </p>
      </PageShell>
    );
  }

  const listened = formatListenTime(album.seconds);

  return (
    <PageShell
      above={backToAlbums}
      title={album.title}
      headTitle={`${album.title} — dame.is`}
    >
      {album.artist && <p className="album-byline">{album.artist}</p>}

      <div className="album-detail">
        <AlbumCover
          payload={album.sample}
          alt={`Cover of ${album.title}`}
          size={600}
          className="album-detail-cover"
        />

        <div className="album-detail-side">
          <dl className="album-facts">
            <Fact label="plays" value={album.plays.toLocaleString()} />
            <Fact label="tracks played" value={album.tracks.toLocaleString()} />
            {listened && <Fact label="listening" value={listened} />}
            {album.firstPlayed && <Fact label="first" value={formatDateLong(album.firstPlayed)} />}
            {album.lastPlayed && <Fact label="last" value={relativeDayShort(album.lastPlayed)} />}
          </dl>

          {/* Where to actually put it on. The Apple link is the record itself
              once its id has resolved; until then — and for Spotify, which has
              no unauthenticated way to be asked — it's an honest search. */}
          <MusicServiceLinks links={links} label={`Play ${album.title} elsewhere`} />
        </div>
      </div>

      {tracks.length > 0 && (
        <section className="album-tracks" aria-label="Tracks played">
          <h2 className="album-tracks-title small-caps">Tracks played</h2>
          <ol className="album-track-list">
            {tracks.map((track) => {
              const href = recordPathFromAtUri(track.lastUri);
              const name = <span className="album-track-name">{track.name}</span>;
              return (
                <li key={track.name} className="album-track">
                  {href ? <Link to={href}>{name}</Link> : name}
                  <span className="album-track-count" title={`${track.plays} plays`}>
                    {track.plays}
                    <span className="album-track-count-unit">&times;</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <p className="album-source gutter">
        Every play of this record, in the feed:{' '}
        <Link to={`/listening?q=${encodeURIComponent(album.title)}`}>
          search /listening for &ldquo;{album.title}&rdquo;
        </Link>
        .
      </p>
    </PageShell>
  );
}

function Fact({ label, value }) {
  return (
    <div className="album-fact">
      <dt className="album-fact-label small-caps">{label}</dt>
      <dd className="album-fact-value">{value}</dd>
    </div>
  );
}
