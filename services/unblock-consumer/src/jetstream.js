// One Jetstream subscription to every block record on the network,
// reconnecting on its own.
//
// Filtered to one collection and to nothing else. The mod-consumer's stream
// is filtered to a roster of authors, because the posts it answers are
// written by people it knows; an unblock can come from anyone, so there is no
// author to ask for. What that costs is small: block records are a few
// hundred bytes and arrive about four a second.
//
// Uses Node 22's built-in WebSocket, as the mod-consumer does.

import { BLOCK_NSID } from './events.js';

/**
 * The address to connect to.
 *
 * @param {object} opts
 * @param {string} opts.host
 * @param {'v1'|'v2'} opts.api
 * @param {number|string|null} opts.cursor  where to resume, or null for the live tail
 */
export function streamUrl({ host: given, api, cursor }) {
  // A bare host is reached over TLS. One that states its scheme is taken at
  // its word, which is for a Jetstream of your own on a private network.
  const host = /^wss?:\/\//.test(given) ? given.replace(/^(wss?):\/\//, '') : given;
  const scheme = given.startsWith('ws://') ? 'ws' : 'wss';
  return `${scheme}://${host}${streamPath({ api, cursor })}`;
}

function streamPath({ api, cursor }) {
  const params = new URLSearchParams();
  if (api === 'v2') {
    params.append('collections', BLOCK_NSID);
    // Commits, and accounts for the deletions. v2 can leave out the identity
    // events, which this service has no use for.
    params.append('kinds', 'commit');
    params.append('kinds', 'account');
    if (cursor != null) params.append('cursor', String(cursor));
    return `/xrpc/network.bsky.jetstream.subscribeEvents?${params}`;
  }
  params.append('wantedCollections', BLOCK_NSID);
  if (cursor != null) params.append('cursor', String(cursor));
  return `/subscribe?${params}`;
}

/**
 * @param {object} opts
 * @param {object} opts.config      jetstreamHost, jetstreamApi, reconnect*, silenceMs
 * @param {object} opts.logger
 * @param {() => number|string|null} opts.getCursor  asked on every (re)connect
 * @param {(frame: object) => void} opts.onFrame     each parsed frame
 * @param {typeof WebSocket} [opts.WebSocketImpl]
 */
export function connectJetstream({ config, logger, getCursor, onFrame, WebSocketImpl = WebSocket }) {
  let ws = null;
  let backoff = config.reconnectBaseMs;
  let watchdog = null;
  let retry = null;
  let lastFrameAt = 0;
  let closedByUs = false;

  function drop() {
    if (watchdog) clearInterval(watchdog);
    watchdog = null;
    try {
      ws?.close();
    } catch {
      /* already gone */
    }
  }

  function connect() {
    if (closedByUs) return;
    const cursor = getCursor();
    const url = streamUrl({ host: config.jetstreamHost, api: config.jetstreamApi, cursor });
    logger.info('Connecting to Jetstream', {
      host: config.jetstreamHost,
      api: config.jetstreamApi,
      resumingFrom: cursor ?? '(live tail)',
    });
    // The v2 endpoint is an XRPC subscription and names its framing as a
    // subprotocol; v1 has none.
    const socket = config.jetstreamApi === 'v2' ? new WebSocketImpl(url, 'xrpc.v1.json') : new WebSocketImpl(url);
    ws = socket;

    socket.addEventListener('open', () => {
      backoff = config.reconnectBaseMs;
      lastFrameAt = Date.now();
      logger.info('Connected to Jetstream', { host: config.jetstreamHost });
      // A socket that dies without a close frame looks like a quiet one, and
      // this stream is never quiet.
      watchdog = setInterval(
        () => {
          if (Date.now() - lastFrameAt < config.silenceMs) return;
          logger.warn('Jetstream has gone silent; reconnecting', { silentMs: Date.now() - lastFrameAt });
          drop();
        },
        Math.max(1000, Math.floor(config.silenceMs / 3)),
      );
      if (watchdog.unref) watchdog.unref();
    });

    socket.addEventListener('message', (ev) => {
      lastFrameAt = Date.now();
      let frame;
      try {
        frame = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch (err) {
        logger.debug('Unparseable frame', { err: err.message });
        return;
      }
      onFrame(frame);
    });

    socket.addEventListener('error', (ev) => {
      logger.warn('WebSocket error', { err: ev?.message || 'unknown' });
    });

    socket.addEventListener('close', () => {
      if (watchdog) clearInterval(watchdog);
      watchdog = null;
      // A socket that was replaced has nothing to say about the one in use.
      if (closedByUs || ws !== socket) return;
      logger.warn('Jetstream closed; reconnecting', { inMs: backoff });
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, config.reconnectMaxMs);
    });
  }

  connect();

  return {
    close() {
      closedByUs = true;
      if (retry) clearTimeout(retry);
      drop();
    },
  };
}
