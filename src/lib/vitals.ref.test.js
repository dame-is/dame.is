import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// resolveVitalsFromRef keeps its answers and its state snapshot at module
// level, so every test loads a fresh copy of the module over fresh mocks.

const fetchSnapshot = vi.fn();
const resolvePds = vi.fn();
const getRecord = vi.fn();

vi.mock('./snapshot.js', () => ({
  fetchSnapshot: (...a) => fetchSnapshot(...a),
}));
vi.mock('./atproto.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    isRecordNotFound: actual.isRecordNotFound,
    resolvePds: (...a) => resolvePds(...a),
    getRecord: (...a) => getRecord(...a),
  };
});

let vitals;
beforeEach(async () => {
  vi.resetModules();
  fetchSnapshot.mockReset();
  resolvePds.mockReset().mockResolvedValue('https://pds.example');
  getRecord.mockReset();
  vitals = await import('./vitals.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ref = (rkey) => ({ uri: `at://did:plc:me/is.dame.state/${rkey}` });
const notFound = () =>
  Object.assign(new Error('RecordNotFound'), { status: 400 });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('loadStateSnapshot', () => {
  it('asks again after a miss instead of holding it', async () => {
    fetchSnapshot
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([{ uri: 'a' }]);
    expect(await vitals.loadStateSnapshot()).toEqual([]);
    expect(await vitals.loadStateSnapshot()).toEqual([{ uri: 'a' }]);
    expect(await vitals.loadStateSnapshot()).toEqual([{ uri: 'a' }]);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });
});

describe('resolveVitalsFromRef', () => {
  it('answers from the snapshot without touching the PDS', async () => {
    fetchSnapshot.mockResolvedValue([
      { uri: ref('a').uri, value: { heartRate: 70 } },
    ]);
    const v = await vitals.resolveVitalsFromRef(ref('a'));
    expect(v.heartRate).toBe(70);
    expect(getRecord).not.toHaveBeenCalled();
  });

  it('shares one live lookup per ref and keeps the answer', async () => {
    fetchSnapshot.mockResolvedValue([]);
    getRecord.mockResolvedValue({ value: { heartRate: 88 } });
    const [a, b] = await Promise.all([
      vitals.resolveVitalsFromRef(ref('x')),
      vitals.resolveVitalsFromRef(ref('x')),
    ]);
    expect(a).toBe(b);
    expect(a.heartRate).toBe(88);
    await vitals.resolveVitalsFromRef(ref('x'));
    expect(getRecord).toHaveBeenCalledTimes(1);
  });

  it('keeps a deleted record as null but retries a network failure', async () => {
    fetchSnapshot.mockResolvedValue([]);
    getRecord.mockRejectedValueOnce(notFound());
    expect(await vitals.resolveVitalsFromRef(ref('gone'))).toBeNull();
    expect(await vitals.resolveVitalsFromRef(ref('gone'))).toBeNull();
    expect(getRecord).toHaveBeenCalledTimes(1);

    getRecord
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }))
      .mockResolvedValueOnce({ value: { heartRate: 61 } });
    expect(await vitals.resolveVitalsFromRef(ref('blip'))).toBeNull();
    expect((await vitals.resolveVitalsFromRef(ref('blip'))).heartRate).toBe(61);
  });

  it('runs at most four live lookups at a time', async () => {
    fetchSnapshot.mockResolvedValue([]);
    let active = 0;
    let peak = 0;
    const releases = [];
    getRecord.mockImplementation(() => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise((resolve) => {
        releases.push(() => {
          active -= 1;
          resolve({ value: { heartRate: 60 } });
        });
      });
    });

    const all = Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        vitals.resolveVitalsFromRef(ref(`r${i}`)),
      ),
    );
    for (
      let round = 0;
      round < 10 && getRecord.mock.calls.length < 10;
      round += 1
    ) {
      await flush();
      expect(active).toBeLessThanOrEqual(4);
      releases.splice(0).forEach((release) => release());
    }
    await flush();
    releases.splice(0).forEach((release) => release());
    const results = await all;
    expect(results).toHaveLength(10);
    expect(peak).toBe(4);
    expect(getRecord).toHaveBeenCalledTimes(10);
  });
});
