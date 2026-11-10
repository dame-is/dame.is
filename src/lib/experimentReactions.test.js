import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteReactions,
  experimentRkeyOf,
  fetchReactions,
  isScopeError,
  sessionCanReact,
  setReactionHidden,
  toReaction,
  writeReaction,
} from './experimentReactions.js';
import { ME_DID, EXPERIMENT_NSID, EXPERIMENT_REACTION_NSID } from '../config.js';

const SUBJECT = `at://${ME_DID}/${EXPERIMENT_NSID}/3exp`;
const REACTOR = 'did:plc:reactor';

/** An XRPC error the way @atproto/api throws one. */
function xrpcError(status, error, message) {
  return Object.assign(new Error(message), { status, error });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A visitor's agent that records what it was asked to write. */
function reactorAgent({ createRecord } = {}) {
  const created = vi.fn(
    createRecord ||
      (async () => ({
        data: { uri: `at://${REACTOR}/${EXPERIMENT_REACTION_NSID}/3new`, cid: 'bafynew' },
      })),
  );
  const deleted = vi.fn().mockResolvedValue({});
  return {
    assertDid: REACTOR,
    com: { atproto: { repo: { createRecord: created, deleteRecord: deleted } } },
    created,
    deleted,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toReaction', () => {
  it('keeps what a page shows and drops the rest', () => {
    const r = toReaction({
      did: REACTOR,
      rkey: '3abc',
      cid: 'bafy',
      value: {
        $type: EXPERIMENT_REACTION_NSID,
        subject: SUBJECT,
        reaction: ' more ',
        text: '  Build it.  ',
        createdAt: '2026-11-09T12:00:00Z',
        anything: 'else',
      },
    });
    expect(r).toEqual({
      uri: `at://${REACTOR}/${EXPERIMENT_REACTION_NSID}/3abc`,
      cid: 'bafy',
      did: REACTOR,
      rkey: '3abc',
      value: {
        subject: SUBJECT,
        reaction: 'more',
        text: 'Build it.',
        createdAt: '2026-11-09T12:00:00Z',
      },
      profile: null,
      flagged: false,
    });
  });

  it('is nothing without a verdict', () => {
    expect(toReaction({ did: REACTOR, rkey: '3abc', value: { subject: SUBJECT } })).toBeNull();
    expect(toReaction({ did: REACTOR, rkey: '3abc', value: null })).toBeNull();
  });

  it('flags a note the language filter trips, and only the note', () => {
    const flagged = toReaction({
      did: REACTOR,
      rkey: '3abc',
      value: { subject: SUBJECT, reaction: 'pass', text: 'this is shit' },
    });
    expect(flagged.flagged).toBe(true);
    expect(flagged.value.reaction).toBe('pass');
  });
});

describe('fetchReactions', () => {
  /** Stub fetch: Constellation lists `refs`, Slingshot serves `records`. */
  function stubNetwork({ refs, records = {}, indexStatus = 200 }) {
    const asked = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = new URL(String(input));
        asked.push(url);
        if (url.hostname === 'constellation.microcosm.blue') {
          if (indexStatus !== 200) return json({ error: 'nope' }, indexStatus);
          return json({ total: refs.length, records: refs, cursor: null });
        }
        if (url.hostname === 'slingshot.microcosm.blue') {
          const key = `${url.searchParams.get('repo')}/${url.searchParams.get('rkey')}`;
          return records[key] ? json(records[key]) : json({ error: 'RecordNotFound' }, 400);
        }
        if (url.pathname.endsWith('app.bsky.actor.getProfiles')) {
          return json({
            profiles: url.searchParams
              .getAll('actors')
              .map((did) => ({ did, handle: `${did.slice(-1)}.example.com` })),
          });
        }
        // Anything else (a PLC lookup for a record Slingshot missed) fails.
        return json({ error: 'not stubbed' }, 404);
      }),
    );
    return asked;
  }

  const ref = (did, rkey) => ({ did, collection: EXPERIMENT_REACTION_NSID, rkey });
  const record = (did, rkey, value) => ({
    uri: `at://${did}/${EXPERIMENT_REACTION_NSID}/${rkey}`,
    cid: `cid-${rkey}`,
    value: { subject: SUBJECT, ...value },
  });

  it('hydrates each backlink and names who left it', async () => {
    stubNetwork({
      refs: [ref('did:plc:a', '3a'), ref('did:plc:b', '3b')],
      records: {
        'did:plc:a/3a': record('did:plc:a', '3a', { reaction: 'more', text: 'Yes.' }),
        'did:plc:b/3b': record('did:plc:b', '3b', { reaction: 'curious' }),
      },
    });
    const page = await fetchReactions(SUBJECT);
    expect(page.total).toBe(2);
    expect(page.truncated).toBe(false);
    expect(page.reactions.map((r) => [r.did, r.value.reaction, r.profile?.handle])).toEqual([
      ['did:plc:a', 'more', 'a.example.com'],
      ['did:plc:b', 'curious', 'b.example.com'],
    ]);
  });

  it('drops a record that has gone, or that now points somewhere else', async () => {
    stubNetwork({
      refs: [ref('did:plc:a', '3gone'), ref('did:plc:b', '3moved'), ref('did:plc:c', '3ok')],
      records: {
        'did:plc:b/3moved': {
          ...record('did:plc:b', '3moved', { reaction: 'more' }),
          value: { subject: `at://${ME_DID}/${EXPERIMENT_NSID}/other`, reaction: 'more' },
        },
        'did:plc:c/3ok': record('did:plc:c', '3ok', { reaction: 'pass' }),
      },
    });
    const page = await fetchReactions(SUBJECT);
    expect(page.reactions.map((r) => r.did)).toEqual(['did:plc:c']);
  });

  it('takes a reaction it already holds as read, and copies it', async () => {
    const known = {
      uri: `at://did:plc:a/${EXPERIMENT_REACTION_NSID}/3a`,
      cid: 'cid-3a',
      did: 'did:plc:a',
      rkey: '3a',
      value: { subject: SUBJECT, reaction: 'more' },
      profile: { did: 'did:plc:a', handle: 'held.example.com', displayName: '', avatar: '' },
      flagged: false,
    };
    const asked = stubNetwork({ refs: [ref('did:plc:a', '3a')] });
    const page = await fetchReactions(SUBJECT, { known: [known] });
    expect(page.reactions).toEqual([known]);
    // A snapshot's objects are shared between readers, so never the same one.
    expect(page.reactions[0]).not.toBe(known);
    // One request: the index. No record fetch, no profile lookup.
    expect(asked.map((u) => u.hostname)).toEqual(['constellation.microcosm.blue']);
  });

  it('is null when the backlink index can’t be reached at all', async () => {
    // A 404 is not one of the statuses the client retries, so this is quick.
    stubNetwork({ refs: [], indexStatus: 404 });
    expect(await fetchReactions(SUBJECT)).toBeNull();
    expect(await fetchReactions('')).toBeNull();
  });
});

describe('writeReaction', () => {
  it('writes the reaction to the reactor’s repo, then deletes the one it replaces', async () => {
    const agent = reactorAgent();
    const fresh = await writeReaction(agent, {
      subject: SUBJECT,
      reaction: 'more',
      text: '  Build it.  ',
      replace: ['3old', '3older'],
    });

    const call = agent.created.mock.calls[0][0];
    expect(call.repo).toBe(REACTOR);
    expect(call.collection).toBe(EXPERIMENT_REACTION_NSID);
    expect(call.record).toMatchObject({
      $type: EXPERIMENT_REACTION_NSID,
      subject: SUBJECT,
      reaction: 'more',
      text: 'Build it.',
    });
    expect(Number.isNaN(Date.parse(call.record.createdAt))).toBe(false);

    expect(agent.deleted.mock.calls.map(([c]) => c.rkey)).toEqual(['3old', '3older']);
    expect(fresh).toMatchObject({ did: REACTOR, rkey: '3new', cid: 'bafynew' });
    expect(fresh.value.reaction).toBe('more');
  });

  it('leaves no text field on a reaction without a note', async () => {
    const agent = reactorAgent();
    await writeReaction(agent, { subject: SUBJECT, reaction: 'curious', text: '   ' });
    expect('text' in agent.created.mock.calls[0][0].record).toBe(false);
  });

  it('keeps the old reaction when the new one fails to write', async () => {
    const agent = reactorAgent({
      createRecord: async () => {
        throw xrpcError(500, 'InternalServerError', 'boom');
      },
    });
    await expect(
      writeReaction(agent, { subject: SUBJECT, reaction: 'more', replace: ['3old'] }),
    ).rejects.toThrow('boom');
    expect(agent.deleted).not.toHaveBeenCalled();
  });

  it('still counts as written when deleting the old one fails', async () => {
    const agent = reactorAgent();
    agent.deleted.mockRejectedValue(new Error('nope'));
    const fresh = await writeReaction(agent, {
      subject: SUBJECT,
      reaction: 'pass',
      replace: ['3old'],
    });
    expect(fresh.rkey).toBe('3new');
  });

  it('refuses a verdict it doesn’t offer, a foreign subject and a long note', async () => {
    const agent = reactorAgent();
    await expect(writeReaction(agent, { subject: SUBJECT, reaction: 'love' })).rejects.toThrow();
    await expect(
      writeReaction(agent, { subject: 'at://did:plc:else/x.y.z/1', reaction: 'more' }),
    ).rejects.toThrow();
    await expect(
      writeReaction(agent, { subject: SUBJECT, reaction: 'more', text: 'x'.repeat(301) }),
    ).rejects.toThrow(/300/);
    await expect(writeReaction(null, { subject: SUBJECT, reaction: 'more' })).rejects.toThrow();
    expect(agent.created).not.toHaveBeenCalled();
  });
});

describe('deleteReactions', () => {
  it('deletes each of the reactor’s records from the reaction collection', async () => {
    const agent = reactorAgent();
    await deleteReactions(agent, ['3a', '', '3b']);
    expect(agent.deleted.mock.calls.map(([c]) => [c.repo, c.collection, c.rkey])).toEqual([
      [REACTOR, EXPERIMENT_REACTION_NSID, '3a'],
      [REACTOR, EXPERIMENT_REACTION_NSID, '3b'],
    ]);
  });
});

describe('the session’s grant', () => {
  it('asks the token what it may do', async () => {
    const session = (scope) => ({ getTokenInfo: async () => ({ scope }) });
    expect(await sessionCanReact(session('atproto transition:generic'))).toBe(true);
    expect(await sessionCanReact(session('atproto repo:is.dame.guestbook.entry'))).toBe(false);
    expect(await sessionCanReact(null)).toBe(false);
  });

  it('lets the write be the test when the token can’t say', async () => {
    expect(await sessionCanReact({ getTokenInfo: async () => ({}) })).toBe(true);
    expect(
      await sessionCanReact({
        getTokenInfo: async () => {
          throw new Error('offline');
        },
      }),
    ).toBe(true);
  });

  it('reads a refusal over scope as one, and nothing else', () => {
    expect(isScopeError(xrpcError(403, 'ScopeMissingError', 'Missing required scope'))).toBe(true);
    expect(isScopeError(xrpcError(401, 'InsufficientScope', 'nope'))).toBe(true);
    expect(isScopeError(xrpcError(403, 'Forbidden', 'not allowed'))).toBe(true);
    expect(isScopeError(xrpcError(500, 'InternalServerError', 'boom'))).toBe(false);
    expect(isScopeError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isScopeError(xrpcError(400, 'InvalidRequest', 'bad record'))).toBe(false);
  });
});

describe('setReactionHidden', () => {
  const REACTION = `at://${REACTOR}/${EXPERIMENT_REACTION_NSID}/3abc`;

  function hostAgent(getRecord) {
    const putRecord = vi.fn().mockResolvedValue({ data: {} });
    return {
      assertDid: ME_DID,
      com: { atproto: { repo: { getRecord: vi.fn(getRecord), putRecord } } },
      putRecord,
    };
  }

  it('adds to the experiment’s hidden list under a CID swap, keeping the rest', async () => {
    const agent = hostAgent(async () => ({
      data: {
        cid: 'bafyexp',
        value: { $type: EXPERIMENT_NSID, title: 'An idea', hidden: ['at://old'] },
      },
    }));
    const hidden = await setReactionHidden(agent, '3exp', REACTION, true);
    const call = agent.putRecord.mock.calls[0][0];
    expect(call.rkey).toBe('3exp');
    expect(call.swapRecord).toBe('bafyexp');
    expect(call.record.title).toBe('An idea');
    expect(call.record.hidden).toEqual(['at://old', REACTION]);
    expect(hidden).toEqual(['at://old', REACTION]);
  });

  it('drops the field when the last hidden reaction is restored', async () => {
    const agent = hostAgent(async () => ({
      data: { cid: 'bafyexp', value: { $type: EXPERIMENT_NSID, title: 'An idea', hidden: [REACTION] } },
    }));
    await setReactionHidden(agent, '3exp', REACTION, false);
    expect('hidden' in agent.putRecord.mock.calls[0][0].record).toBe(false);
  });

  it('never writes over an experiment it couldn’t read', async () => {
    const down = hostAgent(async () => {
      throw xrpcError(500, 'InternalServerError', 'boom');
    });
    await expect(setReactionHidden(down, '3exp', REACTION, true)).rejects.toThrow('boom');
    expect(down.putRecord).not.toHaveBeenCalled();

    const gone = hostAgent(async () => {
      throw xrpcError(400, 'RecordNotFound', 'Could not locate record');
    });
    await expect(setReactionHidden(gone, '3exp', REACTION, true)).rejects.toThrow(/no longer/);
    expect(gone.putRecord).not.toHaveBeenCalled();
  });
});

describe('experimentRkeyOf', () => {
  it('reads the record key off an experiment’s at-uri, and off nothing else', () => {
    expect(experimentRkeyOf(SUBJECT)).toBe('3exp');
    expect(experimentRkeyOf(`at://did:plc:else/${EXPERIMENT_NSID}/3exp`)).toBeNull();
    expect(experimentRkeyOf(`at://${ME_DID}/app.bsky.feed.post/3exp`)).toBeNull();
    expect(experimentRkeyOf('')).toBeNull();
  });
});
