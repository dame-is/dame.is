// The standalone build: `npm run dev` / `npm run build` from this folder
// serves or bundles the game by itself, from index.html. The site this lives
// in doesn't use this file; it bundles src/index.js with its own config.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths, so the build can be dropped under any path of any
  // host (a subdomain, a folder, an itch.io frame).
  base: './',
  plugins: [react()],
  server: { port: 5180 },
  preview: { port: 5180 },
  build: {
    outDir: 'dist',
    // three.js is most of the bundle and there is nothing to split it from.
    chunkSizeWarningLimit: 900,
  },
});
