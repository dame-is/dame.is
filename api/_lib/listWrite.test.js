import { describe, it, expect, vi, beforeEach } from 'vitest';

const protectedRows = new Map();
const decisions = [];
vi.mock('./modDb.js', () => ({
  select: vi.fn(async (table, { eq }) =>
    table === 'protected' && protectedRows.has(eq.did)
      ? [{ reason: protectedRows.get(eq.did) }]
      : [],
  ),
  selectAll: vi.fn(async (table, { eq = {}, where = {} }) =>
    table === 'decision'
      ? decisions.filter(
          (r) =>
            r.action === eq.action &&
            where.did.includes(`"${r.did}"`) &&
            r.acted_at &&
            !r.undone_at,
        )
      : [],
  ),
  upsert: vi.fn(async (table, rows) => {
    if (table === 'decision') {
      for (const row of rows) {
        const at = decisions.findIndex(
          (r) => r.plan_id === row.plan_id && r.did === row.did,
        );
        if (at === -1) decisions.push({ ...row });
        else decisions[at] = { ...decisions[at], ...row };
      }
    }
    return rows.length;
  }),
}));
const graph = {
  rkeysForWrite: vi.fn(),
  noteListed: vi.fn(),
  noteUnlisted: vi.fn(),
};
vi.mock('./graphFacts.js', () => graph);
vi.mock('../../src/lib/moderation/target.js', () => ({
  resolveActor: vi.fn(async (a) =>
    a.startsWith('did:') ? a : `did:plc:${a.replace(/\W/g, '')}`,
  ),
}));

const { applyCommand } = await import('./listWrite.js');

process.env.MOD_LIST_URI = 'at://did:plc:bot/app.bsky.graph.list/3list';

function agent() {
  return {
    session: { did: 'did:plc:bot' },
    com: {
      atproto: {
        repo: {
          createRecord: vi.fn(async () => ({
            data: { uri: 'at://did:plc:bot/app.bsky.graph.listitem/rNew' },
          })),
          deleteRecord: vi.fn(async () => ({})),
          listRecords: vi.fn(() => {
            throw new Error('the repo walk is the fallback, not the path');
          }),
        },
      },
    },
  };
}

beforeEach(() => {
  protectedRows.clear();
  decisions.length = 0;
  graph.rkeysForWrite.mockReset();
  graph.noteListed.mockReset();
  graph.noteUnlisted.mockReset();
});

describe('one block', () => {
  it('checks membership once, scores alongside, and records the write', async () => {
    graph.rkeysForWrite.mockResolvedValue([]);
    const a = agent();
    const lookUp = vi.fn(async () => ({
      band: 'UNKNOWN',
      handle: 'x.test',
      blocksYou: true,
    }));
    const out = await applyCommand(a, 'list_add', 'x.test', { lookUp });
    expect(out).toMatchObject({
      ok: true,
      changed: true,
      account: { handle: 'x.test', blocksYou: true },
    });
    expect(a.com.atproto.repo.createRecord).toHaveBeenCalledTimes(1);
    expect(graph.noteListed).toHaveBeenCalledWith(
      process.env.MOD_LIST_URI,
      'did:plc:xtest',
      'rNew',
    );
  });

  it('writes nothing for someone already on the list', async () => {
    graph.rkeysForWrite.mockResolvedValue(['r1']);
    const a = agent();
    const out = await applyCommand(a, 'list_add', 'x.test');
    expect(out).toMatchObject({ ok: true, already: true, changed: false });
    expect(a.com.atproto.repo.createRecord).not.toHaveBeenCalled();
  });

  it('keeps the PROTECTED veto', async () => {
    graph.rkeysForWrite.mockResolvedValue([]);
    protectedRows.set('did:plc:friendtest', 'you follow them');
    const a = agent();
    const out = await applyCommand(a, 'list_add', 'friend.test');
    expect(out).toMatchObject({ ok: false, vetoed: 'you follow them' });
    expect(a.com.atproto.repo.createRecord).not.toHaveBeenCalled();
  });
});

describe('one unblock', () => {
  it('deletes every copy, so an account two plans added really comes off', async () => {
    graph.rkeysForWrite.mockResolvedValue(['r1', 'r2']);
    const a = agent();
    const out = await applyCommand(a, 'list_remove', 'x.test');
    expect(out).toMatchObject({ ok: true, changed: true });
    expect(a.com.atproto.repo.deleteRecord).toHaveBeenCalledTimes(2);
    expect(graph.noteUnlisted).toHaveBeenCalled();
  });

  it('closes the decision that added them, so "undo last" moves past it', async () => {
    decisions.push({
      plan_id: 'plan-block',
      did: 'did:plc:xtest',
      band: 'UNKNOWN',
      action: 'list_add',
      acted_at: '2026-10-01T10:00:00Z',
      undone_at: null,
    });
    graph.rkeysForWrite.mockResolvedValue(['r1']);
    const out = await applyCommand(agent(), 'list_remove', 'x.test', {
      raw: 'unblock @x.test',
    });
    expect(out).toMatchObject({ ok: true, changed: true });
    const block = decisions.find((r) => r.plan_id === 'plan-block');
    expect(block.undone_at).toBeTruthy();
    expect(block.undo_reason).toBe('unblock @x.test');
    // The unblock is still recorded as an action of its own.
    expect(decisions.some((r) => r.action === 'list_remove')).toBe(true);
  });

  it('treats an already-deleted copy as done, and an unknown list as no', async () => {
    graph.rkeysForWrite.mockResolvedValue(['r1']);
    const a = agent();
    a.com.atproto.repo.deleteRecord.mockRejectedValue(
      new Error('Could not locate record'),
    );
    expect((await applyCommand(a, 'list_remove', 'x.test')).ok).toBe(true);

    graph.rkeysForWrite.mockResolvedValue(null);
    const out = await applyCommand(agent(), 'list_remove', 'x.test');
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/could not check/);
  });
});
