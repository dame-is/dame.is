// JSON-LD structured data for the crawler-facing <head>.
//
// The site is one person's, so the identity node is a schema.org Person rather
// than an Organization — there is no company here, no storefront, and no
// postal address that belongs in public. The Person carries the identifiers
// that ARE public and verifiable: the handle, the atproto DID, and the profiles
// on other networks that resolve back to the same person.
//
// Emitted as a @graph so the three nodes can reference each other by @id: the
// Person, the WebSite they publish, and the WebPage (or BlogPosting) being
// looked at. An agent resolving "who is dame.is" gets one answer from any page
// on the site rather than a different fragment from each.

import { SITE } from './pages.js';
import { ME_DID, ME_HANDLE, GITHUB_REPO, INATURALIST_USER, ARENA_USER } from '../src/config.js';

const ORIGIN = `https://${SITE.domain}`;
const PERSON_ID = `${ORIGIN}/#person`;
const WEBSITE_ID = `${ORIGIN}/#website`;

/** GitHub owner from the `owner/repo` pair in config. */
const GITHUB_OWNER = String(GITHUB_REPO || '').split('/')[0];

/**
 * Public profiles that resolve to the same person. Every entry is derived from
 * a value in src/config.js that the site already uses to fetch from that
 * service, so none of them can drift into a link that isn't dame's.
 */
const SAME_AS = [
  `https://bsky.app/profile/${ME_HANDLE}`,
  GITHUB_OWNER ? `https://github.com/${GITHUB_OWNER}` : null,
  INATURALIST_USER ? `https://www.inaturalist.org/people/${INATURALIST_USER}` : null,
  ARENA_USER ? `https://www.are.na/${ARENA_USER}` : null,
].filter(Boolean);

function personNode(description) {
  return {
    '@type': 'Person',
    '@id': PERSON_ID,
    name: 'dame',
    alternateName: ME_HANDLE,
    url: `${ORIGIN}/`,
    description,
    // The DID is the durable identifier: handles can be reassigned, a DID
    // can't. Declaring both lets an agent verify the two point at each other.
    identifier: ME_DID,
    mainEntityOfPage: `${ORIGIN}/themself`,
    sameAs: SAME_AS,
  };
}

function websiteNode(description) {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: `${ORIGIN}/`,
    name: SITE.domain,
    description,
    inLanguage: 'en',
    author: { '@id': PERSON_ID },
    publisher: { '@id': PERSON_ID },
  };
}

/**
 * Build the JSON-LD graph for one page.
 *
 * @param {object}  opts
 * @param {string}  opts.canonical  Absolute canonical URL for this view.
 * @param {string}  opts.title      The page's title.
 * @param {string}  opts.desc       The page's description.
 * @param {string} [opts.heading]   The page's <h1>, when it differs from title.
 * @param {string} [opts.siteDesc]  Description for the WebSite/Person nodes.
 * @param {boolean}[opts.isArticle] Render the page node as a BlogPosting.
 * @param {string} [opts.date]      ISO date the article was published.
 * @param {string} [opts.image]     Absolute URL of the page's card image.
 * @returns {object} A schema.org @graph document.
 */
export function pageJsonLd({
  canonical,
  title,
  desc,
  heading = null,
  siteDesc = SITE.tagline,
  isArticle = false,
  date = null,
  image = null,
}) {
  const page = {
    '@type': isArticle ? 'BlogPosting' : 'WebPage',
    '@id': canonical,
    url: canonical,
    name: title,
    headline: heading || title,
    description: desc,
    inLanguage: 'en',
    isPartOf: { '@id': WEBSITE_ID },
    author: { '@id': PERSON_ID },
  };
  if (isArticle) page.publisher = { '@id': PERSON_ID };
  if (date) {
    page.datePublished = date;
    // Nothing here tracks a separate modification time, so the two agree
    // rather than inventing a dateModified the records can't support.
    page.dateModified = date;
  }
  if (image) page.image = image;

  return {
    '@context': 'https://schema.org',
    '@graph': [personNode(siteDesc), websiteNode(siteDesc), page],
  };
}

/**
 * Serialise a JSON-LD graph into a <script> tag.
 *
 * `<` is escaped as `<` so a description containing `</script>` can't
 * close the block early — JSON string escapes are still valid JSON, so parsers
 * read the original text back.
 */
export function jsonLdScript(graph) {
  const json = JSON.stringify(graph).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}
