import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  RESULT_SOURCE,
  boardKey,
  boardUri,
  checkResult,
  leanProfile,
  parsePendingResult,
  rankResults,
  scopeAllowsResults,
  toResult,
} from './sunfarmingResults.js';
import { PLAY_SCOPE, REACTION_SCOPE, OWNER_SCOPE } from './oauthClient.js';
import { ME_DID, SUNFARMING_RESULT_NSID } from '../config.js';

const lexicon = JSON.parse(
  readFileSync(
    new URL('../../lexicons/is.dame.sunfarming.result.json', import.meta.url),
    'utf8',
  ),
);

describe('a board', () => {
  it('is keyed by the island, and by the day for the daily island', () => {
    expect(boardKey({ island: 'tern' })).toBe('tern');
    expect(boardKey({ island: 'tern', date: '2026-11-10' })).toBe('tern');
    expect(boardKey({ island: 'today', date: '2026-11-10' })).toBe(
      'today-2026-11-10',
    );
    expect(boardKey({ island: 'today' })).toBeNull();
    expect(boardKey({ island: 'today', date: 'yesterday' })).toBeNull();
    for (const bad of ['', 'Tern', 'a b', '../x', 'x'.repeat(40), null, 7]) {
      expect(boardKey({ island: bad })).toBeNull();
    }
    expect(boardKey()).toBeNull();
  });

  it('is named by an at-uri on the host’s repo that results point at', () => {
    expect(boardUri('tern')).toBe(
      `at://${ME_DID}/is.dame.sunfarming.island/tern`,
    );
    expect(boardUri(null)).toBeNull();
    expect(RESULT_SOURCE).toBe('is.dame.sunfarming.result:subject');
  });
});

describe('a result', () => {
  const subject = boardUri('tern');
  const record = (value) => ({
    did: 'did:plc:someone',
    uri: 'at://x/y/tern',
    value,
  });

  it('is read from a record that points at the board and says how many days', () => {
    expect(
      toResult(
        record({
          subject,
          island: 'tern',
          days: 9,
          createdAt: '2026-11-10T12:00:00Z',
        }),
        subject,
      ),
    ).toEqual({
      uri: 'at://x/y/tern',
      did: 'did:plc:someone',
      days: 9,
      at: '2026-11-10T12:00:00Z',
      profile: null,
    });
  });

  it('is nothing when it points elsewhere or its days make no sense', () => {
    expect(
      toResult(record({ subject: boardUri('pines'), days: 9 }), subject),
    ).toBeNull();
    for (const days of [0, -3, 2.5, '9', null, undefined, 100000]) {
      expect(toResult(record({ subject, days }), subject)).toBeNull();
    }
    expect(
      toResult({ did: null, value: { subject, days: 9 } }, subject),
    ).toBeNull();
    expect(toResult(record(null), subject)).toBeNull();
    expect(
      toResult(record({ subject, days: 9, createdAt: 'never' }), subject).at,
    ).toBeNull();
  });

  it('is ranked quickest first, one line a person, earliest first among equals', () => {
    const r = (did, days, at) => ({ did, days, at });
    const ranked = rankResults([
      r('c', 12, '2026-11-10T10:00:00Z'),
      r('a', 9, '2026-11-10T11:00:00Z'),
      r('b', 9, '2026-11-10T09:00:00Z'),
      r('a', 7, '2026-11-10T12:00:00Z'),
      r('d', 9, null),
      { days: 3 },
    ]);
    expect(ranked.map((x) => [x.did, x.days])).toEqual([
      ['a', 7],
      ['b', 9],
      ['d', 9],
      ['c', 12],
    ]);
    expect(rankResults(null)).toEqual([]);
  });

  it('has to be a finished island before it is written anywhere', () => {
    expect(checkResult({ island: 'tern', days: 9 })).toEqual({
      key: 'tern',
      island: 'tern',
      date: null,
      days: 9,
    });
    expect(
      checkResult({ island: 'today', date: '2026-11-10', days: 8 }),
    ).toEqual({
      key: 'today-2026-11-10',
      island: 'today',
      date: '2026-11-10',
      days: 8,
    });
    expect(checkResult({ island: 'tern', days: 0 })).toBeNull();
    expect(checkResult({ island: 'tern', days: 1.5 })).toBeNull();
    expect(checkResult({ island: 'today', days: 8 })).toBeNull();
    expect(checkResult()).toBeNull();
  });

  it('matches the lexicon it is written under', () => {
    expect(lexicon.id).toBe(SUNFARMING_RESULT_NSID);
    const { record: shape, key } = lexicon.defs.main;
    // The record key is the board's key, so a player has one per board.
    expect(key).toBe('any');
    expect(shape.required).toEqual(['subject', 'island', 'days', 'createdAt']);
    expect(shape.properties.subject.format).toBe('at-uri');
    expect(shape.properties.days).toMatchObject({
      type: 'integer',
      minimum: 1,
    });
  });

  it('shows a face only when there is one', () => {
    expect(leanProfile('did:x', null)).toBeNull();
    expect(
      leanProfile('did:x', { handle: 'handle.invalid', displayName: 'A' }),
    ).toEqual({
      did: 'did:x',
      handle: '',
      displayName: 'A',
      avatar: '',
    });
  });
});

describe('posting', () => {
  it('needs the play grant: the reaction grant can’t write a result, the owner’s can', () => {
    expect(scopeAllowsResults(PLAY_SCOPE)).toBe(true);
    expect(scopeAllowsResults(OWNER_SCOPE)).toBe(true);
    expect(scopeAllowsResults(REACTION_SCOPE)).toBe(false);
    expect(scopeAllowsResults('')).toBe(false);
    expect(
      scopeAllowsResults(`atproto repo?collection=${SUNFARMING_RESULT_NSID}`),
    ).toBe(true);
  });

  it('keeps a result across the hop to the PDS, for a while', () => {
    const now = 1_800_000_000_000;
    const stored = (over = {}) =>
      JSON.stringify({
        island: 'today',
        date: '2026-11-10',
        days: 8,
        at: now,
        ...over,
      });
    expect(parsePendingResult(stored(), now + 60_000)).toEqual({
      island: 'today',
      date: '2026-11-10',
      days: 8,
    });
    expect(parsePendingResult(stored(), now + 16 * 60_000)).toBeNull();
    expect(
      parsePendingResult(stored({ at: now + 10 * 60_000 }), now),
    ).toBeNull();
    expect(parsePendingResult(stored({ days: 0 }), now)).toBeNull();
    expect(parsePendingResult(stored({ island: '../etc' }), now)).toBeNull();
    expect(parsePendingResult('not json', now)).toBeNull();
    expect(parsePendingResult('null', now)).toBeNull();
  });
});
