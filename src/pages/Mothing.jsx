import { useMemo, useState } from 'react';
import PageShell from '../components/PageShell.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { MothingSkeleton, FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import { fetchMothData, fetchMothSignature, photoUrl, buildSessions } from '../lib/inaturalist.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { ME_DID, INATURALIST_USER, MOTHING_OBSERVATION_NSID } from '../config.js';
import '../components/Feed.css';
import './Mothing.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Format a plain 'YYYY-MM-DD' date without touching Date() (no timezone math,
// so a date can never shift across a day boundary — and never implies where).
function formatDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  if (!m) return '';
  const [, y, mo, day] = m;
  return `${MONTHS[Number(mo) - 1]} ${Number(day)}, ${y}`;
}

// Local 'HH:MM' → '8:47pm'. Wall-clock only; carries no location.
function formatTime(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return '';
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${min}${ampm}`;
}

function StatBlock({ value, label }) {
  if (value == null) return null;
  return (
    <div className="mothing-stat">
      <span className="mothing-stat-value">{value.toLocaleString()}</span>
      <span className="mothing-stat-label small-caps">{label}</span>
    </div>
  );
}

/** Google Lens reverse-image search for a photo — handy for pinning an ID. */
function reverseSearchUrl(imageUrl) {
  return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`;
}

const mothName = (obs) => obs.taxon?.commonName || obs.taxon?.name || 'Unidentified moth';

/**
 * One observation as an image tile that opens the in-page lightbox (the
 * iNaturalist link moves into the lightbox's "source" control). Photoless
 * observations fall back to a static placeholder tile.
 */
function MothTile({ obs, onOpen }) {
  const photo = obs.photos?.[0];
  const src = photo ? photoUrl(photo, 'medium') : null;
  const title = mothName(obs);
  const sci = obs.taxon?.name;
  const showSci = sci && sci !== title;
  const caption = (
    <span className="mothing-tile-caption">
      <span className="mothing-name">{title}</span>
      {showSci && <span className="mothing-sci">{sci}</span>}
    </span>
  );
  return (
    <li className="mothing-cell">
      {src ? (
        <button
          type="button"
          className="mothing-tile"
          onClick={() => onOpen(obs)}
          aria-label={`View photo: ${title}`}
        >
          <img src={src} alt={title} loading="lazy" decoding="async" />
          {caption}
        </button>
      ) : (
        <div className="mothing-tile mothing-tile-empty">
          <div className="mothing-placeholder" aria-hidden="true">&#x1F98B;</div>
          {caption}
        </div>
      )}
    </li>
  );
}

function SessionHeader({ session }) {
  const parts = [`${session.observationCount} moth${session.observationCount === 1 ? '' : 's'}`];
  if (session.speciesCount) parts.push(`${session.speciesCount} species`);
  if (session.firstTime) {
    parts.push(
      session.lastTime && session.lastTime !== session.firstTime
        ? `${formatTime(session.firstTime)}–${formatTime(session.lastTime)}`
        : formatTime(session.firstTime),
    );
  }
  return (
    <header className="mothing-session-head">
      <div className="mothing-session-headrow">
        <span className="small-caps mothing-session-num">Session #{session.number}</span>
        <h2 className="mothing-session-title">Night of {formatDate(session.date)}</h2>
      </div>
      <span className="gutter mothing-session-stats">{parts.join(' · ')}</span>
    </header>
  );
}

/** Compact per-session summary for the ledger day-header (count · species). */
function sessionLedgerMeta(session) {
  const parts = [`${session.observationCount} moth${session.observationCount === 1 ? '' : 's'}`];
  if (session.speciesCount) parts.push(`${session.speciesCount} species`);
  return parts.join(' · ');
}

/**
 * One observation as a ledger row: a small square thumbnail, the common and
 * scientific names stacked, and the observed time flush right. Tapping a row
 * with a photo opens the in-page lightbox (the same one the tile grid uses);
 * a photoless observation is a static row with a placeholder thumb.
 */
function MothLedgerRow({ obs, onOpen }) {
  const photo = obs.photos?.[0];
  const thumb = photo ? photoUrl(photo, 'square') : null;
  const name = mothName(obs);
  const sci = obs.taxon?.name;
  const showSci = sci && sci !== name;
  const time = obs.observedTime ? formatTime(obs.observedTime) : formatDate(obs.observedDate);
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
  return (
    <li className="mothing-ledger-item" data-nsid={MOTHING_OBSERVATION_NSID}>
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
  const lightboxImages = useMemo(
    () =>
      photoObs.map((o) => {
        const photo = o.photos[0];
        const large = photoUrl(photo, 'large');
        const name = mothName(o);
        const sci = o.taxon?.name;
        return {
          src: large,
          thumb: photoUrl(photo, 'medium'),
          alt: sci && sci !== name ? `${name} — ${sci}` : name,
          sourceUrl: o.url,
          searchUrl: large ? reverseSearchUrl(large) : undefined,
        };
      }),
    [photoObs],
  );

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/mothing`}
      headTitle="dame.is mothing"
    >
      {stats && (
        <section className="mothing-stats" aria-label="Mothing stats">
          <StatBlock value={stats.sessionCount ?? sessions.length} label="sessions" />
          <StatBlock value={stats.observationCount} label="observations" />
          <StatBlock value={stats.speciesCount} label="species" />
          {stats.earliestDate && (
            <div className="mothing-stat mothing-stat-range">
              <span className="mothing-stat-value mothing-stat-dates">
                {formatDate(stats.earliestDate)} &ndash; {formatDate(stats.latestDate)}
              </span>
              <span className="mothing-stat-label small-caps">span</span>
            </div>
          )}
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
                <h3 className="day-header">Night of {formatDate(session.date)}</h3>
                <p className="day-header-meta">{sessionLedgerMeta(session)}</p>
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
