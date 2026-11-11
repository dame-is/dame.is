import { defineConfig } from 'vitest/config';

// The rules of the game (src/sim) are plain functions, so their tests need
// neither a browser nor the React plugin from vite.config.js.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
