import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The admin's studio table imports the hub from this path. It is a re-export
// now, and the one thing worth pinning is that it points at the hub rather
// than at a component that no longer exists. Read as source: the suite runs in
// node, with no DOM to mount anything in. The hub's own tests are in
// ./moderation/moderation.test.js.
const SOURCE = readFileSync(
  fileURLToPath(new URL('./ModerationStudio.jsx', import.meta.url)),
  'utf8',
);

describe('the moderation studio entry point', () => {
  it('re-exports the hub', () => {
    expect(SOURCE).toMatch(
      /export \{ default \} from '\.\/moderation\/ModerationApp\.jsx'/,
    );
  });
});
