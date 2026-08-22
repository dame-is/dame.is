import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLlmsTxt, LLMS_SURFACES } from './llms.js';
import { PAGES } from './pages.js';
import { ME_DID } from '../src/config.js';

const PREFETCH = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/prefetch.mjs'),
  'utf-8',
);

const SNAPSHOTS = {
  pds: 'https://enoki.us-east.host.bsky.network',
  blogRecords: [
    {
      uri: `at://${ME_DID}/site.standard.document/abc123`,
      value: {
        title: 'On the open social web',
        description: 'What changes when the database is a protocol.',
        publishedAt: '2026-03-02T10:00:00Z',
      },
    },
    {
      uri: `at://${ME_DID}/site.standard.document/def456`,
      value: { title: 'Newer post', publishedAt: '2026-06-01T10:00:00Z' },
    },
    { uri: `at://${ME_DID}/site.standard.document/draft1`, value: { title: 'A draft', draft: true } },
  ],
  creatingRecords: [
    { uri: `at://${ME_DID}/is.dame.creating.work/w1`, value: { title: 'Ratioed', slug: 'ratioed' } },
  ],
  curatingChannels: [{ slug: 'red-blue-yellow', title: 'Red Blue Yellow', description: 'Colour.' }],
  ratioedPieces: [{ value: { take: 14, measuredAt: '2026-05-01T00:00:00Z' } }],
  mothNights: ['2026-04-24', '2026-04-25'],
};

const build = (over = {}) => buildLlmsTxt({ ...SNAPSHOTS, ...over });

describe('llmstxt.org structure', () => {
  const txt = build();
  const lines = txt.split('\n');

  it('opens with a single H1 naming the site', () => {
    expect(lines[0]).toBe('# dame.is');
    expect(lines.filter((l) => /^# /.test(l))).toHaveLength(1);
  });

  it('follows the H1 with a blockquote summary', () => {
    expect(lines[1]).toBe('');
    expect(lines[2].startsWith('> ')).toBe(true);
  });

  it('puts every heading-free prose section before the first H2', () => {
    const firstH2 = lines.findIndex((l) => l.startsWith('## '));
    expect(firstH2).toBeGreaterThan(3);
    // Nothing between the blockquote and the first H2 may be a heading.
    for (const line of lines.slice(3, firstH2)) expect(/^#{1,6} /.test(line)).toBe(false);
  });

  it('uses only H2 for its file-list sections', () => {
    for (const l of lines.filter((l) => /^#{1,6} /.test(l))) {
      expect(/^(# dame\.is$|## )/.test(l)).toBe(true);
    }
  });

  it('writes every file-list entry as a markdown hyperlink, optionally with notes', () => {
    // Only the H2 sections are file lists. The prose above the first H2 may
    // hold ordinary bullets — the spec allows any non-heading markdown there,
    // and the when-to-use guidance uses a list.
    const firstH2 = lines.findIndex((l) => l.startsWith('## '));
    const entries = lines.slice(firstH2).filter((l) => l.startsWith('- '));
    expect(entries.length).toBeGreaterThan(10);
    for (const e of entries) expect(/^- (\[[^\]]+\]\([^)]+\)|`[^`]+`)(: .*)?$/.test(e)).toBe(true);
  });

  it('ends with the conventional Optional section', () => {
    const h2s = lines.filter((l) => l.startsWith('## '));
    expect(h2s[h2s.length - 1]).toBe('## Optional');
  });
});

describe('when-to-use guidance', () => {
  const txt = build();

  it('says what the site is for, in specifics rather than marketing copy', () => {
    expect(txt).toContain('**When to use this site.**');
    expect(txt).toContain('résumé');
    expect(txt).toContain('AT Protocol');
  });

  it('says when an agent should go elsewhere', () => {
    expect(txt).toContain('**When not to use it.**');
    expect(txt).toContain('atproto.com');
  });

  it('tells an agent how to fetch the site efficiently', () => {
    expect(txt).toContain('Accept: text/markdown');
    expect(txt).toContain('return a real 404');
  });
});

describe('the AT Protocol surface it advertises', () => {
  it('names a callable, unauthenticated endpoint on the resolved PDS', () => {
    const txt = build();
    expect(txt).toContain(
      `${SNAPSHOTS.pds}/xrpc/com.atproto.repo.listRecords?repo=${ME_DID}`,
    );
    expect(txt).toContain(`https://plc.directory/${ME_DID}`);
  });

  it('lists the collections an agent can enumerate', () => {
    const txt = build();
    expect(txt).toContain('## Collections');
    expect(txt).toContain('`is.dame.now`');
    expect(txt).toContain('`app.bsky.feed.post`');
  });

  it('degrades to a placeholder host rather than a wrong one when the PDS is unknown', () => {
    const txt = build({ pds: null });
    expect(txt).toContain('https://<pds>/xrpc/com.atproto.repo.listRecords');
    expect(txt).not.toContain('describeRepo');
  });
});

describe('content lists', () => {
  it('lists published blog posts newest first, and omits drafts', () => {
    const txt = build();
    expect(txt.indexOf('Newer post')).toBeLessThan(txt.indexOf('On the open social web'));
    expect(txt).not.toContain('A draft');
  });

  it('links a work by its slug, and a Ratioed take by its zero-padded number', () => {
    const txt = build();
    expect(txt).toContain('](https://dame.is/creating/ratioed)');
    expect(txt).toContain('](https://dame.is/creating/ratioed/14)');
  });

  it('counts the moth nights instead of listing them, and says where the rest are', () => {
    const txt = build();
    expect(txt).toContain('Index of 2 nights at the light');
    expect(txt).toContain('listed in sitemap.xml');
  });

  it('survives every snapshot being missing', () => {
    const txt = buildLlmsTxt({ pds: null });
    expect(txt.startsWith('# dame.is')).toBe(true);
    expect(txt).toContain('## Pages');
    expect(txt).not.toContain('## Blog posts');
  });
});

describe('the page list', () => {
  it('describes each surface with the same copy the OG cards use', () => {
    const txt = build();
    for (const p of LLMS_SURFACES) {
      if (p === '/') continue;
      expect(txt).toContain(`](https://dame.is${p}): ${PAGES[p].desc}`);
    }
  });

  it('lists the same surfaces as sitemap.xml', () => {
    // Both files are generated from these lists; if they drift, agents and
    // crawlers get different answers about which pages exist.
    const block = PREFETCH.match(/const SITEMAP_SURFACES = \[([^\]]*)\]/);
    expect(block).toBeTruthy();
    const declared = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...LLMS_SURFACES].sort()).toEqual([...declared].sort());
  });
});
