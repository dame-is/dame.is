// The standalone build: `npm run dev` / `npm run build` from this folder
// serves or bundles the workbench by itself, from index.html. The site this
// lives in doesn't use this file; it bundles src/index.js with its own
// config.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5181 },
  preview: { port: 5181 },
  build: { outDir: 'dist' },
});
