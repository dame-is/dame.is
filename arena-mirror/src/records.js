// Pure mappers from are.na v3 JSON to PDS record values, plus the equality
// check the engine uses to skip rewriting unchanged records.
//
// Two data-model constraints shape these records:
//   - atproto records cannot contain floats, so are.na's `aspect_ratio` is
//     dropped (derivable from width/height) and every number is an integer.
//   - records must be self-contained: reference URLs and metadata are kept
//     even in blobs mode, so nothing renders differently when a blob was
//     skipped (too large, download failed).

/** are.na rich-text fields are `{ markdown, html, plain }` or plain strings. */
export function arenaMarkdown(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.markdown || value.plain || '';
  return String(value);
}

const int = (v) => (Number.isInteger(v) ? v : null);

function compactUser(u) {
  if (!u || u.id == null) return null;
  const out = { arenaId: u.id, slug: u.slug || '' };
  if (u.name) out.name = u.name;
  return out;
}

/** Drop null/undefined/'' properties so records stay compact and stable. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

export function channelUrl(ch) {
  const owner = ch?.owner?.slug || 'channels';
  return `https://www.are.na/${owner}/${ch?.slug || ch?.id}`;
}

export const blockUrl = (id) => `https://www.are.na/block/${id}`;

/** are.na channel JSON → channel record value. */
export function channelValue(ch, { type, now }) {
  return compact({
    $type: type,
    title: ch.title || '',
    description: arenaMarkdown(ch.description) || null,
    slug: ch.slug || null,
    visibility: ch.visibility || null,
    owner: compactUser(ch.owner),
    counts: ch.counts
      ? compact({
          blocks: int(ch.counts.blocks),
          channels: int(ch.counts.channels),
          contents: int(ch.counts.contents),
        })
      : null,
    createdAt: ch.created_at || now,
    updatedAt: ch.updated_at || null,
    origin: { arenaId: ch.id, url: channelUrl(ch), syncedAt: now },
  });
}

function imageValue(img) {
  if (!img?.src) return null;
  return compact({
    src: img.src,
    alt: img.alt_text || null,
    width: int(img.width),
    height: int(img.height),
    contentType: img.content_type || null,
    fileSize: int(img.file_size),
    blurhash: img.blurhash || null,
    updatedAt: img.updated_at || null,
  });
}

function attachmentValue(att) {
  if (!att?.url) return null;
  return compact({
    url: att.url,
    filename: att.filename || null,
    contentType: att.content_type || null,
    fileSize: int(att.file_size),
    extension: att.file_extension || null,
    updatedAt: att.updated_at || null,
  });
}

/**
 * are.na block JSON → { value, media }. `media` describes the primary
 * artifact the engine may mirror as a blob in blobs mode: an Image block's
 * original file, or an Attachment block's file. Preview imagery on Link /
 * Embed / Attachment blocks is always reference-only — it's derivative
 * (screenshots, oEmbed thumbnails), not the thing being saved.
 */
export function blockValue(block, { type, now }) {
  const kind = String(block.type || '').toLowerCase();
  const value = compact({
    $type: type,
    kind,
    title: block.title || null,
    description: arenaMarkdown(block.description) || null,
    text: kind === 'text' ? arenaMarkdown(block.content) || null : null,
    source: block.source?.url
      ? compact({
          url: block.source.url,
          title: block.source.title || null,
          providerName: block.source.provider?.name || null,
          providerUrl: block.source.provider?.url || null,
        })
      : null,
    image: imageValue(block.image),
    attachment: attachmentValue(block.attachment),
    embed: block.embed
      ? compact({
          type: block.embed.type || null,
          authorName: block.embed.author_name || null,
          authorUrl: block.embed.author_url || null,
          html: block.embed.html || null,
          width: int(block.embed.width),
          height: int(block.embed.height),
        })
      : null,
    creator: compactUser(block.user),
    createdAt: block.created_at || now,
    updatedAt: block.updated_at || null,
    origin: { arenaId: block.id, url: blockUrl(block.id), syncedAt: now },
  });

  let media = null;
  if (kind === 'image' && value.image) {
    media = { field: 'image', url: value.image.src, fileSize: value.image.fileSize ?? null, updatedAt: value.image.updatedAt ?? null };
  } else if (kind === 'attachment' && value.attachment) {
    media = { field: 'attachment', url: value.attachment.url, fileSize: value.attachment.fileSize ?? null, updatedAt: value.attachment.updatedAt ?? null };
  }
  return { value, media };
}

/**
 * A channel-contents item's connection → connection record value. `target`
 * always carries the are.na id/url/title; `uri` is added only when the
 * target is mirrored in this repo, so foreign or out-of-scope targets stay
 * addressable without implying a local record exists.
 */
export function connectionValue(item, { type, channelUri, targetUri, now }) {
  const conn = item.connection || {};
  const isChannel = item.type === 'Channel';
  return compact({
    $type: type,
    channel: channelUri,
    target: compact({
      type: isChannel ? 'channel' : 'block',
      arenaId: item.id,
      uri: targetUri || null,
      url: isChannel ? channelUrl(item) : blockUrl(item.id),
      title: item.title || null,
    }),
    position: int(conn.position),
    pinned: conn.pinned === true ? true : null,
    connectedAt: conn.connected_at || null,
    connectedBy: compactUser(conn.connected_by),
    origin: { arenaId: conn.id, syncedAt: now },
  });
}

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * True when two record values are equivalent apart from `origin.syncedAt`,
 * i.e. rewriting would only churn the repo. Key order is ignored (records
 * read back from the PDS don't preserve ours).
 */
export function valuesEqual(a, b) {
  if (!a || !b) return false;
  const strip = (v) => {
    if (!v?.origin) return v;
    const { syncedAt, ...origin } = v.origin;
    return { ...v, origin };
  };
  return stableStringify(strip(a)) === stableStringify(strip(b));
}
