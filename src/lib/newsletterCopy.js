// The newsletter's words, editable without a deploy.
//
// What dame.is says around the form, wherever the form is (a post, /blogging,
// the newsletter's own page), lives in one record: is.dame.newsletter, a
// singleton at "self", edited in the admin's Newsletter surface. The same
// argument the Ratioed copy makes (lib/ratioedCopy.js): the wording is the
// author's, and what the newsletter carries will drift, so it shouldn't take a
// deploy to say so. The newsletter page's title and intro are page chrome, so
// they live where every page's do, in is.dame.page/subscribe (pageRegistry.js).
//
// Every field defaults to the sentence the site shipped with, so an absent
// record, an empty field or an unreachable PDS all render the form as before
// the record existed.

/**
 * The built-in wording, and the fallback for every field. Prose rather than
 * fragments: it is what a reader sees when nothing has been written.
 */
export const DEFAULT_NEWSLETTER_COPY = {
  name: 'The dame.is newsletter',
  heading: 'Newsletter',
  thanks: 'You’re subscribed. New posts and updates will come to your inbox.',
  fine: 'Sent through Leaflet, where you’ll confirm your address first. There’s also an {rss}.',
};

export const NEWSLETTER_COPY_KEYS = Object.keys(DEFAULT_NEWSLETTER_COPY);

/** The record's fields folded over the defaults, empties ignored. */
export function mergeNewsletterCopy(value) {
  const out = { ...DEFAULT_NEWSLETTER_COPY };
  for (const key of NEWSLETTER_COPY_KEYS) {
    const written = value?.[key];
    if (typeof written === 'string' && written.trim()) out[key] = written.trim();
  }
  return out;
}

export const RSS_TOKEN = '{rss}';

/**
 * The fine print cut at its first {rss}, for the form to put the feed's link
 * between: `{ before, after, rss }`, where `rss` says whether there was a
 * token at all. A second {rss} is left as written.
 */
export function splitFine(text) {
  const s = String(text || '');
  const at = s.indexOf(RSS_TOKEN);
  if (at === -1) return { before: s, after: '', rss: false };
  return { before: s.slice(0, at), after: s.slice(at + RSS_TOKEN.length), rss: true };
}
