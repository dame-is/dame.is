import { useSearchParams } from 'react-router-dom';
import { FileText, Image, Link, Quote, Reply, X } from 'lucide-react';
import Modal from './Modal.jsx';
import { useFeedFilter, useRegisterFeedFilter } from '../hooks/useFeedFilter.jsx';
import { matchesQuery } from './FeedSearch.jsx';
import './FeedFilters.css';

const NONE_SENTINEL = '__none__';

const POSTING_TYPES = ['reply', 'image', 'link', 'quote', 'text'];
// Default: hide replies, show everything else. Mirrors the home feed's
// reply-hiding default.
const POSTING_TYPES_DEFAULT = ['image', 'link', 'quote', 'text'];

const TYPE_LABELS = {
  reply: 'replies',
  image: 'images',
  link: 'links',
  quote: 'quotes',
  text: 'text only',
};

const TYPE_ICONS = {
  reply: Reply,
  image: Image,
  link: Link,
  quote: Quote,
  text: FileText,
};

/**
 * Filter modal host for the /posting page. Mirrors the FeedFilters
 * pattern: registers with the chrome bar's filter trigger and renders
 * its own Modal when the trigger is tapped. Filters are sub-types of
 * the same `posting` verb (replies, image posts, link posts, quote
 * posts, plain text), not separate verbs.
 */
export default function PostingFilters({ counts }) {
  const [params, setParams] = useSearchParams();
  const { open, closeModal } = useFeedFilter();
  useRegisterFeedFilter();

  const activeTypes = resolveActivePostingTypes(params);
  const usingDefaults = !params.has('postTypes');

  function toggleType(t) {
    const next = new Set(activeTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setTypes(next);
  }

  function setTypes(types) {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('postTypes', Array.from(types).join(','));
      return out;
    }, { replace: true });
  }

  function selectAll() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('postTypes', '');
      return out;
    }, { replace: true });
  }

  function selectNone() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('postTypes', NONE_SENTINEL);
      return out;
    }, { replace: true });
  }

  function resetToDefault() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete('postTypes');
      return out;
    }, { replace: true });
  }

  const allActive = !usingDefaults && activeTypes.size === POSTING_TYPES.length;
  const noneActive = !usingDefaults && activeTypes.size === 0;

  return (
    <Modal
      open={open}
      onClose={closeModal}
      label="Filter posts"
      className="feed-filter-modal-panel"
      scrimLabel="Close filter"
    >
      <div className="feed-filter-modal-header">
        <span className="small-caps">filter by post type</span>
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
      <div className="feed-chips" role="group" aria-label="Filter by post type">
        {POSTING_TYPES.map((t) => {
          const active = activeTypes.has(t);
          const count = counts?.[t];
          const Icon = TYPE_ICONS[t];
          return (
            <div
              key={t}
              className={`feed-chip-wrap ${active ? 'is-active' : ''}`}
            >
              <button
                type="button"
                className="feed-chip feed-chip-toggle"
                onClick={() => toggleType(t)}
                aria-pressed={active}
              >
                {Icon && <Icon size={13} className="feed-chip-icon" aria-hidden="true" strokeWidth={1.75} />}
                <span className="feed-chip-label small-caps">{TYPE_LABELS[t]}</span>
                {typeof count === 'number' && (
                  <span className="feed-chip-count gutter">{count}</span>
                )}
              </button>
              <button
                type="button"
                className="feed-chip-only"
                onClick={() => setTypes(new Set([t]))}
                aria-label={`Show only ${TYPE_LABELS[t]}`}
                title={`Show only ${TYPE_LABELS[t]}`}
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

/**
 * Categorize a posting item into the set of sub-types it satisfies.
 * Returns `null` for non-posting items (they're not filterable here).
 * A post can match multiple types (a reply with an image is both
 * `reply` and `image`); the filter shows the post if ANY of its
 * categories is enabled.
 */
export function postingCategories(item) {
  if (item?.verb !== 'posting') return null;
  const payload = item.payload || {};
  const embed = payload.embed || payload.embedRecord || null;
  const type = embed?.$type || '';
  const cats = new Set();
  if (payload.reply?.parent?.uri) cats.add('reply');
  if (type.startsWith('app.bsky.embed.images') || type.startsWith('app.bsky.embed.recordWithMedia')) {
    cats.add('image');
  }
  if (type.startsWith('app.bsky.embed.external')) cats.add('link');
  if (type.startsWith('app.bsky.embed.record')) cats.add('quote');
  if (cats.size === 0) cats.add('text');
  return cats;
}

export function resolveActivePostingTypes(params) {
  if (!params.has('postTypes')) return new Set(POSTING_TYPES_DEFAULT);
  const value = params.get('postTypes') || '';
  if (value === NONE_SENTINEL) return new Set();
  const raw = value.split(',').filter(Boolean);
  if (raw.length === 0) return new Set(POSTING_TYPES);
  return new Set(raw);
}

export function filterPostingItems(items, params) {
  const active = resolveActivePostingTypes(params);
  const q = (params.get('q') || '').trim().toLowerCase();
  return items.filter((item) => {
    const cats = postingCategories(item);
    if (!cats) return false;
    let pass = false;
    for (const c of cats) {
      if (active.has(c)) {
        pass = true;
        break;
      }
    }
    if (!pass) return false;
    if (!q) return true;
    return matchesQuery(item.payload?.text, q);
  });
}
