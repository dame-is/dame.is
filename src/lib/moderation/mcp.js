// The Atmosphere MCP server, as tools the analyst can call.
//
// aturi.to/api/mcp is dame's own service and exposes 38 read tools over the
// atproto network: author feeds, threads, post search, identity history,
// lexicon activity, the atproto docs. Wiring it in is what turns the analyst
// from "scores a DID" into something that can answer "what has this person been
// posting about", which is a different and more useful question.
//
// WHO IS TRUSTED HERE, AND WHO IS NOT. The server is first-party; the CONTENT it
// returns is not. Post text, bios and display names are written by the people
// being analysed, and this is the change that puts a lot more of that writing in
// front of the model than the handful of handles it saw before. So every result
// goes back fenced, whole, as data.
//
// THE GUARD IS AN ALLOW-PATTERN, NOT A DENY-PATTERN. A denylist of write verbs
// only protects against the writes someone thought of; this file does not
// control what aturi.to publishes next, and a `create_record` added there next
// month would walk straight into a system whose stated rule is that the analyst
// can only look. So a tool is available only if its name begins with a verb that
// reads. Everything else is dropped, loudly enough to see in the log.
//
// Note `list_` is a READ here and a write in buildTools' guard. Both are right:
// in MCP `list_records` enumerates, and in this codebase "listing someone" means
// adding them to a modlist. The two namespaces keep their own vocabularies, and
// conflating them is how you would end up allowing the wrong one.

import { jsonSchema, dynamicTool, tool } from 'ai';
import { z } from 'zod';
import { untrusted } from './agent.js';

export const ATMOSPHERE_URL = 'https://aturi.to/api/mcp';

/** A tool is exposed only if it starts with a verb that reads. */
export const READ_VERB = /^(get|list|search|resolve|describe|read|sample)_/;

/**
 * Per-call ceiling.
 *
 * Most calls answer in about a second, but `sample_jetstream` opens a live
 * firehose window and returns when it decides to. A tool loop that can spend
 * eight steps is a tool loop that can spend eight of those, and the person
 * waiting is watching a DM thread do nothing.
 */
const CALL_TIMEOUT_MS = 20_000;

/** Streamable HTTP answers as SSE; plain JSON is also valid. Accept both. */
function parseBody(text) {
  const data = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('');
  return JSON.parse(data || text);
}

/**
 * A client for a STATELESS MCP server.
 *
 * aturi.to returns no `Mcp-Session-Id` and accepts `tools/call` with no prior
 * handshake, so there is no session to keep, resume or expire — which is why
 * this is forty lines of JSON-RPC rather than a dependency. If the server ever
 * starts issuing session ids, this is the file that has to learn about them.
 */
export function createAtmosphereClient({
  url = ATMOSPHERE_URL,
  fetchImpl = fetch,
  timeoutMs = CALL_TIMEOUT_MS,
} = {}) {
  let id = 0;

  async function rpc(method, params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: (id += 1), method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`atmosphere ${method} failed: ${res.status}`);
      }
      const body = parseBody(await res.text());
      if (body.error) {
        throw new Error(
          `atmosphere ${method}: ${body.error.message || JSON.stringify(body.error)}`,
        );
      }
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    listTools: () => rpc('tools/list', {}),
    callTool: (name, args) =>
      rpc('tools/call', { name, arguments: args || {} }),
  };
}

/** Result content as one string, whatever shape the server used. */
export function flatten(result) {
  const parts = result?.content;
  if (!Array.isArray(parts)) return JSON.stringify(result ?? null);
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : JSON.stringify(p)))
    .join('\n');
}

/**
 * A one-line summary for the catalogue.
 *
 * These descriptions are written as prose ("You have an account and want...")
 * and run to 435 characters. The catalogue only needs to be enough to pick from,
 * so it takes the first clause and stops.
 */
function summarise(description) {
  const first = String(description || '')
    .split(/[.\n]/)[0]
    .replace(/^You (have|want|need|already have)\s*/i, '')
    .trim();
  return first.length > 64 ? `${first.slice(0, 61)}...` : first;
}

/**
 * ONE tool instead of thirty-eight.
 *
 * Measured: exposing all 38 as separate tools cost 7,346 tokens of definitions,
 * resent on every step of the loop. Real usage went from ~1,900 input tokens a
 * turn to ~15,800 the day it landed. The tools are worth having; paying for all
 * of their schemas on every step of every turn, including the turns that never
 * touch the network, is not.
 *
 * So the model gets a dispatcher carrying a catalogue of names, and fetches a
 * schema only for the tool it actually wants. An unfamiliar tool costs one extra
 * step; a familiar one costs none. Every tool stays reachable.
 *
 * `describe` is also the error path: a call with bad arguments comes back with
 * the schema rather than just a complaint, so the retry has what it needs.
 */
export function bridgeTools(listed, { call, log = () => {} }) {
  const allowed = new Map();
  const skipped = [];

  for (const t of listed || []) {
    if (!t?.name) continue;
    if (!READ_VERB.test(t.name)) {
      skipped.push(t.name);
      continue;
    }
    allowed.set(t.name, t);
  }
  if (skipped.length) {
    log('Atmosphere tools withheld, not a read verb', { skipped });
  }
  if (!allowed.size) return {};

  const catalogue = [...allowed.values()]
    .map((t) => `${t.name}: ${summarise(t.description)}`)
    .join('\n');

  const describe = (t) => ({
    tool: t.name,
    description: t.description,
    inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
  });

  return {
    atmosphere: tool({
      description:
        'Read the atproto network: profiles, author feeds, threads, post search, ' +
        'identity history, lexicon activity, the atproto docs. Read-only. ' +
        "Pass `tool` plus `args`. If you are unsure of a tool's arguments, call " +
        'it with `describe: true` first to get its schema.\n\nAvailable:\n' +
        catalogue,
      inputSchema: z.object({
        tool: z.string().describe('one of the names listed in the description'),
        args: z
          .record(z.string(), z.any())
          .optional()
          .describe('arguments for that tool'),
        describe: z
          .boolean()
          .optional()
          .describe('true to return the schema instead of calling it'),
      }),
      execute: async ({ tool: name, args, describe: wantSchema }) => {
        const t = allowed.get(name);
        if (!t) {
          return `No atmosphere tool called ${name}. Names are listed in this tool's description.`;
        }
        if (wantSchema) return describe(t);
        try {
          const result = await call(name, args || {});
          // Fenced WHOLE. The structural half (counts, URIs, timestamps) is
          // harmless to read as data, and splitting it from the prose half so
          // one could be trusted would mean deciding which fields are safe on
          // a schema this file does not own.
          return untrusted(`atmosphere:${name}`, flatten(result));
        } catch (err) {
          // Hand back the schema with the failure: a bad-arguments error that
          // does not say what the arguments are costs another round trip to
          // find out.
          return {
            error: `The ${name} lookup failed: ${err.message}`,
            ...describe(t),
          };
        }
      },
    }),
  };
}

/**
 * Every allowed Atmosphere tool, ready to merge into the analyst's toolset.
 *
 * Returns an empty object rather than throwing when the server cannot be
 * reached: the gate's own tools are the ones that matter, and losing the
 * network's colour commentary must not stop dame getting a band back.
 */
export async function loadAtmosphereTools({
  client = createAtmosphereClient(),
  log = () => {},
} = {}) {
  try {
    const listed = await client.listTools();
    const tools = bridgeTools(listed?.tools, {
      call: (name, args) => client.callTool(name, args),
      log,
    });
    log('Atmosphere tools loaded', { count: Object.keys(tools).length });
    return tools;
  } catch (err) {
    log('Atmosphere unavailable — continuing with the gate tools only', {
      err: err.message,
    });
    return {};
  }
}
