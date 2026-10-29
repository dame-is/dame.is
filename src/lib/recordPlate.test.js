import { describe, it, expect } from 'vitest';
import {
  resolveCrumbs,
  upFrom,
  indexPathForVerb,
  GENERATED_INDEX_VERBS,
  crumbStamp,
  colophon,
  easternDayOfLife,
  gapBetween,
  recordSentence,
  sentenceText,
  verbIndexIntro,
} from './recordPlate.js';

describe('resolveCrumbs', () => {
  it('links a section crumb that has a page, and names the moment last', () => {
    expect(resolveCrumbs('/logging/3mysojzqy3z23', 'Oct 26 · 5:36 pm')).toEqual([
      { label: 'logging', to: '/logging' },
      { label: 'Oct 26 · 5:36 pm', to: '/logging/3mysojzqy3z23' },
    ]);
  });

  it('sends a repost crumb to the generated /reposting index, not a 404', () => {
    expect(resolveCrumbs('/reposting/3myuh64psn623')[0]).toEqual({ label: 'reposting', to: '/reposting' });
  });

  it('resolves a lexicon-form path through the verb registry', () => {
    expect(resolveCrumbs('/app.bsky.feed.repost/3myuh64psn623')[0]).toEqual({
      label: 'reposting',
      to: '/reposting',
    });
  });

  it('leaves a segment with no page as plain text', () => {
    // Flushing redirects off-site; a participant's parent segment has no page.
    expect(resolveCrumbs('/flushing/abc')[0].to).toBe(null);
    const c = resolveCrumbs('/creating/ratioed/participant/someone.bsky.social');
    expect(c.map((x) => x.to)).toEqual([
      '/creating',
      '/creating/ratioed',
      null,
      '/creating/ratioed/participant/someone.bsky.social',
    ]);
  });
});

describe('upFrom', () => {
  it('goes to the nearest ancestor with a page', () => {
    expect(upFrom('/logging/3mysojzqy3z23')).toEqual({ to: '/logging', label: 'logging' });
    expect(upFrom('/creating/ratioed/participant/x')).toEqual({ to: '/creating/ratioed', label: 'ratioed' });
    expect(upFrom('/blogging')).toEqual({ to: '/', label: 'home' });
  });
});

describe('generated indexes', () => {
  it('covers the verbs with no page of their own, and skips flushing', () => {
    expect(GENERATED_INDEX_VERBS).toContain('reposting');
    expect(GENERATED_INDEX_VERBS).toContain('liking');
    expect(GENERATED_INDEX_VERBS).not.toContain('flushing');
    expect(GENERATED_INDEX_VERBS).not.toContain('posting');
    expect(indexPathForVerb('flushing')).toBe(null);
  });

  it('says what each entry is', () => {
    expect(verbIndexIntro('reposting')).toBe(
      'Other people’s posts, reshared. Each entry is one app.bsky.feed.repost or net.anisota.feed.repost record.',
    );
  });
});

describe("Dame's clock", () => {
  // The record from the audit: createdAt 17:36:37-04:00.
  const iso = '2026-10-26T21:36:37.000Z';

  it('stamps the crumb in Eastern time whatever the reader\'s zone', () => {
    expect(crumbStamp(iso, new Date('2026-10-29T12:00:00Z'))).toBe('Oct 26 · 5:36 pm');
  });

  it('adds the year to a crumb from another year', () => {
    expect(crumbStamp(iso, new Date('2027-01-02T12:00:00Z'))).toBe('Oct 26, 2026 · 5:36 pm');
  });

  it('writes the colophon with the past tense and the day of life', () => {
    expect(colophon('logging', iso)).toBe('Logged Monday, October 26, 2026 · 5:36 pm · day 12,226');
  });

  it("counts the day of life on Dame's calendar day, whatever the instant", () => {
    // 9:28pm ET on Oct 25 is already Oct 26 in UTC; it's still day 12,225.
    expect(easternDayOfLife('2026-10-26T01:28:00Z')).toBe(12225);
  });

  it('measures the gap between neighbours', () => {
    expect(gapBetween('2026-10-26T21:36:00Z', '2026-10-26T01:28:00Z')).toBe('20 h');
    expect(gapBetween('2026-10-27T14:30:00Z', '2026-10-27T13:32:00Z')).toBe('58 min');
  });
});

describe('recordSentence', () => {
  it('sets a status in the hero grammar', () => {
    expect(sentenceText(recordSentence('logging', { status: 'playing tennis' }))).toBe('dame is playing tennis');
  });

  it('names whose post a repost is', () => {
    const s = recordSentence('reposting', {}, { subject: 'Poe' });
    expect(s).toEqual({ lead: 'dame', verb: 'reposted', rest: 'Poe' });
  });

  it('falls back to an image description for a post with no text', () => {
    const s = recordSentence('posting', { text: '', embed: { images: [{ alt: 'gm from cooper' }] } });
    expect(sentenceText(s)).toBe('dame posted an image: gm from cooper');
  });
});
