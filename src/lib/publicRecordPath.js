// Where a record can be READ on the public site, or null when it can't be.
//
// The registry already answers most of this: `verbRegistry.js` maps an NSID to
// the verb that owns it, and every verb declares the `recordHref` its feed
// cards link with. This module only picks the right existing answer for a
// record seen out of context — in the explorer, or in the admin — and returns
// null rather than guessing, because a "View on dame.is" link that lands on
// "Record not found" is worse than no link at all.
//
// Three things the registry can't decide alone:
//
//  - Whose repo it is. Every page on the site reads Dame's repo, so another
//    account's `app.bsky.feed.post` has no page here even though the NSID does.
//  - Documents. A `site.standard.document` reads at `/blogging/<rkey>` on the
//    blog and at `/creating/<slug>` in the portfolio, and can be on both, so
//    its publication decides — with the surface it was opened from breaking
//    the tie. A draft is on neither.
//  - Records whose verb has no page of its own. Anisota posts and reposts link
//    to the explorer, and a publication isn't a post; neither gets a link.

import { ME_DID } from '../config.js';
import { nsidConfig, recordHrefFor } from './verbRegistry.js';
import {
  canonicalWorkPath,
  isDraft,
  showOnBlog,
  showOnCreating,
} from './publications.js';

/** The NSIDs whose public path is decided by publication rather than by NSID. */
const DOCUMENT_NSIDS = new Set([
  'site.standard.document',
  'pub.leaflet.document',
]);

/**
 * @param {object} record
 * @param {string} record.repo        DID of the repo holding the record.
 * @param {string} record.collection  The record's NSID.
 * @param {string} record.rkey        Its record key.
 * @param {object} record.value       The record value (needed for drafts and
 *                                    documents; without it there is no link).
 * @param {string} [record.surface]   `'creating'` when opened from the
 *                                    portfolio, so a doc on both offers that URL.
 * @returns {string|null} A site path, or null.
 */
export function publicRecordPath({
  repo,
  collection,
  rkey,
  value,
  surface,
} = {}) {
  if (repo !== ME_DID || !collection || !rkey || !value) return null;
  if (isDraft(value)) return null;

  if (DOCUMENT_NSIDS.has(collection)) {
    if (surface === 'creating' && showOnCreating(value))
      return canonicalWorkPath(value, rkey);
    if (showOnBlog(value)) return `/blogging/${encodeURIComponent(rkey)}`;
    if (showOnCreating(value)) return canonicalWorkPath(value, rkey);
    return null;
  }

  // `nsidConfig` hands back `{ verb, collection }` where `verb` is the whole
  // registry entry; `recordHrefFor` wants the gerund string off it.
  const entry = nsidConfig(collection);
  const verb = entry?.verb?.verb;
  if (!verb) return null;
  // Blogging's only other collection is the publication itself. The generic
  // route would draw it as a blog card with no post behind it.
  if (verb === 'blogging') return null;

  const href = recordHrefFor(verb, {
    atUri: `at://${repo}/${collection}/${rkey}`,
    rkey,
    payload: value,
    // Without the source, an Anisota post falls through to `/posting/<rkey>`,
    // which reads the Bluesky AppView and finds nothing.
    source: entry.collection?.source,
  });
  // A verb with no page of its own sends its records to the explorer, which is
  // not "on the site" in the sense the caller means.
  if (!href || href.startsWith('/exploring')) return null;
  return href;
}
