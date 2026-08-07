import { describe, it, expect } from 'vitest';
import { flushBody, flushPermalink, isWordlessFlush } from './flushText.js';

describe('flushBody', () => {
  it('drops the leading "is " for a handle that already ends in .is', () => {
    expect(flushBody('is flushing', 'dame.is')).toBe('flushing');
    expect(flushBody('is not doing so hot guys', 'dame.is')).toBe('not doing so hot guys');
  });

  it('keeps the leading "is " for every other handle', () => {
    expect(flushBody('is flushing', 'someone.bsky.social')).toBe('is flushing');
  });

  it('matches the "is " prefix regardless of case', () => {
    expect(flushBody('IS FLUSHING', 'dame.is')).toBe('FLUSHING');
  });

  it('only strips a whole leading word, not any text starting with "is"', () => {
    expect(flushBody('island time', 'dame.is')).toBe('island time');
  });

  it('falls back to the composer default when the text is empty', () => {
    expect(flushBody('', 'dame.is')).toBe('flushing');
    expect(flushBody('   ', 'dame.is')).toBe('flushing');
    expect(flushBody(null, 'dame.is')).toBe('flushing');
    expect(flushBody('', 'someone.bsky.social')).toBe('is flushing');
  });

  it('leaves a bare "is" alone rather than stripping down to nothing', () => {
    // Trailing space or not, there is no word behind the "is" to keep, so
    // the strip never fires — same as flushes.app.
    expect(flushBody('is', 'dame.is')).toBe('is');
    expect(flushBody('is ', 'dame.is')).toBe('is');
  });

  it('collapses the gap when the stored text double-spaces after "is"', () => {
    expect(flushBody('is  flushing', 'dame.is')).toBe('flushing');
  });

  it('tolerates a missing handle', () => {
    expect(flushBody('is flushing', null)).toBe('is flushing');
    expect(flushBody('', undefined)).toBe('is flushing');
  });
});

describe('isWordlessFlush', () => {
  it('recognises the composer default, stored or stripped', () => {
    expect(isWordlessFlush('is flushing')).toBe(true);
    expect(isWordlessFlush('flushing')).toBe(true);
    expect(isWordlessFlush('  IS FLUSHING  ')).toBe(true);
  });

  it('recognises an empty box', () => {
    expect(isWordlessFlush('')).toBe(true);
    expect(isWordlessFlush('   ')).toBe(true);
    expect(isWordlessFlush(null)).toBe(true);
    expect(isWordlessFlush(undefined)).toBe(true);
  });

  it('is false as soon as the flush says anything of its own', () => {
    expect(isWordlessFlush('is not doing so hot guys')).toBe(false);
    expect(isWordlessFlush('is flushing twice')).toBe(false);
    expect(isWordlessFlush('flushing, again')).toBe(false);
  });
});

describe('flushPermalink', () => {
  const uri = 'at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/im.flushing.right.now/3msijht7apx2d';

  it('builds the flushes.app permalink from the at:// URI and handle', () => {
    expect(flushPermalink(uri, 'dame.is')).toBe(
      'https://flushes.app/flush/dame.is/3msijht7apx2d',
    );
  });

  it('returns null without a handle, since the route needs one', () => {
    expect(flushPermalink(uri, null)).toBe(null);
    expect(flushPermalink(uri, '')).toBe(null);
  });

  it('returns null for anything that is not a flush record', () => {
    expect(flushPermalink('at://did:plc:abc/app.bsky.feed.post/xyz', 'dame.is')).toBe(null);
    expect(flushPermalink('', 'dame.is')).toBe(null);
    expect(flushPermalink(null, 'dame.is')).toBe(null);
  });
});
