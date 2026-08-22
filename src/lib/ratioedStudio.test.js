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
  DEFAULT_ANNOUNCEMENT,
  ANNOUNCEMENT_BREAK,
  announcementParts,
  announcementLengths,
  shortenPost,
  graphemes,
  FEED_MAX,
  fillAnnouncement,
  announcementProblems,
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

  it('opens with the line every take has carried, now naming which one', () => {
    const text = announcementDraft({ handle: 'satyrs.eu', piece, others: [{ lifespanMs: 48832 }] });
    expect(text.startsWith('thanks for participating, piece 13 has now concluded,')).toBe(true);
  });

  it('carries both links, written the way the post template writes one', () => {
    const text = announcementDraft({ handle: 'satyrs.eu', piece, others: [] });
    expect(text).toContain('dame.is/creating/ratioed/participant/satyrs.eu');
    expect(text).toContain('dame.is/creating/ratioed/13');
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

  it('reports the engagement', () => {
    const text = announcementDraft({ handle: 'satyrs.eu', piece, others: [{ lifespanMs: 48832 }] });
    expect(text).toContain('zero engagement');
  });

  // The standing a piece earned is a placeholder now rather than a line the
  // code appends, so it appears exactly where somebody wrote it and nowhere
  // otherwise. The default does not ask for it; a template that does gets it.
  it('fills the ranking only for a template that asks, and only when there is one', () => {
    const tpl = 'was to blame @{handle}, it lasted {duration}{rank}';
    expect(
      announcementDraft({ handle: 'satyrs.eu', piece, others: [{ lifespanMs: 48832 }], announcement: tpl }),
    ).toContain('the shortest piece in the series');
    expect(
      announcementDraft({
        handle: 'satyrs.eu',
        piece: { ...piece, lifespanMs: 100000 },
        others: [{ lifespanMs: 48832 }, { lifespanMs: 904700 }],
        announcement: tpl,
      }),
    ).not.toContain('piece in the series');
  });

  it('leaves a figure nothing measured as its own placeholder', () => {
    // Not a zero: a piece with no measurement has no engagement, and "zero
    // engagement" is a finding about a piece that ran.
    const text = announcementDraft({ handle: 'someone.test', piece: {}, others: [] });
    expect(text).toContain('{counts}');
    expect(text).not.toContain('zero engagement');
  });

  it('still names the breaker for a piece with nothing measured on it', () => {
    const text = announcementDraft({ handle: 'someone.bsky.social', piece: {}, others: [] });
    expect(breakerFromAnnouncement(text).handle).toBe('someone.bsky.social');
  });
});

describe('what a post holds', () => {
  // A post's limit is counted against the text of the record, and the client
  // that composes these by hand stores the SHORTENED link and puts the whole
  // URL in a facet. Counting the draft instead read the participant link at its
  // full length — which contains the handle, so every extra character of handle
  // cost two — and reported the default as over the limit for nineteen of the
  // twenty-two breakers the project has actually had.
  it('fits the default in one post, for every handle the project has drawn', () => {
    const lengths = announcementLengths(DEFAULT_ANNOUNCEMENT);
    expect(lengths).toHaveLength(1);
    expect(lengths[0]).toBeLessThanOrEqual(FEED_MAX);
    expect(announcementProblems(DEFAULT_ANNOUNCEMENT)).toEqual([]);
  });

  // The span is in bytes and the ellipsis is three of them, so this reads the
  // link back the way a client does rather than by slicing characters.
  const spanned = (text, l) =>
    new TextDecoder().decode(new TextEncoder().encode(text).slice(l.start, l.end));

  it('cuts a link at thirty characters and keeps the whole URL beside it', () => {
    const { text, links } = shortenPost('see https://dame.is/creating/ratioed/participant/ver.ooo now');
    expect(text).toBe('see dame.is/creating/ratioed/part… now');
    expect(links).toHaveLength(1);
    expect(links[0].uri).toBe('https://dame.is/creating/ratioed/participant/ver.ooo');
    expect(spanned(text, links[0])).toBe('dame.is/creating/ratioed/part…');
  });

  it('leaves a short link whole', () => {
    expect(shortenPost('at https://dame.is/creating/ratioed/22').text).toBe(
      'at dame.is/creating/ratioed/22',
    );
  });

  it('keeps a full stop out of the link, where a reader would put it', () => {
    const { text, links } = shortenPost('go to dame.is/creating/ratioed/22.');
    expect(text).toBe('go to dame.is/creating/ratioed/22.');
    expect(links[0].uri).toBe('https://dame.is/creating/ratioed/22');
    expect(spanned(text, links[0])).toBe('dame.is/creating/ratioed/22');
  });

  // The offsets a facet is measured in are UTF-8 bytes, not characters, and
  // this reply carries a curly apostrophe in front of both of its links.
  it('measures a facet in bytes, past the characters that are not one', () => {
    const { text, links } = shortenPost('liker’s page: dame.is/creating/ratioed/22');
    const bytes = new TextEncoder().encode(text);
    expect(new TextDecoder().decode(bytes.slice(links[0].start, links[0].end))).toBe(
      'dame.is/creating/ratioed/22',
    );
  });

  it('keeps the blame sentence where the scan reads it', () => {
    const text = announcementDraft({
      handle: 'satyrs.eu',
      piece: { take: 13, lifespanMs: 16748, preSeal: { likes: 1, threadPosts: 6, reposts: 2 } },
      others: [],
    });
    expect(breakerFromAnnouncement(text)).toEqual({ handle: 'satyrs.eu' });
    expect(text).toContain('liker’s page');
  });

  it('is one reply when nothing marks a break', () => {
    expect(announcementParts('was to blame @{handle}')).toEqual(['was to blame @{handle}']);
  });

  it('drops an empty part rather than posting a blank reply', () => {
    expect(announcementParts(`one\n${ANNOUNCEMENT_BREAK}\n\n${ANNOUNCEMENT_BREAK}\ntwo`)).toEqual([
      'one',
      'two',
    ]);
  });

  it('names the reply that is too long, not just that one is', () => {
    const tpl = `was to blame @{handle}\n${ANNOUNCEMENT_BREAK}\n${'x'.repeat(400)}`;
    const problems = announcementProblems(tpl);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Reply 2 of 2');
  });

  it('counts an emoji as the one character a post counts it as', () => {
    expect(graphemes('a👩‍👩‍👧‍👦b')).toBe(3);
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
