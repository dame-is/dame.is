import { describe, expect, it } from 'vitest';
import {
  REACTIONS,
  experimentDate,
  experimentFacts,
  experimentImage,
  experimentLink,
  experimentNumbers,
  experimentPath,
  experimentStatus,
  experimentUri,
  findExperiment,
  hasWriteUp,
  latestPerPerson,
  listExperiments,
  parsePendingReaction,
  reactionCountLabel,
  reactionFor,
  reactionNotes,
  scopeAllowsReaction,
  standingReactions,
  takesReactions,
  tallyLine,
  tallyReactions,
} from './experiments.js';
import { ME_DID, EXPERIMENT_NSID } from '../config.js';

const uri = (rkey) => `at://${ME_DID}/${EXPERIMENT_NSID}/${rkey}`;
const experiment = (rkey, value) => ({ uri: uri(rkey), cid: `cid-${rkey}`, value });

/** A reaction as the pages hold one. */
function reaction(did, verdict, createdAt, extra = {}) {
  const rkey = extra.rkey || `r${did.slice(-1)}${createdAt.slice(8, 10)}`;
  return {
    uri: `at://${did}/is.dame.experiment.reaction/${rkey}`,
    cid: null,
    did,
    rkey,
    value: { subject: uri('a'), reaction: verdict, createdAt, ...(extra.text ? { text: extra.text } : {}) },
    profile: null,
    flagged: false,
  };
}

describe('addresses', () => {
  it('puts an experiment at /experimenting/{rkey} and on my repo', () => {
    expect(experimentPath('3abc')).toBe('/experimenting/3abc');
    expect(experimentPath('')).toBe('/experimenting');
    expect(experimentUri('3abc')).toBe(`at://${ME_DID}/is.dame.experiment/3abc`);
  });
});

describe('listExperiments', () => {
  const records = [
    experiment('old', { title: 'Old', createdAt: '2026-01-01T00:00:00Z' }),
    experiment('new', { title: 'New', createdAt: '2026-03-01T00:00:00Z' }),
    experiment('draft', { title: 'Draft', draft: true, createdAt: '2026-04-01T00:00:00Z' }),
    experiment('blank', { title: '   ', createdAt: '2026-05-01T00:00:00Z' }),
    { cid: 'no-uri', value: { title: 'No uri' } },
  ];

  it('lists public experiments newest first, without drafts or untitled ones', () => {
    expect(listExperiments(records).map((r) => r.value.title)).toEqual(['New', 'Old']);
  });

  it('shows the owner their drafts', () => {
    expect(listExperiments(records, { includeDrafts: true }).map((r) => r.value.title)).toEqual([
      'Draft',
      'New',
      'Old',
    ]);
  });

  it('takes anything that isn’t a list as an empty one', () => {
    expect(listExperiments(null)).toEqual([]);
    expect(listExperiments({ experiments: [] })).toEqual([]);
  });

  it('does not reorder the list it was handed', () => {
    const before = records.map((r) => r.uri);
    listExperiments(records);
    expect(records.map((r) => r.uri)).toEqual(before);
  });

  it('finds one by record key, and a draft only when asked', () => {
    expect(findExperiment(records, 'new')?.value.title).toBe('New');
    expect(findExperiment(records, 'draft')).toBeNull();
    expect(findExperiment(records, 'draft', { includeDrafts: true })?.value.title).toBe('Draft');
    expect(findExperiment(records, 'nope')).toBeNull();
    expect(findExperiment(records, '')).toBeNull();
  });

  it('numbers the public ones from the oldest, so a draft never leaves a gap', () => {
    const numbers = experimentNumbers(records);
    expect(numbers.get(uri('old'))).toBe(1);
    expect(numbers.get(uri('new'))).toBe(2);
    expect(numbers.has(uri('draft'))).toBe(false);
  });
});

describe('reading an experiment', () => {
  it('dates it by its own date, and by its record key when it has none', () => {
    expect(experimentDate(experiment('a', { createdAt: '2026-03-01T00:00:00Z' }))).toBe(
      '2026-03-01T00:00:00Z',
    );
    // 3lgq2b6x2c22a is a real TID; a human-chosen key carries no time.
    expect(experimentDate(experiment('3lgq2b6x2c22a', {}))).toMatch(/^20\d\d-/);
    expect(experimentDate(experiment('hand-made', { createdAt: 'not a date' }))).toBeNull();
  });

  it('is open unless it says how it came out', () => {
    expect(experimentStatus({}).key).toBe('open');
    expect(experimentStatus({ status: 'pursuing' }).label).toBe('Being built');
    expect(experimentStatus({ status: 'whatever' }).key).toBe('open');
    expect(takesReactions({ status: 'open' })).toBe(true);
    expect(takesReactions({ status: 'shelved' })).toBe(false);
  });

  it('offers a link only when it is a web address', () => {
    expect(experimentLink({ url: 'https://www.example.com/try?x=1' })).toEqual({
      href: 'https://www.example.com/try?x=1',
      host: 'example.com',
    });
    expect(experimentLink({ url: 'javascript:alert(1)' })).toBeNull();
    expect(experimentLink({ url: 'not a url' })).toBeNull();
    expect(experimentLink({})).toBeNull();
  });

  it('shows a picture only once its blob has an address', () => {
    expect(experimentImage({ image: { ref: { $link: 'bafk' } } })).toBeNull();
    expect(experimentImage({ image: { _url: 'https://pds/blob' }, imageAlt: ' A sketch ' })).toEqual({
      url: 'https://pds/blob',
      alt: 'A sketch',
    });
  });

  it('tells a write-up from the empty shell the block editor leaves', () => {
    const body = (blocks) => ({
      content: { pages: [{ blocks: blocks.map((block) => ({ block })) }] },
    });
    const text = (plaintext) => ({ $type: 'pub.leaflet.blocks.text', plaintext });
    expect(hasWriteUp({})).toBe(false);
    expect(hasWriteUp(body([text('')]))).toBe(false);
    expect(hasWriteUp(body([text('  ')]))).toBe(false);
    expect(hasWriteUp(body([text('Something.')]))).toBe(true);
    expect(hasWriteUp(body([{ $type: 'pub.leaflet.blocks.image' }]))).toBe(true);
  });

  it('sets out its facts: its number, then its kind', () => {
    expect(experimentFacts(experiment('a', { kind: ' Prototype ' }), 7)).toEqual([
      'Experiment 7',
      'prototype',
    ]);
    expect(experimentFacts(experiment('a', {}))).toEqual([]);
  });
});

describe('what the reactions add up to', () => {
  const A = 'did:plc:a';
  const B = 'did:plc:b';
  const C = 'did:plc:c';

  it('knows its three verdicts and nothing else', () => {
    expect(REACTIONS.map((r) => r.key)).toEqual(['more', 'curious', 'pass']);
    expect(reactionFor('more')?.label).toBe('More of this');
    expect(reactionFor('love')).toBeNull();
    expect(reactionFor(undefined)).toBeNull();
  });

  it('counts one reaction per person: their newest', () => {
    const list = [
      reaction(A, 'pass', '2026-03-01T00:00:00Z'),
      reaction(A, 'more', '2026-03-05T00:00:00Z'),
      reaction(B, 'curious', '2026-03-03T00:00:00Z'),
    ];
    const latest = latestPerPerson(list);
    expect(latest.map((r) => [r.did, r.value.reaction])).toEqual([
      [A, 'more'],
      [B, 'curious'],
    ]);
  });

  it('leaves out what the host has hidden, without falling back to an older one', () => {
    const older = reaction(A, 'more', '2026-03-01T00:00:00Z');
    const newer = reaction(A, 'pass', '2026-03-05T00:00:00Z');
    const other = reaction(B, 'curious', '2026-03-03T00:00:00Z');
    const standing = standingReactions([older, newer, other], [newer.uri]);
    expect(standing.map((r) => r.did)).toEqual([B]);
    // A set works as well as a list, and nothing hidden means everyone stands.
    expect(standingReactions([older, other], new Set())).toHaveLength(2);
  });

  it('tallies by verdict and counts a word it doesn’t know as other', () => {
    const tally = tallyReactions([
      reaction(A, 'more', '2026-03-01T00:00:00Z'),
      reaction(B, 'more', '2026-03-02T00:00:00Z'),
      reaction(C, 'obsessed', '2026-03-03T00:00:00Z'),
    ]);
    expect(tally).toEqual({ total: 3, more: 2, curious: 0, pass: 0, other: 1 });
    expect(tallyLine(tally)).toBe('2 more of this · 1 other');
  });

  it('says nothing for no reactions', () => {
    expect(tallyReactions([])).toEqual({ total: 0, more: 0, curious: 0, pass: 0, other: 0 });
    expect(tallyLine(tallyReactions([]))).toBe('');
    expect(reactionCountLabel(0)).toBe('');
    expect(reactionCountLabel(1)).toBe('1 reaction');
    expect(reactionCountLabel(1200)).toBe('1,200 reactions');
  });

  it('picks out the reactions that came with a note', () => {
    const noted = reaction(A, 'more', '2026-03-01T00:00:00Z', { text: 'Yes.' });
    const bare = reaction(B, 'more', '2026-03-02T00:00:00Z');
    expect(reactionNotes([noted, bare])).toEqual([noted]);
  });
});

describe('scopeAllowsReaction', () => {
  it('accepts the owner’s grant and the reaction collection’s', () => {
    expect(scopeAllowsReaction('atproto transition:generic')).toBe(true);
    expect(
      scopeAllowsReaction('atproto repo:is.dame.guestbook.entry repo:is.dame.experiment.reaction'),
    ).toBe(true);
    expect(scopeAllowsReaction('atproto repo:is.dame.experiment.reaction?action=create')).toBe(true);
    expect(scopeAllowsReaction('atproto repo?collection=is.dame.experiment.reaction')).toBe(true);
    expect(scopeAllowsReaction('atproto repo:*')).toBe(true);
  });

  it('refuses a guestbook-only grant, which is what an older session holds', () => {
    expect(scopeAllowsReaction('atproto repo:is.dame.guestbook.entry')).toBe(false);
    expect(scopeAllowsReaction('atproto')).toBe(false);
    expect(scopeAllowsReaction('')).toBe(false);
    // A collection that only starts the same is another collection.
    expect(scopeAllowsReaction('atproto repo:is.dame.experiment.reaction.extra')).toBe(false);
  });
});

describe('a reaction waiting on a sign-in', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const stored = (over = {}) =>
    JSON.stringify({ subject: uri('a'), reaction: 'more', text: 'hi', at: now, ...over });

  it('comes back as it was left', () => {
    expect(parsePendingReaction(stored(), now + 60_000)).toEqual({
      subject: uri('a'),
      reaction: 'more',
      text: 'hi',
    });
  });

  it('is dropped once the sign-in it belonged to is long over', () => {
    expect(parsePendingReaction(stored(), now + 16 * 60_000)).toBeNull();
    // Nor one stamped in the future, which no real hop produces.
    expect(parsePendingReaction(stored({ at: now + 10 * 60_000 }), now)).toBeNull();
  });

  it('only ever names an experiment on this site', () => {
    expect(
      parsePendingReaction(stored({ subject: 'at://did:plc:else/is.dame.experiment/a' }), now),
    ).toBeNull();
    expect(
      parsePendingReaction(stored({ subject: `at://${ME_DID}/app.bsky.feed.post/a` }), now),
    ).toBeNull();
    expect(parsePendingReaction(stored({ reaction: '' }), now)).toBeNull();
    expect(parsePendingReaction('not json', now)).toBeNull();
    expect(parsePendingReaction('null', now)).toBeNull();
  });
});
