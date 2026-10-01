// The review queue, against an in-memory mod schema, a stubbed Constellation
// and a stubbed AppView.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const LIST = 'at://did:plc:bot/app.bsky.graph.list/3list';
const AUDIT = {
  id: 'audit-1',
  list_uri: LIST,
  started_at: '2026-10-01T01:24:50Z',
  finished_at: '2026-10-01T01:25:38Z',
  total: 9000,
  scored: 9000,
};

const db = { audit_item: [], decision: [], review: [], writes: [] };
const members = new Map(); // did -> rkeys on our list (absent = Constellation says none)
let constellationDown = false;

vi.mock('./modDb.js', () => {
  const match = (row, { eq = {}, where = {} } = {}) => {
    for (const [k, v] of Object.entries(eq)) if (row[k] !== v) return false;
    for (const [k, v] of Object.entries(where)) {
      const val = row[k];
      if (v === 'not.is.null' && val == null) return false;
      if (v === 'is.null' && val != null) return false;
      if (v.startsWith('neq.') && val === v.slice(4)) return false;
      if (v.startsWith('in.(')) {
        const set = v
          .slice(4, -1)
          .split(',')
          .map((x) => x.replace(/"/g, ''));
        if (!set.includes(val)) return false;
      }
      if (v.startsWith('like.')) {
        const needle = v.slice(5).replace(/\*/g, '');
        if (!String(val || '').includes(needle)) return false;
      }
    }
    return true;
  };
  return {
    select: vi.fn(async (table, opts = {}) => {
      if (table === 'audit') return [AUDIT];
      return (db[table] || []).filter((r) => match(r, opts));
    }),
    selectAll: vi.fn(async (table, opts = {}) =>
      (db[table] || []).filter((r) => match(r, opts)),
    ),
    upsert: vi.fn(async (table, rows) => {
      db.writes.push({ table, rows });
      const key = table === 'review' ? ['did'] : ['plan_id', 'did'];
      for (const row of rows) {
        const list = (db[table] ||= []);
        const at = list.findIndex((r) => key.every((k) => r[k] === row[k]));
        if (at === -1) list.push({ ...row });
        else list[at] = { ...list[at], ...row };
      }
      return rows.length;
    }),
    update: vi.fn(async () => {}),
    del: vi.fn(async (table, { eq }) => {
      db[table] = (db[table] || []).filter(
        (r) => !Object.entries(eq).every(([k, v]) => r[k] === v),
      );
    }),
  };
});

vi.mock('../../src/lib/constellation.js', () => ({
  getManyToMany: vi.fn(async (did, source, path, { otherSubject } = {}) => {
    if (constellationDown) return null;
    // A popular account is on many lists; the filter is what finds ours.
    expect(otherSubject).toBe(LIST);
    const rkeys = members.get(did) || [];
    return {
      items: rkeys.map((rkey) => ({
        linkRecord: {
          did: 'did:plc:bot',
          collection: 'app.bsky.graph.listitem',
          rkey,
        },
        otherSubject: LIST,
      })),
    };
  }),
}));

vi.mock('./listWrite.js', () => ({ listUri: () => LIST }));

const { openItems, queuePage, decide, removeMember, listitemRkeys } =
  await import('./queue.js');

const auditRow = (did, band, trust, extra = {}) => ({
  audit_id: AUDIT.id,
  did,
  handle: `${did.slice(8)}.test`,
  band,
  trust,
  vouches: band === 'CONNECTED' ? 5 : band === 'PERIPHERAL' ? 1 : 0,
  followers: 100,
  protected_reason: null,
  decision: null,
  ...extra,
});

beforeEach(() => {
  db.audit_item = [
    auditRow('did:plc:conn', 'CONNECTED', 90),
    auditRow('did:plc:peri', 'PERIPHERAL', 60),
    auditRow('did:plc:nota', 'NOTABLE', 35),
    auditRow('did:plc:unk', 'UNKNOWN', 20),
    auditRow('did:plc:prot', 'CONNECTED', 99, {
      protected_reason: 'you follow them',
    }),
  ];
  db.decision = [
    {
      plan_id: '6fa2491d-0000-0000-0000-000000000000',
      did: 'did:plc:disp',
      band: 'UNKNOWN',
      trust: 10,
      vouches: 0,
      action: 'list_add',
      acted_at: '2026-09-30T12:00:00Z',
      undone_at: null,
      approved_via: 'triage:hostile',
      triage: 'arguing',
      triage_quote: 'this policy is cowardly',
      triage_model: 'a+b',
    },
  ];
  db.review = [];
  db.writes = [];
  members.clear();
  for (const d of [
    'did:plc:conn',
    'did:plc:peri',
    'did:plc:nota',
    'did:plc:prot',
    'did:plc:disp',
  ]) {
    members.set(d, [`rk-${d.slice(8)}`]);
  }
  constellationDown = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const actors = new URL(url).searchParams.getAll('actors');
      return {
        ok: true,
        json: async () => ({
          profiles: actors.map((did) => ({
            did,
            handle: `${did.slice(8)}.test`,
            displayName: did.slice(8),
            avatar: `https://cdn/${did}`,
          })),
        }),
      };
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('what is in the queue', () => {
  it('merges the audit and the disputed labels, most urgent first, strangers left out', async () => {
    const q = await openItems();
    expect(q.open.map((i) => i.did)).toEqual([
      'did:plc:prot',
      'did:plc:conn',
      'did:plc:disp',
      'did:plc:peri',
      'did:plc:nota',
    ]);
    expect(q.counts).toMatchObject({
      PROTECTED: 1,
      CONNECTED: 1,
      disputed: 1,
      PERIPHERAL: 1,
      NOTABLE: 1,
    });
    const disp = q.open.find((i) => i.did === 'did:plc:disp');
    expect(disp).toMatchObject({
      reason: 'disputed',
      label: 'arguing',
      plan: '6fa2491d',
      quote: 'this policy is cowardly',
    });
  });

  it('keeps a kept account out until it gets worse than it was', async () => {
    db.review = [
      {
        did: 'did:plc:peri',
        decision: 'keep',
        reason: 'PERIPHERAL',
        band: 'PERIPHERAL',
        decided_at: '2026-10-01T10:00:00Z',
      },
    ];
    expect((await openItems()).open.map((i) => i.did)).not.toContain(
      'did:plc:peri',
    );
    // Next week they are CONNECTED: that is a reason to look again.
    db.audit_item.find((r) => r.did === 'did:plc:peri').band = 'CONNECTED';
    expect((await openItems()).open.map((i) => i.did)).toContain(
      'did:plc:peri',
    );
  });

  it('holds a removal until an audit newer than it', async () => {
    db.review = [
      {
        did: 'did:plc:nota',
        decision: 'remove',
        reason: 'NOTABLE',
        band: 'NOTABLE',
        decided_at: '2026-10-01T10:00:00Z',
      },
    ];
    expect((await openItems()).open.map((i) => i.did)).not.toContain(
      'did:plc:nota',
    );
    db.review[0].decided_at = '2026-09-20T10:00:00Z';
    expect((await openItems()).open.map((i) => i.did)).toContain(
      'did:plc:nota',
    );
  });
});

describe('a page of the queue', () => {
  it('adds profiles to the page and drops anyone no longer on the list', async () => {
    members.delete('did:plc:conn');
    const page = await queuePage({ limit: 10 });
    expect(page.items.map((i) => i.did)).not.toContain('did:plc:conn');
    expect(page.skipped).toBe(1);
    expect(page.items[0].profile.avatar).toMatch(/^https:/);
    expect(db.review.find((r) => r.did === 'did:plc:conn')).toMatchObject({
      decision: 'remove',
      note: 'already off the list',
    });
  });

  it('never drops anyone when Constellation cannot answer', async () => {
    // The bug this guards: "could not tell" read as "not on the list" took the
    // five most connected accounts out of the queue.
    constellationDown = true;
    const page = await queuePage({ limit: 10 });
    expect(page.skipped).toBe(0);
    expect(page.items).toHaveLength(5);
    expect(db.review).toEqual([]);
  });

  it('filters to one reason', async () => {
    const page = await queuePage({ reason: 'disputed' });
    expect(page.items.map((i) => i.did)).toEqual(['did:plc:disp']);
    expect(page.matched).toBe(1);
  });
});

describe('deciding', () => {
  const bot = () => ({
    session: { did: 'did:plc:bot' },
    com: {
      atproto: {
        repo: { deleteRecord: vi.fn(async () => ({})), listRecords: vi.fn() },
      },
    },
  });

  it('keeps, and reopening a keep puts them back', async () => {
    await decide(null, {
      did: 'did:plc:conn',
      decision: 'keep',
      reason: 'CONNECTED',
      band: 'CONNECTED',
    });
    expect((await openItems()).open.map((i) => i.did)).not.toContain(
      'did:plc:conn',
    );
    await decide(null, { did: 'did:plc:conn', decision: 'reopen' });
    expect((await openItems()).open.map((i) => i.did)).toContain(
      'did:plc:conn',
    );
  });

  it('removes with one lookup, and closes the decision that added them', async () => {
    const agent = bot();
    const out = await decide(agent, {
      did: 'did:plc:disp',
      decision: 'remove',
      reason: 'disputed',
    });
    expect(out).toMatchObject({ ok: true, removed: 1 });
    expect(agent.com.atproto.repo.deleteRecord).toHaveBeenCalledWith({
      repo: 'did:plc:bot',
      collection: 'app.bsky.graph.listitem',
      rkey: 'rk-disp',
    });
    expect(agent.com.atproto.repo.listRecords).not.toHaveBeenCalled();
    const d = db.decision.find((r) => r.did === 'did:plc:disp');
    expect(d.undone_at).toBeTruthy();
    expect(d.undo_reason).toMatch(/queue/);
    expect(db.review.find((r) => r.did === 'did:plc:disp')).toMatchObject({
      decision: 'remove',
    });
  });

  it('falls back to reading the repo when Constellation is down', async () => {
    constellationDown = true;
    const agent = bot();
    agent.com.atproto.repo.listRecords.mockResolvedValue({
      data: {
        records: [
          {
            uri: 'at://did:plc:bot/app.bsky.graph.listitem/rk-scan',
            value: { list: LIST, subject: 'did:plc:conn' },
          },
        ],
      },
    });
    const out = await removeMember(agent, 'did:plc:conn');
    expect(out.removed).toBe(1);
    expect(agent.com.atproto.repo.deleteRecord.mock.calls[0][0].rkey).toBe(
      'rk-scan',
    );
  });

  it('refuses to write a list the session does not own', async () => {
    const agent = { ...bot(), session: { did: 'did:plc:someone-else' } };
    await expect(removeMember(agent, 'did:plc:conn')).rejects.toThrow(
      /does not own/,
    );
  });

  it('restores through the add path, so the PROTECTED veto still applies', async () => {
    const addToList = vi.fn(async () => ({ ok: false, message: 'PROTECTED' }));
    const out = await decide(
      bot(),
      { did: 'did:plc:prot', decision: 'restore' },
      { addToList },
    );
    expect(addToList).toHaveBeenCalledWith(
      expect.anything(),
      'list_add',
      'did:plc:prot',
      expect.objectContaining({ via: 'portal' }),
    );
    expect(out.ok).toBe(false);
    expect(db.review).toEqual([]);
  });

  it('rejects anything that is not a decision', async () => {
    await expect(
      decide(null, { did: 'did:plc:conn', decision: 'block' }),
    ).rejects.toThrow(/unknown decision/);
    await expect(
      decide(null, { did: 'not-a-did', decision: 'keep' }),
    ).rejects.toThrow(/did/);
  });
});

describe('finding a listitem', () => {
  it('pages, and answers "unknown" rather than "none" when it runs out of pages', async () => {
    const { getManyToMany } = await import('../../src/lib/constellation.js');
    getManyToMany.mockClear();
    getManyToMany.mockImplementation(async () => ({
      items: [],
      cursor: 'more',
    }));
    expect(await listitemRkeys(LIST, 'did:plc:busy', { maxPages: 3 })).toBe(
      null,
    );
    expect(getManyToMany).toHaveBeenCalledTimes(3);
  });
});
