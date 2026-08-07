import { describe, it, expect } from 'vitest';
import {
  VERBS,
  DEFAULT_HOME_VERBS,
  VERB_LABELS,
  verbConfig,
  nsidConfig,
  recordHrefFor,
} from './verbRegistry.js';

describe('DEFAULT_HOME_VERBS', () => {
  it('only names verbs that exist in the registry', () => {
    // A typo here silently drops a verb from the default feed, which reads
    // as "those records stopped showing up" rather than as a broken list.
    for (const verb of DEFAULT_HOME_VERBS) {
      expect(VERBS, `"${verb}" is not a registry verb`).toContain(verb);
    }
  });

  it('leaves the opt-in verbs out', () => {
    // Both are deliberate omissions, so they get asserted rather than left
    // to a reader's memory: `liking` is high-volume and pays for a subject
    // lookup per record, `flushing` is frequent and beside the point of the
    // timeline. Turning either on for everybody means editing this list —
    // and this test — on purpose.
    expect(DEFAULT_HOME_VERBS).not.toContain('liking');
    expect(DEFAULT_HOME_VERBS).not.toContain('flushing');
  });
});

describe('the flushing verb', () => {
  it('is registered, so the filter chip exists to turn it on', () => {
    expect(VERBS).toContain('flushing');
    expect(VERB_LABELS.flushing).toBe('a flush');
  });

  it('owns im.flushing.right.now as plain content', () => {
    const cfg = verbConfig('flushing');
    expect(cfg.renderer).toBe('FlushCard');
    expect(cfg.icon).toBe('Toilet');
    expect(cfg.collections).toHaveLength(1);
    expect(cfg.collections[0]).toMatchObject({
      nsid: 'im.flushing.right.now',
      source: 'flushes',
      kind: 'content',
    });
    // No maxAgeDays: a flush is small, and the point of turning the chip on
    // is to see them, not to see the last ninety days of them.
    expect(cfg.collections[0].maxAgeDays).toBeUndefined();
  });

  it('routes an at:// URI back to itself', () => {
    expect(nsidConfig('im.flushing.right.now').verb.verb).toBe('flushing');
  });

  it('addresses a record by the short /flushing/{rkey} form', () => {
    const atUri = 'at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/im.flushing.right.now/3msijht7apx2d';
    expect(recordHrefFor('flushing', { atUri, rkey: '3msijht7apx2d' })).toBe(
      '/flushing/3msijht7apx2d',
    );
  });
});
