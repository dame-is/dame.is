import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { MothTile } from '../components/MothTile.jsx';
import Figures from '../components/Figures.jsx';
import { MothingSkeleton, FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useFeedWindow } from '../hooks/useFeedWindow.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useSectionView } from '../hooks/useFeedLayout.jsx';
import { useXray } from '../hooks/useXray.jsx';
import { XrayTag, XraySubstratePanel } from '../components/XraySubstrate.jsx';
import FirstSightingChip from '../components/FirstSightingChip.jsx';
import FeedMore from '../components/FeedMore.jsx';
import { fetchMothData, fetchMothSignature, photoUrl, buildSessions } from '../lib/inaturalist.js';
import { firstSightingIds } from '../lib/firstSightings.js';
import {
  formatNightDate,
  formatNightDay,
  formatObservedTime,
  mothLightboxImages,
  mothName,
  nightPath,
  nightSpanCompact,
  nightSummaryParts,
  photographed,
  seasonsOf,
  weekdayOf,
} from '../lib/mothing.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { ME_DID, INATURALIST_USER, INATURALIST_URL, MOTHING_OBSERVATION_NSID } from '../config.js';
import '../components/Feed.css';
import './Mothing.css';

const EMPTY_OBSERVATIONS = [];
const NO_FIRSTS = new Set();
// A night is drawn as one tile (or ledger row) per moth, so the page's window
// is counted in moths rather than in nights.
const nightRows = (session) => session.observations.length;

/**
 * One night as a ruled entry in the almanac: a folio (No. 29, Oct 16,
 * Friday), a filmstrip of the first photographs, the counts, the time at the
 * light, any first sightings, and an explicit "see the night →" that shows
 * at rest, so a touch screen, which never hovers, still sees the way in.
 * The folio and the strip lead to the same page.
 */
function NightEntry({ session, firstCount }) {
  const href = nightPath(session.date);
  const shots = photographed(session);
  const strip = shots.slice(0, 8);
  const moreWide = session.observationCount - strip.length;
  const moreNarrow = session.observationCount - Math.min(strip.length, 4);
  const span = nightSpanCompact(session);
  return (
    <li className="night-entry">
      <Link to={href} className="night-folio">
        <span className="night-folio-num">No. {session.number}</span>
        <span className="night-folio-date">{formatNightDay(session.date)}</span>
        <span className="night-folio-day">{weekdayOf(session.date)}</span>
      </Link>
      <div className="night-body">
        {strip.length > 0 && (
          <Link to={href} className="night-strip" tabIndex={-1} aria-hidden="true">
            {strip.map((o) => (
              <img
                key={o.id}
                src={photoUrl(o.photos[0], 'square')}
                srcSet={`${photoUrl(o.photos[0], 'square')} 1x, ${photoUrl(o.photos[0], 'small')} 2x`}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ))}
            {moreWide > 0 && <span className="night-more night-more-wide">+{moreWide} more</span>}
            {moreNarrow > 0 && <span className="night-more night-more-narrow">+{moreNarrow} more</span>}
          </Link>
        )}
        <p className="night-counts">
          <span>{nightSummaryParts(session, { span: false }).join(' · ')}</span>
          {span && <span className="night-span">{span}</span>}
          {firstCount > 0 && <FirstSightingChip count={firstCount} size="small" />}
        </p>
        <Link to={href} className="night-see">
          see the night&nbsp;&rarr;
        </Link>
      </div>
    </li>
  );
}

/**
 * The six species seen most often, as plates: a square photograph (the
 * latest sighting of that species, picked by rule), the name, and the count.
 * A tap opens the photo in the page's lightbox. A species with no common
 * name is set in italic, as a binomial or genus is.
 */
function MostSeen({ top, observations, onOpen }) {
  const plates = useMemo(() => {
    const newest = new Map();
    for (const o of observations) {
      const id = o.taxon?.id;
      if (id == null || !o.photos?.[0]) continue;
      const key = `${o.observedDate || ''} ${o.observedTime || ''}`;
      const cur = newest.get(id);
      if (!cur || key > cur.key) newest.set(id, { key, obs: o });
    }
    return top.slice(0, 6).map((s) => ({ s, obs: newest.get(s.taxonId)?.obs || null }));
  }, [top, observations]);
  return (
    <section className="mothing-seen" aria-labelledby="mothing-seen-h">
      <h2 id="mothing-seen-h" className="mothing-section-h">
        Most seen
      </h2>
      <ul className="mothing-seen-plates">
        {plates.map(({ s, obs }) => (
          <li key={s.taxonId}>
            <button
              type="button"
              className="mothing-seen-plate"
              onClick={() => obs && onOpen(obs)}
              disabled={!obs}
              aria-label={`View photo: ${s.commonName || s.name}, seen ${s.count} times`}
            >
              {obs ? (
                <img src={photoUrl(obs.photos[0], 'medium')} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="mothing-seen-empty" aria-hidden="true" />
              )}
              <span className="mothing-seen-caption">
                <span className={`mothing-seen-name${s.commonName ? '' : ' is-binomial'}`}>
                  {s.commonName || s.name}
                </span>
                <span className="mothing-seen-count">&times;{s.count}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One observation as a ledger row: a small square thumbnail, the common and
 * scientific names stacked, and the observed time flush right. Tapping a row
 * with a photo opens the in-page lightbox (the same one the tile grid uses);
 * a photoless observation is a static row with a placeholder thumb.
 */
function MothLedgerRow({ obs, onOpen, first = false }) {
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
        <span className="mothing-ledger-name">
          {name}
          {first && <FirstSightingChip size="small" />}
        </span>
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
        // Named by its own contents — common name, the lifer mark, binomial,
        // time — rather than an aria-label, which would replace them: a label
        // short of what's on screen hides the binomial and the time from a
        // screen reader, and voice control can't find the row by its words.
        <button
          type="button"
          className="mothing-ledger-row"
          onClick={() => onOpen(obs)}
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
  // The almanac is the page; the ledger of every observation is the index a
  // reader chooses, for searching by name.
  const [view, setView] = useSectionView('mothing', 'plates');
  const ledger = view === 'index';

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
        truncated: Boolean(data.truncated),
      };
    },
  });

  const loading = status === 'loading';
  const stats = items?.stats || null;
  // Held stable across renders, not rebuilt as a fresh `|| []` each time: two
  // whole-archive passes hang off it below, and neither wants re-running
  // because nothing has loaded yet.
  const observations = useMemo(() => items?.observations || EMPTY_OBSERVATIONS, [items]);

  const { sessions, orphans } = useMemo(() => buildSessions(observations), [observations]);

  // The ledger view is drawn a window at a time, as the other feed pages are:
  // the whole archive was every row at once, for a reader who mostly looks at
  // the last few nights. (The almanac needs no window: a night is one line,
  // and only the current season starts open.) The lightbox still walks every
  // photograph, drawn or not. The daytime list comes last, once every night
  // is showing.
  const feedWindow = useFeedWindow(sessions, undefined, { weigh: nightRows });
  const shownSessions = feedWindow.visible;
  const shownOrphans = feedWindow.hasMore ? EMPTY_OBSERVATIONS : orphans;

  // Lifers. This page pulls every moth observation there is, so it derives the
  // set itself rather than reading the build's index — which means it is right
  // about a sighting logged an hour ago, not right as of the last deploy. A
  // pull that stopped short is missing the oldest sightings, which are the
  // firsts, so it marks none rather than hand the mark to the wrong moth.
  const truncated = Boolean(items?.truncated);
  const firstIds = useMemo(
    () => (truncated ? NO_FIRSTS : firstSightingIds(observations)),
    [observations, truncated],
  );

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

  const seasons = useMemo(() => seasonsOf(sessions), [sessions]);
  const firstCountByDate = useMemo(() => {
    const map = new Map();
    for (const s of sessions) map.set(s.date, s.observations.filter((o) => firstIds.has(o.id)).length);
    return map;
  }, [sessions, firstIds]);
  const atLight = observations.length - orphans.length;
  const earliestNight = sessions.length ? sessions[sessions.length - 1].date : null;

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/mothing`}
      headTitle="dame.is mothing"
    >
      {stats && (
        <Figures
          label="Mothing in figures"
          items={[
            {
              key: 'nights',
              value: stats.sessionCount ?? sessions.length,
              label: 'nights',
              note: earliestNight ? `since ${formatNightDate(earliestNight)}` : null,
            },
            {
              key: 'moths',
              value: stats.observationCount,
              label: 'moths',
              note: orphans.length ? `${atLight} at the light, ${orphans.length} by day or untimed` : null,
            },
            {
              key: 'species',
              value: stats.speciesCount,
              label: 'species',
              note:
                stats.distinctTaxaCount > stats.speciesCount
                  ? `${stats.distinctTaxaCount} taxa, counting genera`
                  : null,
            },
          ]}
        />
      )}

      {!ledger && stats?.topSpecies?.length > 0 && (
        <MostSeen top={stats.topSpecies} observations={observations} onOpen={openLightbox} />
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
          {shownSessions.map((session) => (
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
                  <MothLedgerRow
                    key={obs.id}
                    obs={obs}
                    onOpen={openLightbox}
                    first={firstIds.has(obs.id)}
                  />
                ))}
              </ol>
            </section>
          ))}
          {shownOrphans.length > 0 && (
            <section className="feed-day-group">
              <header className="day-section-header">
                <h3 className="day-header">Daytime &amp; untimed</h3>
                <p className="day-header-meta">
                  {orphans.length} observation{orphans.length === 1 ? '' : 's'}
                </p>
              </header>
              <ol className="mothing-ledger reveal-stagger">
                {shownOrphans.map((obs) => (
                  <MothLedgerRow
                    key={obs.id}
                    obs={obs}
                    onOpen={openLightbox}
                    first={firstIds.has(obs.id)}
                  />
                ))}
              </ol>
            </section>
          )}
          <FeedMore {...feedWindow} />
        </div>
      ) : (
        // The almanac: nights grouped by season, newest first, only the
        // current season open. A <details> fold, so find-in-page still opens
        // an older season to find a name.
        <div className="mothing-almanac">
          {seasons.map((season, i) => (
            <details key={season.key} className="mothing-season" open={i === 0}>
              <summary className="mothing-season-head">
                <span className="mothing-season-label">{season.label}</span>
                <span className="mothing-season-range">{season.range}</span>
                <span className="mothing-season-tally">
                  {season.sessions.length} {season.sessions.length === 1 ? 'night' : 'nights'} · {season.moths}{' '}
                  {season.moths === 1 ? 'moth' : 'moths'}
                  <span className="mothing-season-species"> · {season.species} species</span>
                </span>
              </summary>
              <ol className="night-entries">
                {season.sessions.map((s) => (
                  <NightEntry key={s.date} session={s} firstCount={firstCountByDate.get(s.date) || 0} />
                ))}
              </ol>
            </details>
          ))}
          {orphans.length > 0 && (
            <details className="mothing-season">
              <summary className="mothing-season-head">
                <span className="mothing-season-label">Daytime &amp; untimed</span>
                <span className="mothing-season-range">outside any night</span>
                <span className="mothing-season-tally">
                  {orphans.length} {orphans.length === 1 ? 'moth' : 'moths'}
                </span>
              </summary>
              <ul className="mothing-grid">
                {orphans.map((obs) => (
                  <MothTile key={obs.id} obs={obs} onOpen={openLightbox} first={firstIds.has(obs.id)} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {observations.length > 0 && (
        <p className="mothing-switch">
          {ledger ? (
            <button type="button" onClick={() => setView('plates')}>
              &larr; The almanac of nights
            </button>
          ) : (
            <button type="button" onClick={() => setView('index')}>
              Every observation in one ledger &rarr;
            </button>
          )}
        </p>
      )}

      <p className="mothing-source gutter">
        Mirrored from{' '}
        <a href={INATURALIST_URL} target="_blank" rel="noopener noreferrer">
          iNaturalist
        </a>
        .
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
