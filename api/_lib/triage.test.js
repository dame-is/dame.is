import { describe, it, expect } from 'vitest';
import { parseLabels, evidenceUriFor } from './triage.js';
import {
  LABELS,
  parseLabel,
  parseCommand,
} from '../../src/lib/moderation/command.js';

describe('which engagement carries words', () => {
  const row = (kinds) => ({
    did: 'did:plc:x',
    records: kinds.map((kind, i) => ({
      kind,
      rkey: `r${i}`,
      collection: 'app.bsky.feed.post',
    })),
  });

  it('reads a quote or a reply', () => {
    expect(evidenceUriFor(row(['quote']))).toBe(
      'at://did:plc:x/app.bsky.feed.post/r0',
    );
    expect(evidenceUriFor(row(['reply']))).toContain('/r0');
    expect(evidenceUriFor(row(['threadReply']))).toContain('/r0');
  });

  it('skips past engagements that say nothing', () => {
    // A like carries no words, so there is nothing to label. Reporting that
    // separately matters: "no words" and "neutral" are different answers.
    expect(evidenceUriFor(row(['like', 'quote']))).toContain('/r1');
    expect(evidenceUriFor(row(['like']))).toBe(null);
    expect(evidenceUriFor(row(['repost']))).toBe(null);
    expect(evidenceUriFor({ did: 'did:plc:x' })).toBe(null);
    expect(evidenceUriFor(null)).toBe(null);
  });
});

describe('reading the model back', () => {
  it('parses one label per numbered line', () => {
    expect(parseLabels('1: hostile\n2: arguing\n3: neutral', 3)).toEqual([
      'hostile',
      'arguing',
      'neutral',
    ]);
  });

  it('tolerates the shapes a model actually produces', () => {
    expect(parseLabels('1. hostile\n2) arguing\n3 - neutral', 3)).toEqual([
      'hostile',
      'arguing',
      'neutral',
    ]);
  });

  it('leaves a row unlabelled rather than guessing at it', () => {
    // An unlabelled row stays pending and gets picked up next run. A row
    // labelled from a word nobody defined would be a block nobody can explain.
    expect(parseLabels('1: hostile\n2: spicy\n', 3)).toEqual([
      'hostile',
      null,
      null,
    ]);
    expect(parseLabels('', 2)).toEqual([null, null]);
    expect(parseLabels(null, 1)).toEqual([null]);
  });

  it('ignores a number outside the batch', () => {
    // The batch is the only thing indexed; a model inventing item 99 must not
    // reach past the end of it.
    expect(parseLabels('99: hostile\n1: arguing', 2)).toEqual([
      'arguing',
      null,
    ]);
    expect(parseLabels('0: hostile\n1: arguing', 2)).toEqual(['arguing', null]);
  });

  it('only accepts the three labels', () => {
    for (const label of LABELS) {
      expect(parseLabels(`1: ${label}`, 1)).toEqual([label]);
    }
    expect(parseLabels('1: PROTECTED\n', 1)).toEqual([null]);
    expect(parseLabels('1: UNKNOWN\n', 1)).toEqual([null]);
  });
});

describe('a label is not a band', () => {
  it('parses the words a person would type', () => {
    expect(parseLabel('toxic')).toBe('hostile');
    expect(parseLabel('Hostile')).toBe('hostile');
    expect(parseLabel('arguing')).toBe('arguing');
    expect(parseLabel('UNKNOWN')).toBe(null);
  });

  it('keeps bands and labels in separate fields', () => {
    // They travel separately all the way to the log, because "you were in a
    // category I approved" and "a model read what you wrote" are different
    // answers to why somebody is on the list.
    const band = parseCommand('approve 3f9a2c1b UNKNOWN');
    expect(band.bands).toEqual(['UNKNOWN']);
    expect(band.labels).toEqual([]);

    const label = parseCommand('approve 3f9a2c1b toxic');
    expect(label.bands).toEqual([]);
    expect(label.labels).toEqual(['hostile']);
  });

  it('never lets a triage label carry PROTECTED past the veto', () => {
    const cmd = parseCommand('approve 3f9a2c1b PROTECTED toxic');
    expect(cmd.bands).toEqual([]);
    expect(cmd.labels).toEqual(['hostile']);
  });

  it('does not count triage as a write', () => {
    // It reads posts and writes labels. Nobody goes on the list until a
    // separate approve, which is why a read-only account keeps it.
    expect(parseCommand('triage 3f9a2c1b').action).toBe('triage');
  });
});
