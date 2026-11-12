import { defineConfig } from 'vitest/config';

// What can be checked without a GPU: the optics (plain functions over
// numbers) and the cloud generators. Neither needs a browser or the React
// plugin from vite.config.js.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
