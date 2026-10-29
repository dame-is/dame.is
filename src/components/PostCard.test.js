import { describe, it, expect } from 'vitest';
import { postStatsLine } from './PostCard.jsx';

describe('postStatsLine', () => {
  const payload = { replyCount: 3, repostCount: 2, likeCount: 28 };

  it('prints the engagement that happened, as one line', () => {
    expect(postStatsLine(payload)).toBe('3 replies · 2 reposts · 28 likes');
    expect(postStatsLine({})).toBe('');
  });

  it('leaves out the replies that are the thread carrying on', () => {
    expect(postStatsLine(payload, 1)).toBe('2 replies · 2 reposts · 28 likes');
    // A post whose only reply is its own continuation has none to show.
    expect(postStatsLine({ replyCount: 1, likeCount: 11 }, 1)).toBe('11 likes');
    expect(postStatsLine({ replyCount: 0 }, 1)).toBe('');
  });
});
