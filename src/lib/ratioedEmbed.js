// What a post is carrying, said in a few characters.
//
// A witness row holds a record key, a DID and up to 300 characters of text
// (see ratioedLive.js) — enough to say who did what and when, and nothing at
// all about the picture they replied with. The feed hydrates its rows from the
// AppView to fill that in, and this turns the embed that comes back into the
// mark that goes on the row: two thumbnails, a domain, "quoting @somebody".
//
// It is a mark and not a preview. The row is one line in a log that a person is
// scanning while a piece runs, and a rendered image embed on every row is a
// feed you can see one row of. What the mark has to do is say that there is
// something there, well enough that somebody knows whether to open it — which
// is what the tap on the row is for, and where the embed is actually drawn.
//
// Two shapes arrive here. The AppView returns the resolved `#view` forms, which
// carry CDN URLs and are what this is written against. The raw record forms
// carry blob refs and no URLs, so they can be named but not shown; they turn up
// only if something ever hands this a record straight off a PDS, and they
// degrade to a label rather than to nothing.

/** Thumbnails on one mark. Four images is a common post; three is a mark. */
export const THUMB_MAX = 3;

/** The host of a URL, without the www, or '' if it isn't one. */
export function linkHost(uri) {
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function imagesMark(images) {
  const list = Array.isArray(images) ? images : [];
  if (!list.length) return null;
  return {
    kind: 'images',
    count: list.length,
    label: list.length === 1 ? '1 image' : `${list.length} images`,
    thumbs: list
      .slice(0, THUMB_MAX)
      .map((im) => ({ src: im?.thumb || '', alt: typeof im?.alt === 'string' ? im.alt : '' }))
      .filter((t) => t.src),
  };
}

function videoMark(video) {
  return {
    kind: 'video',
    count: 1,
    label: 'video',
    thumbs: video?.thumbnail
      ? [{ src: video.thumbnail, alt: typeof video.alt === 'string' ? video.alt : '' }]
      : [],
  };
}

function linkMark(external) {
  const host = linkHost(external?.uri);
  return {
    kind: 'link',
    count: 1,
    label: host || 'link',
    thumbs: external?.thumb ? [{ src: external.thumb, alt: '' }] : [],
  };
}

/**
 * The thing being quoted, named by whoever wrote it.
 *
 * A quoted record can also be a feed, a list, a starter pack or a labeller, and
 * it can be gone — blocked, deleted, detached by its author. All of those are
 * `record` on the wire and none of them has an author handle, so they are named
 * for what they are rather than left unmarked: a row whose quote has been taken
 * down is still a row that quoted something.
 */
function quoteMark(record) {
  // `recordWithMedia` nests the quote one level deeper than `record` does: its
  // `record` is a whole `app.bsky.embed.record#view`, whose own `record` is the
  // thing quoted. So it has to be unwrapped — but on what it IS rather than on
  // what it calls itself, because the AppView ships that wrapper with no
  // `$type` at all (measured on a live post; the field is implied by position
  // and simply left out), and a type check alone labelled every quote-plus-
  // picture "a post". On "has a `record` key" alone it goes wrong the other
  // way: a quoted starter pack HAS a `record` key — its own raw record — and
  // unwrapping that loses the view type with the name in it.
  //
  // So: unwrap something holding a `record` when it either says it is the
  // wrapper, or says nothing about itself at all and has no `uri`. The `uri` is
  // what settles it — every view that is a THING (a post, a feed, a list, a
  // starter pack, a tombstone) carries the uri of that thing, and the wrapper
  // carries only what it wraps.
  const wrapper =
    record &&
    typeof record === 'object' &&
    record.record &&
    (record.$type === 'app.bsky.embed.record#view' || (!record.$type && !record.uri));
  const inner = wrapper ? record.record : record;
  const type = inner?.$type || '';
  if (type.endsWith('#viewNotFound') || type.endsWith('#viewDetached')) {
    return { kind: 'quote', count: 1, label: 'a post that is gone', thumbs: [] };
  }
  if (type.endsWith('#viewBlocked')) {
    return { kind: 'quote', count: 1, label: 'a blocked post', thumbs: [] };
  }
  if (type.includes('generatorView')) {
    return { kind: 'quote', count: 1, label: inner?.displayName || 'a feed', thumbs: [] };
  }
  if (type.includes('listView')) {
    return { kind: 'quote', count: 1, label: inner?.name || 'a list', thumbs: [] };
  }
  if (type.includes('starterPack')) {
    return { kind: 'quote', count: 1, label: inner?.record?.name || 'a starter pack', thumbs: [] };
  }
  const handle = inner?.author?.handle || inner?.creator?.handle || '';
  return {
    kind: 'quote',
    count: 1,
    label: handle ? `@${handle}` : 'a post',
    thumbs: [],
  };
}

/**
 * Every mark a post's embed earns, in the order they should be read.
 *
 * An array rather than one mark because `recordWithMedia` is genuinely two
 * things — a quote AND a picture — and a post that does both should say both.
 * Anything unrecognised returns nothing at all: a mark that says "embed" tells
 * a reader less than the absence of one, because the absence is at least true
 * about what it is showing.
 */
export function embedMarks(embed) {
  if (!embed || typeof embed !== 'object') return [];
  const type = String(embed.$type || '');
  switch (true) {
    case type.startsWith('app.bsky.embed.images'):
      return [imagesMark(embed.images)].filter(Boolean);
    case type.startsWith('app.bsky.embed.video'):
      return [videoMark(embed)];
    case type.startsWith('app.bsky.embed.external'):
      return [linkMark(embed.external)];
    case type.startsWith('app.bsky.embed.recordWithMedia'):
      return [...embedMarks(embed.media), quoteMark(embed.record)];
    case type.startsWith('app.bsky.embed.record'):
      return [quoteMark(embed.record)];
    default:
      return [];
  }
}
