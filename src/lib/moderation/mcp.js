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

import { jsonSchema, dynamicTool } from 'ai';
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
 * Turn the server's tool list into tools `generateText` can call.
 *
 * `dynamicTool` + `jsonSchema` because the shapes are only known at runtime —
 * hand-writing 38 zod schemas would be a copy that goes stale the first time
 * aturi.to changes a parameter.
 *
 * @param {Array} listed         from tools/list
 * @param {object} opts
 * @param {Function} opts.call   (name, args) => Promise<result>
 * @param {Function} [opts.log]
 */
export function bridgeTools(listed, { call, log = () => {} }) {
  const tools = {};
  const skipped = [];

  for (const t of listed || []) {
    if (!t?.name) continue;
    if (!READ_VERB.test(t.name)) {
      skipped.push(t.name);
      continue;
    }
    tools[t.name] = dynamicTool({
      description: t.description || `Atmosphere tool ${t.name}`,
      inputSchema: jsonSchema(
        t.inputSchema || { type: 'object', properties: {} },
      ),
      execute: async (args) => {
        try {
          const result = await call(t.name, args);
          // Fenced WHOLE. The structural half (counts, URIs, timestamps) is
          // harmless to read as data, and splitting it from the prose half so
          // one could be trusted would mean deciding which fields are safe on
          // a schema this file does not own.
          return untrusted(`atmosphere:${t.name}`, flatten(result));
        } catch (err) {
          // A failed lookup is an answer the analyst can report, not a reason
          // to lose the turn. aturi.to being down should cost a sentence.
          return `The ${t.name} lookup failed: ${err.message}`;
        }
      },
    });
  }

  if (skipped.length) {
    log('Atmosphere tools withheld — not a read verb', { skipped });
  }
  return tools;
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
