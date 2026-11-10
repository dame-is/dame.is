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
  // The socket in use, or null between one and the next.
  let current = null;
  let backoff = config.reconnectBaseMs;
  let watchdog = null;
  let retry = null;
  let lastFrameAt = 0;
  let closedByUs = false;

  function stopWatchdog() {
    if (watchdog) clearInterval(watchdog);
    watchdog = null;
  }

  function retryLater() {
    retry = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, config.reconnectMaxMs);
  }

  /**
   * Give up on `socket` and arrange the next attempt.
   *
   * THE RECONNECT IS NEVER LEFT TO THE SOCKET. A WebSocket that can't connect
   * fires `error` and no `close` (Node 22, checked), and one whose peer has
   * stopped answering never finishes closing, so waiting on `close` to
   * reconnect is waiting on the thing that has failed. Whichever sign of
   * trouble comes first (an error, a close, silence) lands here, the socket
   * stops being the one in use, and anything it says afterwards is ignored.
   */
  function giveUp(socket, why) {
    if (closedByUs || current !== socket) return;
    current = null;
    stopWatchdog();
    try {
      socket.close();
    } catch {
      /* already gone */
    }
    logger.warn('Jetstream connection lost; reconnecting', { why, inMs: backoff });
    retryLater();
  }

  function connect() {
    retry = null;
    if (closedByUs) return;
    const cursor = getCursor();
    const url = streamUrl({ host: config.jetstreamHost, api: config.jetstreamApi, cursor });
    logger.info('Connecting to Jetstream', {
      host: config.jetstreamHost,
      api: config.jetstreamApi,
      resumingFrom: cursor ?? '(live tail)',
    });

    let socket;
    try {
      // The v2 endpoint is an XRPC subscription and names its framing as a
      // subprotocol; v1 has none.
      socket = config.jetstreamApi === 'v2' ? new WebSocketImpl(url, 'xrpc.v1.json') : new WebSocketImpl(url);
    } catch (err) {
      logger.warn('Could not open a socket to Jetstream', { err, inMs: backoff });
      retryLater();
      return;
    }
    current = socket;

    // The watchdog starts with the attempt, not with its success: a
    // connection that never opens and never fails is silence too. This
    // stream is never quiet once it is open, so silence always means dead.
    lastFrameAt = Date.now();
    watchdog = setInterval(
      () => {
        const silentMs = Date.now() - lastFrameAt;
        if (silentMs >= config.silenceMs) giveUp(socket, `silent for ${Math.round(silentMs / 1000)}s`);
      },
      Math.max(1000, Math.floor(config.silenceMs / 3)),
    );

    socket.addEventListener('open', () => {
      if (current !== socket) return;
      backoff = config.reconnectBaseMs;
      lastFrameAt = Date.now();
      logger.info('Connected to Jetstream', { host: config.jetstreamHost });
    });

    socket.addEventListener('message', (ev) => {
      // A socket that was given up on may still have frames in flight. They
      // are behind the cursor the next one resumes from.
      if (current !== socket) return;
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

    socket.addEventListener('error', (ev) => giveUp(socket, `error: ${ev?.message || 'unknown'}`));
    socket.addEventListener('close', () => giveUp(socket, 'closed'));
  }

  connect();

  return {
    close() {
      closedByUs = true;
      if (retry) clearTimeout(retry);
      retry = null;
      stopWatchdog();
      const socket = current;
      current = null;
      try {
        socket?.close();
      } catch {
        /* already gone */
      }
    },
  };
}
