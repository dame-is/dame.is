import { defineConfig } from 'vitest/config';

// What is tested here is what can be checked without a GPU (see
// src/culturing.test.js), so it needs neither a browser nor the React plugin
// from vite.config.js.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
