import { useLiveFeed } from './useLiveFeed.js';
import { resolvePds, getRecord } from '../lib/atproto.js';
import { pageDefault } from '../lib/pageRegistry.js';
import { ME_DID, COLLECTIONS } from '../config.js';

// Sentinel returned when there is no `is.dame.page/<slug>` record — distinct
// from `null` (which keeps `useLiveFeed` in its loading state) so a genuinely
// local page resolves to a 'ready' fallback instead of an error.
const LOCAL = { __local: true };

/**
 * Resolve a page's chrome (title / intro / body) from the PDS when an
 * `is.dame.page/<slug>` record exists, otherwise fall back to the hardcoded
 * defaults in `pageRegistry`. Mirrors the snapshot-first pattern used by the
 * content pages so first paint comes from the snapshot and live confirms.
 *
 *   { title, intro, body, bodyFormat, source: 'pds' | 'local', loading }
 *
 * The body comes back as written, not rendered: the chrome's info sheet calls
 * this from the entry bundle, and marked is too big to ship there for a sheet
 * most visits never open. Render it with lib/markdown.js where it is shown.
 */
export function usePageContent(slug) {
  const def = pageDefault(slug) || {};

  const { items, status } = useLiveFeed({
    name: 'pages',
    strategy: 'snapshot-first',
    deps: [slug],
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      try {
        return await getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.page, rkey: slug });
      } catch {
        // A missing record throws; treat it as "this page is local".
        return LOCAL;
      }
    },
    mapItems: (data) => {
      if (!data) return null;
      if (data.__local) return data; // explicit "no record" sentinel
      if (data.uri || data.value) return data; // live getRecord shape
      if (data[slug]) return data[slug]; // snapshot shape: { [slug]: record }
      return LOCAL; // snapshot present but no entry for this slug
    },
  });

  const record = items && (items.uri || items.value) ? items : null;
  const v = record?.value || {};

  // When a PDS record exists, its body wins (even if empty — the owner may
  // have deliberately cleared it). Otherwise fall back to the local default
  // body so pages authored entirely in the registry (e.g. the info sheet)
  // still render before/without a migration.
  return {
    title: v.title || def.title,
    intro: v.intro || def.intro,
    body: (record ? v.body : def.body) || '',
    bodyFormat: (record ? v.bodyFormat : def.bodyFormat) || 'markdown',
    source: record ? 'pds' : 'local',
    loading: status === 'loading',
  };
}
