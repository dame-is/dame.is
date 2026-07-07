// The dynamic Open Graph card design, shared by the /api/og serverless
// function and the local sample renderer. Framework-free: builds a satori
// element tree with a tiny hyperscript helper so it works the same in a plain
// Node script and inside @vercel/og.
//
// Design goals (from the site itself, src/styles/theme.css):
//   • paper/book aesthetic — warm paper ground, Crimson Pro serif, moss accent
//   • thin top + bottom chrome bars, exactly like the real ChromeBar
//   • square corners everywhere (--radius: 0) — nothing rounded
//   • the current sky-avatar rides in the top chrome as the brand mark, so the
//     card drifts through the day in step with the favicon + live avatar
//
// The 24 sky-avatars are passed in as a data URI by the caller (the API embeds
// the current Eastern-hour tile; see og/assets/icons.js + og/time.js).

// --- palettes (light + dark, from theme.css) -------------------------------
export const THEMES = {
  light: {
    page: '#f1ead4',
    chrome: '#e3d8ba',
    ink: '#1d2419',
    inkSoft: '#364034',
    inkMuted: '#6f6e58',
    inkFaint: '#9d9784',
    rule: '#cabf9f',
    accent: '#5e7a47',
  },
  dark: {
    page: '#1d2419',
    chrome: '#13180f',
    ink: '#ece4cb',
    inkSoft: '#d2c9ac',
    inkMuted: '#9a9377',
    inkFaint: '#6a6450',
    rule: '#3a4232',
    accent: '#a3b486',
  },
};

// satori requires every <div> with >1 child to declare an explicit display —
// default divs to flex and drop nullish children so callers can use `cond &&`.
const h = (type, props = {}, ...children) => {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  const style = { ...(props.style || {}) };
  if (type === 'div' && style.display === undefined) style.display = 'flex';
  return { type, props: { ...props, style, children: kids } };
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Big-title size steps down for longer strings so it never overflows the
// ~1040px body column.
function titleSize(text) {
  const n = (text || '').length;
  if (n <= 8) return 128;
  if (n <= 12) return 108;
  if (n <= 18) return 84;
  return 66;
}

function chromeBar(t, { left, right, top }) {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: 68, flexShrink: 0, background: t.chrome, padding: '0 48px',
      fontSize: 23, color: t.inkMuted, letterSpacing: '0.01em',
      borderTop: top ? 'none' : `1px solid ${t.rule}`,
      borderBottom: top ? `1px solid ${t.rule}` : 'none',
    },
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } }, left),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 16, color: t.inkFaint } }, right),
  );
}

function wordmark(t, avatarUri) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
    avatarUri
      ? h('img', { src: avatarUri, width: 40, height: 40, style: { border: `1px solid ${t.rule}` } })
      : null,
    h('div', { style: { fontSize: 27, fontWeight: 600, color: t.ink, letterSpacing: '-0.01em' } }, 'Dame is…'),
  );
}

/**
 * Build the OG card element.
 * @param {object} o
 * @param {string} o.label     gerund shown big (e.g. "blogging"); '' → home
 * @param {string} o.subtitle  one-line description
 * @param {string} o.avatarUri data: URI for the current sky-avatar tile
 * @param {'light'|'dark'} [o.theme]
 * @param {string} [o.tagline] bottom-left tagline
 */
export function ogElement({ label = '', subtitle = '', avatarUri = null, theme = 'light', tagline = 'An atmospheric website built atop the AT Protocol' }) {
  const t = THEMES[theme] || THEMES.light;
  const bigTitle = label ? cap(label) : 'Dame is…';
  const showEyebrow = Boolean(label);

  const body = h('div', {
    style: {
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      flex: 1, width: '100%', padding: '0 80px',
    },
  },
    showEyebrow
      ? h('div', { style: { fontSize: 32, fontStyle: 'italic', color: t.accent, marginBottom: 6 } }, 'Dame is…')
      : null,
    h('div', {
      style: {
        fontSize: titleSize(bigTitle), fontWeight: 700, color: t.ink,
        lineHeight: 1.0, letterSpacing: '-0.02em',
      },
    }, bigTitle),
    h('div', { style: { width: 132, height: 4, background: t.accent, margin: '30px 0' } }),
    subtitle
      ? h('div', { style: { fontSize: 34, color: t.inkSoft, maxWidth: 900, lineHeight: 1.32 } }, subtitle)
      : null,
  );

  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
      background: t.page, fontFamily: 'Crimson Pro',
    },
  },
    chromeBar(t, { top: true, left: wordmark(t, avatarUri), right: 'dame.is' }),
    body,
    chromeBar(t, { top: false, left: tagline, right: label || 'dame.is' }),
  );
}
