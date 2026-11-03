import { describe, expect, it } from 'vitest';
import {
  BLOCK_STAGES,
  REPO_SPANS,
  SYNC_PLAN,
  SYNC_STEPS,
  blocksFraction,
  countAtOrAfter,
  partsFraction,
  repoDownloadFraction,
  repoReadFraction,
  repoSaveFraction,
  share,
  timeFraction,
  walkFraction,
} from './syncProgress.js';

describe('share', () => {
  it('measures a count against its total, held under done', () => {
    expect(share(50, 200)).toBe(0.25);
    expect(share(200, 200)).toBe(0.99);
    expect(share(260, 200)).toBe(0.99);
  });

  it('has no share without a total to measure by', () => {
    expect(share(10, null)).toBeNull();
    expect(share(10, 0)).toBeNull();
    expect(share(undefined, 10)).toBeNull();
  });
});

describe('the plan', () => {
  it('names every planned step', () => {
    for (const key of SYNC_PLAN) expect(SYNC_STEPS[key]?.label).toBeTruthy();
    expect(SYNC_STEPS.outbound.label).toBeTruthy();
  });
});

describe('blocksFraction', () => {
  it('moves forward through the stages and never back', () => {
    const reports = [
      { stage: 'direct', done: 0 },
      { stage: 'direct', done: 3000 },
      { stage: 'direct', done: 6000 },
      { stage: 'lists', done: 400 },
      { stage: 'check', done: 0, total: 600 },
      { stage: 'check', done: 600, total: 600 },
      { stage: 'subscribers', done: 0, total: 280 },
      { stage: 'subscribers', done: 140, total: 280 },
      { stage: 'subscribers', done: 280, total: 280 },
    ];
    const shares = reports.map((p) => blocksFraction(p, { directEstimate: 6000 }));
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeGreaterThanOrEqual(shares[i - 1]);
    expect(shares[0]).toBe(0);
    expect(shares.at(-1)).toBe(0.99);
  });

  it('gives the long subscriber walk most of the segment', () => {
    const [from, to] = BLOCK_STAGES.subscribers;
    expect(to - from).toBeGreaterThan(0.5);
    expect(blocksFraction({ stage: 'subscribers', done: 140, total: 280 })).toBeCloseTo(0.6, 5);
  });

  it('holds the direct stage at its start when there is no earlier count', () => {
    expect(blocksFraction({ stage: 'direct', done: 4000 })).toBe(0);
  });

  it('reads a stage with nothing in it as finished, not unmeasured', () => {
    expect(blocksFraction({ stage: 'subscribers', done: 0, total: 0 })).toBe(0.99);
    expect(blocksFraction({ stage: 'check', done: 0, total: 0 })).toBe(BLOCK_STAGES.check[1]);
  });

  it('has no share for a report it does not recognise', () => {
    expect(blocksFraction({ fetched: 10 })).toBeNull();
  });
});

describe('repo', () => {
  it('measures the download against the last full pull, within its span', () => {
    const [from, to] = REPO_SPANS.download;
    expect(repoDownloadFraction(33, 66)).toBeCloseTo(from + 0.5 * (to - from), 5);
    expect(repoDownloadFraction(5, null)).toBeNull();
  });

  it('carries on from the download through the parse and the write', () => {
    const shares = [
      repoDownloadFraction(66, 66),
      repoReadFraction({ stage: 'index', done: 0, total: 100 }),
      repoReadFraction({ stage: 'walk', done: 50 }, { expectedRecords: 100 }),
      repoReadFraction({ stage: 'decode', done: 100, total: 100 }),
      repoSaveFraction(0, 1000),
      repoSaveFraction(500, 1000),
      repoSaveFraction(1000, 1000),
    ];
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeGreaterThanOrEqual(shares[i - 1]);
    expect(shares[1]).toBeCloseTo(REPO_SPANS.read[0], 5);
    expect(shares.at(-1)).toBe(0.99);
  });

  it('reads nothing to write as a finished write', () => {
    expect(repoSaveFraction(0, 0)).toBe(0.99);
  });
});

describe('newest-first walks', () => {
  const DAY = 86_400_000;
  const NOW = Date.parse('2026-11-01T12:00:00Z');
  // Busy lately, quiet before: 90 posts in the last 10 days, 10 in the 80 before.
  const times = [
    ...Array.from({ length: 10 }, (_, i) => NOW - (20 + i * 8) * DAY),
    ...Array.from({ length: 90 }, (_, i) => NOW - (i / 9) * DAY),
  ].sort((a, b) => a - b);

  it('counts held items at or after a time', () => {
    expect(countAtOrAfter(times, NOW - 10 * DAY)).toBe(90);
    expect(countAtOrAfter(times, -Infinity)).toBe(100);
    expect(countAtOrAfter([], 0)).toBe(0);
  });

  it('weighs the walk by what the archive holds, not by elapsed time', () => {
    // Ten days back is 1/9 of the time but 90% of the posts.
    const s = walkFraction(times, NOW - 10 * DAY, times[0]);
    expect(s).toBeCloseTo(0.9, 5);
    expect(timeFraction(NOW, NOW - 10 * DAY, times[0])).toBeLessThan(0.15);
  });

  it('starts at zero and has nothing to say over an empty range', () => {
    expect(walkFraction(times, null, times[0])).toBe(0);
    expect(walkFraction([], NOW, NOW - DAY)).toBeNull();
  });

  it('measures a notification walk by how far back it has reached', () => {
    expect(timeFraction(NOW, NOW - 30 * DAY, NOW - 120 * DAY)).toBeCloseTo(0.25, 5);
    expect(timeFraction(NOW, null, NOW - DAY)).toBe(0);
    expect(timeFraction(NOW, NOW - DAY, NOW)).toBeNull();
  });

  it('splits a two-collection walk into halves', () => {
    expect(partsFraction(0, 2, 0.5)).toBe(0.25);
    expect(partsFraction(1, 2, 0)).toBe(0.5);
    expect(partsFraction(1, 2, 1)).toBe(0.99);
  });
});
