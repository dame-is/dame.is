// Flat ESLint config (ESLint 9). Intentionally light-touch: the goal is to
// enforce the react-hooks rules the codebase already annotates with
// `eslint-disable react-hooks` comments, and to surface obvious mistakes —
// not to reformat the repo (Prettier owns style) or drown it in warnings.
//
// react-hooks: we wire the plugin's two canonical rules (rules-of-hooks +
// exhaustive-deps) rather than spreading the plugin's v7 "recommended-latest"
// preset, which now bundles ~15 aggressive React-Compiler rules that would
// flood this existing codebase with errors. The canonical pair is exactly what
// the in-tree `eslint-disable react-hooks/exhaustive-deps` comments target.
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/**',
      'coverage/**',
      '.vercel/**',
      // Scriptable / iOS widget scripts run in the Scriptable app runtime with
      // its own globals (Color, Font, Keychain, …); not Node, not the browser.
      'scripts/scriptable/**',
    ],
  },

  js.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'], // new JSX transform — no `import React`

  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        // The vite `define` constants (__BUILD_ID__ etc.) are declared with an
        // inline `/* global */` comment in the one file that reads them
        // (src/lib/appVersion.js), so they aren't listed here — doing so would
        // trigger no-redeclare against that comment.
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // The react-hooks rules that actually matter here.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Prop-types aren't used in this codebase; the new transform means React
      // needn't be in scope. Turn both off rather than warn on every file.
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      // Noisy stylistic / low-signal rules downgraded so `npm run lint` stays
      // useful instead of catastrophic on the existing code.
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'off',
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
      // Control chars in regexes and non-breaking whitespace are deliberate in
      // the sanitizer / href guard / text-extraction code — flag, don't fail.
      'no-control-regex': 'warn',
      'no-irregular-whitespace': 'warn',
    },
  },

  {
    // Node-only surfaces: build scripts, serverless functions, middleware, the
    // arena-mirror sub-package and the config files themselves.
    files: [
      '**/*.mjs',
      '**/*.cjs',
      'scripts/**',
      'api/**',
      'arena-mirror/**',
      'middleware.js',
      '*.config.js',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
