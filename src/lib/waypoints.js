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
  WAYPOINT_CATEGORIES_DATA,
  WAYPOINT_DESTINATIONS_DATA,
  CATEGORY_ORDER,
} from '@aturi.to/waypoints';
import { resolveHandle } from './atproto.js';

// --- Waypoint policy -------------------------------------------------------
// The upstream catalog returns a URL for nearly every client on every record
// (most non-native apps fall back to a plain profile link), so left unfiltered
// the picker lists ~24 destinations for a single Bluesky post. We trim it to a
// curated set:
//
//   - aturiExplore  — universal raw-record explorer; always offered.
//   - bluesky / reddwarf / anisota — Bluesky clients; offered for Bluesky
//     records (app.bsky.*) and bare profiles / repos.
//   - leaflet / anisotaReader — publication readers; offered for blog and
//     standard-site documents (pub.leaflet.*, site.standard.*).
//   - grain, streamplace, semble, tangled, margin, popfeed, sifa, blento —
//     app-specific; offered only when the record itself is native to that app
//     (its collection sits under the app's own lexicon).
//
// Every other catalog entry (Bluepy, Blacksky, Witchsky, Catsky, Deer,
// Pinkleap, the Aturi universal link, Offprint, pckt, PDSls, atp.tools) is
// intentionally hidden.

const ALWAYS_WAYPOINTS = new Set(['aturiExplore']);
const BLUESKY_CLIENT_WAYPOINTS = new Set(['bluesky', 'reddwarf', 'anisota']);
// App-specific destinations, shown only when the record is native to them.
// The native NSID prefixes come from the catalog's own `expectedCollections`
// (minus the generic `app.bsky.` prefix, so plain Bluesky records don't count).
const NATIVE_WAYPOINTS = new Set([
  'leaflet',
  'anisotaReader',
  'grain',
  'streamplace',
  'semble',
  'tangled',
  'margin',
  'popfeed',
  'sifa',
  'blento',
]);

function isNativeToRecord(id, collection) {
  if (!collection) return false;
  const expected = WAYPOINT_DESTINATIONS_DATA[id]?.expectedCollections || [];
  return expected.some((prefix) => prefix !== 'app.bsky.' && collection.startsWith(prefix));
}

/**
 * Decide whether a waypoint should be offered for a given resolved record,
 * per the site policy above.
 */
function isWaypointAllowed(id, parsed) {
  const collection = parsed?.collection || null;
  if (ALWAYS_WAYPOINTS.has(id)) return true;
  if (BLUESKY_CLIENT_WAYPOINTS.has(id)) {
    return !collection || collection.startsWith('app.bsky.');
  }
  if (NATIVE_WAYPOINTS.has(id)) return isNativeToRecord(id, collection);
  return false;
}

/**
 * Apply the site waypoint policy to a raw resolve result — trimming both the
 * `waypoints` list and the `recommended.ids` to the allowed set.
 */
function applyWaypointPolicy(result) {
  if (!result) return result;
  const waypoints = (result.waypoints || []).filter((w) => isWaypointAllowed(w.id, result.parsed));
  const allowedIds = new Set(waypoints.map((w) => w.id));
  return {
    ...result,
    waypoints,
    recommended: {
      ...result.recommended,
      ids: (result.recommended?.ids || []).filter((id) => allowedIds.has(id)),
    },
  };
}

// Hosts whose links should *automatically* open the "Open in…" picker on a
// plain left-click. We deliberately scope this to Bluesky's own web client
// (bsky.app) only. A bsky.app link is the case where a visitor is most likely
// to prefer opening the record in a *different* client, so it's worth
// interposing the picker. Every other host the catalog can resolve — including
// anisota.net, the other Bluesky forks (deer.social, reddwarf.app, …), and the
// publication readers (leaflet.pub, grain.social, …) — is left to navigate
// natively, since a visitor clicking one of those clearly meant to go there.
// The picker stays reachable for any record via the explicit "Open in…"
// affordance (<AturiActions>), which opens it imperatively regardless of host.
const AUTO_INTERCEPT_HOSTS = new Set(['bsky.app']);

/**
 * Cheap, synchronous test for "should a plain left-click on this link auto-open
 * the waypoints picker?" — true only for a Bluesky (bsky.app) URL the catalog
 * can reverse-parse into a record. Everything else (internal SPA links, other
 * Atmosphere hosts, unrelated external links) returns false so the click falls
 * through to the browser untouched.
 */
export function isAutoWaypointHref(href) {
  if (!href) return false;
  let url;
  try {
    url = new URL(String(href));
  } catch {
    return false;
  }
  // Fast host gate before the (slightly heavier) pattern match.
  if (!AUTO_INTERCEPT_HOSTS.has(url.hostname)) return false;
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
  if (s.startsWith('at://')) return applyWaypointPolicy(resolveAtUri(s));
  try {
    return applyWaypointPolicy(await resolveUrl(s, { resolveHandle }));
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
