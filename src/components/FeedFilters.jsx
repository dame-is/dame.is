import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { VERBS } from '../config.js';
import VerbIcon from './VerbIcon.jsx';
import './FeedFilters.css';

/**
 * Verb-chip multi-select + free-text search, both synced to URL params:
 *   ?verbs=posting,blogging&q=mothing
 */
export default function FeedFilters({ counts }) {
  const [params, setParams] = useSearchParams();
  const activeVerbs = new Set((params.get('verbs') || '').split(',').filter(Boolean));
  const q = params.get('q') || '';

  function toggleVerb(v) {
    const next = new Set(activeVerbs);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      if (next.size === 0) out.delete('verbs');
      else out.set('verbs', Array.from(next).join(','));
      return out;
    }, { replace: true });
  }

  function setQ(value) {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      if (value) out.set('q', value);
      else out.delete('q');
      return out;
    }, { replace: true });
  }

  return (
    <div className="feed-filters">
      <div className="feed-chips" role="group" aria-label="Filter by verb">
        {VERBS.map((v) => {
          const active = activeVerbs.has(v);
          const count = counts?.[v];
          return (
            <button
              key={v}
              type="button"
              className={`feed-chip ${active ? 'is-active' : ''}`}
              onClick={() => toggleVerb(v)}
              aria-pressed={active}
            >
              <VerbIcon verb={v} size={13} className="feed-chip-icon" />
              <span className="feed-chip-label small-caps">{v}</span>
              {typeof count === 'number' && <span className="feed-chip-count gutter">{count}</span>}
            </button>
          );
        })}
        {activeVerbs.size > 0 && (
          <button
            type="button"
            className="feed-chip feed-chip-clear"
            onClick={() => setParams((prev) => { const o = new URLSearchParams(prev); o.delete('verbs'); return o; }, { replace: true })}
          >
            <X size={13} aria-hidden="true" className="feed-chip-icon" />
            <span className="small-caps">clear</span>
          </button>
        )}
      </div>
      <div className="feed-search">
        <Search size={14} aria-hidden="true" className="feed-search-icon" />
        <input
          type="search"
          placeholder="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search the feed"
        />
        {q && (
          <button type="button" className="feed-search-clear" onClick={() => setQ('')} aria-label="Clear search">
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Filter helper used by Home.jsx.
 */
export function filterFeed(items, params) {
  const verbs = (params.get('verbs') || '').split(',').filter(Boolean);
  const q = (params.get('q') || '').trim().toLowerCase();
  return items.filter((item) => {
    if (verbs.length && !verbs.includes(item.verb)) return false;
    if (!q) return true;
    const hay = textForMatch(item).toLowerCase();
    return hay.includes(q);
  });
}

function textForMatch(item) {
  const p = item.payload || {};
  return [
    p.text,
    p.status,
    p.title,
    p.summary,
    p.body,
    p.trackName,
    Array.isArray(p.artists) ? p.artists.map((a) => a?.artistName).join(' ') : '',
    p.releaseName,
  ]
    .filter(Boolean)
    .join(' ');
}
