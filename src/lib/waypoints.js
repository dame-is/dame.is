// Thin wrapper around @aturi.to/waypoints — the MIT-licensed core catalog and
// resolver that powers aturi.to. We use it to turn an outbound Bluesky /
// Atmosphere link (or a bare `at://` URI) into the list of clients that can
// open the same record, so a visitor can pick their own client rather than
// being forced onto whatever host the link happened to point at.
//
// The React picker (@aturi.to/waypoints-react) ships its own components + CSS;
// we intentionally use the zero-dependency core instead and render the picker
// with the site's own <Modal> so it matches the design system exactly.

import {
  matchSupportedUrl,
  resolveAtUri,
  resolveUrl,
  SUPPORTED_HOSTS,
  WAYPOINT_CATEGORIES_DATA,
  CATEGORY_ORDER,
} from '@aturi.to/waypoints';
import { resolveHandle } from './atproto.js';

const SUPPORTED_HOST_SET = new Set(SUPPORTED_HOSTS);

/**
 * Cheap, synchronous test for "is this a link the waypoints modal should
 * intercept?" — a bare `at://` URI, or a URL on one of the Atmosphere hosts
 * the catalog knows how to reverse-parse into a record. Everything else
 * (internal SPA links, unrelated external links) returns false so the click
 * falls through to the browser untouched.
 */
export function isWaypointHref(href) {
  if (!href) return false;
  const s = String(href);
  if (s.startsWith('at://')) return true;
  let url;
  try {
    url = new URL(s);
  } catch {
    return false;
  }
  // Fast host gate before the (slightly heavier) pattern match.
  if (!SUPPORTED_HOST_SET.has(url.hostname)) return false;
  try {
    return matchSupportedUrl(url) != null;
  } catch {
    return false;
  }
}

/**
 * Resolve an outbound link (or `at://` URI) into its waypoints. `at://` URIs
 * resolve offline; page URLs use the offline pattern matcher plus the site's
 * own `resolveHandle` so DID-only destinations (Grain, PDSls, Margin, …) are
 * included when the handle resolves. Returns `null` when the input can't be
 * mapped to a record.
 */
export async function resolveWaypoints(href) {
  const s = String(href || '');
  if (s.startsWith('at://')) return resolveAtUri(s);
  try {
    return await resolveUrl(s, { resolveHandle });
  } catch {
    return null;
  }
}

/**
 * Shape a raw `ResolveResult` into the sections the modal renders:
 *   - `recommended`  — the recommended waypoints, in the catalog's order.
 *   - `groups`       — the remaining waypoints bucketed by display category,
 *                      in `CATEGORY_ORDER`, with recommended ones removed so
 *                      nothing appears twice.
 * Empty groups are dropped.
 */
export function groupWaypoints(result) {
  if (!result) return { recommended: [], recommendedLabel: '', groups: [] };
  const byId = new Map(result.waypoints.map((w) => [w.id, w]));
  const recommendedIds = (result.recommended?.ids || []).filter((id) => byId.has(id));
  const recommended = recommendedIds.map((id) => byId.get(id));
  const recommendedSet = new Set(recommendedIds);

  const groups = CATEGORY_ORDER.map((catId) => ({
    id: catId,
    name: WAYPOINT_CATEGORIES_DATA[catId]?.name || catId,
    waypoints: result.waypoints.filter(
      (w) => w.category === catId && !recommendedSet.has(w.id),
    ),
  })).filter((g) => g.waypoints.length > 0);

  return {
    recommended,
    recommendedLabel: result.recommended?.label || 'Recommended',
    groups,
  };
}

/**
 * A short, human label for the resolved record — e.g. "Post by alice.bsky.social".
 * Used as the modal's subtitle. Falls back gracefully when parts are missing.
 */
export function describeResolved(result) {
  const parsed = result?.parsed;
  if (!parsed) return '';
  const typeLabel =
    { post: 'Post', profile: 'Profile', list: 'List', record: 'Record' }[parsed.type] ||
    'Record';
  const who = parsed.handle && !parsed.handle.startsWith('did:') ? parsed.handle : parsed.did;
  return who ? `${typeLabel} · ${who}` : typeLabel;
}
