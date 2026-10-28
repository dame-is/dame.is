// Lazy singleton for the BrowserOAuthClient.
//
// Production: burns metadata that mirrors what /client-metadata.json serves.
// Development: uses the loopback client the spec provides for localhost,
//   which means we don't need to tunnel for the OAuth server to fetch our
//   metadata. Its redirect URI has to name 127.0.0.1 (RFC 8252 forbids the
//   `localhost` hostname there), and the session the callback stores lives at
//   that origin — so start a local sign-in from http://127.0.0.1:<port>.

// `@atproto/oauth-client-browser` (with its zod / jose dependency tree) is
// the single heaviest thing in the bundle, yet only the owner and guestbook
// signers ever use it. Import it dynamically inside the client factory so it
// lands in its own lazily-fetched chunk instead of the entry bundle — the
// session provider only awaits it when a session may actually exist.
import { ME_HANDLE, ME_DID, OAUTH_CALLBACK_PATH } from '../config.js';

let _clientPromise = null;

// Module-level event bus. The BrowserOAuthClient itself does not expose
// addEventListener — it surfaces session lifecycle through `onDelete` /
// `onUpdate` constructor hooks. We forward those into a real EventTarget so
// React (or anything else) can subscribe in the usual way.
const _events = new EventTarget();

export function getOauthEvents() {
  return _events;
}

// Two grants, chosen per sign-in (see scopeForAccount):
//   - The owner (dame.is) signs in to administer the whole site, so they get
//     the broad transitional scope.
//   - Everyone else signs in for exactly one reason — to leave a guestbook
//     signature — so visitors get a granular scope that grants write access to
//     just the is.dame.guestbook.entry collection on their own PDS, nothing else.
const OWNER_SCOPE = 'atproto transition:generic';
const GUESTBOOK_SCOPE = 'atproto repo:is.dame.guestbook.entry';
// Client metadata must advertise every scope the client may ever request — the
// authorization server validates each authorization request against it — so it
// declares the union of both. A single sign-in then narrows to one of the two.
const CLIENT_SCOPE = 'atproto transition:generic repo:is.dame.guestbook.entry';

function isLoopbackHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

/**
 * A loopback client's `client_id` IS its metadata: `http://localhost` plus
 * query params naming its redirect URI and scope, which the authorization
 * server parses instead of fetching a document. The scope has to be declared
 * here for the same reason it is in the production metadata — every sign-in
 * narrows to one of OWNER_SCOPE / GUESTBOOK_SCOPE, and a server checks the
 * request against what the client declared.
 */
export function buildLoopbackClientId(origin, redirectPath) {
  const redirect = new URL(redirectPath, origin);
  if (redirect.hostname === 'localhost') redirect.hostname = '127.0.0.1';
  const params = new URLSearchParams({
    redirect_uri: redirect.href,
    scope: CLIENT_SCOPE,
  });
  return `http://localhost?${params}`;
}

/**
 * Lazily construct (once) the BrowserOAuthClient. Returns a Promise — the
 * `@atproto/oauth-client-browser` module is imported dynamically so it never
 * weighs down the entry bundle. A failed construction clears the cached
 * promise so a later call can retry.
 */
export function getOauthClient() {
  if (_clientPromise) return _clientPromise;
  _clientPromise = createOauthClient().catch((err) => {
    _clientPromise = null;
    throw err;
  });
  return _clientPromise;
}

async function createOauthClient() {
  const { BrowserOAuthClient } = await import('@atproto/oauth-client-browser');

  const origin = window.location.origin;
  const redirectPath = OAUTH_CALLBACK_PATH;

  const hooks = {
    onDelete: (sub, cause) => {
      _events.dispatchEvent(new CustomEvent('deleted', { detail: { sub, cause } }));
    },
    onUpdate: (sub, session) => {
      _events.dispatchEvent(new CustomEvent('updated', { detail: { sub, session } }));
    },
  };

  if (isLoopbackHost(window.location.hostname)) {
    // `load` turns the loopback client_id into the metadata object the
    // constructor wants; handing the constructor the bare URL string (as this
    // once did) failed validation on every local sign-in.
    return BrowserOAuthClient.load({
      clientId: buildLoopbackClientId(origin, redirectPath),
      handleResolver: 'https://bsky.social',
      ...hooks,
    });
  }

  return new BrowserOAuthClient({
    handleResolver: 'https://bsky.social',
    clientMetadata: {
      client_id: `${origin}/oauth-client-metadata.json`,
      client_name: 'dame.is',
      client_uri: origin,
      logo_uri: `${origin}/api/favicon`,
      redirect_uris: [`${origin}${redirectPath}`],
      scope: CLIENT_SCOPE,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
      dpop_bound_access_tokens: true,
    },
    ...hooks,
  });
}

/**
 * Which OAuth scope to request for a given sign-in identifier. The owner
 * (matched by handle or DID) gets the broad transitional scope for admin;
 * everyone else gets the guestbook-only write scope — the narrowest grant that
 * still lets a visitor sign the book. Unrecognized input falls through to the
 * guestbook scope, never the broad one.
 */
export function scopeForAccount(input) {
  const id = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
  const isOwner = id === ME_HANDLE.toLowerCase() || id === ME_DID.toLowerCase();
  return isOwner ? OWNER_SCOPE : GUESTBOOK_SCOPE;
}

/**
 * A sign-in that couldn't start (the handle didn't resolve, the PDS's
 * authorization server didn't answer), in words a visitor can act on. The
 * library's own messages are written for developers — an unresolvable handle
 * surfaces as "Failed to resolve identity: …", a bad config as a zod issue
 * dump — so the sign-in forms show this and log the original.
 */
export function signInErrorMessage(err) {
  const message = String(err?.message || '');
  if (/resolve identity|invalid (handle|did)|handle must be/i.test(message)) {
    return 'Couldn’t find that account. Check the handle (it looks like you.bsky.social), or paste your DID.';
  }
  const serverRefused =
    /resolve oauth server metadata|not protected by issuer|does not support/i;
  if (serverRefused.test(message)) {
    return 'Found the account, but its server isn’t accepting sign-ins from here right now.';
  }
  if (err?.name === 'TypeError' && /fetch|network|load failed/i.test(message)) {
    return 'Couldn’t reach the account’s server. Check your connection and try again.';
  }
  return 'Sign-in couldn’t start. Check the handle and try again.';
}

/**
 * The same for a sign-in that came back from the authorization server without
 * a session — declined at the consent screen, or the callback couldn't be
 * matched to the request that started it (an old tab, a reload).
 */
export function callbackErrorMessage(err) {
  const code =
    typeof err?.params?.get === 'function' ? err.params.get('error') : null;
  if (code === 'access_denied') {
    return 'Access wasn’t granted, so you’re not signed in.';
  }
  return 'Sign-in didn’t finish, so you’re not signed in. Nothing was changed.';
}

export { OWNER_SCOPE, GUESTBOOK_SCOPE, CLIENT_SCOPE };
