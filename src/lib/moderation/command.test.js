import { describe, it, expect } from 'vitest';
import {
  isWrite,
  readOnlyReply,
  parseCommand,
  parseActor,
  parseChoice,
  facetLinks,
  facetMentions,
  offersFrom,
  parsePostScan,
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

describe('truncated links', () => {
  // A client truncates the visible text of a pasted URL and keeps the whole
  // thing in a facet. Reading the text finds "bsky.app/profile/free..." which
  // cannot be resolved, and the analyst says so at length about a message that
  // contained a perfectly good link.
  const link = (uri) => ({
    index: { byteStart: 0, byteEnd: 24 },
    features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
  });
  const mention = (did) => ({
    index: { byteStart: 0, byteEnd: 10 },
    features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
  });

  it('pulls the full url out of the facet', () => {
    const msg = {
      text: 'bsky.app/profile/free...',
      facets: [link('https://bsky.app/profile/freeuse.toys')],
    };
    expect(facetLinks(msg)).toEqual(['https://bsky.app/profile/freeuse.toys']);
  });

  it('resolves an actor a truncated text could not', () => {
    const out = parseCommand('block bsky.app/profile/free...', {
      links: ['https://bsky.app/profile/freeuse.toys'],
    });
    expect(out.actor).toBe('freeuse.toys');
    expect(out.needsTarget).toBe(false);
  });

  it('takes a DID straight from a mention facet', () => {
    const out = parseCommand('block @freeuse...', {
      mentions: ['did:plc:2t622budf364qkodu3skkp5d'],
    });
    expect(out.actor).toBe('did:plc:2t622budf364qkodu3skkp5d');
  });

  it('refuses when the facets name two different accounts', () => {
    // Two candidates is the same ambiguity as two typed handles.
    const out = parseCommand('block them', {
      mentions: ['did:plc:aaa', 'did:plc:bbb'],
    });
    expect(out.actor).toBe(null);
    expect(out.needsTarget).toBe(true);
  });

  it('prefers what dame actually typed over a facet', () => {
    const out = parseCommand('block @typed.example', {
      mentions: ['did:plc:somethingelse'],
    });
    expect(out.actor).toBe('typed.example');
  });

  it('finds a post link in a facet for a bulk plan', () => {
    const post = 'https://bsky.app/profile/a.bsky.social/post/3abc';
    const out = parseCommand('add likers bsky.app/profile/a.bsk...', {
      links: [post],
    });
    expect(out.target).toBe(post);
  });

  it('ignores facets that are neither links nor mentions', () => {
    expect(
      facetLinks({ facets: [{ features: [{ $type: 'other' }] }] }),
    ).toEqual([]);
    expect(facetMentions({})).toEqual([]);
  });
});

describe('offersFrom', () => {
  // The analyst quotes its suggestions in backticks. Lifting them into a menu
  // means dame answers "2" instead of retyping one.
  const reply = [
    'Band: CONNECTED. 4 of your circle follow them.',
    '',
    'Command:',
    '',
    '`list add @freeuse.toys`',
    '',
    'Or `block @freeuse.toys` if you want a block instead.',
    'Reverses are `list remove @freeuse.toys` and `unblock @freeuse.toys`.',
  ].join('\n');

  it('lifts the quoted commands out', () => {
    const out = offersFrom(reply);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].command).toBe('list add @freeuse.toys');
  });

  it('collapses block and list add, which are the same operation here', () => {
    // Offering both as though they differed is the model misunderstanding its
    // own system, and a menu should not repeat it.
    const out = offersFrom(reply);
    const adds = out.filter((o) => o.label.startsWith('Add '));
    expect(adds).toHaveLength(1);
  });

  it('labels from the parse, not from the prose', () => {
    // What dame reads has to be what runs. A label copied from model text could
    // say one thing and execute another.
    const out = offersFrom('try `block @someone.example`');
    expect(out[0].label).toBe('Add @someone.example to the list');
  });

  it('drops anything the parser will not accept', () => {
    expect(offersFrom('run `rm -rf /` or `sudo make me a sandwich`')).toEqual(
      [],
    );
    expect(offersFrom('`block them`')).toEqual([]);
    expect(offersFrom('no backticks here, block @a.example')).toEqual([]);
  });

  it('caps the menu', () => {
    const many = Array.from(
      { length: 9 },
      (_, i) => `\`block @a${i}.example\``,
    ).join(' ');
    expect(offersFrom(many)).toHaveLength(4);
  });

  it('handles a reply with nothing quoted', () => {
    expect(offersFrom('Just prose, no commands.')).toEqual([]);
    expect(offersFrom('')).toEqual([]);
    expect(offersFrom(null)).toEqual([]);
  });
});

describe('parsePostScan', () => {
  const POST = 'https://bsky.app/profile/a.bsky.social/post/3abc';
  const AT = 'at://did:plc:abc/app.bsky.feed.post/3abc';

  it('treats a bare post as a scan', () => {
    expect(parsePostScan(POST)).toBe(POST);
    expect(parsePostScan('this post', { embedUri: AT })).toBe(AT);
    expect(parsePostScan('', { embedUri: AT })).toBe(AT);
  });

  it('takes the full link from a facet when the text is truncated', () => {
    expect(parsePostScan('bsky.app/profile/a.bsk...', { links: [POST] })).toBe(
      POST,
    );
  });

  it('leaves a real question to the analyst', () => {
    // A scan is a form. Anything carrying its own verb is not one.
    expect(
      parsePostScan(`what is the sentiment of the replies to ${POST}`),
    ).toBe(null);
    expect(parsePostScan(`should I act on ${POST}`)).toBe(null);
  });

  it('is not a scan without a post', () => {
    expect(parsePostScan('hello')).toBe(null);
    expect(parsePostScan('')).toBe(null);
  });
});

describe('undo and history', () => {
  it('parses undo by code and undo last', () => {
    // "undo last" is the common case: the thing that just happened.
    expect(parseCommand('undo 3f9a2c1b')).toMatchObject({
      action: 'undo',
      code: '3f9a2c1b',
      last: false,
    });
    expect(parseCommand('undo last')).toMatchObject({
      action: 'undo',
      last: true,
      needsTarget: false,
    });
  });

  it('defaults a bare undo to the last plan', () => {
    // This answered `No plan with code null.` -- a sentence about an internal
    // variable. Undo is the one verb that may default, because it only ever
    // takes people OFF the list; guessing wrong un-blocks someone rather than
    // blocking them.
    for (const text of ['undo', 'undo it', 'undo that', 'undo those']) {
      expect(parseCommand(text), text).toMatchObject({
        action: 'undo',
        last: true,
        needsTarget: false,
      });
    }
  });

  it('will not default a mistyped code to the last plan', () => {
    // The whole value of defaulting is that the common case needs no code. It
    // would be spent immediately if a typo'd code also meant "the last one":
    // that acts on a batch dame did not name, which is the failure the plan
    // codes exist to prevent.
    const cmd = parseCommand('undo 3f9az');
    expect(cmd.needsTarget).toBe(true);
    expect(cmd.last).toBe(false);
    expect(cmd.code).toBe(null);
  });

  it('parses history with and without an account', () => {
    expect(parseCommand('history')).toMatchObject({
      action: 'history',
      actor: null,
      needsTarget: false,
    });
    expect(parseCommand('history @a.bsky.social')).toMatchObject({
      action: 'history',
      actor: 'a.bsky.social',
    });
  });

  it('does not swallow prose that mentions undoing', () => {
    expect(parseCommand('can I undo that?')).toBe(null);
    expect(parseCommand('what is the history here')).toBe(null);
  });
});

describe('read: the one verb that asks a model for an opinion', () => {
  it('parses an account the same way block does', () => {
    expect(parseCommand('read @a.bsky.social')).toMatchObject({
      action: 'read',
      actor: 'a.bsky.social',
      needsTarget: false,
    });
    expect(
      parseCommand('read https://bsky.app/profile/a.bsky.social'),
    ).toMatchObject({ action: 'read', actor: 'a.bsky.social' });
  });

  it('will not work out who to read from context', () => {
    // Same rule as block. The analyst reads strangers' posts mid-turn, so a
    // pronoun resolved against one is a target named by that post.
    expect(parseCommand('read them').needsTarget).toBe(true);
  });

  it('is not a write, so a read-only account keeps it', () => {
    expect(isWrite(parseCommand('read @a.bsky.social'))).toBe(false);
  });
});

describe('which verbs change something', () => {
  const writes = [
    'block @a.bsky.social',
    'unblock @a.bsky.social',
    'list add @a.bsky.social',
    'list remove @a.bsky.social',
    'approve 3f9a2c1b UNKNOWN',
    'undo last',
    'cancel 3f9a2c1b',
  ];
  const reads = [
    'review 3f9a2c1b',
    'history',
    'history @a.bsky.social',
    'read @a.bsky.social',
    'add likers https://bsky.app/profile/a.bsky.social/post/3xyz',
  ];

  it.each(writes)('%s writes', (text) => {
    expect(isWrite(parseCommand(text))).toBe(true);
  });

  it.each(reads)('%s does not', (text) => {
    expect(isWrite(parseCommand(text))).toBe(false);
  });

  it('says what still works when it refuses one', () => {
    // A refusal that leaves someone guessing which half of the surface is
    // still available is a refusal they have to come back from.
    const out = readOnlyReply(parseCommand('block @a.bsky.social'));
    expect(out).toContain('read-only');
    expect(out).toMatch(/review|history/);
  });

  it('treats a non-command as not a write', () => {
    expect(isWrite(null)).toBe(false);
    expect(isWrite(parseCommand('what is the weather'))).toBe(false);
  });
});
