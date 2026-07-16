// Helpers for producing and editing leaflet richtext facets.
//
// Leaflet facets are byte-offset indexed into the UTF-8 encoding of the
// text (not JS-string indices), so anywhere we touch a selection we have
// to convert. See `src/lib/leafletRichText.jsx` for the matching reader.

const ENCODER = new TextEncoder();

/** Number of UTF-8 bytes in the first `charCount` JS chars of `text`. */
export function charsToBytes(text, charCount) {
  if (!text) return 0;
  const clamped = Math.max(0, Math.min(charCount, text.length));
  return ENCODER.encode(text.slice(0, clamped)).length;
}

/** Inverse of charsToBytes: byte offset → JS char offset. */
export function bytesToChars(text, byteOffset) {
  if (!text) return 0;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.codePointAt(i);
    const size =
      ch < 0x80 ? 1 : ch < 0x800 ? 2 : ch < 0x10000 ? 3 : 4;
    if (bytes + size > byteOffset) return i;
    bytes += size;
    if (ch >= 0x10000) i++; // surrogate pair
    if (bytes === byteOffset) return i + 1;
  }
  return text.length;
}

export const FORMAT_TYPES = {
  bold: 'pub.leaflet.richtext.facet#bold',
  italic: 'pub.leaflet.richtext.facet#italic',
  underline: 'pub.leaflet.richtext.facet#underline',
  strikethrough: 'pub.leaflet.richtext.facet#strikethrough',
  code: 'pub.leaflet.richtext.facet#code',
  highlight: 'pub.leaflet.richtext.facet#highlight',
};
export const LINK_TYPE = 'pub.leaflet.richtext.facet#link';

/** Reverse of FORMAT_TYPES: facet $type → short key used in the editor DOM. */
export const KEY_FOR_TYPE = Object.fromEntries(
  Object.entries(FORMAT_TYPES).map(([key, type]) => [type, key]),
);

/**
 * Toggle a feature on/off across a byte range. If every byte in the
 * range already has the feature, it's removed; otherwise it's added.
 *
 * The facet model in leaflet is flat — each facet is a {index, features[]}
 * tuple. To toggle cleanly we re-segment: split the existing facets at
 * the new range boundaries, then add/remove the feature on the segments
 * inside the range, then merge adjacent segments with identical feature
 * sets.
 */
export function toggleFeature(facets, byteStart, byteEnd, feature) {
  if (byteEnd <= byteStart) return facets;
  const segments = facetsToSegments(facets);

  // Split existing segments at byteStart and byteEnd.
  const split = [];
  for (const s of segments) {
    if (s.end <= byteStart || s.start >= byteEnd) {
      split.push(s);
      continue;
    }
    if (s.start < byteStart) {
      split.push({ start: s.start, end: byteStart, features: s.features });
    }
    const innerStart = Math.max(s.start, byteStart);
    const innerEnd = Math.min(s.end, byteEnd);
    split.push({ start: innerStart, end: innerEnd, features: s.features });
    if (s.end > byteEnd) {
      split.push({ start: byteEnd, end: s.end, features: s.features });
    }
  }

  // Fill the gap with bare segments if the range wasn't fully covered.
  const inRange = split.filter((s) => s.start >= byteStart && s.end <= byteEnd);
  // No existing segment overlaps the range at all (e.g. the first mark on a
  // fresh block, or formatting an unformatted region past every facet) — the
  // whole range is a gap, so seed it as one bare segment.
  if (inRange.length === 0) {
    split.push({ start: byteStart, end: byteEnd, features: [] });
  }
  const fillStart = inRange.length ? Math.min(...inRange.map((s) => s.start)) : byteStart;
  const fillEnd = inRange.length ? Math.max(...inRange.map((s) => s.end)) : byteEnd;
  if (fillStart > byteStart) {
    split.push({ start: byteStart, end: fillStart, features: [] });
  }
  if (fillEnd < byteEnd) {
    split.push({ start: fillEnd, end: byteEnd, features: [] });
  }
  // Patch interior gaps between split segments inside the range.
  const sortedRange = split
    .filter((s) => s.start >= byteStart && s.end <= byteEnd)
    .slice()
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < sortedRange.length - 1; i++) {
    if (sortedRange[i].end < sortedRange[i + 1].start) {
      split.push({
        start: sortedRange[i].end,
        end: sortedRange[i + 1].start,
        features: [],
      });
    }
  }

  // Decide add vs remove: if every in-range segment already has the
  // feature, we remove; otherwise we add.
  const inside = split.filter((s) => s.start >= byteStart && s.end <= byteEnd);
  const allHave = inside.length > 0 && inside.every((s) => hasFeature(s.features, feature));
  const next = split.map((s) => {
    if (s.start < byteStart || s.end > byteEnd) return s;
    return {
      start: s.start,
      end: s.end,
      features: allHave ? removeFeature(s.features, feature) : addFeature(s.features, feature),
    };
  });

  return segmentsToFacets(next);
}

/** Add a link feature across a range — replaces any existing link on overlap. */
export function applyLink(facets, byteStart, byteEnd, uri) {
  if (byteEnd <= byteStart || !uri) return facets;
  // Strip any existing link on the range, then add fresh.
  const stripped = toggleFeature(
    toggleFeature(facets, byteStart, byteEnd, { $type: LINK_TYPE }),
    byteStart,
    byteEnd,
    { $type: LINK_TYPE },
  );
  // The double toggle above leaves the range with no link; now apply.
  return applyFeatureAlways(stripped, byteStart, byteEnd, { $type: LINK_TYPE, uri });
}

export function applyFeatureAlways(facets, byteStart, byteEnd, feature) {
  const segments = facetsToSegments(facets);
  const split = [];
  for (const s of segments) {
    if (s.end <= byteStart || s.start >= byteEnd) {
      split.push(s);
      continue;
    }
    if (s.start < byteStart) split.push({ start: s.start, end: byteStart, features: s.features });
    const innerStart = Math.max(s.start, byteStart);
    const innerEnd = Math.min(s.end, byteEnd);
    split.push({ start: innerStart, end: innerEnd, features: addFeature(s.features, feature) });
    if (s.end > byteEnd) split.push({ start: byteEnd, end: s.end, features: s.features });
  }
  // Fill any gap inside the range.
  const inRange = split.filter((s) => s.start >= byteStart && s.end <= byteEnd);
  if (inRange.length === 0) {
    split.push({ start: byteStart, end: byteEnd, features: [feature] });
  } else {
    const sorted = inRange.slice().sort((a, b) => a.start - b.start);
    const first = sorted[0];
    if (first.start > byteStart) split.push({ start: byteStart, end: first.start, features: [feature] });
    const last = sorted[sorted.length - 1];
    if (last.end < byteEnd) split.push({ start: last.end, end: byteEnd, features: [feature] });
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].end < sorted[i + 1].start) {
        split.push({ start: sorted[i].end, end: sorted[i + 1].start, features: [feature] });
      }
    }
  }
  return segmentsToFacets(split);
}

/** Force-remove a feature across a byte range (no toggle semantics). */
export function removeFeatureAlways(facets, byteStart, byteEnd, feature) {
  if (byteEnd <= byteStart) return facets;
  const segments = facetsToSegments(facets);
  const split = [];
  for (const s of segments) {
    if (s.end <= byteStart || s.start >= byteEnd) {
      split.push(s);
      continue;
    }
    if (s.start < byteStart) split.push({ start: s.start, end: byteStart, features: s.features });
    const innerStart = Math.max(s.start, byteStart);
    const innerEnd = Math.min(s.end, byteEnd);
    split.push({ start: innerStart, end: innerEnd, features: removeFeature(s.features, feature) });
    if (s.end > byteEnd) split.push({ start: byteEnd, end: s.end, features: s.features });
  }
  return segmentsToFacets(split);
}

/** Feature $types that cover the ENTIRE [byteStart, byteEnd) range. */
export function featureTypesForRange(facets, byteStart, byteEnd) {
  if (byteEnd <= byteStart) return [];
  const types = new Set();
  for (const f of facets || []) {
    for (const ft of f.features || []) if (ft?.$type) types.add(ft.$type);
  }
  return Array.from(types).filter((t) => rangeFullyCovered(facets, byteStart, byteEnd, t));
}

function rangeFullyCovered(facets, bs, be, type) {
  const intervals = (facets || [])
    .filter((f) => (f.features || []).some((x) => x?.$type === type))
    .map((f) => [Math.max(f.index.byteStart, bs), Math.min(f.index.byteEnd, be)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let cursor = bs;
  for (const [a, b] of intervals) {
    if (a > cursor) return false;
    cursor = Math.max(cursor, b);
    if (cursor >= be) return true;
  }
  return cursor >= be;
}

/**
 * Break text + facets into contiguous runs covering the whole string, each
 * carrying the features active across it. Gap-free, so the editor can render
 * a flat span-per-run structure (and parse it back the same way).
 */
export function facetRuns(text, facets) {
  const safe = typeof text === 'string' ? text : '';
  if (!safe) return [];
  const totalBytes = ENCODER.encode(safe).length;
  const valid = Array.isArray(facets)
    ? facets.filter((f) => f?.index?.byteStart != null && f?.index?.byteEnd != null)
    : [];
  const points = new Set([0, totalBytes]);
  for (const f of valid) {
    if (f.index.byteStart >= 0 && f.index.byteStart <= totalBytes) points.add(f.index.byteStart);
    if (f.index.byteEnd >= 0 && f.index.byteEnd <= totalBytes) points.add(f.index.byteEnd);
  }
  const sorted = Array.from(points).sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const bs = sorted[i];
    const be = sorted[i + 1];
    if (be <= bs) continue;
    const features = [];
    for (const f of valid) {
      if (f.index.byteStart <= bs && f.index.byteEnd >= be) {
        for (const ft of f.features || []) {
          if (ft?.$type && !features.some((x) => x.$type === ft.$type)) features.push(ft);
        }
      }
    }
    runs.push({ text: safe.slice(bytesToChars(safe, bs), bytesToChars(safe, be)), features });
  }
  return runs;
}

/**
 * Inverse of facetRuns: ordered runs whose text concatenates to `text` →
 * merged, gap-free leaflet facets.
 */
export function runsToFacets(text, runs) {
  const safe = typeof text === 'string' ? text : '';
  let charPos = 0;
  const byteSegs = [];
  for (const r of runs || []) {
    const len = r.text ? r.text.length : 0;
    if (len > 0 && Array.isArray(r.features) && r.features.length) {
      byteSegs.push({
        start: charsToBytes(safe, charPos),
        end: charsToBytes(safe, charPos + len),
        features: r.features,
      });
    }
    charPos += len;
  }
  return segmentsToFacets(byteSegs);
}

/**
 * Extract the `[startChar, endChar)` substring of `text` together with the
 * facets that fall within it, re-based to the slice's own byte offsets. Used
 * to split a text block's rich text around the caret when a paste is exploded
 * into blocks (the head keeps what was before the caret, the tail what was
 * after). Returns `{ text, facets }`.
 */
export function sliceRichText(text, facets, startChar, endChar) {
  const safe = typeof text === 'string' ? text : '';
  const start = Math.max(0, Math.min(startChar, safe.length));
  const end = Math.max(start, Math.min(endChar, safe.length));
  const sliceText = safe.slice(start, end);
  if (!sliceText) return { text: '', facets: [] };
  // facetRuns yields gap-free runs whose text concatenates to the whole string;
  // clip each to the window, then rebuild facets against the slice.
  const cut = [];
  let pos = 0;
  for (const run of facetRuns(safe, facets)) {
    const runStart = pos;
    const runEnd = pos + run.text.length;
    pos = runEnd;
    const from = Math.max(runStart, start);
    const to = Math.min(runEnd, end);
    if (to <= from) continue;
    cut.push({ text: run.text.slice(from - runStart, to - runStart), features: run.features });
  }
  return { text: sliceText, facets: runsToFacets(sliceText, cut) };
}

function hasFeature(features, target) {
  return (features || []).some((f) => f?.$type === target.$type);
}

function addFeature(features, target) {
  if (hasFeature(features, target)) {
    // Replace (handles link URI updates).
    return (features || []).map((f) => (f?.$type === target.$type ? target : f));
  }
  return [...(features || []), target];
}

function removeFeature(features, target) {
  return (features || []).filter((f) => f?.$type !== target.$type);
}

/** Flatten facets[] into non-overlapping byte segments. */
function facetsToSegments(facets) {
  if (!Array.isArray(facets) || facets.length === 0) return [];
  // Collect all boundary points.
  const points = new Set();
  for (const f of facets) {
    if (f?.index?.byteStart == null || f?.index?.byteEnd == null) continue;
    points.add(f.index.byteStart);
    points.add(f.index.byteEnd);
  }
  const sorted = Array.from(points).sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === end) continue;
    const features = [];
    for (const f of facets) {
      if (f.index.byteStart <= start && f.index.byteEnd >= end) {
        for (const feat of f.features || []) {
          if (!features.some((x) => x.$type === feat.$type)) features.push(feat);
        }
      }
    }
    segs.push({ start, end, features });
  }
  return segs;
}

/** Inverse of facetsToSegments: merge adjacent segments with identical features. */
function segmentsToFacets(segments) {
  const sorted = segments
    .filter((s) => s.end > s.start && (s.features?.length || 0) > 0)
    .slice()
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.end === s.start && featuresEqual(last.features, s.features)) {
      last.end = s.end;
    } else {
      merged.push({ start: s.start, end: s.end, features: s.features });
    }
  }
  return merged.map((s) => ({
    index: { byteStart: s.start, byteEnd: s.end },
    features: s.features,
  }));
}

function featuresEqual(a, b) {
  if (a.length !== b.length) return false;
  const keys = (arr) =>
    arr
      .map((f) => `${f.$type}|${f.uri || ''}`)
      .sort()
      .join(',');
  return keys(a) === keys(b);
}

/**
 * Recompute facet byte ranges when the text changes. Maps every facet
 * boundary through the diff between old and new text. Facets whose new
 * range collapses to empty are dropped.
 */
export function remapFacets(oldText, newText, facets) {
  if (!Array.isArray(facets) || facets.length === 0) return [];
  if (oldText === newText) return facets;
  // Find common prefix/suffix to bound the edited region.
  let prefixChars = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefixChars < maxPrefix && oldText[prefixChars] === newText[prefixChars]) {
    prefixChars++;
  }
  let suffixChars = 0;
  const maxSuffix = Math.min(oldText.length - prefixChars, newText.length - prefixChars);
  while (
    suffixChars < maxSuffix &&
    oldText[oldText.length - 1 - suffixChars] === newText[newText.length - 1 - suffixChars]
  ) {
    suffixChars++;
  }
  const prefixBytesOld = charsToBytes(oldText, prefixChars);
  const oldEndChars = oldText.length - suffixChars;
  const prefixBytesNew = charsToBytes(newText, prefixChars);
  const newEndChars = newText.length - suffixChars;
  const oldDeletedBytes = charsToBytes(oldText, oldEndChars) - prefixBytesOld;
  const newInsertedBytes = charsToBytes(newText, newEndChars) - prefixBytesNew;
  const delta = newInsertedBytes - oldDeletedBytes;
  const editStartByte = prefixBytesOld;
  const editEndByte = prefixBytesOld + oldDeletedBytes;

  const remap = (b) => {
    if (b <= editStartByte) return b;
    if (b >= editEndByte) return b + delta;
    return editStartByte; // boundary fell inside the deleted range
  };

  const out = [];
  for (const f of facets) {
    const nextStart = remap(f.index.byteStart);
    const nextEnd = remap(f.index.byteEnd);
    if (nextEnd <= nextStart) continue;
    out.push({
      index: { byteStart: nextStart, byteEnd: nextEnd },
      features: f.features,
    });
  }
  return out;
}
