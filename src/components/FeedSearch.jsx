import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import './FeedFilters.css';

/**
 * Search input synced to the URL `?q=` param. Used on the main feed
 * (inside FeedFilters) and on each verb page.
 */
export default function FeedSearch({ placeholder = 'search', label = 'Search' }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';

  function setQ(value) {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (value) out.set('q', value);
        else out.delete('q');
        return out;
      },
      { replace: true },
    );
  }

  return (
    <div className="feed-search">
      <Search size={14} aria-hidden="true" className="feed-search-icon" />
      <input
        type="search"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={label}
      />
      {q && (
        <button
          type="button"
          className="feed-search-clear"
          onClick={() => setQ('')}
          aria-label="Clear search"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * Lowercase substring match. Returns true when `q` is empty.
 */
export function matchesQuery(text, q) {
  const needle = (q || '').trim().toLowerCase();
  if (!needle) return true;
  return String(text || '').toLowerCase().includes(needle);
}
