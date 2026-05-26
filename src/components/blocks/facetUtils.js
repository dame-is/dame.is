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

function applyFeatureAlways(facets, byteStart, byteEnd, feature) {
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
