import { useMemo, useState } from 'react';
import PageShell from '../components/PageShell.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { fetchMothData, photoUrl } from '../lib/inaturalist.js';
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

const QUALITY_LABEL = {
  research: 'Research grade',
  needs_id: 'Needs ID',
  casual: 'Casual',
};

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
      <a
        className="mothing-link"
        href={obs.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {src ? (
          <img src={src} alt={obs.taxon?.commonName || obs.taxon?.name || 'Moth observation'} loading="lazy" />
        ) : (
          <div className="mothing-placeholder" aria-hidden="true">&#x1F98B;</div>
        )}
        <div className="mothing-meta">
          <h3 className="mothing-name">{title}</h3>
          {showSci && <span className="mothing-sci">{sci}</span>}
          <span className="gutter mothing-sub">
            {obs.observedDate ? formatDate(obs.observedDate) : ''}
            {obs.qualityGrade === 'research' ? ' · Research grade' : ''}
          </span>
        </div>
      </a>
    </li>
  );
}

export default function Mothing() {
  const { title, intro } = usePageContent('mothing');
  const [gradeFilter, setGradeFilter] = useState('all');

  const { items, status } = useLiveFeed({
    name: 'mothing',
    strategy: 'snapshot-first',
    fetchLive: () => fetchMothData({ user: INATURALIST_USER }),
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

  const filtered = useMemo(() => {
    if (gradeFilter === 'all') return observations;
    const want = gradeFilter === 'research' ? 'research' : gradeFilter === 'needsId' ? 'needs_id' : 'casual';
    return observations.filter((o) => o.qualityGrade === want);
  }, [observations, gradeFilter]);

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

      {observations.length > 0 && (
        <div className="mothing-filters" role="group" aria-label="Filter by quality grade">
          {[
            { key: 'all', label: `All ${stats?.observationCount ? `(${stats.observationCount})` : ''}`.trim() },
            { key: 'research', label: `Research${grades.research ? ` (${grades.research})` : ''}` },
            { key: 'needsId', label: `Needs ID${grades.needsId ? ` (${grades.needsId})` : ''}` },
            { key: 'casual', label: `Casual${grades.casual ? ` (${grades.casual})` : ''}` },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              className={`mothing-filter${gradeFilter === f.key ? ' is-active' : ''}`}
              onClick={() => setGradeFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {loading && observations.length === 0 ? (
        <p className="placeholder-card">Loading moths&hellip;</p>
      ) : filtered.length === 0 ? (
        <p className="feed-empty">
          {observations.length === 0
            ? 'No moth observations yet.'
            : 'No observations match that filter.'}
        </p>
      ) : (
        <ul className="mothing-grid reveal-stagger">
          {filtered.map((obs) => (
            <MothCard key={obs.id} obs={obs} />
          ))}
        </ul>
      )}

      <p className="mothing-source gutter">
        Mirrored from{' '}
        <a href={stats?.profileUrl || `https://www.inaturalist.org/people/${INATURALIST_USER}`} target="_blank" rel="noopener noreferrer">
          iNaturalist
        </a>
        . Location data is intentionally omitted.
      </p>
    </PageShell>
  );
}
