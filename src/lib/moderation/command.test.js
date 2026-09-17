import { describe, it, expect } from 'vitest';
import { parseCommand, parseActor, needsTargetReply } from './command.js';

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
