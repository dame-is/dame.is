import { describe, it, expect } from 'vitest';
import {
  pieceTemplate,
  nextTake,
  previousPiece,
  lifespanRank,
  engagementPhrase,
  announcementDraft,
  templateProblems,
  fillTemplate,
  DEFAULT_TEMPLATE,
  fillAnnouncement,
  announcementProblems,
  DEFAULT_ANNOUNCEMENT,
} from './ratioedStudio.js';
import {
  anchorsFromTemplate,
  breakerFromAnnouncement,
  takeFromText,
  isPiecePost,
} from './ratioedDiscovery.js';

describe('nextTake', () => {
  it('counts off the highest take, not the number of pieces', () => {
    // A gap in the series must not hand out a number somebody already has.
    expect(nextTake([{ take: 1 }, { take: 2 }, { take: 13 }])).toBe(14);
    expect(nextTake([])).toBe(1);
    expect(nextTake(null)).toBe(1);
  });

  it('ignores records with no take', () => {
    expect(nextTake([{ take: 4 }, {}, { take: null }])).toBe(5);
  });
});

describe('previousPiece', () => {
  it('is the highest take, which is the one a new piece quotes', () => {
    const list = [{ take: 11, rkey: 'a' }, { take: 13, rkey: 'c' }, { take: 12, rkey: 'b' }];
    expect(previousPiece(list).rkey).toBe('c');
  });

  it('is null for the first piece there has ever been', () => {
    expect(previousPiece([])).toBeNull();
  });
});

describe('pieceTemplate', () => {
  // The whole point of the template is that the site can still recognise what
  // it produces. If these two drift apart, a piece posted from the studio stops
  // being found by the scan that measures it.
  it('produces text the discovery scan recognises as a piece', () => {
    const text = pieceTemplate(14);
    expect(isPiecePost({ text })).toBe(true);
    expect(takeFromText(text)).toBe(14);
  });

  it('links to the piece’s own page, padded like the canonical URL', () => {
    expect(pieceTemplate(14)).toContain('dame.is/creating/ratioed/14');
    expect(pieceTemplate(7)).toContain('dame.is/creating/ratioed/07');
  });
});

describe('engagementPhrase', () => {
  it('names nothing as nothing', () => {
    expect(engagementPhrase({ threadPosts: 0, reposts: 0, quotes: 0 })).toBe('zero engagement');
    expect(engagementPhrase(null)).toBe('zero engagement');
  });

  it('counts only what is not a like', () => {
    // The like is what ended the piece; it is not engagement with it.
    expect(engagementPhrase({ threadPosts: 21, reposts: 4, quotes: 0, likes: 1 })).toBe(
      '21 replies and 4 reposts',
    );
  });

  it('agrees in number', () => {
    expect(engagementPhrase({ threadPosts: 1 })).toBe('1 reply');
    expect(engagementPhrase({ threadPosts: 1, reposts: 1, quotes: 1 })).toBe(
      '1 reply, 1 repost and 1 quote',
    );
  });
});

describe('lifespanRank', () => {
  const others = [{ lifespanMs: 48832 }, { lifespanMs: 904700 }];

  it('spots a new extreme in either direction', () => {
    expect(lifespanRank(16748, others)).toBe('shortest');
    expect(lifespanRank(2000000, others)).toBe('longest');
  });

  it('says nothing about a middling piece', () => {
    expect(lifespanRank(100000, others)).toBeNull();
  });

  it('says nothing when there is nothing to compare against', () => {
    expect(lifespanRank(16748, [])).toBeNull();
  });
});

describe('announcementDraft', () => {
  const piece = {
    take: 13,
    lifespanMs: 16748,
    preSeal: { likes: 1, threadPosts: 0, reposts: 0, quotes: 0 },
  };

  it('opens with the line every take has carried', () => {
    const text = announcementDraft({ handle: 'satyrs.eu', piece, others: [{ lifespanMs: 48832 }] });
    expect(text.startsWith('thank you for your participation, this piece has now concluded,')).toBe(
      true,
    );
  });

  // The site reads the breaker back out of this line — it is the only record
  // that a deleted like ever existed. A draft the parser can't read would lose
  // the one person the piece is about.
  it('round-trips through the parser the site reads breakers with', () => {
    const text = announcementDraft({ handle: 'satyrs.eu', piece, others: [] });
    expect(breakerFromAnnouncement(text)).toEqual({ handle: 'satyrs.eu' });
  });

  it('handles a hyphenated handle, which the parser also has to', () => {
    const text = announcementDraft({ handle: 'g-sharp-major.bsky.social', piece, others: [] });
    expect(breakerFromAnnouncement(text).handle).toBe('g-sharp-major.bsky.social');
  });

  it('reports the engagement and the standing it earned', () => {
    const text = announcementDraft({ handle: 'satyrs.eu', piece, others: [{ lifespanMs: 48832 }] });
    expect(text).toContain('zero engagement');
    expect(text).toContain('the shortest piece in the series');
  });

  it('omits the ranking when the piece is neither extreme', () => {
    const text = announcementDraft({
      handle: 'satyrs.eu',
      piece: { ...piece, lifespanMs: 100000 },
      others: [{ lifespanMs: 48832 }, { lifespanMs: 904700 }],
    });
    expect(text).toContain('it lasted approximately');
    expect(text).not.toContain('piece in the series');
  });

  it('still names the breaker for a piece with nothing measured on it', () => {
    const text = announcementDraft({ handle: 'someone.bsky.social', piece: {}, others: [] });
    expect(breakerFromAnnouncement(text).handle).toBe('someone.bsky.social');
  });
});

describe('templateProblems', () => {
  it('passes the template the project actually uses', () => {
    expect(templateProblems(DEFAULT_TEMPLATE, 14)).toEqual([]);
  });

  // The drift that lost take #13 is no longer a matter of guessing the phrase
  // the scan was taught: the scan reads the wording off this same record. So a
  // rewrite nobody has seen before is allowed through — and is findable, which
  // is the half that matters.
  it('accepts a rewording, and the scan finds what that rewording produces', () => {
    const reworded = ['here is a post about nothing', '', 'this is take #{take}', '', '{link}'].join(
      '\n',
    );
    expect(templateProblems(reworded, 14)).toEqual([]);
    expect(
      isPiecePost({ text: fillTemplate(reworded, 14) }, anchorsFromTemplate(reworded)),
    ).toBe(true);
  });

  it('still catches a template with nothing the scan could match', () => {
    const problems = templateProblems('hi\n\nbye', 14);
    expect(problems.some((p) => p.includes('recognise'))).toBe(true);
  });

  it('catches a template that loses the take number', () => {
    const problems = templateProblems('this post is the project\n\n{link}', 14);
    expect(problems.some((p) => p.includes('take number'))).toBe(true);
  });

  it('catches a template with no link to the piece', () => {
    const problems = templateProblems('this post is the project\n\nthis is take #{take}', 14);
    expect(problems.some((p) => p.includes('{link}'))).toBe(true);
  });

  it('catches an empty template', () => {
    expect(templateProblems('', 14).length).toBeGreaterThan(0);
  });
});

describe('fillTemplate', () => {
  it('substitutes both placeholders, padding the link like the canonical URL', () => {
    const out = fillTemplate('take #{take} at {link}', 7);
    expect(out).toBe('take #7 at dame.is/creating/ratioed/07');
  });

  it('substitutes every occurrence, not just the first', () => {
    expect(fillTemplate('{take}/{take}', 3)).toBe('3/3');
  });

  it('is safe on nothing', () => {
    expect(fillTemplate(null, 3)).toBe('');
  });
});

describe('the concluding reply is a template too', () => {
  it('fills the handle in', () => {
    expect(fillAnnouncement('@{handle} did it', 'ponder.ooo')).toBe('@ponder.ooo did it');
  });

  it('refuses a sentence that would break the breaker parser', () => {
    // BLAME_RE reads the breaker back out of this reply, and on a piece whose
    // like was deleted that reply is the only evidence the like existed.
    expect(announcementProblems('@{handle} ended it')).toHaveLength(1);
    expect(announcementProblems('somebody was to blame')[0]).toMatch(/\{handle\}/);
    expect(announcementProblems('')).not.toHaveLength(0);
    expect(announcementProblems(DEFAULT_ANNOUNCEMENT)).toEqual([]);
  });

  it('opens the draft with the stored sentence, not the built-in', () => {
    const draft = announcementDraft({
      handle: 'ponder.ooo',
      piece: null,
      others: [],
      announcement: 'it is over. @{handle} was to blame.',
    });
    expect(draft.split('\n')[0]).toBe('it is over. @ponder.ooo was to blame.');
  });
});
