// Calling a bluesky-mod bot's API from a page: the bot's own panel, or an
// admin page on your own site (docs/YOUR-OWN-ADMIN.md, docs/API.md).
//
// No dependencies, and nothing that touches the page: what comes back is the
// bot's JSON, for your own code to draw however it likes.

/** The API version this client was written against (GET /api/me). */
export const API_VERSION = 1;

/** A refusal or a failure, with the bot's words for it. `status` is 0 when the bot could not be reached. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** When a JWT runs out, in milliseconds, or 0 when it cannot be read. */
function expiresAt(jwt) {
  try {
    const part = String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp = JSON.parse(atob(part)).exp;
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * A client for one bot.
 *
 * @param {object} opts
 * @param {string} [opts.baseUrl]  where the bot's panel is served, like
 *   https://mod.example.com. Leave it out on the panel's own page.
 * @param {'cookie' | { token: string | (() => string | Promise<string>) } |
 *   { serviceAuth: () => Promise<string> }} [opts.auth]
 *   How to sign in: the panel's cookie (its own page only); a panel session
 *   token; or a service-auth token your site gets from the account's PDS,
 *   with `aud` set to the bot's DID and no `lxm`.
 * @param {typeof fetch} [opts.fetch]
 * @param {() => void} [opts.onSignedOut]  called when the bot answers 401
 */
export function createClient({
  baseUrl = '',
  auth = 'cookie',
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  onSignedOut = null,
} = {}) {
  const root = String(baseUrl).replace(/\/+$/, '');
  const cookie = auth === 'cookie';
  // A PDS makes a service-auth token for a minute; one is reused until
  // fifteen seconds before it runs out, and calls made together share one.
  let held = null;

  async function bearer() {
    if (cookie) return null;
    if (auth.token != null) return typeof auth.token === 'function' ? auth.token() : auth.token;
    if (typeof auth.serviceAuth === 'function') {
      if (held?.jwt && held.until - Date.now() > 15_000) return held.jwt;
      if (held?.pending) return held.pending;
      const pending = Promise.resolve(auth.serviceAuth()).then(
        (jwt) => {
          held = { jwt, until: expiresAt(jwt) };
          return jwt;
        },
        (err) => {
          held = null;
          throw err;
        },
      );
      held = { pending };
      return pending;
    }
    throw new Error('auth must be "cookie", { token }, or { serviceAuth }');
  }

  async function request(method, path, { params, body } = {}) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v != null && v !== '') query.set(k, String(v));
    }
    const qs = query.toString();
    const url = `${root}${path}${qs ? `?${qs}` : ''}`;
    const headers = {};
    const token = await bearer();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      // The panel's own page says so on every change it sends; a bearer
      // token needs no such header, but it does no harm.
      headers['X-Panel-Request'] = '1';
    }
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers,
        credentials: cookie ? 'same-origin' : 'omit',
        body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      });
    } catch {
      throw new ApiError(0, 'Could not reach the bot. Is it running?');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      if (res.status === 401) {
        held = null;
        if (path !== '/api/sign-in') onSignedOut?.();
      }
      throw new ApiError(res.status, data?.error || `The bot answered ${res.status}.`);
    }
    return data;
  }

  const get = (path, params) => request('GET', path, { params });
  const post = (path, body) => request('POST', path, { body });

  return {
    request,
    get,
    post,

    // You and the bot
    me: () => get('/api/me'),
    health: () => get('/api/health'),
    settings: () => get('/api/settings'),
    people: () => get('/api/people'),
    /** Exchange a code the bot sent by DM. With `token`, the session comes back as a token to keep. */
    signIn: (code, { token = !cookie } = {}) => post('/api/sign-in', { code, ...(token ? { token: true } : {}) }),
    signOut: () => post('/api/sign-out'),
    signOutEverywhere: () => post('/api/sign-out-everywhere'),

    // The list
    lists: () => get('/api/lists'),
    overview: ({ days, list } = {}) => get('/api/overview', { days, list }),
    list: ({ band, family, q, sort, offset, limit, list } = {}) =>
      get('/api/list', { band, family, q, sort, offset, limit, list }),
    radar: ({ list } = {}) => get('/api/list/radar', { list }),
    members: ({ list } = {}) => get('/api/list/members', { list }),
    queue: ({ band, offset, limit } = {}) => get('/api/queue', { band, offset, limit }),
    keep: (did, band) => post('/api/queue/keep', { did, band }),
    reopen: (did) => post('/api/queue/reopen', { did }),
    protectedAccounts: ({ q, offset, limit } = {}) => get('/api/protected', { q, offset, limit }),
    activity: ({ filter, offset, limit } = {}) => get('/api/activity', { filter, offset, limit }),

    // Accounts and posts
    account: (actor) => get('/api/account', { actor }),
    profiles: (dids) => post('/api/profiles', { dids }),
    check: (link) => post('/api/check', { link }),
    scans: ({ state, before, limit } = {}) => get('/api/scans', { state, before, limit }),
    scan: (code) => get('/api/scan', { code }),
    startScan: (link, kind = 'everyone') => post('/api/scans', { link, kind }),
    watches: () => get('/api/watches'),
    stopWatch: (uri) => post('/api/watches/stop', { uri }),

    // The follow graph and the shield
    graph: () => get('/api/graph'),
    vouches: (opts = {}) => post('/api/graph/vouches', opts),
    rebuild: () => post('/api/graph/rebuild'),
    rescore: () => post('/api/rescore'),
    models: ({ days } = {}) => get('/api/models', { days }),
    shield: () => get('/api/shield'),

    /** One of the bot's own commands, run as a DM's would be (docs/API.md). */
    command: (text) => post('/api/command', { command: text }),
  };
}
