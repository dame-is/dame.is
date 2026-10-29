import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import LeafletDocument from '../components/LeafletDocument.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { Skeleton } from '../components/Skeleton.jsx';
import Time from '../components/Time.jsx';
import { useProfile } from '../hooks/useProfile.js';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, getRecord, listRecordsPage } from '../lib/atproto.js';
import { annotateBlobUrl, annotateLeafletBlobs } from '../lib/feedBuilder.js';
import { renderMarkdown } from '../lib/markdown.js';
import { hasLeafletContent } from '../lib/lexicons.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { pickDefaultResume } from '../lib/resumeHelpers.js';
import { fetchGuestbookEntries } from '../lib/guestbook.js';
import { isRecent } from '../lib/time.js';
import { pageDefault } from '../lib/pageRegistry.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useNavRoutes } from '../hooks/useNavRoutes.js';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { safeHref } from '../lib/safeHref.js';
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
  const { profile, status: profileStatus } = useProfile();
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
  const { tagline } = v;
  // Record data, so guarded the way every other record href on the site is:
  // only http(s)/mailto/at links survive, and a malformed `links` (null, an
  // object) reads as none rather than throwing the page into the error screen.
  const links = useMemo(
    () =>
      (Array.isArray(v.links) ? v.links : [])
        .map((l) => ({ ...l, href: safeHref(l?.url) }))
        .filter((l) => l.href),
    [v.links],
  );

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

  // Until the Bluesky profile lands (snapshot or live), the card holds its
  // shape instead of painting a stand-in name: "dame.is" flipping to "dame"
  // with an avatar arriving beside it moved the whole card on every cold visit.
  const identityPending = !profile && (profileStatus === 'idle' || profileStatus === 'loading');
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
      // Named only once the record turns up: is.dame.profile/self is written
      // when the owner gets to it, and until then this page claimed a record
      // that wasn't there — in its <head>, its footer and its edit button —
      // where the edge (middleware.js) had already stopped claiming it.
      atUri={extended?.uri || undefined}
      cid={extended?.cid || undefined}
    >
      {hasCard && (
        <section className="about-card" aria-busy={identityPending || undefined}>
          {/* The page's one above-the-fold image, so not lazy. */}
          {avatar ? (
            <img
              className="about-avatar"
              src={avatar}
              alt={profile?.displayName || 'Avatar'}
              width={112}
              height={112}
            />
          ) : (
            showAvatar &&
            identityPending && <Skeleton block className="about-avatar" width="7rem" height="7rem" />
          )}
          <div className="about-meta">
            {showIdentity &&
              (identityPending ? (
                <>
                  <Skeleton
                    block
                    className="about-name"
                    width="9rem"
                    height="calc(var(--text-3xl) * 1.1)"
                  />
                  <Skeleton block className="about-handle" width="7rem" height="1.5em" />
                </>
              ) : (
                <>
                  <h1 className="about-name">{displayName}</h1>
                  <p className="about-handle">
                    <a
                      href={`https://bsky.app/profile/${profile?.handle || 'dame.is'}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      @{profile?.handle || 'dame.is'}
                      <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden="true" />
                    </a>
                  </p>
                </>
              ))}
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
                    <a href={l.href} target="_blank" rel="noreferrer noopener">
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

      {/* Nothing here waits on is.dame.profile/self, so the page no longer
          ends at the one-line bio when that record is missing. The record's
          own links, once it has some, take over from Find Dame. */}
      {links.length === 0 && <FindDame profile={profile} />}
      <AlsoList />
    </PageShell>
  );
}

/**
 * Find Dame: the real routes in, as a two-column ledger. Every value comes
 * from a record the site already reads: the Bluesky profile, the featured
 * résumé (its email and title), and the guestbook's count.
 */
function FindDame({ profile }) {
  const { openPanel } = useChromePanel();
  const [resume, setResume] = useState(null);
  const [book, setBook] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchSnapshot('resume')
      .then((d) => {
        if (!cancelled) setResume(pickDefaultResume(d?.resumes)?.value || null);
      })
      .catch(() => {});
    fetchGuestbookEntries({ limit: 1 })
      .then((page) => {
        if (!cancelled && page) {
          setBook({
            total: page.publicTotal ?? page.total,
            latest: page.entries?.[0]?.value?.createdAt || null,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handle = profile?.handle || 'dame.is';
  const email = resume?.contact?.email;
  const role = [resume?.headline, resume?.contact?.location].filter(Boolean).join(' · ');
  return (
    <section className="about-ledger" aria-labelledby="about-find-h">
      <h2 id="about-find-h" className="about-ledger-h">
        Find Dame
      </h2>
      <dl className="about-ledger-rows">
        <div>
          <dt>bluesky</dt>
          <dd>
            <a href={`https://bsky.app/profile/${handle}`} target="_blank" rel="noreferrer noopener">
              @{handle}
              <ArrowUpRight size={12} strokeWidth={1.75} aria-hidden="true" />
            </a>
            {profile?.followersCount ? (
              <span className="about-ledger-note">
                {profile.followersCount.toLocaleString('en-US')} followers
              </span>
            ) : null}
          </dd>
        </div>
        {email && (
          <div>
            <dt>email</dt>
            <dd>
              <a href={`mailto:${email}`}>{email}</a>
              <span className="about-ledger-note">the address on the résumé</span>
            </dd>
          </div>
        )}
        <div>
          <dt>résumé</dt>
          <dd>
            <Link to="/available">available for hire&nbsp;&rarr;</Link>
            {role && <span className="about-ledger-note">{role}</span>}
          </dd>
        </div>
        <div>
          <dt>guestbook</dt>
          <dd>
            <button type="button" className="about-ledger-action" onClick={() => openPanel('guestbook')}>
              sign it&nbsp;&rarr;
            </button>
            {book?.total ? (
              <span className="about-ledger-note">
                {book.total} {book.total === 1 ? 'signature' : 'signatures'}
                {book.latest ? (
                  <>
                    , the latest {isRecent(book.latest) ? '' : 'on '}
                    <Time value={book.latest} variant="relative" />
                  </>
                ) : null}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// The sections whose latest record is one cheap read: a single listRecords
// row. The rest go without a folio rather than guess.
const LATEST_FROM = {
  '/logging': COLLECTIONS.now,
  '/listening': COLLECTIONS.listen,
  '/mothing': 'is.dame.mothing.observation',
};
const ROUTE_SLUG = { '/welcoming': 'guestbook', '/available': 'resume' };
const NOT_ALSO = new Set(['/', '/themself', '/available', '/welcoming']);

/**
 * "Dame is also…": the menu's own sections (in is.dame.nav order), each with
 * a gloss cut from that page's intro and, where it's cheap to know, how
 * recently it last had a record.
 */
function AlsoList() {
  const routes = useNavRoutes().filter((r) => !NOT_ALSO.has(r.to));
  const [latest, setLatest] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pds = await resolvePds(ME_DID);
        const out = {};
        await Promise.all(
          Object.entries(LATEST_FROM).map(async ([path, collection]) => {
            const page = await listRecordsPage(pds, { repo: ME_DID, collection, limit: 1 }).catch(() => null);
            const v = page?.records?.[0]?.value;
            const at = v?.createdAt || v?.playedTime || v?.observedAt || null;
            if (at) out[path] = at;
          }),
        );
        if (!cancelled) setLatest(out);
      } catch {
        /* no folios; the list still stands */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  if (!routes.length) return null;
  return (
    <section className="about-ledger about-also" aria-labelledby="about-also-h">
      <h2 id="about-also-h" className="about-ledger-h">
        Dame is also&hellip;
        <span className="about-ledger-h-meta">latest</span>
      </h2>
      <ul className="about-also-rows">
        {routes.map((r) => (
          <AlsoRow key={r.to} route={r} latest={latest[r.to]} />
        ))}
      </ul>
    </section>
  );
}

function AlsoRow({ route, latest }) {
  const slug = ROUTE_SLUG[route.to] || route.to.slice(1);
  const { intro } = usePageContent(slug);
  const text = intro || pageDefault(slug)?.intro || '';
  // The first sentence, lower-cased to run on from "Dame is also… creating:".
  const first = text.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '');
  const gloss = first ? first[0].toLowerCase() + first.slice(1) : '';
  return (
    <li className="about-also-row">
      <Link to={route.to} className="about-also-label">
        {route.label}
      </Link>
      <span className="about-also-gloss">{gloss}</span>
      <span className="about-also-latest">{latest ? <Time value={latest} variant="relative" /> : ''}</span>
    </li>
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
  const uniform = layout !== 'one-up' && layout !== 'standalone' && layout !== 'justified';
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
            <figure
              className="about-photo"
              key={i}
              style={ar?.width && ar?.height ? { '--ar': ar.width / ar.height } : undefined}
            >
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
