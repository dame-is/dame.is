import { describe, it, expect } from 'vitest';
import {
  parseAccept,
  qualityFor,
  negotiate,
  pageMarkdown,
  notFoundMarkdown,
  MARKDOWN_TYPE,
} from './markdown.js';

describe('parseAccept', () => {
  it('returns nothing for a missing or empty header', () => {
    expect(parseAccept(undefined)).toEqual([]);
    expect(parseAccept(null)).toEqual([]);
    expect(parseAccept('   ')).toEqual([]);
  });

  it('defaults q to 1 and lowercases the range', () => {
    expect(parseAccept('Text/Markdown')).toEqual([{ type: 'text', subtype: 'markdown', q: 1 }]);
  });

  it('reads q-values', () => {
    expect(parseAccept('text/html;q=0.8, text/markdown;q=0.9')).toEqual([
      { type: 'text', subtype: 'html', q: 0.8 },
      { type: 'text', subtype: 'markdown', q: 0.9 },
    ]);
  });

  it('ignores parameters other than q', () => {
    expect(parseAccept('text/markdown;variant=gfm;q=0.5')).toEqual([
      { type: 'text', subtype: 'markdown', q: 0.5 },
    ]);
  });

  it('falls back to q=1 on an unparseable q, and clamps out-of-range values', () => {
    expect(parseAccept('text/html;q=banana')[0].q).toBe(1);
    expect(parseAccept('text/html;q=5')[0].q).toBe(1);
    expect(parseAccept('text/html;q=-2')[0].q).toBe(0);
  });

  it('skips malformed ranges rather than throwing', () => {
    expect(parseAccept('text, /html, text/, ,text/plain')).toEqual([
      { type: 'text', subtype: 'plain', q: 1 },
    ]);
  });
});

describe('qualityFor', () => {
  it('treats an empty header as */*', () => {
    expect(qualityFor('text/markdown', parseAccept(''))).toBe(1);
  });

  it('lets the most specific range win regardless of q', () => {
    // */*;q=0.9 is broader than text/markdown;q=0.1, so markdown is 0.1.
    const ranges = parseAccept('*/*;q=0.9, text/markdown;q=0.1');
    expect(qualityFor('text/markdown', ranges)).toBe(0.1);
    expect(qualityFor('text/html', ranges)).toBe(0.9);
  });

  it('honours a type wildcard', () => {
    const ranges = parseAccept('text/*;q=0.7');
    expect(qualityFor('text/markdown', ranges)).toBe(0.7);
    expect(qualityFor('application/json', ranges)).toBe(0);
  });

  it('reads q=0 as a refusal, not an absence', () => {
    const ranges = parseAccept('text/html;q=0, */*');
    expect(qualityFor('text/html', ranges)).toBe(0);
    expect(qualityFor('text/markdown', ranges)).toBe(1);
  });
});

describe('negotiate', () => {
  it('serves markdown when it is asked for outright', () => {
    expect(negotiate('text/markdown')).toBe('markdown');
    expect(negotiate('text/markdown, text/html;q=0.5')).toBe('markdown');
  });

  it('serves HTML to a browser', () => {
    expect(
      negotiate('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8'),
    ).toBe('html');
  });

  it('serves HTML when nothing was specified', () => {
    expect(negotiate('')).toBe('html');
    expect(negotiate(undefined)).toBe('html');
    expect(negotiate('*/*')).toBe('html');
  });

  it('breaks a tie towards HTML', () => {
    // Neither was preferred, so nothing asked us to change representation.
    expect(negotiate('text/markdown, text/html')).toBe('html');
    expect(negotiate('text/*')).toBe('html');
  });

  it('406s a request that accepts neither', () => {
    expect(negotiate('application/pdf')).toBe('none');
    expect(negotiate('image/png, image/webp')).toBe('none');
    expect(negotiate('text/html;q=0, text/markdown;q=0')).toBe('none');
  });

  it('does not 406 a request that refuses only one of the two', () => {
    expect(negotiate('text/html;q=0, text/markdown')).toBe('markdown');
    expect(negotiate('text/markdown;q=0, text/html')).toBe('html');
  });
});

describe('pageMarkdown', () => {
  const base = {
    origin: 'https://dame.is',
    path: '/blogging',
    heading: 'dame.is blogging',
    desc: 'Long-form essays on the open social web.',
  };

  it('opens with a single H1', () => {
    const md = pageMarkdown(base);
    expect(md.startsWith('# dame.is blogging\n')).toBe(true);
    expect(md.match(/^# /gm)).toHaveLength(1);
  });

  it('carries enough prose to be worth fetching', () => {
    expect(pageMarkdown(base).length).toBeGreaterThan(500);
  });

  it('links every section absolutely, and marks the current one', () => {
    const md = pageMarkdown(base);
    expect(md).toContain('](https://dame.is/creating)');
    expect(md).toContain('](https://dame.is/blogging) (this page)');
  });

  it('includes the record, date and canonical URL when given them', () => {
    const md = pageMarkdown({
      ...base,
      path: '/blogging/a-post',
      heading: 'A post',
      body: 'The body of the post.',
      atUri: 'at://did:plc:abc/site.standard.document/xyz',
      date: '2026-04-01',
      canonical: 'https://dame.is/blogging/a-post',
    });
    expect(md).toContain('Source record: `at://did:plc:abc/site.standard.document/xyz`');
    expect(md).toContain('Published: 2026-04-01');
    expect(md).toContain('Canonical URL: https://dame.is/blogging/a-post');
    expect(md).toContain('The body of the post.');
  });

  it('does not print the body twice when it repeats the description', () => {
    const md = pageMarkdown({ ...base, body: base.desc });
    expect(md.split(base.desc).length - 1).toBe(1);
  });

  it('escapes markdown syntax in record-derived text', () => {
    const md = pageMarkdown({ ...base, heading: '# not a heading [link](x)' });
    expect(md).toContain('\\# not a heading \\[link\\](x)');
    // The escaped text must not introduce a second H1.
    expect(md.match(/^# /gm)).toHaveLength(1);
  });
});

describe('notFoundMarkdown', () => {
  it('names the missing path and points at the indexes', () => {
    const md = notFoundMarkdown({ origin: 'https://dame.is', path: '/nope' });
    expect(md).toContain('# 404 — Not found');
    expect(md).toContain('/nope');
    expect(md).toContain('https://dame.is/llms.txt');
    expect(md).toContain('https://dame.is/sitemap.xml');
  });
});

describe('MARKDOWN_TYPE', () => {
  it('is the media type acceptmarkdown.com checks for', () => {
    expect(MARKDOWN_TYPE).toBe('text/markdown; charset=utf-8');
  });
});
