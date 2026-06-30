// Shared helpers for publishing creative works as `site.standard.document`
// records. Used by both upload.mjs (fresh import from the old portfolio) and
// migrate-creating.mjs (convert existing is.dame.creating.work records).

import { PORTFOLIO_PUBLICATION } from '../../src/config.js';

export const STANDARD_DOC = 'site.standard.document';

/**
 * The portfolio publication `at://` URI. Resolution order: explicit CLI
 * value → DAME_PORTFOLIO_PUBLICATION env → PORTFOLIO_PUBLICATION in config.
 * Throws if none is set, since a creative work must belong to it.
 */
export function resolvePublication(cliValue) {
  const pub = cliValue || process.env.DAME_PORTFOLIO_PUBLICATION || PORTFOLIO_PUBLICATION;
  if (!pub) {
    throw new Error(
      'No portfolio publication set. Create one with `node scripts/portfolio/create-publication.mjs`, ' +
        'then set PORTFOLIO_PUBLICATION in src/config.js (or pass --publication=at://…).',
    );
  }
  return pub;
}

/** Merge a primary category and extra tags into one deduped, trimmed list. */
export function mergeTags(category, tags = []) {
  const out = [];
  for (const t of [category, ...(Array.isArray(tags) ? tags : [])]) {
    const s = String(t || '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Build a `site.standard.document` record value for a creative work.
 * `content` is a ready `pub.leaflet.content` value (image blocks already
 * carrying blob refs or legacy URLs).
 */
export function buildStandardDocRecord({
  publication,
  title,
  slug,
  summary,
  category,
  tags = [],
  createdAt,
  content,
  coverImage,
}) {
  const record = {
    $type: STANDARD_DOC,
    title,
    site: publication,
    publishedAt: createdAt || new Date().toISOString(),
    content,
  };
  if (slug) record.path = '/' + String(slug).replace(/^\/+/, '');
  if (summary) record.description = summary;
  const allTags = mergeTags(category, tags);
  if (allTags.length) record.tags = allTags;
  if (coverImage) record.coverImage = coverImage;
  return record;
}

/** Resolve a handle to its DID + PDS service endpoint (no auth needed). */
export async function resolveIdentity(handle, pdsOverride = null) {
  const r = await fetch(
    `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
  );
  if (!r.ok) throw new Error(`resolveHandle(${handle}) → HTTP ${r.status}`);
  const { did } = await r.json();
  if (pdsOverride) return { did, pds: pdsOverride };
  const docUrl = did.startsWith('did:web:')
    ? `https://${did.slice('did:web:'.length)}/.well-known/did.json`
    : `https://plc.directory/${did}`;
  const doc = await (await fetch(docUrl)).json();
  const svc = (doc.service || []).find(
    (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer',
  );
  if (!svc) throw new Error(`No PDS endpoint in DID doc for ${did}`);
  return { did, pds: svc.serviceEndpoint };
}

/** Set of `path` slugs already published as portfolio standard docs. */
export async function existingPaths(agent, did, publication) {
  const paths = new Set();
  let cursor;
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: STANDARD_DOC,
      limit: 100,
      cursor,
    });
    for (const r of res.data.records) {
      const v = r.value || {};
      if (v.site === publication && v.path) paths.add(String(v.path).replace(/^\/+/, ''));
    }
    cursor = res.data.cursor;
  } while (cursor);
  return paths;
}
