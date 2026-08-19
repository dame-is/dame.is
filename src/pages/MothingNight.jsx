import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { MothTile, MothStat } from '../components/MothTile.jsx';
import { MothingSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { fetchMothData, fetchMothSignature } from '../lib/inaturalist.js';
import {
  findNight,
  formatNightDate,
  mothLightboxImages,
  nightBeyondReach,
  nightPath,
  nightSpan,
} from '../lib/mothing.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { INATURALIST_USER } from '../config.js';
import '../components/Feed.css';
import './Mothing.css';

/**
 * One mothing session — a single night at the light — as a card gallery.
 *
 * The night's date IS its address (`/mothing/2026-08-18`), which is what
 * makes it shareable: a session isn't a record on the PDS, it's a grouping
 * the site derives from the observations that fall inside one 8pm–3am window
 * (see `buildSessions`). So this page derives it again from the same data the
 * index reads, rather than fetching anything of its own.
 *
 * `/mothing/:slug` is one route serving two things — a date lands here, an
 * iNaturalist observation id lands on Record.jsx. See App.jsx.
 */
// "This date genuinely had no session at the light." Distinct from null,
// which keeps useLiveFeed at `loading` while the live pull is still out.
const NO_SESSION = { session: null };

export default function MothingNight() {
  const { rkey: date } = useParams();

  const { items, status } = useLiveFeed({
    name: 'mothing',
    strategy: 'snapshot-first',
    deps: [date],
    // Same two-step the index uses: the build snapshot is at most six hours
    // old, so take a cheap signature first and only re-pull everything when
    // iNaturalist has actually moved.
    fetchLive: async () => {
      const snap = await fetchSnapshot('mothing');
      if (snap?.sync?.latestUpdatedAt) {
        try {
          const sig = await fetchMothSignature({ user: INATURALIST_USER });
          if (sig.count === snap.sync.count && sig.latestUpdatedAt === snap.sync.latestUpdatedAt) {
            return snap;
          }
        } catch {
          // Signature check failed — fall through to a normal full fetch.
        }
      }
      return fetchMothData({ user: INATURALIST_USER });
    },
    mapItems: (data) => {
      const observations = Array.isArray(data?.observations) ? data.observations : null;
      if (!observations) return null;
      const found = findNight(observations, date);
      if (found) return found;
      // A miss means one of two things, and they want opposite treatment. If
      // the date is past what this copy can answer for, the copy is simply
      // behind — hold at `loading` (null does that) so a night logged since
      // the last build shows a skeleton until the live pull answers, instead
      // of flashing "no night here" and then filling in. Any older date is a
      // real miss and should say so at once.
      return nightBeyondReach(observations, date) ? null : NO_SESSION;
    },
  });

  const night = items || null;
  const session = night?.session || null;

  const lightboxImages = useMemo(
    () => mothLightboxImages(session?.observations || []),
    [session],
  );
  // The active lightbox index, -1 when closed. Keyed on the night's own
  // observations, so prev/next walks this night and stops at its edges.
  const [lightbox, setLightbox] = useState(-1);
  const indexById = useMemo(() => {
    const map = new Map();
    (session?.observations || []).filter((o) => o.photos?.[0]).forEach((o, i) => map.set(o.id, i));
    return map;
  }, [session]);

  const backToIndex = (
    <p className="mothing-night-crumb">
      <Link to="/mothing">&larr; Mothing</Link>
    </p>
  );

  if (status === 'loading') {
    return (
      <PageShell above={backToIndex} headTitle={`Night of ${formatNightDate(date)} — dame.is`}>
        <MothingSkeleton sessions={1} cells={8} />
      </PageShell>
    );
  }

  if (!session) {
    const unreachable = status === 'error';
    return (
      <PageShell
        above={backToIndex}
        title={unreachable ? 'Night unavailable' : 'No night here'}
        headTitle="Not found — dame.is"
      >
        <p>
          {unreachable ? (
            <>Couldn&rsquo;t load the observations right now.{' '}</>
          ) : (
            <>
              No mothing session on <strong>{formatNightDate(date) || date}</strong>. A session is
              one night at the light, so only the nights that were spent there have a page.{' '}
            </>
          )}
          <Link to="/mothing">Back to every night.</Link>
        </p>
      </PageShell>
    );
  }

  const span = nightSpan(session);
  const { newer, older } = night;

  return (
    <PageShell
      above={backToIndex}
      title={`Night of ${formatNightDate(session.date)}`}
      headTitle={`Night of ${formatNightDate(session.date)} — dame.is`}
    >
      <section className="mothing-stats" aria-label="Night summary">
        <MothStat value={`#${session.number}`} label="session" />
        <MothStat value={session.observationCount} label="moths" />
        <MothStat value={session.speciesCount} label="species" />
        <MothStat value={span} label="at the light" />
      </section>

      <ul className="mothing-grid reveal-stagger">
        {session.observations.map((obs) => (
          <MothTile key={obs.id} obs={obs} onOpen={(o) => setLightbox(indexById.get(o.id) ?? -1)} />
        ))}
      </ul>

      {(older || newer) && (
        <nav className="mothing-night-nav" aria-label="Other nights">
          {older && (
            <Link className="mothing-night-nav-prev" to={nightPath(older.date)}>
              <span className="small-caps mothing-night-nav-label">Earlier night</span>
              <span className="mothing-night-nav-date">&larr; {formatNightDate(older.date)}</span>
            </Link>
          )}
          {newer && (
            <Link className="mothing-night-nav-next" to={nightPath(newer.date)}>
              <span className="small-caps mothing-night-nav-label">Later night</span>
              <span className="mothing-night-nav-date">{formatNightDate(newer.date)} &rarr;</span>
            </Link>
          )}
        </nav>
      )}

      <p className="mothing-source gutter">
        Mirrored from{' '}
        <a
          href={`https://www.inaturalist.org/people/${INATURALIST_USER}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          iNaturalist
        </a>
        . A mothing session is one night at the light (8pm&ndash;3am). Location data is
        intentionally omitted.
      </p>

      <Lightbox
        open={lightbox >= 0}
        index={Math.max(0, lightbox)}
        onClose={() => setLightbox(-1)}
        images={lightboxImages}
      />
    </PageShell>
  );
}
