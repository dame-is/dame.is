// A preview of the label voice the design audit proposes (c-11, TYP-05):
// real capitals at the 11px floor, weight 500, tracked 0.1em, in place of the
// browser's synthesised small caps. The switch itself is held until Dame has
// seen it on real pages (typography.css says why), and about a hundred rules
// across the stylesheets set `all-small-caps` on their own, so a preview that
// only restyled `.small-caps` would put two label voices on one screen.
//
// So the preview finds those rules where they are: it reads every stylesheet
// on the page, collects the selectors whose declarations ask for all small
// caps, and writes one stylesheet that sets the proposed voice on exactly
// those, scoped to <html data-label-preview="caps">. Route chunks bring their
// own CSS as they load, so it re-reads when the <head> changes. Owner-only:
// it's switched from /colophon and remembered in this browser alone.

import { readStorage } from './storageGuard.js';

const STORAGE_KEY = 'dame.labelPreview';
const STYLE_ID = 'label-caps-preview';
const ATTR = 'data-label-preview';

const PROPOSED = [
  'font-variant: normal',
  'font-variant-caps: normal',
  'text-transform: uppercase',
  'font-size: var(--text-2xs, 0.6875rem)',
  'font-weight: 500',
  'letter-spacing: 0.1em',
].join('; ');

/** The selectors in `rules` that set all small caps, descending into @media,
 *  @supports and @layer blocks. Pseudo-element rules (an essay's first line)
 *  are left alone: they aren't labels. */
export function smallCapsSelectors(rules, out = new Set()) {
  for (const rule of rules || []) {
    if (rule.cssRules && !rule.selectorText) {
      smallCapsSelectors(rule.cssRules, out);
      continue;
    }
    const style = rule.style;
    if (!style || !rule.selectorText) continue;
    const variant = `${style.getPropertyValue('font-variant')} ${style.getPropertyValue('font-variant-caps')}`;
    if (!variant.includes('all-small-caps')) continue;
    for (const sel of splitSelectors(rule.selectorText)) {
      if (!sel.includes('::')) out.add(sel);
    }
  }
  return out;
}

/** Split a selector list on its top-level commas (not those inside :is()). */
function splitSelectors(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/** One selector, scoped under the preview attribute. A selector that already
 *  starts at the root takes the attribute on its own :root or html. */
export function scopeSelector(sel) {
  const scope = `[${ATTR}='caps']`;
  if (/^:root\b/.test(sel)) return sel.replace(/^:root/, `:root${scope}`);
  if (/^html\b/.test(sel)) return sel.replace(/^html/, `html${scope}`);
  return `:root${scope} ${sel}`;
}

/** The preview stylesheet's text for a set of selectors. Units keep their
 *  case, as they do under the small caps ("65 dB", not "65 DB"). */
export function previewCss(selectors) {
  const list = [...selectors].map(scopeSelector);
  if (!list.length) return '';
  const scope = `:root[${ATTR}='caps']`;
  return `${list.join(',\n')} { ${PROPOSED}; }\n${scope} .unit { text-transform: none; }\n`;
}

function readAllSheets() {
  const found = new Set();
  for (const sheet of document.styleSheets) {
    if (sheet.ownerNode?.id === STYLE_ID) continue;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet; none of ours are
    }
    smallCapsSelectors(rules, found);
  }
  return found;
}

let observer = null;
let pending = 0;

function write() {
  pending = 0;
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  const css = previewCss(readAllSheets());
  if (el.textContent !== css) el.textContent = css;
}

function start() {
  document.documentElement.setAttribute(ATTR, 'caps');
  write();
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((records) => {
    // Our own stylesheet's writes are mutations too; only another sheet
    // arriving is a reason to read again.
    const other = records.some((r) =>
      [...r.addedNodes].some((n) => n.id !== STYLE_ID && /^(STYLE|LINK)$/.test(n.nodeName)),
    );
    if (other && !pending) pending = requestAnimationFrame(write);
  });
  observer.observe(document.head, { childList: true });
}

function stop() {
  document.documentElement.removeAttribute(ATTR);
  observer?.disconnect();
  observer = null;
  document.getElementById(STYLE_ID)?.remove();
}

export function labelPreviewOn() {
  return readStorage(STORAGE_KEY) === 'caps';
}

/** Turn the preview on or off, for this browser, from now on. */
export function setLabelPreview(on) {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, 'caps');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: the preview lasts for this page only */
  }
  if (on) start();
  else stop();
}

/** At boot: pick the preview back up if it was left on in this browser. */
export function restoreLabelPreview() {
  if (labelPreviewOn()) start();
}
