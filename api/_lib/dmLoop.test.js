import { describe, it, expect } from 'vitest';
import {
  sharedPostUri,
  composeMessage,
  runCommand,
  routeFor,
  normaliseMode,
  plainText,
} from './dmLoop.js';

describe('a post shared into a DM', () => {
  // Sharing from the Bluesky app puts no link in the text: the post travels in
  // embed.record.uri. Scanning the text found nothing and the analyst answered
  // "no link in your message" about a message with a post attached to it.
  const embed = (uri) => ({ record: { uri, cid: 'bafy' } });

  it('finds the uri in the embed', () => {
    const uri = 'at://did:plc:abc/app.bsky.feed.post/3xyz';
    expect(sharedPostUri({ text: 'check this', embed: embed(uri) })).toBe(uri);
  });

  it('ignores an embed that is not a record', () => {
    expect(sharedPostUri({ text: 'x' })).toBe(null);
    expect(sharedPostUri({ text: 'x', embed: {} })).toBe(null);
    expect(
      sharedPostUri({
        text: 'x',
        embed: { record: { uri: 'https://ex.com' } },
      }),
    ).toBe(null);
    expect(sharedPostUri(null)).toBe(null);
  });

  it('hands the model the text and the shared post together', () => {
    const uri = 'at://did:plc:abc/app.bsky.feed.post/3xyz';
    const out = composeMessage({ text: 'who liked this', embed: embed(uri) });
    expect(out).toContain('who liked this');
    expect(out).toContain(uri);
  });

  it('leaves a plain message alone', () => {
    expect(composeMessage({ text: 'hello' })).toBe('hello');
  });
});

describe('composeMessage with facets', () => {
  it('hands the model the full link, not the truncated text', () => {
    const out = composeMessage({
      text: 'can you add this user to the block list bsky.app/profile/free...',
      facets: [
        {
          features: [
            {
              $type: 'app.bsky.richtext.facet#link',
              uri: 'https://bsky.app/profile/freeuse.toys',
            },
          ],
        },
      ],
    });
    expect(out).toContain('https://bsky.app/profile/freeuse.toys');
  });

  it('does not repeat a link that was already written out in full', () => {
    const url = 'https://bsky.app/profile/a.bsky.social';
    const out = composeMessage({
      text: `check ${url}`,
      facets: [
        { features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }] },
      ],
    });
    expect(out).toBe(`check ${url}`);
  });

  it('surfaces mentioned accounts as DIDs', () => {
    const out = composeMessage({
      text: '@someone',
      facets: [
        {
          features: [
            { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:abc' },
          ],
        },
      ],
    });
    expect(out).toContain('did:plc:abc');
  });
});

describe('help', () => {
  const cmd = { action: 'help', needsTarget: false, raw: 'help' };

  it('answers with no session at all', async () => {
    // It returns before the writeAgent guard on purpose: asking what the thing
    // does is the one question that should work when nothing else does.
    const out = await runCommand(cmd, null, { canWrite: true });
    expect(out.text).toContain('WHAT THE NETWORK IS SAYING');
    expect(out.text).toContain('pulse');
  });

  it('offers the digest as a pressable first move', async () => {
    const out = await runCommand(cmd, null, { canWrite: true });
    expect(out.options).toHaveLength(1);
    expect(out.options[0].command).toBe('pulse');
    // Derived from the parse, like every other option in this system.
    expect(out.options[0].label).toMatch(/your circle/i);
  });

  it('shows a read-only sender only what they can actually run', async () => {
    const out = await runCommand(cmd, null, { canWrite: false });
    expect(out.text).not.toContain('block @handle');
    expect(out.text).not.toContain('approve ');
    expect(out.text).toContain('pulse');
  });
});

describe('agent mode routing', () => {
  it('is classic unless asked for by name', () => {
    expect(normaliseMode(undefined)).toBe('classic');
    expect(normaliseMode('')).toBe('classic');
    expect(normaliseMode('agnet')).toBe('classic');
    expect(normaliseMode(' Agent ')).toBe('agent');
  });

  it('changes nothing in classic mode, "!" included', () => {
    expect(routeFor('block @a.test')).toEqual({
      route: 'classic',
      text: 'block @a.test',
    });
    expect(routeFor('!block @a.test')).toEqual({
      route: 'classic',
      text: '!block @a.test',
    });
  });

  it('sends words to the agent', () => {
    expect(
      routeFor('block the nasty ones in the quotes', { mode: 'agent' }).route,
    ).toBe('agent');
    // A typed command is words too, in this mode. "!" is how to insist.
    expect(routeFor('block @a.test', { mode: 'agent' }).route).toBe('agent');
  });

  it('takes "!" as the classic path for one message', () => {
    expect(routeFor('!block @a.test', { mode: 'agent' })).toEqual({
      route: 'classic',
      text: 'block @a.test',
    });
    expect(routeFor('  ! help', { mode: 'agent' })).toEqual({
      route: 'classic',
      text: 'help',
    });
  });

  it('reads "!!!" as a feeling, not a prefix', () => {
    expect(routeFor('!!! these people', { mode: 'agent' }).route).toBe('agent');
    expect(routeFor('!', { mode: 'agent' }).route).toBe('agent');
  });

  it('holds a bare number for the menu check', () => {
    expect(routeFor('2', { mode: 'agent' }).route).toBe('choice');
  });
});

describe('agent replies in a DM', () => {
  it('drops markdown emphasis and headings, which a DM shows raw', () => {
    expect(plainText('## Vibe\n- **Main theme:** mockery')).toBe(
      'Vibe\n- Main theme: mockery',
    );
  });

  it('leaves everything else alone', () => {
    expect(plainText('2 * 3 = 6, and a_b stays')).toBe(
      '2 * 3 = 6, and a_b stays',
    );
  });

  it('sends "^" to the stronger model, and a lone "^" to the ordinary one', () => {
    expect(routeFor('^ what is the vibe here', { mode: 'agent' })).toEqual({
      route: 'agent',
      escalate: true,
      text: 'what is the vibe here',
    });
    expect(routeFor('^', { mode: 'agent' })).toEqual({
      route: 'agent',
      text: '^',
    });
    expect(routeFor('^ what is the vibe here')).toEqual({
      route: 'classic',
      text: '^ what is the vibe here',
    });
  });
});
