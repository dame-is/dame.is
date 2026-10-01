// The triage cascade, against an in-memory decision table and a stubbed
// AppView: which posts the second wave reads, whose label is kept, and what
// happens when the second wave cannot answer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = { decision: [], usage: [] };

vi.mock('./modDb.js', () => ({
  select: vi.fn(async () => []),
  selectAll: vi.fn(async (table, opts = {}) => {
    const rows = table === 'decision' ? db.decision : [];
    const eq = opts.eq || {};
    return rows.filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v));
  }),
  update: vi.fn(async () => {}),
  upsert: vi.fn(async (table, rows) => {
    if (table === 'llm_usage') db.usage.push(...rows);
    if (table !== 'decision') return rows.length;
    for (const row of rows) {
      const i = db.decision.findIndex(
        (r) => r.plan_id === row.plan_id && r.did === row.did,
      );
      if (i === -1) db.decision.push({ ...row });
      else db.decision[i] = { ...db.decision[i], ...row };
    }
    return rows.length;
  }),
}));

const { runTriage, recheckTriage } = await import('./triage.js');

const PLAN = {
  id: 'plan-1',
  totals: { uri: 'at://did:plc:a/app.bsky.feed.post/1' },
};
const POSTS = {
  'at://did:plc:p1/app.bsky.feed.post/1': 'you are a worthless idiot',
  'at://did:plc:p2/app.bsky.feed.post/2': 'this policy is cowardly',
  'at://did:plc:p3/app.bsky.feed.post/3': 'lol nice',
  'at://did:plc:p4/app.bsky.feed.post/4': 'pile on this clown',
};

/** A labeller that answers by keyword, standing in for a model. */
function labeller(map) {
  return vi.fn(async ({ messages, model }) => {
    const items = messages[0].content.split(/\n(?=\d+\. )/);
    const text = items
      .map((item, i) => {
        const hit = Object.entries(map).find(([k]) => item.includes(k));
        return `${i + 1}: ${hit ? hit[1] : 'neutral'}`;
      })
      .join('\n');
    return { text, usage: { inputTokens: 100, outputTokens: 10 }, model };
  });
}

beforeEach(() => {
  db.decision = Object.keys(POSTS).map((uri, i) => ({
    plan_id: PLAN.id,
    did: `did:plc:p${i + 1}`,
    band: 'UNKNOWN',
    evidence_uri: uri,
    triage: null,
  }));
  db.usage = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const uris = [...new URL(url).searchParams.getAll('uris')];
      return {
        ok: true,
        json: async () => ({
          posts: uris.map((uri) => ({ uri, record: { text: POSTS[uri] } })),
        }),
      };
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const label = (did) => db.decision.find((r) => r.did === did);

describe('triage in two waves', () => {
  it("re-reads what either first-wave reader calls hostile, and keeps the stronger model's label", async () => {
    // First wave: calls the idiot post AND the policy post hostile.
    // Judge: thinks the clown post is hostile, which the first wave missed.
    // Second wave: agrees about the idiot and the clown, not the policy post.
    const generate = vi.fn(async (opts) =>
      opts.model === 'strong/model'
        ? labeller({ idiot: 'hostile', cowardly: 'arguing', clown: 'hostile' })(
            opts,
          )
        : labeller({ idiot: 'hostile', cowardly: 'hostile', clown: 'arguing' })(
            opts,
          ),
    );
    const evaluate = vi.fn(async ({ state }) => ({
      answers: {
        tone: {
          type: 'choice',
          choice: 'x',
          probabilities: { hostile: /clown|idiot/.test(state) ? 0.9 : 0.1 },
        },
      },
      usage: { inputTokens: 50 },
    }));

    const out = await runTriage(PLAN, {
      generate,
      model: 'cheap/model',
      escalation: 'strong/model',
      judge: 'j/jev',
      evaluate,
    });

    expect(label('did:plc:p1')).toMatchObject({
      triage: 'hostile',
      triage_model: 'strong/model',
    });
    expect(label('did:plc:p2')).toMatchObject({
      triage: 'arguing',
      triage_model: 'strong/model',
    });
    expect(label('did:plc:p4')).toMatchObject({
      triage: 'hostile',
      triage_model: 'strong/model',
    });
    // Nobody flagged the "lol" post, so the first wave's label stands.
    expect(label('did:plc:p3')).toMatchObject({
      triage: 'neutral',
      triage_model: 'cheap/model',
    });
    expect(out.secondWave).toMatchObject({
      model: 'strong/model',
      read: 3,
      overturned: 2,
    });
    expect(out.counts.hostile).toBe(2);
    expect(db.usage.map((u) => u.kind).sort()).toEqual([
      'triage',
      'triage-escalated',
      'triage-judge',
    ]);
  });

  it('leaves a flagged post unlabelled when the second wave cannot read it', async () => {
    const generate = vi.fn(async (opts) => {
      if (opts.model === 'strong/model') throw new Error('503');
      return labeller({ idiot: 'hostile' })(opts);
    });
    const out = await runTriage(PLAN, {
      generate,
      model: 'cheap/model',
      escalation: 'strong/model',
      judge: 'off',
    });
    // The one post that would have been "hostile" is exactly the one not
    // trusted to the first wave alone, so it stays pending for next time.
    expect(label('did:plc:p1').triage).toBe(null);
    expect(label('did:plc:p2').triage).toBe('neutral');
    expect(out.remaining).toBe(1);
    expect(out.counts.hostile).toBe(0);
  });

  it('is the old single pass when there is no second wave', async () => {
    const generate = labeller({ idiot: 'hostile' });
    const out = await runTriage(PLAN, {
      generate,
      model: 'cheap/model',
      escalation: 'off',
    });
    expect(label('did:plc:p1')).toMatchObject({
      triage: 'hostile',
      triage_model: 'cheap/model',
    });
    expect(out.secondWave).toBeUndefined();
  });
});

describe('re-checking labels a plan already has', () => {
  const onList = (did, quote) => ({
    plan_id: PLAN.id,
    did,
    band: 'UNKNOWN',
    triage: 'hostile',
    triage_quote: quote,
    triage_model: 'cheap/model',
    acted_at: 't',
    approved_via: 'triage:hostile',
  });

  it('changes a label only when both readers dispute it, and adds or removes nobody', async () => {
    db.decision = [
      onList('did:plc:p1', 'you are a worthless idiot'),
      onList('did:plc:p2', 'this policy is cowardly'),
      onList('did:plc:p3', 'enjoy the camps'),
    ];
    // Reader one is strict, reader two is not; they agree about p1 and p2.
    const generate = vi.fn(async (opts) =>
      opts.model === 'strict/model'
        ? labeller({ idiot: 'hostile', cowardly: 'arguing', camps: 'arguing' })(
            opts,
          )
        : labeller({ idiot: 'hostile', cowardly: 'neutral', camps: 'hostile' })(
            opts,
          ),
    );
    const out = await recheckTriage(PLAN, {
      generate,
      readers: ['strict/model', 'loose/model'],
    });
    expect(out).toMatchObject({
      checked: 3,
      confirmed: 1,
      disputed: { arguing: 1 },
      split: 1,
      failed: 0,
    });
    expect(label('did:plc:p1')).toMatchObject({
      triage: 'hostile',
      triage_model: 'strict/model+loose/model',
    });
    // Both readers disagree: the first reader's label, still on the list, and
    // the log still says what it was added on.
    expect(label('did:plc:p2')).toMatchObject({
      triage: 'arguing',
      acted_at: 't',
      approved_via: 'triage:hostile',
    });
    // A split keeps its label and says so.
    expect(label('did:plc:p3').triage).toBe('hostile');
    expect(label('did:plc:p3').triage_model).toMatch(
      /split model=arguing model=hostile/,
    );

    // Run again: nothing left to re-read, so nothing is paid for twice.
    generate.mockClear();
    const again = await recheckTriage(PLAN, {
      generate,
      readers: ['strict/model', 'loose/model'],
    });
    expect(again.checked).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });

  it('leaves a row for next time when a reader does not answer', async () => {
    db.decision = [onList('did:plc:p2', 'this policy is cowardly')];
    const generate = vi.fn(async (opts) => {
      if (opts.model === 'loose/model') throw new Error('503');
      return labeller({ cowardly: 'arguing' })(opts);
    });
    const out = await recheckTriage(PLAN, {
      generate,
      readers: ['strict/model', 'loose/model'],
    });
    expect(out).toMatchObject({ checked: 0, failed: 1 });
    expect(label('did:plc:p2')).toMatchObject({
      triage: 'hostile',
      triage_model: 'cheap/model',
    });
  });
});
