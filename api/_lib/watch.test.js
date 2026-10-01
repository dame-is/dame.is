import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { watch: [], post_alert: [] };
vi.mock('./modDb.js', () => ({
  select: vi.fn(async (table, opts = {}) => {
    let rows = db[table] || [];
    for (const [k, v] of Object.entries(opts.is || {})) {
      if (v === 'null') rows = rows.filter((r) => r[k] == null);
    }
    return rows;
  }),
  selectAll: vi.fn(async () => []),
  update: vi.fn(async (table, { eq }, patch) => {
    for (const r of db[table] || [])
      if (r.id === eq.id) Object.assign(r, patch);
  }),
  upsert: vi.fn(async (table, rows) => {
    for (const row of rows) {
      const i = db[table].findIndex((r) => r.uri === row.uri);
      if (i === -1) db[table].push({ ...row });
      else db[table][i] = { ...db[table][i], ...row };
    }
    return rows.length;
  }),
}));

const { digestFor, ownPostAlerts, alertText, watchesText } =
  await import('./watch.js');

const HOUR = 3_600_000;
const URI = 'at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/app.bsky.feed.post/3abc';

beforeEach(() => {
  db.watch.length = 0;
  db.post_alert.length = 0;
});

describe('the hourly digest', () => {
  const watch = (extra = {}) => ({
    id: 'w1',
    uri: URI,
    plan_id: '1c2d3e4f-0000-4000-8000-000000000000',
    mode: 'ask',
    until: new Date(10 * HOUR).toISOString(),
    last_digest_at: new Date(0).toISOString(),
    stats: { newSinceDigest: 12, hostileSinceDigest: 3, held: 3 },
    ...extra,
  });

  it('says what was found and offers the hostile ones for a thumbs-up', async () => {
    const w = watch();
    db.watch.push(w);
    const out = await digestFor(w, { now: 2 * HOUR });
    expect(out.text).toContain(
      '(8h left): 12 new quotes and replies since the last update, 3 read as hostile.',
    );
    expect(out.pending).toEqual(['approve 1c2d3e4f hostile']);
    // Counters reset, so the next digest is about the next hour.
    expect(db.watch[0].stats.newSinceDigest).toBe(0);
  });

  it('says who was added on an auto watch, and what was held', async () => {
    const w = watch({
      mode: 'auto',
      stats: {
        newSinceDigest: 20,
        hostileSinceDigest: 5,
        addedSinceDigest: 4,
        held: 1,
      },
    });
    db.watch.push(w);
    const out = await digestFor(w, { now: 2 * HOUR });
    expect(out.text).toContain('Added 4.');
    expect(out.text).toContain(
      '1 hostile one is CONNECTED or NOTABLE, so I held it',
    );
  });

  it('stays quiet with nothing new, and within the hour', async () => {
    const quiet = watch({ stats: {} });
    expect(await digestFor(quiet, { now: 2 * HOUR })).toBe(null);
    const recent = watch({
      last_digest_at: new Date(1.5 * HOUR).toISOString(),
    });
    expect(await digestFor(recent, { now: 2 * HOUR })).toBe(null);
  });

  it('lists what is being watched', () => {
    expect(watchesText([watch()], { now: 2 * HOUR })).toContain(
      '8h left, asking before adding',
    );
    expect(watchesText([])).toMatch(/^Not watching anything/);
  });
});

describe("alerts on dame's own posts", () => {
  const feed = (count) =>
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        feed: [
          {
            post: {
              uri: URI,
              author: { did: 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj' },
              indexedAt: new Date(0).toISOString(),
              quoteCount: count,
              replyCount: 0,
            },
          },
        ],
      }),
    }));

  it('sets a baseline, then alerts once on a jump within the hour', async () => {
    expect(await ownPostAlerts({ fetchImpl: feed(3), now: 1000 })).toEqual([]);
    expect(
      await ownPostAlerts({ fetchImpl: feed(9), now: 1000 + 20 * 60_000 }),
    ).toEqual([]);
    const alerts = await ownPostAlerts({
      fetchImpl: feed(25),
      now: 1000 + 40 * 60_000,
    });
    expect(alerts).toEqual([{ uri: URI, growth: 22, count: 25 }]);
    // Not again for six hours.
    expect(
      await ownPostAlerts({ fetchImpl: feed(60), now: 1000 + 50 * 60_000 }),
    ).toEqual([]);
    expect(alertText(alerts[0]).pending).toEqual([`watch ${URI}`]);
  });
});
