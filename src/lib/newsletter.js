// The blog's email newsletter. Leaflet keeps the list and sends the email;
// dame.is only shows the form and never sees an address.
//
// The form is Leaflet's embeddable subscribe form (publication settings →
// Embeddable Subscribe Form), rebuilt as a plain GET form so it works without
// any Leaflet script: it goes to leaflet.pub, the reader confirms their
// address there with a code, and Leaflet sends them back. It only does
// anything for a publication with Leaflet's newsletter mode turned on.
//
// The way back is the part that needs a route of our own. Leaflet doesn't
// send a confirmed reader to the form's `redirect`: it sends them to
// RETURN_PATH on that redirect's origin, with the real redirect sealed inside
// a token only Leaflet can read (postAuthRedirect in Leaflet's source). So the
// form notes the page it was on in a cookie scoped to RETURN_PATH as it goes,
// and api/newsletter-return.js reads it back and forwards the reader there
// with RETURN_PARAM set, which the form uses to say thanks.
//
// A post places forms with Leaflet's `pub.leaflet.blocks.signup` block, which
// carries no data of its own. A post with none gets one after its last line
// (BlogPost.jsx), and the /blogging index keeps one at #subscribe. The page
// to link to is SUBSCRIBE_PATH, the newsletter's own (SUBSCRIBE_URL in full):
// a post's link to it, or to any dame.is form by the older #subscribe, opens
// that page in place (leafletRichText.jsx), and an email, a feed reader or
// Bluesky opens it as any link.

import { BLOG_PUBLICATION } from '../config.js';

export const SITE_ORIGIN = 'https://dame.is';
export const LEAFLET_EMAIL_LOGIN = 'https://leaflet.pub/api/auth/email-login';
export const SIGNUP_BLOCK_TYPE = 'pub.leaflet.blocks.signup';

/** The first form on any page that has one. */
export const SUBSCRIBE_ID = 'subscribe';

/**
 * The newsletter's own page (BloggingSubscribe.jsx), where the form is the To
 * line of an email. It sits under /blogging, where every other second segment
 * is a post's rkey, so the edge asks isSubscribePath before treating it as a
 * record that isn't there.
 */
export const SUBSCRIBE_PATH = '/blogging/subscribe';
export const SUBSCRIBE_URL = `${SITE_ORIGIN}${SUBSCRIBE_PATH}`;

export function isSubscribePath(pathname) {
  return String(pathname || '').replace(/\/+$/, '') === SUBSCRIBE_PATH;
}

export const RETURN_PATH = '/receive_auth_callback';
export const RETURN_COOKIE = 'newsletter_return';
export const RETURN_MAX_AGE = 86_400;
export const RETURN_PARAM = 'subscribed';
export const RETURN_VALUE = 'email';

/** Where a reader goes when the cookie is missing or unusable. */
const DEFAULT_RETURN = `${SUBSCRIBE_PATH}#${SUBSCRIBE_ID}`;

/**
 * Leaflet's `action` value: the JSON percent-encoded once, exactly as its own
 * snippet has it. The form encodes it a second time on submit and Leaflet
 * decodes both (parseActionFromSearchParam).
 */
export function emailAction(publication = BLOG_PUBLICATION) {
  return encodeURIComponent(
    JSON.stringify({ action: 'subscribe', publication, source: { placement: 'embed' } }),
  );
}

/**
 * The form's `redirect`: the page it sits on, at the form itself. Leaflet's
 * "back" link on its confirm page goes here too, before anything is
 * confirmed, so it carries no thank-you marker.
 */
export function emailRedirect(origin, pathname, formId) {
  const url = new URL(pathname || '/', origin || SITE_ORIGIN);
  url.hash = formId;
  return url.toString();
}

/**
 * The cookie a form sets as it goes to Leaflet: the redirect's path, query and
 * hash, for RETURN_PATH only.
 */
export function returnCookie(redirect, { secure = true } = {}) {
  let back;
  try {
    back = new URL(redirect);
  } catch {
    return null;
  }
  const value = encodeURIComponent(`${back.pathname}${back.search}${back.hash}`);
  return (
    `${RETURN_COOKIE}=${value}; Path=${RETURN_PATH}; Max-Age=${RETURN_MAX_AGE}; SameSite=Lax` +
    (secure ? '; Secure' : '')
  );
}

/** Clears the cookie once api/newsletter-return.js has used it. */
export const RETURN_COOKIE_CLEARED = `${RETURN_COOKIE}=; Path=${RETURN_PATH}; Max-Age=0; SameSite=Lax; Secure`;

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Where RETURN_PATH sends a confirmed reader: the page in their cookie, else
 * the index's form, with the thank-you marker. A path on this site only, so
 * the cookie can never send anyone elsewhere.
 */
export function returnLocation(cookieHeader) {
  let back = new URL(DEFAULT_RETURN, SITE_ORIGIN);
  const saved = readCookie(cookieHeader, RETURN_COOKIE);
  if (saved) {
    try {
      const url = new URL(decodeURIComponent(saved), SITE_ORIGIN);
      if (url.origin === SITE_ORIGIN && url.pathname !== RETURN_PATH) back = url;
    } catch {
      // malformed: the index it is
    }
  }
  back.searchParams.set(RETURN_PARAM, RETURN_VALUE);
  return `${back.pathname}${back.search}${back.hash}`;
}

/** True when the address is the way back from Leaflet to the form `formId`. */
export function isReturnTo(search, hash, formId) {
  return (
    new URLSearchParams(search || '').get(RETURN_PARAM) === RETURN_VALUE &&
    String(hash || '').replace(/^#/, '') === formId
  );
}

/** The address without the thank-you marker, for history.replaceState. */
export function withoutReturnMarker(pathname, search, hash) {
  const params = new URLSearchParams(search || '');
  params.delete(RETURN_PARAM);
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash || ''}`;
}

/**
 * Each signup block in a document mapped to its form's id, in reading order:
 * the first is SUBSCRIBE_ID, then subscribe-2, subscribe-3. Keyed by the
 * block object, as LeafletDocument's sections are.
 */
export function signupBlockIds(pages) {
  const ids = new Map();
  for (const page of Array.isArray(pages) ? pages : []) {
    for (const wrap of Array.isArray(page?.blocks) ? page.blocks : []) {
      const block = wrap?.block;
      if (block?.$type !== SIGNUP_BLOCK_TYPE) continue;
      ids.set(block, ids.size === 0 ? SUBSCRIBE_ID : `${SUBSCRIBE_ID}-${ids.size + 1}`);
    }
  }
  return ids;
}

export function hasSignupBlock(pages) {
  return signupBlockIds(pages).size > 0;
}

/**
 * A link that means "subscribe": the newsletter's page (SUBSCRIBE_URL), or a
 * form on any dame.is page by its #subscribe, the way links were written
 * before the page existed and still are in published posts.
 */
export function isSubscribeLink(href) {
  try {
    const url = new URL(href);
    if (!/^(www\.)?dame\.is$/.test(url.hostname)) return false;
    return isSubscribePath(url.pathname) || url.hash === `#${SUBSCRIBE_ID}`;
  } catch {
    return false;
  }
}
