// The record is read-only to the bot by construction — it lives in dame's repo
// and this module never writes it. What is worth testing here is the degrade
// path, because a silent drop back to defaults is the kind of change nobody
// notices for a week.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let cacheRow = null;
const upserts = [];

vi.mock('./modDb.js', () => ({
  select: vi.fn(async () => (cacheRow ? [{ voice: cacheRow }] : [])),
  upsert: vi.fn(async (t, rows) => {
    upserts.push(...rows);
    return rows.length;
  }),
}));

vi.mock('../../src/lib/atproto.js', () => ({
  resolvePds: vi.fn(async () => 'https://pds.example.com'),
}));

const { loadAgentConfig, readFromPds, recordFrom, MAX_FIELD_CHARS } =
  await import('./agentConfig.js');

const ok = (value) => ({
  ok: true,
  status: 200,
  json: async () => ({ value }),
});

beforeEach(() => {
  cacheRow = null;
  upserts.length = 0;
});

describe('readFromPds', () => {
  it('reads the record', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        style: 'Terse.',
        guidance: 'Always give posting frequency.',
        updatedAt: '2026-09-17T00:00:00Z',
      }),
    );
    await expect(readFromPds({ fetchImpl })).resolves.toEqual({
      style: 'Terse.',
      guidance: 'Always give posting frequency.',
      openers: '',
      model: '',
      limits: null,
      source: 'pds',
      updated_at: '2026-09-17T00:00:00Z',
    });
    expect(fetchImpl.mock.calls[0][0]).toContain('is.dame.mod.config');
    expect(fetchImpl.mock.calls[0][0]).toContain('rkey=self');
  });

  it('treats a missing record as no config, not an error', async () => {
    // The normal state before one is ever published.
    for (const status of [400, 404]) {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status });
      await expect(readFromPds({ fetchImpl })).resolves.toBe(null);
    }
  });

  it('throws on a real failure, so the caller can fall back to the cache', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(readFromPds({ fetchImpl })).rejects.toThrow(/503/);
  });

  it('clips a field that is trying to be a second system prompt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(ok({ style: 'x'.repeat(9000) }));
    const out = await readFromPds({ fetchImpl });
    expect(out.style.length).toBe(MAX_FIELD_CHARS);
  });
});

describe('loadAgentConfig', () => {
  it('falls back to the cached copy when the PDS cannot be read', async () => {
    // A silent drop to defaults mid-conversation changes the register with
    // nothing to notice. The last known good config is the better wrong answer.
    cacheRow = { style: 'Cached voice.', guidance: '', source: 'pds' };
    global.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const out = await loadAgentConfig();
    expect(out.style).toBe('Cached voice.');
    expect(out.source).toBe('cache');
  });

  it('returns null when there is no record and no cache', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    await expect(loadAgentConfig()).resolves.toBe(null);
  });

  it('caches a successful read so the next outage has something to use', async () => {
    global.fetch = vi.fn().mockResolvedValue(ok({ style: 'Fresh.' }));
    await loadAgentConfig();
    expect(upserts[0].voice).toMatchObject({ style: 'Fresh.', source: 'pds' });
  });

  it('caches a cleared record as cleared', async () => {
    // Otherwise the next PDS outage restores a voice dame deliberately removed.
    cacheRow = { style: 'Old voice.', source: 'pds' };
    global.fetch = vi.fn().mockResolvedValue(ok({ style: '', guidance: '' }));
    await expect(loadAgentConfig()).resolves.toBe(null);
    expect(upserts[0].voice).toBe(null);
  });
});

describe('recordFrom', () => {
  it('produces the record the browser publishes', () => {
    const r = recordFrom({ style: '  Terse.  ', guidance: '' });
    expect(r.$type).toBe('is.dame.mod.config');
    expect(r.style).toBe('Terse.');
    expect(r.updatedAt).toMatch(/^\d{4}-/);
  });
});

describe('clampLimits', () => {
  it('holds a runaway value to the range', async () => {
    // Unlike voice, these have a bill attached: a typo in maxSteps is a runaway
    // loop, not an awkward sentence.
    const { clampLimits, LIMITS } = await import('./agentConfig.js');
    const out = clampLimits({
      maxSteps: 400,
      maxTurns: -5,
      historyHours: 99999,
    });
    expect(out.maxSteps).toBe(LIMITS.maxSteps.max);
    expect(out.maxTurns).toBe(LIMITS.maxTurns.min);
    expect(out.historyHours).toBe(LIMITS.historyHours.max);
  });

  it('falls back to the default for anything missing or unparseable', async () => {
    const { clampLimits, LIMITS } = await import('./agentConfig.js');
    const out = clampLimits({ maxSteps: 'lots' });
    expect(out.maxSteps).toBe(LIMITS.maxSteps.def);
    expect(out.reviewRows).toBe(LIMITS.reviewRows.def);
  });

  it('allows zero history hours, which turns the window off', async () => {
    const { clampLimits } = await import('./agentConfig.js');
    expect(clampLimits({ historyHours: 0 }).historyHours).toBe(0);
  });
});

describe('the model field', () => {
  it('drops a malformed model rather than breaking every turn', async () => {
    const { recordFrom } = await import('./agentConfig.js');
    expect(recordFrom({ model: 'not a model' }).model).toBe('');
    expect(recordFrom({ model: 'anthropic/claude-opus-5' }).model).toBe(
      'anthropic/claude-opus-5',
    );
  });
});
