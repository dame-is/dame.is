import { useMemo } from 'react';
import { useLiveFeed } from './useLiveFeed.js';
import { resolvePds, getRecord } from '../lib/atproto.js';
import { renderMarkdown } from '../lib/markdown.js';
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
 *   { title, intro, html, source: 'pds' | 'local', loading }
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
  const html = useMemo(() => {
    const body = record ? v.body : def.body;
    const fmt = (record ? v.bodyFormat : def.bodyFormat) || 'markdown';
    return body ? renderMarkdown(body, fmt) : '';
  }, [record, v.body, v.bodyFormat, def.body, def.bodyFormat]);

  return {
    title: v.title || def.title,
    intro: v.intro || def.intro,
    html,
    source: record ? 'pds' : 'local',
    loading: status === 'loading',
  };
}
