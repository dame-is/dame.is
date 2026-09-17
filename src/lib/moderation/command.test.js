import { describe, it, expect } from 'vitest';
import {
  parseCommand,
  parseActor,
  parseChoice,
  needsTargetReply,
} from './command.js';

describe('parseActor', () => {
  it('takes a handle, with or without the @', () => {
    expect(parseActor('@freeuse.toys')).toBe('freeuse.toys');
    expect(parseActor('dame.is')).toBe('dame.is');
    expect(parseActor('A.BSKY.SOCIAL')).toBe('a.bsky.social');
  });

  it('takes a DID', () => {
    expect(parseActor('did:plc:abc123')).toBe('did:plc:abc123');
  });

  it('takes a profile link from any client', () => {
    expect(parseActor('https://bsky.app/profile/dame.is')).toBe('dame.is');
    expect(parseActor('https://deer.social/profile/did:plc:xyz/post/3a')).toBe(
      'did:plc:xyz',
    );
  });

  it('refuses a bare word, which is how "them" gets rejected', () => {
    expect(parseActor('them')).toBe(null);
    expect(parseActor('that guy')).toBe(null);
    expect(parseActor('')).toBe(null);
  });
});

describe('parseCommand', () => {
  it('recognises the verbs', () => {
    expect(parseCommand('block @a.bsky.social')).toMatchObject({
      action: 'list_add',
      actor: 'a.bsky.social',
    });
    expect(parseCommand('unblock @a.bsky.social')).toMatchObject({
      action: 'list_remove',
      actor: 'a.bsky.social',
    });
    expect(parseCommand('list add @a.bsky.social')).toMatchObject({
      action: 'list_add',
    });
    expect(parseCommand('list remove @a.bsky.social')).toMatchObject({
      action: 'list_remove',
    });
  });

  it('is not a command when it is a question', () => {
    // Anything that is not a command goes to the analyst untouched. The parser
    // must not swallow prose that merely mentions blocking.
    expect(parseCommand('should I block @a.bsky.social?')).toBe(null);
    expect(parseCommand('what has @a.bsky.social been posting about')).toBe(
      null,
    );
    expect(parseCommand('why is that one connected')).toBe(null);
    expect(parseCommand('')).toBe(null);
  });

  it('refuses to guess who "them" is', () => {
    // The whole design. "block them" after a turn that read a stranger's feed
    // is exactly how a post gets to choose the target.
    const out = parseCommand('block them');
    expect(out.action).toBe('list_add');
    expect(out.actor).toBe(null);
    expect(out.needsTarget).toBe(true);
  });

  it('refuses an ambiguous command naming two accounts', () => {
    const out = parseCommand('block @a.bsky.social @b.bsky.social');
    expect(out.needsTarget).toBe(true);
    expect(out.actor).toBe(null);
  });

  it('refuses a verb with trailing prose it cannot resolve', () => {
    expect(
      parseCommand('block the account I mentioned earlier').needsTarget,
    ).toBe(true);
  });

  it('keeps the literal text, for the decision log', () => {
    expect(parseCommand('block @a.bsky.social').raw).toBe(
      'block @a.bsky.social',
    );
  });
});

describe('needsTargetReply', () => {
  it('asks for a handle and says why it will not guess', () => {
    expect(needsTargetReply('list_add')).toMatch(/block @handle/);
    expect(needsTargetReply('list_remove')).toMatch(/unblock @handle/);
    expect(needsTargetReply('list_add')).toMatch(/block list/);
  });
});

describe('bulk plans', () => {
  const POST = 'https://bsky.app/profile/a.bsky.social/post/3abc';
  const EMBED = 'at://did:plc:abc/app.bsky.feed.post/3abc';

  it('recognises each engagement kind', () => {
    for (const kind of [
      'likers',
      'reposters',
      'repliers',
      'quoters',
      'everyone',
    ]) {
      const out = parseCommand(`add ${kind} ${POST}`);
      expect(out).toMatchObject({ action: 'plan', kind, target: POST });
    }
  });

  it('accepts the "list add likers" and "add the likers" phrasings', () => {
    expect(parseCommand(`list add likers ${POST}`).action).toBe('plan');
    expect(parseCommand(`add the likers ${POST}`).kind).toBe('likers');
  });

  it('is not confused with adding an account called "likers"', () => {
    // Bulk patterns are matched first, or "list add likers" would be read as
    // adding a handle.
    expect(parseCommand(`list add likers ${POST}`).action).not.toBe('list_add');
    expect(parseCommand('list add @a.bsky.social').action).toBe('list_add');
  });

  it('takes the post from a shared embed when the text has no link', () => {
    // Sharing from the app puts no link in the text.
    const out = parseCommand('add likers', { embedUri: EMBED });
    expect(out.target).toBe(EMBED);
    expect(out.needsTarget).toBe(false);
  });

  it('asks for a post rather than guessing one', () => {
    expect(parseCommand('add likers').needsTarget).toBe(true);
  });

  it('parses an approval with bands, in any case or separator', () => {
    const out = parseCommand('approve 3f9a2c1b unknown, notable');
    expect(out).toMatchObject({ action: 'approve', code: '3f9a2c1b' });
    expect(out.bands).toEqual(['UNKNOWN', 'NOTABLE']);
  });

  it('strips PROTECTED from an approval, whatever is typed', () => {
    // The veto is not a default an approval can talk its way past.
    const out = parseCommand('approve 3f9a2c1b UNKNOWN,PROTECTED');
    expect(out.bands).toEqual(['UNKNOWN']);
  });

  it('ignores band names that are not bands', () => {
    expect(parseCommand('approve 3f9a2c1b everyone,ALL').bands).toEqual([]);
  });

  it('needs a plan code', () => {
    expect(parseCommand('approve').needsTarget).toBe(true);
    expect(parseCommand('approve UNKNOWN').code).toBe(null);
  });

  it('parses a cancellation', () => {
    expect(parseCommand('cancel 3f9a2c1b')).toMatchObject({
      action: 'cancel',
      code: '3f9a2c1b',
    });
  });

  it('still lets a question through to the analyst', () => {
    expect(parseCommand('should I add the likers of this post?')).toBe(null);
    expect(parseCommand('who approved that')).toBe(null);
  });
});

describe('parseChoice', () => {
  it('reads a number, a letter, or "option N"', () => {
    expect(parseChoice('1')).toBe(1);
    expect(parseChoice('3.')).toBe(3);
    expect(parseChoice('2)')).toBe(2);
    expect(parseChoice(' option 2 ')).toBe(2);
    expect(parseChoice('a')).toBe(1);
    expect(parseChoice('B')).toBe(2);
  });

  it('is not a choice when it is a sentence', () => {
    // A message that merely contains a number is a question for the analyst.
    expect(parseChoice('what about the 3rd one')).toBe(null);
    expect(parseChoice('1 of them looks off')).toBe(null);
    expect(parseChoice('')).toBe(null);
    expect(parseChoice('yes')).toBe(null);
  });
});

describe('reviewing and approving by name', () => {
  it('parses a review', () => {
    expect(parseCommand('review 3f9a2c1b')).toMatchObject({
      action: 'review',
      code: '3f9a2c1b',
    });
  });

  it('parses an approval naming accounts', () => {
    // The personal path: dame read these and decided, which is a different
    // answer to "why am I on your list" than approving a band.
    const out = parseCommand('approve 3f9a2c1b @a.bsky.social @b.bsky.social');
    expect(out.actors).toEqual(['a.bsky.social', 'b.bsky.social']);
    expect(out.bands).toEqual([]);
  });

  it('keeps bands and actors apart in one command', () => {
    const out = parseCommand('approve 3f9a2c1b UNKNOWN @a.bsky.social');
    expect(out.bands).toEqual(['UNKNOWN']);
    expect(out.actors).toEqual(['a.bsky.social']);
  });
});
