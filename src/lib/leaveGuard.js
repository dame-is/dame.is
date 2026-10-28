// Which clicks are about to take the owner somewhere else in the app.
//
// The unsaved-changes guards (the admin shell's, and the quick-edit sheet's on
// the public site) cannot wrap every link that might leave: the site's chrome —
// the wordmark, the Home button, the breadcrumb, the compass dock — is plain
// router links that must not import a line of the admin. So each guard listens
// for clicks on the whole document, in the capture phase, before any link's own
// handler, and asks this module whether the click is a navigation it should
// question. Kept free of React and of DOM globals (the link is read through
// `closest` and `getAttribute`, nothing else) so vitest can pin it in `node`.

/**
 * The same-origin address a click is about to navigate the page to, or null
 * when it is not one: a click something already handled, any button but the
 * primary, a modified click (a new tab or window leaves this one where it is),
 * a download, a link aimed at another browsing context, and a link to another
 * origin — a full page load, which `beforeunload` already asks about.
 *
 * The href is read as written and resolved against `here`, rather than through
 * the element's `href` property, because an SVG `<a>` has no string there.
 *
 * @param {MouseEvent} event
 * @param {URL|Location} here  the page's current address
 * @returns {URL|null}
 */
export function navigationTarget(event, here) {
  if (!event || event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null;
  }
  const link = event.target?.closest?.('a[href]');
  if (!link) return null;
  if (link.hasAttribute('download')) return null;
  const target = link.getAttribute('target');
  if (target && target !== '_self') return null;
  let url;
  try {
    url = new URL(link.getAttribute('href'), here.href);
  } catch {
    return null;
  }
  if (url.origin !== here.origin) return null;
  return url;
}
