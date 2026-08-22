import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ssrFallbackHtml, injectSsrFallback, escapeHtml, NAV_PATHS } from './ssrContent.js';
import { PAGES } from './pages.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHELL = readFileSync(resolve(HERE, '../index.html'), 'utf-8');

/** Text as an HTML-to-text extractor would see it: tags out, entities kept. */
function textOf(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HOME = {
  path: '/',
  heading: 'dame.is',
  desc: 'An atmospheric personal website — statuses, posts, blogs, listens, and creations.',
};

describe('ssrFallbackHtml', () => {
  it('gives the page exactly one H1', () => {
    const html = ssrFallbackHtml(HOME);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('<h1>dame.is</h1>');
  });

  it('carries well over the 500 characters of text crawlers look for', () => {
    // The audit that prompted this measured 7 characters on the live homepage.
    expect(textOf(ssrFallbackHtml(HOME)).length).toBeGreaterThan(500);
  });

  it('links every section as a real anchor a crawler can follow', () => {
    const html = ssrFallbackHtml(HOME);
    for (const p of NAV_PATHS) expect(html).toContain(`href="${p}"`);
  });

  it('marks the current page in the nav', () => {
    expect(ssrFallbackHtml({ ...HOME, path: '/blogging' })).toContain(
      'href="/blogging" aria-current="page"',
    );
  });

  it('points agents at the machine-readable indexes', () => {
    const html = ssrFallbackHtml(HOME);
    expect(html).toContain('href="/llms.txt"');
    expect(html).toContain('href="/sitemap.xml"');
    expect(html).toContain('href="/feed.xml"');
  });

  it('names the record behind a record page', () => {
    const html = ssrFallbackHtml({
      path: '/blogging/a-post',
      heading: 'A post',
      desc: 'About something.',
      atUri: 'at://did:plc:abc/site.standard.document/xyz',
      date: '2026-04-01',
    });
    expect(html).toContain('at://did:plc:abc/site.standard.document/xyz');
    expect(html).toContain('<time datetime="2026-04-01">2026-04-01</time>');
  });

  it('does not print the body twice when it repeats the description', () => {
    const html = ssrFallbackHtml({ ...HOME, body: HOME.desc });
    expect(html.split(escapeHtml(HOME.desc)).length - 1).toBe(1);
  });

  it('escapes record-derived text so it cannot inject markup', () => {
    const html = ssrFallbackHtml({
      ...HOME,
      heading: '<img src=x onerror=alert(1)>',
      body: '</div><script>alert(2)</script>',
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('injectSsrFallback', () => {
  it('puts the block inside the shell’s #root', () => {
    const out = injectSsrFallback(SHELL, ssrFallbackHtml(HOME));
    expect(out).toContain('<div id="root"><div id="ssr-fallback"');
    expect(out).not.toContain('<div id="root"></div>');
  });

  it('ships the inline script that hides it wherever JS runs', () => {
    const out = injectSsrFallback(SHELL, ssrFallbackHtml(HOME));
    expect(out).toContain("getElementById('ssr-fallback')");
    expect(out).toContain('hidden=true');
  });

  it('writes $ sequences literally instead of expanding them', () => {
    // `$&` in a replacement string means "the whole match". A record titled
    // "How I saved $1,000" must not rewrite the shell around it.
    const block = ssrFallbackHtml({ ...HOME, heading: 'How I saved $1,000 with $& and $`' });
    const out = injectSsrFallback(SHELL, block);
    expect(out).toContain('How I saved $1,000 with $&amp; and $`');
    expect(out.match(/<div id="root">/g)).toHaveLength(1);
  });

  it('tolerates the whitespace a build step might introduce', () => {
    const spaced = SHELL.replace('<div id="root"></div>', '<div id="root" >\n    </div>');
    const out = injectSsrFallback(spaced, ssrFallbackHtml(HOME));
    expect(out).toContain('<div id="root"><div id="ssr-fallback"');
  });

  it('ships the content before </body> if #root is no longer an empty div', () => {
    // The failure this guards is silent: no match, no content, and a page that
    // reads as empty again with nothing to show it regressed.
    const changed = SHELL.replace('<div id="root"></div>', '<div id="root"><span>x</span></div>');
    const out = injectSsrFallback(changed, ssrFallbackHtml(HOME));
    expect(out).toContain('<div id="ssr-fallback"');
    expect(out).toContain("getElementById('ssr-fallback')");
    expect(out.indexOf('ssr-fallback')).toBeLessThan(out.indexOf('</body>'));
  });

  it('leaves the rest of the shell alone', () => {
    const out = injectSsrFallback(SHELL, ssrFallbackHtml(HOME));
    expect(out).toContain('<script type="module" src="/src/main.jsx"></script>');
    expect(out).toContain('<link rel="manifest" href="/api/manifest" />');
  });

  it('lifts the shell’s text well past the 5% content-efficiency floor', () => {
    const out = injectSsrFallback(SHELL, ssrFallbackHtml(HOME));
    const ratio = textOf(out).length / out.length;
    expect(ratio).toBeGreaterThan(0.05);
  });
});

describe('NAV_PATHS', () => {
  it('names only pages that exist in the page table', () => {
    for (const p of NAV_PATHS) expect(PAGES[p]).toBeTruthy();
  });
});
