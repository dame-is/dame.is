// theme.css defines the site's tokens on :root, and a component's stylesheet
// can't redefine one there. main.jsx imports App.jsx, and with it every
// component's stylesheet, before it imports the global sheets, so in the
// bundle a component's `:root { --token: … }` lands ahead of theme.css's and
// loses the tie. That's how the essay's 18px phone size, set that way in
// LeafletDocument.css, never applied for as long as it existed.
//
// A token's responsive values belong beside it in theme.css. A scope can
// still re-size one on its own class (`.wb`, `.resume`) or on a qualified
// root (`:root[data-xray='on']`), both of which outrank the bare :root.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const STYLES = join(SRC, 'styles');

function cssFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

const uncomment = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties a stylesheet declares, anywhere in it. */
function declared(css) {
  return new Set([...uncomment(css).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
}

/**
 * The declaration blocks of every innermost rule whose selector list includes
 * a bare `:root`, inside an at-rule or not. An at-rule's own block contains
 * braces, so the pattern only ever matches the rules inside it.
 */
function bareRootBlocks(css) {
  return [...uncomment(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.split(',').some((s) => s.trim() === ':root'))
    .map(([, , body]) => body);
}

/** `file: --token` for every theme token a sheet outside src/styles sets on a bare :root. */
export function rootTokenOverrides(themeCss, sheets) {
  const tokens = declared(themeCss);
  const found = [];
  for (const [file, css] of sheets) {
    for (const body of bareRootBlocks(css)) {
      for (const name of declared(body)) {
        if (tokens.has(name)) found.push(`${file}: ${name}`);
      }
    }
  }
  return found;
}

describe('theme tokens', () => {
  it('are never redefined on a bare :root outside src/styles', () => {
    const theme = readFileSync(join(STYLES, 'theme.css'), 'utf8');
    const sheets = cssFiles(SRC)
      .filter((file) => !file.startsWith(STYLES))
      .map((file) => [relative(SRC, file), readFileSync(file, 'utf8')]);
    expect(rootTokenOverrides(theme, sheets)).toEqual([]);
  });

  it('catch the rule that kept phones at 20px', () => {
    const theme = ':root { --text-prose: 1.25rem; --edge: 1rem; }';
    const leaflet = '.leaflet-doc { color: red; }\n@media (max-width: 700px) {\n  :root {\n    --text-prose: 1.125rem;\n  }\n}';
    expect(rootTokenOverrides(theme, [['components/LeafletDocument.css', leaflet]])).toEqual([
      'components/LeafletDocument.css: --text-prose',
    ]);
  });

  it('leave scoped and qualified overrides alone', () => {
    const theme = ':root { --text-base: 1rem; --wing: 0px; }';
    const sheet = [
      '.wb { --text-base: 0.95rem; }',
      ":root[data-admin-shell] { --wing: 2rem; }",
      ':root:not([data-x]) .y { --text-base: 2rem; }',
      ':root { --own-thing: 1px; }',
    ].join('\n');
    expect(rootTokenOverrides(theme, [['a.css', sheet]])).toEqual([]);
  });
});
