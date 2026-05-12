import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { relativeTime } from '../lib/time.js';
import { ME_DID } from '../config.js';
import './Creating.css';

export default function Creating() {
  const [works, setWorks] = useState([]);
  const [kind, setKind] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot('creations').then((snap) => {
      if (cancelled || !Array.isArray(snap)) return;
      setWorks(
        snap
          .filter((r) => r?.value)
          .sort((a, b) => {
            const ax = a.value?.createdAt || '';
            const bx = b.value?.createdAt || '';
            return ax < bx ? 1 : -1;
          }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const kinds = Array.from(new Set(works.map((r) => r.value?.kind).filter(Boolean)));
  const filtered = kind ? works.filter((r) => r.value?.kind === kind) : works;

  return (
    <PageShell
      verb="creating"
      title={<><span className="gerund">Dame is&hellip;</span> creating</>}
      intro="A portfolio of works — art, software, writing, music, and more."
      atUri={`at://${ME_DID}/is.dame.page/creating`}
      headTitle="Creating — Dame is&hellip;"
    >
      {kinds.length > 1 && (
        <div className="creating-filters">
          <button
            type="button"
            className={`feed-chip ${!kind ? 'is-active' : ''}`}
            onClick={() => setKind(null)}
          >
            <span className="small-caps">all</span>
          </button>
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className={`feed-chip ${kind === k ? 'is-active' : ''}`}
              onClick={() => setKind(k)}
            >
              <span className="small-caps">{k}</span>
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="feed-empty">No works yet.</p>
      ) : (
        <ul className="creating-grid">
          {filtered.map((r, i) => {
            const v = r.value || {};
            const slug = v.slug;
            const thumb = v.media?.find((m) => m?.kind === 'image' && m?.url);
            return (
              <li key={r.uri || i} className="creating-grid-cell">
                <Link to={`/creating/${slug}`} className="creating-grid-link">
                  {thumb ? (
                    <img src={thumb.url} alt={thumb.alt || ''} loading="lazy" />
                  ) : (
                    <div className="creating-grid-placeholder" aria-hidden="true">&#x2767;</div>
                  )}
                  <div className="creating-grid-meta">
                    <span className="small-caps creating-grid-kind">{v.kind}</span>
                    <h3 className="creating-grid-title">{v.title || slug}</h3>
                    {v.createdAt && <span className="gutter">{relativeTime(v.createdAt)}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
