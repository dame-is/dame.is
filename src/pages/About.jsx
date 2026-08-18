import { useMemo, useState } from 'react';
import PageShell from '../components/PageShell.jsx';
import LeafletDocument from '../components/LeafletDocument.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { useProfile } from '../hooks/useProfile.js';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, getRecord } from '../lib/atproto.js';
import { annotateBlobUrl, annotateLeafletBlobs } from '../lib/feedBuilder.js';
import { renderMarkdown } from '../lib/markdown.js';
import { hasLeafletContent } from '../lib/lexicons.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './About.css';

/**
 * /themself — the long-form profile.
 *
 * Two records meet on this page. Bluesky's `app.bsky.actor.profile` supplies the
 * identity card (avatar, display name, handle, and a 256-character description);
 * `is.dame.profile/self` supplies everything below it — tagline, photos, the
 * long-form body — plus three flags saying how much of that Bluesky card to keep.
 * The flags default to ON when absent, so a repo with no profile record (or an
 * old one written before they existed) renders exactly as it always did.
 *
 * The body can be either shape: `content` is a pub.leaflet.content block body,
 * the same one blog posts use, so photos and headers can sit inline; `body` is
 * the original plain markdown, still rendered when no blocks exist.
 */
export default function About() {
  const { profile } = useProfile();
  const { items: extended } = useLiveFeed({
    name: 'extendedProfile',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      const rec = await getRecord(pds, {
        repo: ME_DID,
        collection: COLLECTIONS.profile,
        rkey: 'self',
      });
      // Blob refs carry a CID, not a URL. The snapshot is annotated at build
      // time (scripts/prefetch.mjs); the live copy has to be annotated here, or
      // the photos would blink out the moment the live fetch overlaid the
      // snapshot they were painted from.
      annotateProfileBlobs(rec?.value, pds);
      return rec;
    },
    mapItems: (rec) => (rec && (rec.uri || rec.value) ? rec : null),
  });

  const v = extended?.value || {};
  const { tagline, links = [] } = v;

  // Absent reads as true: the flags exist to take things AWAY, so a record that
  // has never heard of them must not hide anything.
  const showAvatar = v.showAvatar !== false;
  const showIdentity = v.showIdentity !== false;
  const showBlueskyBio = v.showBlueskyBio !== false;

  const photos = useMemo(
    () => (Array.isArray(v.photos) ? v.photos.filter((p) => photoUrl(p)) : []),
    [v.photos],
  );

  const blockBody = hasLeafletContent(v.content) ? v.content : null;
  const longHtml = !blockBody && v.body ? renderMarkdown(v.body, v.bodyFormat || 'markdown') : '';

  const avatar = showAvatar ? profile?.avatar : null;
  const displayName = profile?.displayName || profile?.handle || 'dame.is';
  const blueskyBio = showBlueskyBio ? profile?.description : null;
  // With the name hidden the tagline is the only thing left that could head the
  // page, so it is promoted to the <h1> rather than leaving the page untitled.
  const taglineIsHeading = !showIdentity && Boolean(tagline);
  const hasCard =
    Boolean(avatar) || showIdentity || Boolean(tagline) || Boolean(blueskyBio) || links.length > 0;

  return (
    <PageShell
      headTitle="dame.is themself"
      atUri={`at://${ME_DID}/is.dame.profile/self`}
    >
      {hasCard && (
        <section className="about-card">
          {avatar && (
            <img
              className="about-avatar"
              src={avatar}
              alt={profile?.displayName || 'Avatar'}
              loading="lazy"
            />
          )}
          <div className="about-meta">
            {showIdentity && (
              <>
                <h1 className="about-name">{displayName}</h1>
                <p className="about-handle">@{profile?.handle || 'dame.is'}</p>
              </>
            )}
            {tagline &&
              (taglineIsHeading ? (
                <h1 className="about-tagline about-tagline-heading">{tagline}</h1>
              ) : (
                <p className="about-tagline">{tagline}</p>
              ))}
            {blueskyBio && <p className="about-bio">{blueskyBio}</p>}
            {links.length > 0 && (
              <ul className="about-links">
                {links.map((l, i) => (
                  <li key={l.url || i}>
                    <a href={l.url} target="_blank" rel="noreferrer noopener">
                      {l.label || l.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <PhotoGallery photos={photos} layout={v.photoLayout} />

      {blockBody && (
        <div className="blog-prose about-longform">
          <LeafletDocument doc={blockBody} />
        </div>
      )}
      {longHtml && (
        <div
          className="blog-prose about-longform"
          dangerouslySetInnerHTML={{ __html: longHtml }}
        />
      )}
    </PageShell>
  );
}

/**
 * The portrait strip between the identity card and the body.
 *
 * `data-layout` carries the same vocabulary as an inline image gallery in a
 * leaflet body (LeafletDocument's GALLERY_LAYOUTS), so the one dropdown in the
 * admin means the same thing wherever a set of photos appears. The column count
 * holds at every width — an author picked a shape, and a breakpoint quietly
 * rewriting it is what made the old count-derived layouts unpredictable.
 *
 * Unlike a leaflet image block this does NOT fall back to `alt` for the visible
 * caption: alt text here describes the photo for a screen reader, and echoing it
 * on screen would only make it be read twice.
 */
function PhotoGallery({ photos, layout }) {
  const [lightbox, setLightbox] = useState(-1);
  // A multi-column strip crops every frame to one shape. Left at their natural
  // ratios the tiles end at different heights and their captions land on
  // different lines, which reads as a layout that didn't finish rather than as
  // a set. A single column has no neighbour to line up with, so there the
  // photo's own proportions are kept.
  const uniform = layout !== 'one-up' && layout !== 'standalone';
  const images = useMemo(
    () =>
      photos.map((p) => ({
        src: photoUrl(p),
        alt: p.alt || '',
        width: p.aspectRatio?.width || undefined,
        height: p.aspectRatio?.height || undefined,
      })),
    [photos],
  );
  if (images.length === 0) return null;

  return (
    <>
      <div className="about-gallery" data-layout={layout || 'two-up'} data-count={images.length}>
        {photos.map((photo, i) => {
          const ar = photo.aspectRatio;
          return (
            // Index keys: the list is rendered straight from the record and
            // never reordered here, and two photos may legitimately share a
            // URL — which a URL key would collide on.
            <figure className="about-photo" key={i}>
              <button
                type="button"
                className="about-photo-button"
                onClick={() => setLightbox(i)}
                aria-label={photo.alt ? `View photo: ${photo.alt}` : 'View photo'}
              >
                <img
                  src={photoUrl(photo)}
                  alt={photo.alt || ''}
                  loading="lazy"
                  decoding="async"
                  style={
                    !uniform && ar?.width && ar?.height
                      ? { aspectRatio: `${ar.width} / ${ar.height}` }
                      : undefined
                  }
                />
              </button>
              {photo.caption && (
                <figcaption className="about-photo-caption">{photo.caption}</figcaption>
              )}
            </figure>
          );
        })}
      </div>
      <Lightbox
        open={lightbox >= 0}
        index={Math.max(0, lightbox)}
        onClose={() => setLightbox(-1)}
        images={images}
      />
    </>
  );
}

function photoUrl(photo) {
  return photo?.image?._url || null;
}

/** Bake display URLs onto every blob the profile record can carry. */
function annotateProfileBlobs(value, pds) {
  if (!value || !pds) return;
  for (const photo of value.photos || []) annotateBlobUrl(photo?.image, pds, ME_DID);
  annotateLeafletBlobs(value.content, pds, ME_DID);
}
