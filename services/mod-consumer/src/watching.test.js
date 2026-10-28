// The timed loops and the one stored question per convo: a digest or an alert
// must never replace a question dame is in the middle of answering.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { dm_choice: [] };

vi.mock('../../../api/_lib/modDb.js', () => ({
  select: vi.fn(async (table, { eq = {} } = {}) =>
    (db[table] || []).filter((r) =>
      Object.entries(eq).every(([k, v]) => r[k] === v),
    ),
  ),
  upsert: vi.fn(async (table, rows) => {
    for (const row of rows) {
      const list = (db[table] ||= []);
      const at = list.findIndex((r) => r.convo_id === row.convo_id);
      if (at === -1) list.push({ ...row });
      else list[at] = { ...list[at], ...row };
    }
    return rows.length;
  }),
  update: vi.fn(async () => {}),
}));

const watch = {
  liveWatches: vi.fn(async () => []),
  checkWatch: vi.fn(async () => {}),
  digestFor: vi.fn(async () => null),
  endExpired: vi.fn(async () => []),
  ownPostAlerts: vi.fn(async () => []),
};
vi.mock('../../../api/_lib/watch.js', () => ({
  ...watch,
  alertText: ({ uri }) => ({
    text: `Your post ${uri} took off.`,
    pending: [`watch ${uri}`],
    describe: 'watch it',
    links: [],
  }),
  WATCH_EVERY_MS: 60_000,
}));

const { say, tickWatches, tickAlerts } = await import('./watching.js');
const { savePending, readPending } =
  await import('../../../api/_lib/chatUx.js');

function chat() {
  const sent = [];
  return {
    sent,
    chat: {
      bsky: {
        convo: {
          sendMessage: async ({ message }) => {
            sent.push(message.text);
            return { data: { id: `m${sent.length}` } };
          },
        },
      },
    },
  };
}

const DIGEST = {
  text: 'Watching the post: 4 new, 3 read as hostile.',
  pending: ['approve 1c2d3e4f hostile'],
  describe: 'add the 3 read as hostile',
};

beforeEach(() => {
  db.dm_choice = [];
  for (const fn of Object.values(watch)) fn.mockClear();
});

describe('a timed message that asks something', () => {
  it('stores its question when nothing else is waiting', async () => {
    const c = chat();
    await say(c, 'convo1', DIGEST);
    expect(c.sent[0]).toMatch(/👍 or "yes" to: add the 3/);
    const p = await readPending('convo1');
    expect(p).toMatchObject({
      commands: ['approve 1c2d3e4f hostile'],
      background: true,
    });
  });

  it('leaves a question from the conversation alone, and does not offer a 👍 of its own', async () => {
    await savePending('convo1', {
      commands: ['list remove @x.test'],
      describe: 'remove @x.test',
      messageIds: ['asked'],
    });
    const c = chat();
    await say(c, 'convo1', DIGEST);
    expect(c.sent[0]).toBe(DIGEST.text);
    expect(await readPending('convo1')).toMatchObject({
      commands: ['list remove @x.test'],
      message_ids: ['asked'],
    });
  });

  it('replaces an earlier timed question, which is what it always did', async () => {
    await say(chat(), 'convo1', {
      ...DIGEST,
      pending: ['approve aaaa1111 hostile'],
    });
    await say(chat(), 'convo1', DIGEST);
    expect((await readPending('convo1')).commands).toEqual([
      'approve 1c2d3e4f hostile',
    ]);
  });
});

describe('the loops wait for an answer', () => {
  it('holds a watch digest while a question is open, and keeps reading', async () => {
    await savePending('convo1', {
      commands: ['list remove @x.test'],
      describe: 'remove @x.test',
      messageIds: ['asked'],
    });
    watch.liveWatches.mockResolvedValueOnce([
      { id: 'w1', convo_id: 'convo1', uri: 'at://p', last_checked_at: null },
    ]);
    const c = chat();
    await tickWatches({
      chat: c,
      agent: {},
      reference: async () => ({ io: { score: () => {} } }),
      model: 'm',
    });
    expect(watch.checkWatch).toHaveBeenCalled();
    expect(watch.digestFor).not.toHaveBeenCalled();
    expect(c.sent).toEqual([]);
  });

  it('holds an alert while a question is open, before it is used up', async () => {
    await savePending('convo1', {
      commands: ['list remove @x.test'],
      describe: 'remove @x.test',
      messageIds: ['asked'],
    });
    const c = chat();
    const n = await tickAlerts({ chat: c, convoFor: async () => 'convo1' });
    expect(n).toBe(0);
    expect(watch.ownPostAlerts).not.toHaveBeenCalled();
    expect(c.sent).toEqual([]);
  });

  it('sends an alert when nothing is waiting', async () => {
    watch.ownPostAlerts.mockResolvedValueOnce([{ uri: 'at://p', growth: 20 }]);
    const c = chat();
    expect(await tickAlerts({ chat: c, convoFor: async () => 'convo1' })).toBe(
      1,
    );
    expect(c.sent[0]).toMatch(/took off/);
  });
});
