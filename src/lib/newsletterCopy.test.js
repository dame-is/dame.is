import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_NEWSLETTER_COPY,
  NEWSLETTER_COPY_KEYS,
  mergeNewsletterCopy,
  splitFine,
} from './newsletterCopy.js';
import { LEXICONS } from './lexicons.js';
import { pageDefault, pageSlugForCollection } from './pageRegistry.js';
import { COLLECTIONS } from '../config.js';

const LEXICON = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../lexicons/is.dame.newsletter.json'),
    'utf-8',
  ),
);

describe('mergeNewsletterCopy', () => {
  it('is the built-in wording when nothing has been written', () => {
    expect(mergeNewsletterCopy(undefined)).toEqual(DEFAULT_NEWSLETTER_COPY);
    expect(mergeNewsletterCopy({})).toEqual(DEFAULT_NEWSLETTER_COPY);
  });

  it('takes a field that has been written and leaves the rest', () => {
    const out = mergeNewsletterCopy({ thanks: '  Thank you!  ' });
    expect(out.thanks).toBe('Thank you!');
    expect(out.heading).toBe(DEFAULT_NEWSLETTER_COPY.heading);
  });

  it('treats a cleared field as unwritten, and ignores what it does not name', () => {
    expect(mergeNewsletterCopy({ heading: '   ' }).heading).toBe('Newsletter');
    expect(mergeNewsletterCopy({ nonsense: 'hi', heading: 3 })).toEqual(DEFAULT_NEWSLETTER_COPY);
  });

  it('keeps the lexicon, the editor and the defaults naming the same fields', () => {
    const inLexicon = Object.keys(LEXICON.defs.main.record.properties).filter(
      (k) => k !== 'updatedAt',
    );
    const inEditor = LEXICONS[COLLECTIONS.newsletter].fields
      .map((f) => f.key)
      .filter((k) => k !== 'updatedAt');
    expect(inLexicon.sort()).toEqual([...NEWSLETTER_COPY_KEYS].sort());
    expect(inEditor.sort()).toEqual([...NEWSLETTER_COPY_KEYS].sort());
    expect(LEXICON.id).toBe(COLLECTIONS.newsletter);
  });

  it('puts the subscribe page’s own panel on the Newsletter surface', () => {
    expect(pageSlugForCollection(COLLECTIONS.newsletter)).toBe('subscribe');
    expect(pageDefault('subscribe').title).toBeTruthy();
  });
});

describe('splitFine', () => {
  it('cuts the fine print at {rss}, for the feed’s link to go between', () => {
    expect(splitFine('Sent through Leaflet. There’s also an {rss}.')).toEqual({
      before: 'Sent through Leaflet. There’s also an ',
      after: '.',
      rss: true,
    });
  });

  it('is all text when there is no {rss}, and only cuts at the first', () => {
    expect(splitFine('No feed here.')).toEqual({ before: 'No feed here.', after: '', rss: false });
    expect(splitFine('{rss} and {rss}')).toEqual({ before: '', after: ' and {rss}', rss: true });
  });

  it('carries the link in the built-in fine print', () => {
    expect(splitFine(DEFAULT_NEWSLETTER_COPY.fine).rss).toBe(true);
  });
});
