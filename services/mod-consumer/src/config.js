// Configuration, read once at startup and validated loudly.
//
// Values arrive from systemd's EnvironmentFile, not from dotenv — the three
// consumers already on this box do the same, and a dependency to read a file
// systemd will read for you is a dependency for nothing.

import { ME_DID } from '../../../src/config.js';
import {
  rosterFromEnv,
  parseDids,
} from '../../../src/lib/moderation/senders.js';

const num = (v, d) => (v == null || v === '' ? d : Number(v));

export const config = {
  /** The account that owns the list. Always answered, always may write. */
  ownerDid: process.env.MOD_OWNER_DID || ME_DID,

  /**
   * Who else is answered, and who may change the list.
   *
   * MOD_ALLOWED_DIDS is read-only: the analyst, lookups, post scans, `review`
   * and `history`. MOD_WRITER_DIDS is the upgrade path and is empty by design,
   * because being able to talk to the bot and being able to add someone to a
   * live block list are different powers with very different costs.
   *
   * Both surfaces consult this one object, which they did not used to: the
   * public path checked MOD_OWNER_DID and the DM path checked the hardcoded
   * ME_DID, so setting the env var moved one boundary and left the other.
   */
  roster: rosterFromEnv(process.env, ME_DID),

  /**
   * Jetstream. One host is enough here in a way it is not for the other
   * consumers: they index records, where a silently dropped event is a hole in
   * a dataset nobody notices. This one answers questions, and a missed trigger
   * shows up immediately as "it didn't reply" — to the one person who can just
   * ask again.
   */
  jetstreamHost:
    process.env.JETSTREAM_HOST || 'jetstream2.us-west.bsky.network',
  reconnectBaseMs: num(process.env.RECONNECT_BASE_MS, 1000),
  reconnectMaxMs: num(process.env.RECONNECT_MAX_MS, 30_000),

  /**
   * Force a reconnect on this interval.
   *
   * The subscription is filtered to one DID, so the socket is silent for hours
   * at a time and "no traffic" cannot be told apart from "the connection died
   * quietly". A dead socket would otherwise be discovered by dame asking a
   * question and getting nothing back. Reconnecting resumes from the stored
   * cursor, so a cycle costs nothing and misses nothing.
   */
  reconnectEveryMs: num(process.env.RECONNECT_EVERY_MS, 15 * 60_000),

  /**
   * DM poll interval.
   *
   * 2s is 0.5 req/s against a documented 10/s per-IP ceiling, and getLog with a
   * stored cursor returns almost nothing when idle. Do not tune this down: the
   * model call is 5-20s, so going from 2s to 500ms moves felt latency by under
   * 10%. The lever for speed is the model, not the transport.
   */
  dmPollMs: num(process.env.DM_POLL_MS, 2000),

  /**
   * How long a loaded reference snapshot is reused, and how long after the last
   * question it is dropped.
   *
   * This box has 512 MB of RAM and three other services on it. The vouch table
   * is ~73k rows and holding it forever to answer a question every few days is
   * the wrong trade; reloading it costs ~74 paged requests, which is seconds,
   * once.
   */
  referenceTtlMs: num(process.env.REFERENCE_TTL_MS, 15 * 60_000),
  referenceIdleMs: num(process.env.REFERENCE_IDLE_MS, 10 * 60_000),

  /** Where the resume point and the answered set live. */
  stateDir: process.env.STATE_DIR || process.cwd(),
  cursorFile: process.env.CURSOR_FILE || 'mod-consumer-cursor.txt',
  answeredFile: process.env.ANSWERED_FILE || 'mod-consumer-answered.json',
  answeredKeep: num(process.env.ANSWERED_KEEP, 500),

  /** true = classify and log, never post or DM. */
  dryRun: String(process.env.DRY_RUN || 'false').toLowerCase() === 'true',

  /** Answer public mentions at all. Off leaves the DM loop running alone. */
  publicReplies:
    String(process.env.PUBLIC_REPLIES || 'true').toLowerCase() === 'true',

  /**
   * The Atmosphere MCP server, which gives the analyst the rest of the network:
   * author feeds, threads, post search, identity history, the atproto docs.
   * Off leaves it with the gate's three tools, which still answer every scoring
   * question — just not "what have they been posting about".
   */
  atmosphere: String(process.env.ATMOSPHERE || 'true').toLowerCase() === 'true',
  atmosphereUrl: process.env.ATMOSPHERE_URL || 'https://aturi.to/api/mcp',
  /** How long the tool list is reused before it is fetched again. */
  atmosphereTtlMs: num(process.env.ATMOSPHERE_TTL_MS, 6 * 60 * 60_000),

  /**
   * How often to re-score the list and report what moved.
   *
   * Weekly by default. The argument the whole gate rests on -- that a sweep
   * knows one moment and nothing about how those accounts relate to dame --
   * does not stop being true after the sweep, and nothing was re-checking.
   * 0 turns it off.
   */
  driftEveryHours: num(process.env.DRIFT_EVERY_HOURS, 168),
  /** How often to ask whether a drift run is due. */
  driftCheckMs: num(process.env.DRIFT_CHECK_MS, 60 * 60_000),

  statsIntervalMs: num(process.env.STATS_INTERVAL_MS, 30 * 60_000),
};

export function assertConfig() {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY &&
    !process.env.SUPABASE_SERVICE_KEY
  ) {
    // Named differently from the other consumers on this box, which use
    // SUPABASE_KEY. api/_lib/modDb.js reads these two names and only these two.
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  // The template ships `MOD_IDENTIFIER=did:plc:` as a prompt to fill in, and a
  // bare prefix would pass a truthiness check, log in on the app password
  // alone, and only fail later in botAgent's account-mismatch guard.
  if (!/^did:[a-z]+:.+/.test(process.env.MOD_IDENTIFIER || '')) {
    missing.push('MOD_IDENTIFIER (a full DID, not a handle)');
  }
  if (!process.env.MOD_APP_PASSWORD) missing.push('MOD_APP_PASSWORD');
  if (!process.env.AI_GATEWAY_API_KEY) missing.push('AI_GATEWAY_API_KEY');
  if (missing.length) {
    throw new Error(`missing required environment: ${missing.join(', ')}`);
  }
  if (!config.ownerDid?.startsWith('did:')) {
    throw new Error('MOD_OWNER_DID must be a DID');
  }
  // A DID that fails to parse is DROPPED by parseDids rather than carried, so
  // a typo in an allowlist would otherwise be silent -- and the failure mode of
  // a silently ignored allowlist is an account that is simply never answered,
  // with nothing in the log to distinguish it from one that was never added.
  for (const [name, raw] of [
    ['MOD_ALLOWED_DIDS', process.env.MOD_ALLOWED_DIDS],
    ['MOD_WRITER_DIDS', process.env.MOD_WRITER_DIDS],
  ]) {
    const given = String(raw ?? '')
      .split(/[\s,]+/)
      .filter(Boolean);
    const kept = parseDids(raw);
    if (given.length !== kept.length) {
      const bad = given.filter((g) => !kept.includes(g));
      throw new Error(
        `${name} has ${bad.length} entry that is not a DID: ${bad.join(', ')}`,
      );
    }
  }
  if (config.roster.all.includes(process.env.MOD_IDENTIFIER)) {
    throw new Error(
      'the moderator account is on its own roster, so it would answer itself',
    );
  }
}
