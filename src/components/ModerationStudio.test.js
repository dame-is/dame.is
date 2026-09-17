import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The tab bar and the panel switch are two lists in one file that must agree.
 *
 * They did not, and nothing said so: Migrate and Retire kept their buttons
 * after their panels were deleted (both rendered a blank page), and Overview,
 * Why and List shipped with panels but no buttons -- Overview being the DEFAULT
 * tab, so the hub opened on a view with nothing selected in its own nav.
 *
 * This reads the source rather than rendering it, because the suite runs in a
 * node environment with no DOM. That is a weaker test than mounting the
 * component, and it still catches the entire class of defect, which was never
 * about behaviour under render -- it was about two hardcoded lists drifting.
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL('./ModerationStudio.jsx', import.meta.url)),
  'utf8',
);

const tabKeys = () => {
  const block = SOURCE.slice(SOURCE.indexOf('const TABS = ['));
  const list = block.slice(0, block.indexOf('];'));
  return [...list.matchAll(/key:\s*'([a-z]+)'/g)].map((m) => m[1]);
};

const renderedKeys = () => [
  ...new Set(
    [...SOURCE.matchAll(/tab === '([a-z]+)'/g)].map((m) => m[1]),
  ),
];

describe('the moderation hub tab bar', () => {
  it('has a button for every panel it can render', () => {
    expect(tabKeys().sort()).toEqual(renderedKeys().sort());
  });

  it('opens on a tab that exists', () => {
    const initial = /useState\('([a-z]+)'\)/.exec(SOURCE)?.[1];
    expect(tabKeys()).toContain(initial);
  });
});
