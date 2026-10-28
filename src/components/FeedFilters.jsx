import { useSearchParams } from 'react-router-dom';
import { VERBS, VERB_GROUPS, DEFAULT_HOME_VERBS, verbConfig } from '../lib/verbRegistry.js';
import { selfThreadMembers } from '../lib/threadGrouping.js';
import { playArtistNames } from '../lib/teal.js';
import { formatFilterCount, kindsSummary } from '../lib/filterCounts.js';
import BottomSheet from './BottomSheet.jsx';
import FilterIndex, { FilterMeta, FilterQuick } from './FilterIndex.jsx';
import { useRegisterFeedFilter } from '../hooks/useFeedFilter.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import './FeedFilters.css';

// Sentinel for "show none" so an empty `verbs=` doesn't resolve back to
// "all" (resolveActiveVerbs treats no-value-after-equals as a power-user
// "show everything" shortcut).
const NONE_SENTINEL = '__none__';

// Virtual filter category: replies to others (or standalone self-
// replies that don't participate in a visible thread) read as their
// own first-class chip even though the underlying records still carry
// the `posting` verb. Including it here lets the chip share the same
// toggle / "only" / count machinery as real verbs.
const REPLYING = 'replying';
const FILTER_KEYS = [REPLYING, ...VERBS];

/**
 * Verb-filter modal host. Renders nothing visible itself — the trigger
 * lives in the bottom chrome bar. Mounting this component registers the
 * filter affordance with the context so the chrome bar knows to show
 * its filter button while the host is on screen.
 *
 * The sheet is an index of the seventeen kinds under four heads (FEED-08).
 * `counts` are per kind; `estimatedVerbs` came from the snapshot rather
 * than a live fetch, and `cappedVerbs` hit `fetchCap` on their first
 * fetch, so they print as "100+" rather than as a total.
 */
export default function FeedFilters({ counts, estimatedVerbs, cappedVerbs, fetchCap = 100 }) {
  const [params, setParams] = useSearchParams();
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'filter';
  useRegisterFeedFilter();

  const activeVerbs = resolveActiveVerbs(params);
  const usingDefaults = !params.has('verbs');

  function toggleVerb(v) {
    const next = new Set(activeVerbs);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setVerbs(next);
  }

  function setVerbs(verbs) {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      // Always write the explicit list once the user starts toggling, so
      // their choice doesn't drift if we ever change the defaults.
      out.set('verbs', verbsParamValue(verbs));
      return out;
    }, { replace: true });
  }

  function selectAll() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      // Empty value is the resolver's "all" shortcut — keeps the URL
      // short instead of spelling out every verb in the list.
      out.set('verbs', '');
      return out;
    }, { replace: true });
  }

  function selectNone() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      // Sentinel value: explicit "none". Empty list would resolve back to
      // "all" in resolveActiveVerbs, so we use a marker the resolver
      // recognizes.
      out.set('verbs', NONE_SENTINEL);
      return out;
    }, { replace: true });
  }

  function resetToDefault() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete('verbs');
      // Legacy `?replies=all` is no longer wired to anything; clear it
      // on a defaults reset so an old URL doesn't linger forever.
      out.delete('replies');
      return out;
    }, { replace: true });
  }

  return (
    <FilterModal
      open={open}
      activeVerbs={activeVerbs}
      counts={counts}
      estimatedVerbs={estimatedVerbs}
      cappedVerbs={cappedVerbs}
      fetchCap={fetchCap}
      usingDefaults={usingDefaults}
      onToggleVerb={toggleVerb}
      onSelectOnly={(v) => setVerbs(new Set([v]))}
      onSelectAll={selectAll}
      onSelectNone={selectNone}
      onReset={resetToDefault}
      onClose={closePanel}
    />
  );
}

// The replying line has no registry entry of its own (its records are
// posting's), so its place and gloss are set here.
const REPLYING_LINE = { group: 'words', gloss: 'replies to other people' };

/**
 * The index's groups, in VERB_GROUPS order, each holding its verbs in
 * registry order; replying sits straight after posting.
 */
function filterGroups() {
  const byGroup = new Map(VERB_GROUPS.map((g) => [g, []]));
  for (const key of VERBS) {
    const v = verbConfig(key);
    byGroup.get(v?.group || 'social')?.push({ key, gloss: v?.gloss || null });
    if (key === 'posting') byGroup.get(REPLYING_LINE.group).push({ key: REPLYING, gloss: REPLYING_LINE.gloss });
  }
  return VERB_GROUPS.map((g) => ({ key: g, label: g, verbs: byGroup.get(g) })).filter((g) => g.verbs.length);
}

const GROUPS = filterGroups();

function FilterModal({
  open,
  activeVerbs,
  counts,
  estimatedVerbs,
  cappedVerbs,
  fetchCap,
  usingDefaults,
  onToggleVerb,
  onSelectOnly,
  onSelectAll,
  onSelectNone,
  onReset,
  onClose,
}) {
  const allActive = !usingDefaults && activeVerbs.size === FILTER_KEYS.length;
  const noneActive = !usingDefaults && activeVerbs.size === 0;
  const shown = FILTER_KEYS.filter((k) => activeVerbs.has(k)).length;
  // `replying` is a view of posting's records, so it shares posting's cap.
  const capped = (k) => Boolean(cappedVerbs?.has(k === REPLYING ? 'posting' : k));
  const groups = GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: g.verbs.map(({ key, gloss }) => ({
      key,
      label: key,
      gloss,
      on: activeVerbs.has(key),
      count: formatFilterCount({
        count: counts?.[key],
        estimate: estimatedVerbs?.has(key),
        capped: capped(key),
      }),
    })),
  }));
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Filter the ledger"
      meta={<FilterMeta summary={kindsSummary(shown, FILTER_KEYS.length)} defaults={usingDefaults} />}
      actions={
        <FilterQuick
          all={allActive}
          none={noneActive}
          defaults={usingDefaults}
          onAll={onSelectAll}
          onNone={onSelectNone}
          onDefaults={onReset}
        />
      }
      id="chrome-filter-sheet"
      className="feed-filter-sheet-panel"
      bodyClassName="filter-sheet-content"
    >
      <FilterIndex
        label="Kinds of activity"
        groups={groups}
        onToggle={onToggleVerb}
        onOnly={onSelectOnly}
        note={`Counts are what’s loaded: at most the latest ${fetchCap} records from each collection, and a + means there are more. A ~ marks an estimate from the last saved snapshot, and — means not loaded yet.`}
      />
    </BottomSheet>
  );
}

/**
 * The `verbs` param value for an explicit chip selection. An empty selection
 * is written as the "show none" sentinel: an empty value means "all" to
 * resolveActiveVerbs, so switching off the last chip used to switch every
 * verb on — likes and their slow fetch included.
 */
export function verbsParamValue(verbs) {
  const list = Array.from(verbs || []);
  return list.length ? list.join(',') : NONE_SENTINEL;
}

/**
 * Active verbs derived from the URL params. Empty `verbs` param falls
 * back to the registry's default set so the home feed isn't flooded
 * with high-volume reference verbs (likes, votes) on first load.
 *
 * Setting `verbs=` (with no value) is treated as "all enabled" — useful
 * for power users who want to clear the default filtering without
 * picking each chip individually.
 */
export function resolveActiveVerbs(params) {
  if (!params.has('verbs')) return new Set(DEFAULT_HOME_VERBS);
  const value = params.get('verbs') || '';
  if (value === NONE_SENTINEL) return new Set();
  const raw = value.split(',').filter(Boolean);
  if (raw.length === 0) return new Set(FILTER_KEYS);
  return new Set(raw);
}

/**
 * Filter helper used by Home.jsx and any other consumer of the registry
 * unified feed. Honors the same default-verb fallback as the chip UI so
 * the visible feed and the visible chips agree about what's "active".
 *
 * `replying` is a virtual filter key — posts whose `reply.parent` is
 * set count toward Replying instead of Posting, unless they're part of
 * a visible self-reply thread (then they're treated as Posting
 * continuations). Toggling the Replying chip is what controls reply
 * visibility; the legacy `?replies=all` URL param is no longer wired.
 */
export function filterFeed(items, params, myDid = null) {
  const activeVerbs = resolveActiveVerbs(params);
  const q = (params.get('q') || '').trim().toLowerCase();
  const continuing = myDid ? selfThreadMembers(items, myDid) : null;
  return items.filter((item) => {
    if (!passesVerb(item, activeVerbs, continuing)) return false;
    if (!q) return true;
    const hay = textForMatch(item).toLowerCase();
    return hay.includes(q);
  });
}

/**
 * True when `item` belongs to one of the active filter buckets. Posts
 * route through either the `replying` or `posting` bucket depending on
 * whether they're standalone replies; everything else falls back to
 * the verb's own bucket.
 */
function passesVerb(item, activeVerbs, continuing) {
  if (item?.verb === 'posting') {
    const isStandaloneReply =
      Boolean(item.payload?.reply?.parent?.uri) && !continuing?.has(item.atUri);
    return activeVerbs.has(isStandaloneReply ? REPLYING : 'posting');
  }
  return activeVerbs.has(item?.verb);
}

/**
 * Per-bucket counts for the chip badges. Posts split into `replying`
 * (standalone replies) and `posting` (originals + thread
 * continuations); other verbs count themselves.
 */
export function feedFilterCounts(items, myDid = null) {
  const continuing = myDid ? selfThreadMembers(items, myDid) : null;
  const out = {};
  for (const item of items || []) {
    if (item?.verb === 'posting') {
      const isStandaloneReply =
        Boolean(item.payload?.reply?.parent?.uri) && !continuing?.has(item.atUri);
      const k = isStandaloneReply ? REPLYING : 'posting';
      out[k] = (out[k] || 0) + 1;
    } else if (item?.verb) {
      out[item.verb] = (out[item.verb] || 0) + 1;
    }
  }
  return out;
}

function textForMatch(item) {
  const p = item.payload || {};
  const subject = item.subject || {};
  // Subject content (post text, author handle, profile bio, …) is just as
  // searchable as the record's own payload — a like over a post should
  // match if the user types the post's body.
  const subjectView = subject.view || {};
  const subjectAuthor = subjectView.author || subjectView; // post view vs profile view
  const subjectRecord = subjectView.record || subject.record?.value || {};
  return [
    p.text,
    p.status,
    p.title,
    p.summary,
    p.description,
    p.body,
    p.trackName,
    p.displayName,
    p.name,
    playArtistNames(p).join(' '),
    p.releaseName,
    item.source,
    subjectAuthor?.handle,
    subjectAuthor?.displayName,
    subjectRecord?.text,
    subjectRecord?.title,
    subjectRecord?.description,
  ]
    .filter(Boolean)
    .join(' ');
}
