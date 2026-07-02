import { useMemo } from 'react';
import PageShell from '../components/PageShell.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { fetchMothData, fetchMothSignature, photoUrl, buildSessions } from '../lib/inaturalist.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { ME_DID, INATURALIST_USER } from '../config.js';
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

function MothCard({ obs }) {
  const photo = obs.photos?.[0];
  const src = photo ? photoUrl(photo, 'medium') : null;
  const title = obs.taxon?.commonName || obs.taxon?.name || 'Unidentified moth';
  const sci = obs.taxon?.name;
  const showSci = sci && sci !== title;
  return (
    <li className="mothing-cell">
      <a className="mothing-link" href={obs.url} target="_blank" rel="noopener noreferrer">
        {src ? (
          <img src={src} alt={title} loading="lazy" />
        ) : (
          <div className="mothing-placeholder" aria-hidden="true">&#x1F98B;</div>
        )}
        <div className="mothing-meta">
          <h3 className="mothing-name">{title}</h3>
          {showSci && <span className="mothing-sci">{sci}</span>}
          <span className="gutter mothing-sub">
            {obs.observedTime ? formatTime(obs.observedTime) : formatDate(obs.observedDate)}
            {obs.qualityGrade === 'research' ? ' · Research grade' : ''}
          </span>
        </div>
      </a>
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

export default function Mothing() {
  const { title, intro } = usePageContent('mothing');

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
  const grades = stats?.qualityGrades || {};

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/mothing`}
      headTitle="Mothing — Dame is&hellip;"
    >
      {stats && (
        <section className="mothing-stats" aria-label="Mothing stats">
          <StatBlock value={stats.sessionCount ?? sessions.length} label="sessions" />
          <StatBlock value={stats.observationCount} label="observations" />
          <StatBlock value={stats.speciesCount} label="species" />
          <StatBlock value={grades.research} label="research grade" />
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
        <p className="placeholder-card">Loading moths&hellip;</p>
      ) : observations.length === 0 ? (
        <p className="feed-empty">No moth observations yet.</p>
      ) : (
        <div className="mothing-sessions">
          {sessions.map((session) => (
            <section key={session.date} className="mothing-session">
              <SessionHeader session={session} />
              <ul className="mothing-grid reveal-stagger">
                {session.observations.map((obs) => (
                  <MothCard key={obs.id} obs={obs} />
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
                  <MothCard key={obs.id} obs={obs} />
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
    </PageShell>
  );
}
