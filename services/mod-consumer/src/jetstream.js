// One filtered Jetstream subscription, reconnecting on its own.
//
// FILTERED TO THE ROSTER. Jetstream filters by `wantedCollections` and
// `wantedDids` only, and `wantedDids` matches the record's AUTHOR, not its
// subject. That is usually the awkward half of the API; here it is exactly
// right, because the only posts this consumer may act on are the ones written
// by accounts on the roster. The alternative — taking the whole post firehose
// at ~62 events/s and ~3.3 GB/day to match subjects in process — would move
// 3 GB a day to find a handful of posts we could have asked for by name.
//
// EVERY ANSWERED DID MUST BE HERE or that account's mentions never arrive at
// all: the transport drops them before `classify` is ever asked. An allowlist
// that widens the rule without widening the subscription looks exactly like an
// allowlist that does not work, with nothing in the log to say why.
//
// It does mean the socket is idle almost all the time, which is why config
// carries a forced reconnect interval: with no traffic, a dead connection and a
// quiet one look identical, and the difference would otherwise be discovered by
// dame asking a question into the void.
//
// Uses Node 22's built-in WebSocket rather than `ws`. That is the whole reason
// this service has no dependencies of its own.

import { config } from './config.js';
import { logger } from './logger.js';
import { getCursor } from './state.js';

function buildUrl() {
  const params = new URLSearchParams();
  params.append('wantedCollections', 'app.bsky.feed.post');
  // One parameter per DID, which is how Jetstream expects a repeated filter.
  // Keep an eye on the length here if the roster ever grows: jetstream1.us-east
  // sits behind a Cloudflare edge that 414s a long URL, which is why the
  // default host is us-west.
  for (const did of config.roster.all) params.append('wantedDids', did);
  const cursor = getCursor();
  if (cursor) params.append('cursor', cursor);
  return `wss://${config.jetstreamHost}/subscribe?${params}`;
}

export function connectJetstream({ onEvent }) {
  let ws = null;
  let backoff = config.reconnectBaseMs;
  let cycle = null;
  let closedByUs = false;

  function teardown() {
    if (cycle) clearTimeout(cycle);
    cycle = null;
    try {
      ws?.close();
    } catch {
      /* already gone */
    }
  }

  function connect() {
    if (closedByUs) return;
    const url = buildUrl();
    logger.info('Connecting to Jetstream', {
      host: config.jetstreamHost,
      dids: config.roster.all.join(','),
      resumingFrom: getCursor() ?? '(live tail)',
    });
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      backoff = config.reconnectBaseMs;
      logger.info('Connected to Jetstream', { host: config.jetstreamHost });
      // Recycle the socket periodically. Resuming from the stored cursor means
      // a cycle loses nothing, and it is the only way to notice a connection
      // that died without a close frame on a stream this quiet.
      cycle = setTimeout(() => {
        logger.debug('Cycling the Jetstream connection for liveness');
        teardown();
      }, config.reconnectEveryMs);
      if (cycle.unref) cycle.unref();
    });

    ws.addEventListener('message', (ev) => {
      let event;
      try {
        event = JSON.parse(
          typeof ev.data === 'string' ? ev.data : String(ev.data),
        );
      } catch (err) {
        logger.debug('Unparseable frame', { err: err.message });
        return;
      }
      Promise.resolve(onEvent(event)).catch((err) =>
        logger.error('Event handler error', { err }),
      );
    });

    ws.addEventListener('error', (ev) => {
      logger.warn('WebSocket error', { err: ev?.message || 'unknown' });
    });

    ws.addEventListener('close', () => {
      if (cycle) clearTimeout(cycle);
      cycle = null;
      if (closedByUs) return;
      logger.warn('Jetstream closed; reconnecting', { inMs: backoff });
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, config.reconnectMaxMs);
    });
  }

  connect();

  return {
    close() {
      closedByUs = true;
      teardown();
    },
  };
}
