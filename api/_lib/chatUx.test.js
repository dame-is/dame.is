import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./modDb.js', () => ({
  select: vi.fn(async () => []),
  upsert: vi.fn(async () => 0),
}));

const {
  renderCard,
  cardChoices,
  summaryText,
  noteQuiet,
  takeDueSummaries,
  resetQuiet,
  confirmLine,
  react,
  settle,
} = await import('./chatUx.js');

const PLAN = {
  code: '1c2d3e4f',
  uri: 'at://did:plc:author/app.bsky.feed.post/3abc',
  total: 34,
  withText: 19,
  byBand: {
    UNKNOWN: 28,
    PERIPHERAL: 4,
    NOTABLE: 0,
    CONNECTED: 1,
    PROTECTED: 1,
  },
  engagements: { like: 12, repost: 3, quote: 5, reply: 14 },
  alreadyListed: 5,
  blocksYou: 3,
  author: {
    did: 'did:plc:author',
    handle: 'poster.example.social',
    band: 'UNKNOWN',
    followers: 1200,
    blocksYou: true,
    alreadyListed: false,
  },
};

describe('the post card', () => {
  it('fits on a phone and answers to words', () => {
    const text = renderCard(PLAN);
    expect(text).toContain(
      '@poster.example.social (UNKNOWN, 1,200 followers, blocks you) wrote this.',
    );
    expect(text).toContain(
      '34 accounts engaged: 12 likes, 3 reposts, 5 quotes, 14 replies.',
    );
    expect(text).toContain(
      'By band: 28 unknown, 4 peripheral, 1 connected, 1 protected.',
    );
    expect(text).toContain('5 already on the list, 3 already block you.');
    expect(text).toContain(
      'Reply with: author · likers · unknowns · everyone · hostile',
    );
    expect(text.length).toBeLessThan(400);
  });

  it('offers only what would do something', () => {
    const quiet = {
      ...PLAN,
      withText: 0,
      engagements: { like: 4 },
      byBand: { UNKNOWN: 4 },
      author: { ...PLAN.author, alreadyListed: true },
    };
    // The author is already listed, nobody wrote anything, and "everyone"
    // would be the same as "unknowns".
    expect(cardChoices(quiet).map((o) => o.key)).toEqual([
      'likers',
      'unknowns',
    ]);
    expect(cardChoices(PLAN).find((o) => o.key === 'likers').command).toBe(
      'approve 1c2d3e4f likers',
    );
    expect(cardChoices(PLAN).find((o) => o.key === 'everyone').command).toBe(
      'approve 1c2d3e4f UNKNOWN,PERIPHERAL,CONNECTED',
    );
    expect(renderCard(PLAN, { choices: [] })).not.toContain('Reply with');
  });

  it('never offers to add a PROTECTED author', () => {
    const p = {
      ...PLAN,
      author: { ...PLAN.author, protectedReason: 'you follow them' },
    };
    expect(cardChoices(p).map((o) => o.key)).not.toContain('author');
  });
});

describe('the burst summary', () => {
  beforeEach(() => resetQuiet());

  it('waits for a quiet minute, and skips a burst of one', () => {
    noteQuiet('c1', { action: 'list_add', handle: 'a.test' }, 0);
    noteQuiet('c2', { action: 'list_add', handle: 'b.test' }, 0);
    noteQuiet('c2', { action: 'list_add', handle: 'c.test' }, 30_000);
    expect(takeDueSummaries({ now: 60_000 })).toEqual([]);
    const due = takeDueSummaries({ now: 95_000 });
    expect(due.map((d) => d.convoId)).toEqual(['c2']);
    // c1 was taken too, and dropped: its ✅ said everything.
    expect(takeDueSummaries({ now: 999_999, force: true })).toEqual([]);
  });

  it('says who, what was already there, and who already blocks you', () => {
    const text = summaryText({
      firstAt: 0,
      lastAt: 20 * 60_000,
      items: [
        { action: 'list_add', handle: 'a.test', blocksYou: true },
        { action: 'list_add', handle: 'b.test' },
        { action: 'list_add', handle: 'c.test', already: true },
        { action: 'list_remove', handle: 'd.test' },
      ],
    });
    expect(text).toContain('Blocked 2 in the last 20 min: @a.test, @b.test.');
    expect(text).toContain('1 was already on the list: @c.test.');
    expect(text).toContain('Unblocked 1: @d.test.');
    expect(text).toContain('1 of them already blocks you');
    expect(text).toContain('"unblock @handle" takes one back.');
  });
});

describe('confirmations and reactions', () => {
  it('says exactly what a thumbs-up will do', () => {
    expect(confirmLine(['add @a.test to the list'])).toBe(
      '👍 or "yes" to: add @a.test to the list',
    );
    expect(confirmLine(['x', 'y'])).toBe(
      '👍 or "yes" to do all of this:\n1. x\n2. y',
    );
    expect(confirmLine([])).toBe('');
  });

  it('never throws over a reaction', async () => {
    const chat = {
      chat: {
        bsky: {
          convo: {
            addReaction: vi
              .fn()
              .mockRejectedValue(new Error('ReactionLimitReached')),
            removeReaction: vi.fn(async () => ({})),
          },
        },
      },
    };
    expect(await react(chat, 'c', 'm', '👀')).toBe(false);
    expect(await react({}, 'c', 'm', '👀')).toBe(false);
    await settle(chat, 'c', 'm', 'done');
    expect(chat.chat.bsky.convo.removeReaction).toHaveBeenCalledWith({
      convoId: 'c',
      messageId: 'm',
      value: '👀',
    });
    expect(chat.chat.bsky.convo.addReaction).toHaveBeenLastCalledWith({
      convoId: 'c',
      messageId: 'm',
      value: '✅',
    });
  });
});

describe('a card on a post mostly dealt with already', () => {
  it('offers only what would add someone new', () => {
    const plan = {
      ...PLAN,
      author: { ...PLAN.author, alreadyListed: true },
      fresh: {
        total: 1,
        byBand: {
          UNKNOWN: 0,
          PERIPHERAL: 0,
          NOTABLE: 0,
          CONNECTED: 1,
          PROTECTED: 0,
        },
        likers: 0,
      },
    };
    // Fifteen of sixteen are on the list: no likers, no unknowns, and
    // "everyone" means the one CONNECTED account that is left.
    expect(cardChoices(plan).map((o) => o.key)).toEqual([
      'everyone',
      'hostile',
    ]);
    expect(cardChoices(plan)[0].command).toBe('approve 1c2d3e4f CONNECTED');
  });
});
