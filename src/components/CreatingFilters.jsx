import { useSearchParams } from 'react-router-dom';
import FilterIndex, { FilterMeta, FilterQuick } from './FilterIndex.jsx';
import { formatFilterCount, kindsSummary } from '../lib/filterCounts.js';
import BottomSheet from './BottomSheet.jsx';
import { useRegisterFeedFilter } from '../hooks/useFeedFilter.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { matchesQuery } from './FeedSearch.jsx';
import { workCategory, workSlug } from '../lib/publications.js';
import './FeedFilters.css';

// "Show none" — distinct from an empty `kinds=`, which reads as all of them.
const NONE_SENTINEL = '__none__';

/**
 * Filter modal host for the /creating portfolio. Mirrors PostingFilters
 * — the available "kinds" (project categories) are derived from the
 * loaded records since the registry doesn't enumerate them, then
 * surfaced as toggleable chips inside the chrome-bar filter modal.
 *
 * Nothing to filter by (still loading, or fewer than two kinds) means
 * neither registering nor rendering, so the chrome-bar filter button stays
 * hidden rather than showing a button with no sheet behind it. The
 * registration lives in the sheet for that reason: a hook can't sit behind
 * the early return.
 */
export default function CreatingFilters({ kinds, counts }) {
  if (!kinds || kinds.length < 2) return null;
  return <CreatingFilterSheet kinds={kinds} counts={counts} />;
}

function CreatingFilterSheet({ kinds, counts }) {
  const [params, setParams] = useSearchParams();
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'filter';
  useRegisterFeedFilter();

  const active = resolveActiveKinds(params, kinds);
  const usingDefaults = !params.has('kinds');
  const allActive = !usingDefaults && active.size === kinds.length;
  const noneActive = !usingDefaults && active.size === 0;

  function setKinds(next) {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('kinds', kindsParamValue(next));
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
      out.set('kinds', NONE_SENTINEL);
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

  return (
    <BottomSheet
      open={open}
      onClose={closePanel}
      title="Filter projects"
      meta={<FilterMeta summary={kindsSummary(active.size, kinds.length)} defaults={usingDefaults} />}
      actions={
        <FilterQuick
          all={allActive}
          none={noneActive}
          defaults={usingDefaults}
          onAll={selectAll}
          onNone={selectNone}
          onDefaults={resetToDefault}
        />
      }
      id="chrome-filter-sheet"
      className="feed-filter-sheet-panel"
      bodyClassName="filter-sheet-content"
    >
      <FilterIndex
        label="Filter by kind"
        groups={[
          {
            key: 'kinds',
            items: kinds.map((k) => ({
              key: k,
              label: k,
              on: active.has(k),
              count: formatFilterCount({ count: counts?.[k] }),
            })),
          },
        ]}
        onToggle={toggleKind}
        onOnly={(k) => setKinds(new Set([k]))}
      />
    </BottomSheet>
  );
}

/**
 * The `kinds` param for a set of active kinds. Switching off the last chip
 * leaves an empty set, and an empty value means "all" (it's what "show all"
 * writes), so the empty set is spelled with the sentinel instead — otherwise
 * clearing the last kind would bring every project back.
 */
export function kindsParamValue(kinds) {
  const list = Array.from(kinds || []);
  return list.length ? list.join(',') : NONE_SENTINEL;
}

export function resolveActiveKinds(params, allKinds) {
  const all = Array.isArray(allKinds) ? allKinds : [];
  if (!params.has('kinds')) return new Set(all);
  const value = params.get('kinds') || '';
  if (value === NONE_SENTINEL) return new Set();
  const raw = value.split(',').filter(Boolean);
  if (raw.length === 0) return new Set(all);
  return new Set(raw);
}

export function filterCreatingItems(items, params, allKinds) {
  const active = resolveActiveKinds(params, allKinds);
  const q = (params.get('q') || '').trim().toLowerCase();
  return items.filter((r) => {
    const v = r?.value || {};
    const category = workCategory(v);
    if (category && !active.has(category)) return false;
    const haystack = [
      v.title,
      v.summary,
      v.description,
      v.body,
      category,
      workSlug(v),
      ...(Array.isArray(v.tags) ? v.tags : []),
    ]
      .filter(Boolean)
      .join(' ');
    return matchesQuery(haystack, q);
  });
}
