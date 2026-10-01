// Whole DM passes for the chat UX: the quick lane, reactions, the burst
// summary, questions a thumbs-up answers, the post card, memory and watch
// commands. Against an in-memory mod schema and a fake chat service, with the
// list write and the plan functions faked, so nothing here reaches a network.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = {
  dm_cursor: [{ id: 1, cursor: 'c0' }],
  dm_choice: [],
  memory: [],
};

vi.mock('./modDb.js', () => ({
  select: vi.fn(async (table, opts = {}) => {
    let rows = db[table] || [];
    for (const [k, v] of Object.entries(opts.eq || {})) {
      rows = rows.filter((r) => r[k] === v);
    }
    for (const [k, v] of Object.entries(opts.is || {})) {
      if (v === 'null') rows = rows.filter((r) => r[k] == null);
    }
    return rows;
  }),
  selectAll: vi.fn(async () => []),
  update: vi.fn(async (table, { eq }, patch) => {
    for (const r of db[table] || []) {
      if (Object.entries(eq).every(([k, v]) => r[k] === v))
        Object.assign(r, patch);
    }
  }),
  upsert: vi.fn(async (table, rows) => {
    if (table === 'dm_choice') {
      for (const row of rows) {
        const i = db.dm_choice.findIndex((r) => r.convo_id === row.convo_id);
        if (i === -1) db.dm_choice.push({ ...row });
        else db.dm_choice[i] = { ...db.dm_choice[i], ...row };
      }
    }
    if (table === 'memory') {
      for (const row of rows) {
        db.memory.push({
          id: `n${db.memory.length + 1}`,
          created_at: new Date().toISOString(),
          removed_at: null,
          ...row,
        });
      }
    }
    return rows.length;
  }),
}));

const config = { value: null };
vi.mock('./agentConfig.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadAgentConfig: async () => config.value,
}));

const listWrite = { applyCommand: vi.fn() };
vi.mock('./listWrite.js', async (importOriginal) => ({
  ...(await importOriginal()),
  applyCommand: (...args) => listWrite.applyCommand(...args),
}));

const PLAN_ROW = {
  id: '1c2d3e4f-0000-4000-8000-000000000000',
  totals: { kind: 'everyone' },
};
const plans = {
  proposePlan: vi.fn(),
  findPlan: vi.fn(async (code) => (code === '1c2d3e4f' ? PLAN_ROW : null)),
  applyPlan: vi.fn(async () => ({
    ok: true,
    added: 12,
    message: 'Added 12 to the list.',
  })),
};
vi.mock('./bulkPlan.js', async (importOriginal) => ({
  ...(await importOriginal()),
  proposePlan: (...a) => plans.proposePlan(...a),
  findPlan: (...a) => plans.findPlan(...a),
  applyPlan: (...a) => plans.applyPlan(...a),
}));

const watch = {
  startWatch: vi.fn(async ({ target }) => ({
    watch: { uri: target, until: 'later' },
    plan: { total: 30, code: '9e8d7c6b' },
    extended: false,
  })),
  stopWatch: vi.fn(async () => null),
  liveWatches: vi.fn(async () => []),
};
vi.mock('./watch.js', async (importOriginal) => ({
  ...(await importOriginal()),
  startWatch: (...a) => watch.startWatch(...a),
  stopWatch: (...a) => watch.stopWatch(...a),
  liveWatches: (...a) => watch.liveWatches(...a),
}));

vi.mock('../../src/lib/moderation/target.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveActor: async (a) => `did:plc:${String(a).replace(/\W/g, '')}`,
}));

const { runDmPass } = await import('./dmLoop.js');
const { resetQuiet } = await import('./chatUx.js');

const OWNER = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
const BOT = 'did:plc:bot';
const POST = 'at://did:plc:author/app.bsky.feed.post/3abc';
const roster = {
  owner: OWNER,
  answers: (d) => d === OWNER,
  writes: (d) => d === OWNER,
  all: [OWNER],
  allWriters: [OWNER],
};

let nextId = 0;
function chatWith(logs) {
  const sent = [];
  const reactions = [];
  const chat = {
    chat: {
      bsky: {
        convo: {
          getLog: async () => ({ data: { cursor: 'c1', logs } }),
          getMessages: async () => ({ data: { messages: [] } }),
          sendMessage: async ({ message }) => {
            sent.push(message.text);
            nextId += 1;
            return { data: { id: `b${nextId}` } };
          },
          addReaction: async ({ messageId, value }) => {
            reactions.push(`+${value}@${messageId}`);
            return {};
          },
          removeReaction: async ({ messageId, value }) => {
            reactions.push(`-${value}@${messageId}`);
            return {};
          },
        },
      },
    },
  };
  return { chat, sent, reactions };
}

const msg = (id, text, extra = {}) => ({
  $type: 'chat.bsky.convo.defs#logCreateMessage',
  convoId: 'convo1',
  message: {
    id,
    text,
    sender: { did: OWNER },
    sentAt: new Date().toISOString(),
    ...extra,
  },
});
const shared = (id, text) =>
  msg(id, text, { embed: { record: { uri: POST } } });
const thumbs = (messageId, value = '👍') => ({
  $type: 'chat.bsky.convo.defs#logAddReaction',
  convoId: 'convo1',
  message: { id: messageId, sender: { did: BOT } },
  reaction: { value, sender: { did: OWNER } },
});

const io = {
  lookUp: async () => null,
  preflight: async () => ({}),
  referenceStatus: () => ({}),
};

function pass(chat, extra = {}) {
  return runDmPass({
    chat,
    writeAgent: { session: { did: BOT } },
    getIo: async () => io,
    botDid: BOT,
    roster,
    generate: extra.generate || vi.fn(async () => ({ text: 'ok', steps: [] })),
    mode: 'agent',
    model: 'test/model',
    ...extra,
  });
}

beforeEach(() => {
  db.dm_choice.length = 0;
  db.memory.length = 0;
  config.value = null;
  resetQuiet();
  listWrite.applyCommand.mockReset();
  listWrite.applyCommand.mockImplementation(async (_agent, action, actor) => ({
    ok: true,
    changed: true,
    account: {
      handle: `${String(actor).replace(/\W/g, '')}.test`,
      band: 'UNKNOWN',
    },
    message: `${action === 'list_add' ? 'Added' : 'Removed'} ${actor}.`,
  }));
  plans.proposePlan.mockReset();
  plans.applyPlan.mockClear();
  watch.startWatch.mockClear();
});

describe('the quick lane', () => {
  it("blocks a shared post's author with a reaction and no reply", async () => {
    const generate = vi.fn();
    const { chat, sent, reactions } = chatWith([shared('m1', 'block')]);
    await pass(chat, { generate });
    expect(generate).not.toHaveBeenCalled();
    expect(listWrite.applyCommand.mock.calls[0].slice(1, 3)).toEqual([
      'list_add',
      'did:plc:author',
    ]);
    expect(listWrite.applyCommand.mock.calls[0][3].via).toBe('command');
    expect(sent).toEqual([]);
    expect(reactions).toEqual(['+👀@m1', '-👀@m1', '+✅@m1']);
  });

  it('sums up a burst in one message', async () => {
    const { chat, sent } = chatWith([
      shared('m1', 'block'),
      shared('m2', 'block em'),
    ]);
    await pass(chat);
    expect(listWrite.applyCommand).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^Blocked 2 in the last 1 min: @/);
  });

  it('says so out loud for a CONNECTED account, and for the veto', async () => {
    listWrite.applyCommand.mockResolvedValueOnce({
      ok: true,
      changed: true,
      account: {
        handle: 'near.test',
        band: 'CONNECTED',
        vouches: 5,
        followers: 7300,
      },
      message: 'Added.',
    });
    let { chat, sent } = chatWith([msg('m1', 'block @near.test')]);
    await pass(chat);
    expect(sent[0]).toBe(
      'Blocked @near.test. Worth knowing: CONNECTED, followed by 5 people you follow, 7,300 followers. "unblock @near.test" takes it back.',
    );

    listWrite.applyCommand.mockResolvedValueOnce({
      ok: false,
      vetoed: 'you follow them',
      message: 'friend.test is PROTECTED (you follow them).',
    });
    let reactions;
    ({ chat, sent, reactions } = chatWith([msg('m2', 'block @friend.test')]));
    await pass(chat);
    expect(sent[0]).toMatch(/PROTECTED/);
    expect(reactions).toContain('+❌@m2');
  });

  it('leaves two things at once to the agent', async () => {
    const generate = vi.fn(async () => ({ text: 'Done.', steps: [] }));
    const { chat } = chatWith([
      shared('m1', 'block this account and everyone that liked this post'),
    ]);
    await pass(chat, { generate });
    expect(generate).toHaveBeenCalled();
    expect(listWrite.applyCommand).not.toHaveBeenCalled();
  });

  it('still takes "!" to the classic path and "^" to the agent', async () => {
    let { chat, sent } = chatWith([msg('m1', '!block @x.test')]);
    await pass(chat);
    // Classic: a receipt, not a quiet ✅.
    expect(sent[0]).toMatch(/Added/);

    const generate = vi.fn(async () => ({ text: 'Looked.', steps: [] }));
    ({ chat } = chatWith([shared('m2', '^ block')]));
    await pass(chat, { generate });
    expect(generate).toHaveBeenCalled();
  });
});

describe('the post card', () => {
  const plan = {
    code: '1c2d3e4f',
    planId: PLAN_ROW.id,
    uri: POST,
    total: 14,
    withText: 0,
    byBand: { UNKNOWN: 12, PERIPHERAL: 2 },
    engagements: { like: 14 },
    author: { did: 'did:plc:author', handle: 'poster.test', band: 'UNKNOWN' },
  };

  it('answers a bare post with a card, then runs the words', async () => {
    plans.proposePlan.mockResolvedValue(plan);
    let { chat, sent } = chatWith([shared('m1', '')]);
    await pass(chat);
    expect(sent[0]).toContain(
      'Reply with: author · likers · unknowns · everyone',
    );

    ({ chat, sent } = chatWith([msg('m2', 'likers')]));
    await pass(chat);
    // "likers" out of a scan of everyone: every band but PROTECTED, likers only.
    expect(plans.applyPlan.mock.calls[0][2]).toEqual([
      'UNKNOWN',
      'PERIPHERAL',
      'NOTABLE',
      'CONNECTED',
    ]);
    expect(plans.applyPlan.mock.calls[0][3]).toEqual({ kinds: ['likers'] });
    expect(sent[0]).toMatch(/Added 12/);
  });

  it('blocks the author instead, when that is what a bare post means', async () => {
    config.value = { barePost: 'author' };
    const { chat } = chatWith([shared('m1', '')]);
    await pass(chat);
    expect(plans.proposePlan).not.toHaveBeenCalled();
    expect(listWrite.applyCommand.mock.calls[0][2]).toBe('did:plc:author');
  });
});

describe('questions a thumbs-up answers', () => {
  // The agent asks first; the question is stored with the message that asked.
  const asking = vi.fn(async (opts) => {
    await opts.tools.add_to_list.execute({
      accounts: ['@a.test'],
      ask_first: true,
    });
    return { text: 'Want me to block @a.test?', steps: [{}] };
  });

  it('runs exactly the stored change on "yes", without the model', async () => {
    let { chat, sent } = chatWith([msg('m1', 'should I block @a.test?')]);
    await pass(chat, { generate: asking });
    expect(sent[0]).toBe(
      'Want me to block @a.test?\n\n👍 or "yes" to: add @a.test to the list',
    );
    expect(db.dm_choice[0].pending.commands).toEqual(['list add @a.test']);
    expect(listWrite.applyCommand).not.toHaveBeenCalled();

    const generate = vi.fn();
    ({ chat, sent } = chatWith([msg('m2', 'yes')]));
    await pass(chat, { generate });
    expect(generate).not.toHaveBeenCalled();
    expect(listWrite.applyCommand.mock.calls[0].slice(1, 3)).toEqual([
      'list_add',
      'a.test',
    ]);
    expect(db.dm_choice[0].pending).toBe(null);
  });

  it('runs it on a 👍 on the question, and drops it on "no"', async () => {
    let { chat } = chatWith([msg('m1', 'should I block @a.test?')]);
    await pass(chat, { generate: asking });
    const asked = db.dm_choice[0].pending.message_ids[0];

    ({ chat } = chatWith([thumbs('not-the-question')]));
    await pass(chat);
    expect(listWrite.applyCommand).not.toHaveBeenCalled();

    ({ chat } = chatWith([thumbs(asked)]));
    await pass(chat);
    expect(listWrite.applyCommand).toHaveBeenCalledTimes(1);

    ({ chat } = chatWith([msg('m3', 'should I block @a.test?')]));
    await pass(chat, { generate: asking });
    let sent;
    ({ chat, sent } = chatWith([msg('m4', 'no')]));
    await pass(chat);
    expect(sent).toEqual(['Okay, nothing changed.']);
    expect(listWrite.applyCommand).toHaveBeenCalledTimes(1);
  });

  it('lets the question lapse when the conversation moves on', async () => {
    let { chat } = chatWith([msg('m1', 'should I block @a.test?')]);
    await pass(chat, { generate: asking });
    ({ chat } = chatWith([msg('m2', 'actually what did they post?')]));
    await pass(chat, {
      generate: vi.fn(async () => ({ text: 'Mostly memes.', steps: [] })),
    });
    ({ chat } = chatWith([msg('m3', 'yes')]));
    await pass(chat, {
      generate: vi.fn(async () => ({ text: 'Yes to what?', steps: [] })),
    });
    expect(listWrite.applyCommand).not.toHaveBeenCalled();
  });
});

describe('memory and watching', () => {
  it("keeps a note from dame's own words and reads it to the agent", async () => {
    let { chat, sent } = chatWith([
      msg('m1', 'remember: never block people who only liked'),
    ]);
    await pass(chat);
    expect(db.memory.map((n) => n.text)).toEqual([
      'never block people who only liked',
    ]);
    expect(sent[0]).toMatch(/^Noted/);

    const generate = vi.fn(async () => ({ text: 'ok', steps: [] }));
    ({ chat } = chatWith([msg('m2', 'what should I do about the quotes?')]));
    await pass(chat, { generate });
    expect(generate.mock.calls[0][0].instructions.content).toContain(
      '- never block people who only liked',
    );
  });

  it('starts a watch on the post sent with it', async () => {
    const { chat, sent } = chatWith([shared('m1', 'watch this for 12h')]);
    await pass(chat);
    expect(watch.startWatch).toHaveBeenCalledWith({
      convoId: 'convo1',
      target: POST,
      hours: 12,
      auto: false,
    });
    expect(sent[0]).toMatch(/^Watching it for 12h/);
  });
});
