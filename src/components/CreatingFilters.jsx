import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import Modal from './Modal.jsx';
import { useFeedFilter, useRegisterFeedFilter } from '../hooks/useFeedFilter.jsx';
import { matchesQuery } from './FeedSearch.jsx';
import './FeedFilters.css';

/**
 * Filter modal host for the /creating portfolio. Mirrors PostingFilters
 * — the available "kinds" (project categories) are derived from the
 * loaded records since the registry doesn't enumerate them, then
 * surfaced as toggleable chips inside the chrome-bar filter modal.
 */
export default function CreatingFilters({ kinds, counts }) {
  const [params, setParams] = useSearchParams();
  const { open, closeModal } = useFeedFilter();
  useRegisterFeedFilter();

  const active = resolveActiveKinds(params, kinds);
  const usingDefaults = !params.has('kinds');
  const allActive = !usingDefaults && active.size === kinds.length;
  const noneActive = !usingDefaults && active.size === 0;

  function setKinds(next) {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('kinds', Array.from(next).join(','));
      return out;
    }, { replace: true });
  }

  function toggleKind(k) {
    const next = new Set(active);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setKinds(next);
  }

  function selectAll() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('kinds', '');
      return out;
    }, { replace: true });
  }

  function selectNone() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('kinds', '__none__');
      return out;
    }, { replace: true });
  }

  function resetToDefault() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete('kinds');
      return out;
    }, { replace: true });
  }

  // Nothing to filter by — don't register or render. The chrome-bar
  // filter button will stay hidden.
  if (!kinds || kinds.length < 2) return null;

  return (
    <Modal
      open={open}
      onClose={closeModal}
      label="Filter projects"
      className="feed-filter-modal-panel"
      scrimLabel="Close filter"
    >
      <div className="feed-filter-modal-header">
        <span className="small-caps">filter by kind</span>
        <button
          type="button"
          className="feed-filter-modal-close"
          onClick={closeModal}
          aria-label="Close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="feed-filter-modal-quick" role="group" aria-label="Quick selection">
        <button
          type="button"
          className={`feed-filter-quick-pill ${allActive ? 'is-active' : ''}`}
          onClick={selectAll}
        >
          <span className="small-caps">show all</span>
        </button>
        <button
          type="button"
          className={`feed-filter-quick-pill ${noneActive ? 'is-active' : ''}`}
          onClick={selectNone}
        >
          <span className="small-caps">show none</span>
        </button>
        <button
          type="button"
          className={`feed-filter-quick-pill ${usingDefaults ? 'is-active' : ''}`}
          onClick={resetToDefault}
        >
          <span className="small-caps">defaults</span>
        </button>
      </div>
      <div className="feed-chips" role="group" aria-label="Filter by kind">
        {kinds.map((k) => {
          const a = active.has(k);
          const count = counts?.[k];
          return (
            <div key={k} className={`feed-chip-wrap ${a ? 'is-active' : ''}`}>
              <button
                type="button"
                className="feed-chip feed-chip-toggle"
                onClick={() => toggleKind(k)}
                aria-pressed={a}
              >
                <span className="feed-chip-label small-caps">{k}</span>
                {typeof count === 'number' && (
                  <span className="feed-chip-count gutter">{count}</span>
                )}
              </button>
              <button
                type="button"
                className="feed-chip-only"
                onClick={() => setKinds(new Set([k]))}
                aria-label={`Show only ${k}`}
                title={`Show only ${k}`}
              >
                <span className="small-caps">only</span>
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export function resolveActiveKinds(params, allKinds) {
  const all = Array.isArray(allKinds) ? allKinds : [];
  if (!params.has('kinds')) return new Set(all);
  const value = params.get('kinds') || '';
  if (value === '__none__') return new Set();
  const raw = value.split(',').filter(Boolean);
  if (raw.length === 0) return new Set(all);
  return new Set(raw);
}

export function filterCreatingItems(items, params, allKinds) {
  const active = resolveActiveKinds(params, allKinds);
  const q = (params.get('q') || '').trim().toLowerCase();
  return items.filter((r) => {
    const v = r?.value || {};
    const category = v.category || v.kind;
    if (category && !active.has(category)) return false;
    const haystack = [
      v.title,
      v.summary,
      v.body,
      category,
      v.slug,
      ...(Array.isArray(v.tags) ? v.tags : []),
    ]
      .filter(Boolean)
      .join(' ');
    return matchesQuery(haystack, q);
  });
}
