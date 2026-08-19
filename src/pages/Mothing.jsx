import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { MothTile, MothStat } from '../components/MothTile.jsx';
import { MothingSkeleton, FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import { useXray } from '../hooks/useXray.jsx';
import { XrayTag, XraySubstratePanel } from '../components/XraySubstrate.jsx';
import { fetchMothData, fetchMothSignature, photoUrl, buildSessions } from '../lib/inaturalist.js';
import {
  formatNightDate,
  formatObservedTime,
  mothLightboxImages,
  mothName,
  nightPath,
  nightSummaryParts,
} from '../lib/mothing.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { ME_DID, INATURALIST_USER, MOTHING_OBSERVATION_NSID } from '../config.js';
import '../components/Feed.css';
import './Mothing.css';

/**
 * A session's header, and the way through to the night's own page — the whole
 * night as a gallery, with a card that previews what was at the light (see
 * MothingNight.jsx). The title is the link because the title IS the night:
 * its date is the address.
 */
function SessionHeader({ session }) {
  return (
    <header className="mothing-session-head">
      <div className="mothing-session-headrow">
        <span className="small-caps mothing-session-num">Session #{session.number}</span>
        <h2 className="mothing-session-title">
          <Link className="mothing-night-link" to={nightPath(session.date)}>
            Night of {formatNightDate(session.date)}
          </Link>
        </h2>
      </div>
      <span className="gutter mothing-session-stats">{nightSummaryParts(session).join(' · ')}</span>
    </header>
  );
}

/**
 * One observation as a ledger row: a small square thumbnail, the common and
 * scientific names stacked, and the observed time flush right. Tapping a row
 * with a photo opens the in-page lightbox (the same one the tile grid uses);
 * a photoless observation is a static row with a placeholder thumb.
 */
function MothLedgerRow({ obs, onOpen }) {
  const xray = useXray();
  const photo = obs.photos?.[0];
  const thumb = photo ? photoUrl(photo, 'square') : null;
  const name = mothName(obs);
  const sci = obs.taxon?.name;
  const showSci = sci && sci !== name;
  const time = obs.observedTime
    ? formatObservedTime(obs.observedTime)
    : formatNightDate(obs.observedDate);
  const inner = (
    <>
      {thumb ? (
        <img className="mothing-ledger-thumb" src={thumb} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="mothing-ledger-thumb mothing-ledger-thumb-empty" aria-hidden="true">
          &#x1F98B;
        </span>
      )}
      <span className="mothing-ledger-names">
        <span className="mothing-ledger-name">{name}</span>
        {showSci && <span className="mothing-ledger-sci">{sci}</span>}
      </span>
      <span className="mothing-ledger-time">{time}</span>
    </>
  );
  // The mirrored observation record on the PDS — its rkey is the iNaturalist id.
  const atUri = obs.id ? `at://${ME_DID}/${MOTHING_OBSERVATION_NSID}/${obs.id}` : null;
  const inspectable = xray.active && !!atUri;
  const focused = inspectable && xray.focusUri === atUri;
  return (
    <li
      className={`mothing-ledger-item${focused ? ' is-xray-focus' : ''}`}
      data-nsid={MOTHING_OBSERVATION_NSID}
      data-atproto={atUri ? '' : undefined}
      data-at-uri={atUri || undefined}
    >
      {photo ? (
        <button
          type="button"
          className="mothing-ledger-row"
          onClick={() => onOpen(obs)}
          aria-label={`View photo: ${name}`}
        >
          {inner}
        </button>
      ) : (
        <div className="mothing-ledger-row mothing-ledger-row-static">{inner}</div>
      )}
      {inspectable && <XrayTag atUri={atUri} onOpen={() => xray.focus(atUri)} />}
      {focused && <XraySubstratePanel atUri={atUri} />}
    </li>
  );
}

export default function Mothing() {
  const { title, intro } = usePageContent('mothing');
  const { layout } = useFeedLayout();
  const ledger = layout === 'ledger';

  const { items, status } = useLiveFeed({
    name: 'mothing',
    strategy: 'snapshot-first',
    // The snapshot is refreshed on every build (≤6h old). Before re-pulling
    // all observations, take a cheap signature and, if it matches the
    // snapshot's, reuse the snapshot instead of downloading everything again.
    fetchLive: async () => {
      const snap = await fetchSnapshot('mothing');
      if (snap?.sync?.latestUpdatedAt) {
        try {
          const sig = await fetchMothSignature({ user: INATURALIST_USER });
          if (sig.count === snap.sync.count && sig.latestUpdatedAt === snap.sync.latestUpdatedAt) {
            return snap; // nothing changed upstream — no full pull needed
          }
        } catch {
          // Signature check failed — fall through to a normal full fetch.
        }
      }
      return fetchMothData({ user: INATURALIST_USER });
    },
    mapItems: (data) => {
      if (!data) return null;
      return {
        stats: data.stats || null,
        observations: Array.isArray(data.observations) ? data.observations : [],
      };
    },
  });

  const loading = status === 'loading';
  const stats = items?.stats || null;
  const observations = items?.observations || [];

  const { sessions, orphans } = useMemo(() => buildSessions(observations), [observations]);

  // Lightbox over every photographed observation, in the same order the tiles
  // render (sessions first, then orphans), so prev/next walks the whole page.
  // `lightbox` is the active index, -1 when closed.
  const [lightbox, setLightbox] = useState(-1);
  const photoObs = useMemo(() => {
    const ordered = [...sessions.flatMap((s) => s.observations), ...orphans];
    return ordered.filter((o) => o.photos?.[0]);
  }, [sessions, orphans]);
  const lightboxIndexById = useMemo(() => {
    const map = new Map();
    photoObs.forEach((o, i) => map.set(o.id, i));
    return map;
  }, [photoObs]);
  const openLightbox = (obs) => setLightbox(lightboxIndexById.get(obs.id) ?? -1);
  const lightboxImages = useMemo(() => mothLightboxImages(photoObs), [photoObs]);

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/mothing`}
      headTitle="dame.is mothing"
    >
      {stats && (
        <section className="mothing-stats" aria-label="Mothing stats">
          <MothStat value={stats.sessionCount ?? sessions.length} label="sessions" />
          <MothStat value={stats.observationCount} label="observations" />
          <MothStat value={stats.speciesCount} label="species" />
        </section>
      )}

      {stats?.topSpecies?.length > 0 && (
        <p className="mothing-toplist">
          <span className="small-caps mothing-toplist-lead">Most seen</span>{' '}
          {stats.topSpecies.slice(0, 6).map((s, i) => (
            <span key={s.taxonId || i} className="mothing-toplist-item">
              {s.commonName || s.name}
              <span className="mothing-toplist-count"> {s.count}</span>
              {i < Math.min(6, stats.topSpecies.length) - 1 ? <span className="mothing-toplist-sep"> · </span> : ''}
            </span>
          ))}
        </p>
      )}

      {loading && observations.length === 0 ? (
        ledger ? (
          <FeedSkeleton rows={6} label="Loading observations" />
        ) : (
          <MothingSkeleton sessions={2} cells={4} />
        )
      ) : observations.length === 0 ? (
        <p className="feed-empty">No moth observations yet.</p>
      ) : ledger ? (
        <div className="feed-ledger">
          {sessions.map((session) => (
            <section key={session.date} className="feed-day-group">
              <header className="day-section-header">
                <h3 className="day-header">
                  <Link className="mothing-night-link" to={nightPath(session.date)}>
                    Night of {formatNightDate(session.date)}
                  </Link>
                </h3>
                <p className="day-header-meta">
                  {nightSummaryParts(session, { span: false }).join(' · ')}
                </p>
              </header>
              <ol className="mothing-ledger reveal-stagger">
                {session.observations.map((obs) => (
                  <MothLedgerRow key={obs.id} obs={obs} onOpen={openLightbox} />
                ))}
              </ol>
            </section>
          ))}
          {orphans.length > 0 && (
            <section className="feed-day-group">
              <header className="day-section-header">
                <h3 className="day-header">Daytime &amp; untimed</h3>
                <p className="day-header-meta">
                  {orphans.length} observation{orphans.length === 1 ? '' : 's'}
                </p>
              </header>
              <ol className="mothing-ledger reveal-stagger">
                {orphans.map((obs) => (
                  <MothLedgerRow key={obs.id} obs={obs} onOpen={openLightbox} />
                ))}
              </ol>
            </section>
          )}
        </div>
      ) : (
        <div className="mothing-sessions">
          {sessions.map((session) => (
            <section key={session.date} className="mothing-session">
              <SessionHeader session={session} />
              <ul className="mothing-grid reveal-stagger">
                {session.observations.map((obs) => (
                  <MothTile key={obs.id} obs={obs} onOpen={openLightbox} />
                ))}
              </ul>
            </section>
          ))}

          {orphans.length > 0 && (
            <section className="mothing-session">
              <header className="mothing-session-head">
                <div className="mothing-session-headrow">
                  <span className="small-caps mothing-session-num">Outside sessions</span>
                  <h2 className="mothing-session-title">Daytime &amp; untimed</h2>
                </div>
                <span className="gutter mothing-session-stats">
                  {orphans.length} observation{orphans.length === 1 ? '' : 's'}
                </span>
              </header>
              <ul className="mothing-grid reveal-stagger">
                {orphans.map((obs) => (
                  <MothTile key={obs.id} obs={obs} onOpen={openLightbox} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <p className="mothing-source gutter">
        Mirrored from{' '}
        <a href={stats?.profileUrl || `https://www.inaturalist.org/people/${INATURALIST_USER}`} target="_blank" rel="noopener noreferrer">
          iNaturalist
        </a>
        . A mothing session is one night at the light (8pm&ndash;3am). Location data is intentionally omitted.
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
