// The standalone build: `npm run dev` / `npm run build` from this folder
// serves or bundles the workbench by itself, from index.html. The site this
// lives in doesn't use this file; it bundles src/index.js with its own
// config.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5182 },
  preview: { port: 5182 },
  build: {
    outDir: 'dist',
    // three.js is most of the bundle and there is nothing to split it from.
    chunkSizeWarningLimit: 900,
  },
  // The ray tracer runs in a worker that imports its own modules.
  worker: { format: 'es' },
});
