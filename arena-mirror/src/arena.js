// Minimal are.na v3 REST client for the mirror. Read-only today; the class
// is the intended home for write methods (createBlock, connect, disconnect…)
// when write-back lands — see README "Roadmap".
//
// Politeness built in: requests are spaced by `delayMs`, 429s honour
// Retry-After, and transient 5xx/network errors retry with backoff. A
// personal access token raises the rate ceiling above the 30 req/min guest
// tier and lets the mirror see the account's private channels.

const ARENA_API = 'https://api.are.na/v3';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ArenaClient {
  constructor({ token, userAgent = 'arena-pds-mirror', delayMs = null, log = () => {} } = {}) {
    this.token = token || null;
    this.userAgent = userAgent;
    // Default spacing tracks the auth tier: unauthenticated callers get 30
    // req/min, so pace just under that; a token's tier is comfortably higher.
    this.delayMs = delayMs ?? (this.token ? 250 : 2100);
    this.log = log;
    this._lastRequestAt = 0;
    this.requestCount = 0;
  }

  async _throttle() {
    const wait = this._lastRequestAt + this.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    this._lastRequestAt = Date.now();
  }

  async json(path) {
    const url = `${ARENA_API}${path}`;
    const headers = { Accept: 'application/json', 'User-Agent': this.userAgent };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; ; attempt++) {
      await this._throttle();
      this.requestCount++;
      let res;
      let retryWaitMs = null;
      let failure = null;
      try {
        res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      } catch (err) {
        failure = `request failed (${err.message})`;
        retryWaitMs = 2000 * 2 ** attempt;
      }
      if (res) {
        if (res.status === 429) {
          failure = 'rate limited (429)';
          retryWaitMs = (Number(res.headers.get('retry-after')) || 15) * 1000;
          this.log(`rate limited — waiting ${Math.round(retryWaitMs / 1000)}s`);
        } else if (res.status >= 500) {
          failure = `HTTP ${res.status}`;
          retryWaitMs = 2000 * 2 ** attempt;
        } else if (!res.ok) {
          const err = new Error(`are.na HTTP ${res.status} for ${path}`);
          err.status = res.status;
          throw err;
        } else {
          return res.json();
        }
      }
      if (attempt >= MAX_ATTEMPTS - 1) throw new Error(`are.na ${failure} for ${path}`);
      await sleep(retryWaitMs);
    }
  }

  /** `GET /v3/users/{slug}` — profile, including the numeric id. */
  user(slug) {
    return this.json(`/users/${encodeURIComponent(slug)}`);
  }

  /** Every page of a paginated v3 listing, yielded item by item. */
  async *paginate(basePath, { per = 100 } = {}) {
    const sep = basePath.includes('?') ? '&' : '?';
    for (let page = 1; ; page++) {
      const res = await this.json(`${basePath}${sep}page=${page}&per=${per}`);
      for (const item of res?.data || []) yield item;
      if (!res?.meta?.has_more_pages) return;
    }
  }

  /**
   * Channels owned by the user. `users/{slug}/contents?type=Channel` also
   * includes channels the user merely connected, so filter to `owner.id`.
   * With the owner's token this includes their private channels.
   */
  async listOwnedChannels(slug, userId) {
    const out = [];
    const seen = new Set();
    for await (const item of this.paginate(`/users/${encodeURIComponent(slug)}/contents?type=Channel`)) {
      if (item?.type !== 'Channel') continue;
      if (userId != null && item?.owner?.id !== userId) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  /** A channel's contents (blocks + nested channels) in curated order. */
  channelContents(idOrSlug) {
    return this.paginate(`/channels/${encodeURIComponent(idOrSlug)}/contents?sort=position_asc`);
  }

  /**
   * Download a media file (image original, attachment) for blob upload.
   * Enforces `maxBytes` via Content-Length when the CDN provides it and by
   * measuring the buffer when it doesn't.
   */
  async fetchBinary(url, { maxBytes } = {}) {
    const res = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`media HTTP ${res.status} for ${url}`);
    const declared = Number(res.headers.get('content-length')) || null;
    if (maxBytes && declared && declared > maxBytes) {
      throw new Error(`media exceeds cap (${declared} > ${maxBytes} bytes)`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (maxBytes && bytes.byteLength > maxBytes) {
      throw new Error(`media exceeds cap (${bytes.byteLength} > ${maxBytes} bytes)`);
    }
    return { bytes, contentType: res.headers.get('content-type') || 'application/octet-stream' };
  }
}
