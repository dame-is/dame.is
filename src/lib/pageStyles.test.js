// The lazy pages' CSS has to keep the cascade position it had when the pages
// were imported statically (see pageStyles.js for why). This walks the
// import graph the way Rollup orders modules and checks that the entry's
// stylesheets come out in the same order either way.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const APP = resolve(SRC, 'App.jsx');
const PAGE_STYLES = resolve(SRC, 'lib/pageStyles.js');

// `import x from '…'`, `import { a, b } from '…'`, bare `import '…'` and
// `export … from '…'`, in source order. Dynamic imports don't match, which
// is the point.
const STATIC_IMPORT =
  /^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
// Whitespace-tolerant: Prettier wraps the longer ones over three lines.
const PAGE_CHUNK = /\bpage\(\s*\(\) => import\('([^']+)'\),?\s*\)/g;

function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null; // packages import no app CSS
  const base = resolve(dirname(from), spec);
  for (const file of [base, `${base}.js`, `${base}.jsx`]) {
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

/**
 * The order stylesheets land in the entry: depth-first through static
 * imports in source order, each file at its first visit. With `pagesInline`,
 * App.jsx's pageStyles import is replaced by the lazy pages themselves —
 * the order the CSS had back when they were static imports at that spot.
 * Returns the order, and (inline) the stylesheets reached through the pages
 * at that spot — what pageStyles.js should import.
 */
function cssOrder({ pagesInline }) {
  const seen = new Set();
  const css = [];
  let viaPages = null;
  let reached = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file.endsWith('.css')) {
      css.push(relative(SRC, file));
      viaPages?.push(`../${relative(SRC, file)}`);
      return;
    }
    const source = readFileSync(file, 'utf8');
    for (const [, spec] of source.matchAll(STATIC_IMPORT)) {
      const target = resolveSpec(file, spec);
      if (!target) continue;
      if (pagesInline && target === PAGE_STYLES) {
        viaPages = [];
        for (const [, page] of source.matchAll(PAGE_CHUNK)) {
          visit(resolveSpec(file, page));
        }
        reached = viaPages;
        viaPages = null;
      } else {
        visit(target);
      }
    }
  };
  visit(APP);
  return { css, reached };
}

describe('lazy pages keep their stylesheets in place', () => {
  it('reads every lazy page App.jsx declares', () => {
    // A page the pattern misses would drop out of the list below, and its
    // stylesheets with it.
    const source = readFileSync(APP, 'utf8');
    const declared = source.match(/=\s*page\(/g) ?? [];
    expect(declared.length).toBeGreaterThan(0);
    expect([...source.matchAll(PAGE_CHUNK)]).toHaveLength(declared.length);
  });

  it('orders the entry CSS exactly as when the pages were static imports', () => {
    const inline = cssOrder({ pagesInline: true });
    const paste = inline.reached.map((f) => `import '${f}';`).join('\n');
    expect(inline.reached.length).toBeGreaterThan(0);
    expect(
      cssOrder({ pagesInline: false }).css,
      `src/lib/pageStyles.js is out of date; its imports should be:\n${paste}`,
    ).toEqual(inline.css);
  });
});
