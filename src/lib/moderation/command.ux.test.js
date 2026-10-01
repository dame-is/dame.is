import { describe, it, expect } from 'vitest';

import {
  parseQuick,
  isYes,
  isNo,
  parseCardWords,
  parseMemoryCommand,
  parseWatchCommand,
  parseCommand,
} from './command.js';

const POST = 'at://did:plc:author/app.bsky.feed.post/3abc';

describe('the quick lane', () => {
  // The shapes dame actually sends, from the DM history: a shared post with
  // "block", a link then "block this account", a typed handle.
  it('takes "block" with one target and nothing else', () => {
    for (const text of [
      'block',
      'Block',
      'block em',
      'block this asshole pls',
      'block them.',
    ]) {
      expect(parseQuick(text, { embedUri: POST })).toMatchObject({
        action: 'list_add',
        actor: 'did:plc:author',
        fromPost: true,
      });
    }
    expect(parseQuick('block @bad.example.social')).toMatchObject({
      action: 'list_add',
      actor: 'bad.example.social',
      fromPost: false,
    });
    expect(
      parseQuick('bsky.app/profile/that... block this account', {
        links: ['https://bsky.app/profile/that.example/post/3abc'],
      }),
    ).toMatchObject({ action: 'list_add', actor: 'that.example' });
    expect(parseQuick('unblock @friend.example.social')).toMatchObject({
      action: 'list_remove',
      actor: 'friend.example.social',
    });
  });

  it('leaves anything more to the agent', () => {
    // Two things at once, two accounts, a typed handle beside an attached
    // post, a reason with its own verb, no verb at all.
    expect(
      parseQuick('block this account and everyone that liked this post', {
        embedUri: POST,
      }),
    ).toBe(null);
    expect(parseQuick('block @a.example.social @b.example.social')).toBe(null);
    expect(parseQuick('block @a.example.social', { embedUri: POST })).toBe(
      null,
    );
    expect(parseQuick('block whoever is replying', { embedUri: POST })).toBe(
      null,
    );
    expect(parseQuick('this one', { embedUri: POST })).toBe(null);
    expect(parseQuick('block')).toBe(null);
  });
});

describe('answers to a question', () => {
  it('reads yes and no as people type them', () => {
    for (const t of [
      'yes',
      'Yes!',
      'y',
      'yep',
      'go ahead',
      'do it',
      '👍',
      'yes please',
    ]) {
      expect(isYes(t)).toBe(true);
    }
    for (const t of ['no', 'nope', 'cancel', 'leave it', 'never mind', '👎']) {
      expect(isNo(t)).toBe(true);
    }
    // A qualified yes is not a yes: it goes to the agent, and the question
    // lapses, so "yes but not @x" cannot run the unqualified version.
    expect(isYes('yes but not @x')).toBe(false);
    expect(isYes('what does that mean')).toBe(false);
  });
});

describe("a card's words", () => {
  const keys = ['author', 'likers', 'unknowns', 'everyone', 'hostile'];

  it('takes one or several, in the order typed, with synonyms', () => {
    expect(parseCardWords('likers', keys)).toEqual(['likers']);
    expect(parseCardWords('author and likers', keys)).toEqual([
      'author',
      'likers',
    ]);
    expect(parseCardWords('the randos, toxic ones', [...keys])).toBe(null);
    expect(parseCardWords('unknown + hostile', keys)).toEqual([
      'unknowns',
      'hostile',
    ]);
  });

  it('is not an answer if any word is not one of them', () => {
    expect(parseCardWords('block the author', keys)).toBe(null);
    expect(parseCardWords('likers', ['author'])).toBe(null);
  });
});

describe('memory commands', () => {
  it("keeps dame's words, and reads questions as questions", () => {
    expect(
      parseMemoryCommand('remember: never block people who only liked'),
    ).toEqual({
      action: 'remember',
      text: 'never block people who only liked',
    });
    expect(parseMemoryCommand('remember that CONNECTED means ask me')).toEqual({
      action: 'remember',
      text: 'CONNECTED means ask me',
    });
    expect(parseMemoryCommand('remember when we blocked them?')).toBe(null);
    expect(parseMemoryCommand('forget 2')).toEqual({
      action: 'forget',
      index: 2,
      text: null,
    });
    expect(parseMemoryCommand('forget about the likers thing')).toEqual({
      action: 'forget',
      index: null,
      text: 'the likers thing',
    });
    expect(parseMemoryCommand('what do you remember?')).toEqual({
      action: 'recall',
    });
    expect(parseMemoryCommand('remembering is hard')).toBe(null);
  });
});

describe('watch commands', () => {
  it('reads a window and whether to block, and nothing else', () => {
    expect(parseWatchCommand('watch this', { embedUri: POST })).toEqual({
      action: 'watch',
      target: POST,
      hours: 24,
      auto: false,
    });
    expect(
      parseWatchCommand('watch this for 2 days and block the hostile ones', {
        embedUri: POST,
      }),
    ).toMatchObject({ hours: 48, auto: true });
    expect(parseWatchCommand('keep an eye on this for 12h')).toMatchObject({
      hours: 12,
      auto: false,
    });
    expect(parseWatchCommand('stop watching')).toEqual({
      action: 'unwatch',
      target: null,
    });
    expect(parseWatchCommand('what are you watching?')).toEqual({
      action: 'watches',
    });
    // A warning with a post attached is not a request to watch it.
    expect(
      parseWatchCommand('watch out, this one is nasty', { embedUri: POST }),
    ).toBe(null);
  });
});

describe('approving by what people did', () => {
  it('reads an engagement kind on approve', () => {
    expect(parseCommand('approve 1c2d3e4f likers')).toMatchObject({
      action: 'approve',
      code: '1c2d3e4f',
      bands: [],
      kinds: ['likers'],
    });
    expect(parseCommand('approve 1c2d3e4f UNKNOWN')).toMatchObject({
      kinds: [],
    });
  });
});
