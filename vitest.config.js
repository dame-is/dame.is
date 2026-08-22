import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.js on purpose: the modules under test in
// src/lib are pure and isomorphic, so they need neither the React plugin nor
// the git-keyed build-id machinery that vite.config.js sets up for the app
// build. A dedicated config also means `vitest` never triggers that plugin's
// `git rev-parse` / version.json emit.
//
// og/ is in too: the crawler-facing resolvers there are plain fetch + JSON for
// the same reason (they run at the edge), and they decide what every shared
// link says about a record — worth holding to the same tests as src/lib.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'og/**/*.test.js'],
  },
});
