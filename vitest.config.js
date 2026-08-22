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
//
// middleware.js is named on its own because it sits at the repo root. It is
// where the route table, content negotiation and the JS-less fallback are
// actually wired together, so unit-testing the pieces without it would leave
// the composition — statuses, headers, what a crawler ends up holding —
// unchecked.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'og/**/*.test.js', 'middleware.test.js'],
  },
});
