// Guards for the stylesheets (design audit SYS-09). The tokens and the
// square, hairline idiom are what make the site read as one volume, and they
// drift a value at a time: a 4px corner here, a 9.3px label there, a
// nineteenth media-query width. These rules stop the next one at review.
//
//   npm run lint:css

// Type sits on the --text-* scale (theme.css), or is relative to it: em,
// a calc() or clamp() over the tokens, a component's own custom property
// that resolves to one. Points are for print, where the sheet is the unit.
const FONT_SIZE = [
  /^var\(--/,
  /^-?[\d.]+em$/,
  /^(calc|min|max|clamp)\(/,
  /%$/,
  /^[\d.]+pt$/,
  'inherit',
  '0',
];

// Tracking is set in em, so it scales with the type it spaces.
const LETTER_SPACING = ['0', 'normal', 'inherit', /^-?[\d.]+em$/, /^var\(--/];

// Every corner is square (theme.css --radius-*, all 0). 50% is the one round
// thing the site draws: a dot, an avatar.
const RADIUS = ['0', /^var\(--radius-\d/, '50%'];

// Two breakpoints, and one fit.
//
//   phone  ≤ 700px     one column: the ledger restacks, the chrome compacts,
//                      sheets take the full width. Mirrored in JS by
//                      ChromeBar's PHONE_QUERY and useChromeBar's
//                      COMPACT_QUERY. Its other side is min-width: 701px.
//   desk   ≥ 62rem     room for a margin: essays, records and the résumé
//                      take their marginalia column, the admin stops
//                      stacking (STACK_QUERY). Its other side is
//                      max-width: 61.99rem.
//   fit    ≤ 380px     not a layout: the few rules that keep a row on one
//                      line on the 320–375px class of phone.
//
// Anything that depends on its own width rather than the window's is a
// container query, which this rule leaves alone.
const BREAKPOINTS = {
  'max-width': ['380px', '700px', '61.99rem'],
  'min-width': ['701px', '62rem'],
};

// Stylesheets whose type predates the scale: ad-hoc rems, most of them in
// the Ratioed charts and x-ray, where the audit counted thirteen sizes
// between 9.3 and 12.6px. They still answer to the corner, tracking and
// breakpoint rules. Move a file's sizes onto --text-* and take it off this
// list; nothing new goes on it.
const LEGACY_TYPE = [
  'src/admin/adminShell.css',
  'src/components/ActionDock.css',
  'src/components/AnalyticsStudio.css',
  'src/components/ChromeBar.css',
  'src/components/DebugOverlay.css',
  'src/components/EditModeBar.css',
  'src/components/PublicationsManager.css',
  'src/components/RatioedPanel.css',
  'src/components/SkyThemeStudio.css',
  'src/components/Xray.css',
  'src/components/blocks/RatioedBlock.css',
  'src/components/blocks/blocks.css',
  'src/components/moderation/moderation.css',
  'src/components/resume/resumeStudio.css',
  'src/pages/Admin.css',
  'src/pages/Blogging.css',
  'src/pages/Guestbook.css',
  'src/pages/Mothing.css',
  'src/pages/RatioedParticipants.css',
  'src/pages/RatioedPiece.css',
];

export default {
  ignoreFiles: ['dist/**', 'node_modules/**', 'docs/**'],
  rules: {
    'declaration-property-value-allowed-list': {
      'font-size': FONT_SIZE,
      'letter-spacing': LETTER_SPACING,
      'border-radius': RADIUS,
    },
    'media-feature-name-value-allowed-list': BREAKPOINTS,
  },
  overrides: [
    {
      files: LEGACY_TYPE,
      rules: {
        'declaration-property-value-allowed-list': {
          'letter-spacing': LETTER_SPACING,
          'border-radius': RADIUS,
        },
      },
    },
  ],
};
