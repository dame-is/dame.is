import { useEffect, useRef } from 'react';

/* Elements that can receive keyboard focus. `[tabindex]` deliberately widens
   the net to anything explicitly made focusable; the isFocusable() filter then
   drops the ones with a negative tabindex (including the panel container we
   make programmatically focusable below). */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

function isVisible(el) {
  // getClientRects is empty for display:none / detached nodes and for
  // type="hidden" inputs — cheaper and more reliable than reading styles.
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function isFocusable(el) {
  if (el.tabIndex < 0) return false;
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.closest('[inert]')) return false;
  return isVisible(el);
}

/* Resolve refs / raw elements / arrays of either into a flat list of live DOM
   nodes, dropping anything not yet (or no longer) mounted. */
function resolveContainers(value) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((x) => (x && typeof x === 'object' && 'current' in x ? x.current : x))
    .filter((el) => el instanceof HTMLElement);
}

/**
 * Trap keyboard focus inside an overlay while it's open, and hand focus back to
 * wherever it came from on close — the piece our dialogs and sheets were
 * missing (BottomSheet/Modal/ActionDock/EditSheet all declared `role="dialog"`
 * — Modal even `aria-modal="true"` — while the page behind stayed fully
 * tabbable). Pairs with, but is independent of, each component's own Escape
 * handling: this hook never touches the Escape key.
 *
 * On activation it saves `document.activeElement`, then (unless focus already
 * lives inside the panel — e.g. an auto-focused field) moves focus to the panel
 * itself, making it programmatically focusable so a screen reader announces the
 * dialog's label before Tab walks into the controls. While active, Tab and
 * Shift+Tab cycle within the panel's focusable elements, wrapping at the ends
 * rather than escaping to the concealed page. On deactivation (or unmount) the
 * key handler is removed and, when `restoreFocus`, focus returns to the saved
 * element.
 *
 * `extraContainers` lets a trap span DOM that lives outside the panel subtree —
 * the image lightbox portals its control bar to <body> (a scale transform on
 * the Modal panel would otherwise trap the fixed bar inside the panel's box),
 * so those controls are threaded in here to stay keyboard-reachable as part of
 * the same trap. Accepts a ref, an element, or an array of either.
 *
 * @param {import('react').RefObject<HTMLElement>} panelRef  the overlay panel
 * @param {object} options
 * @param {boolean} options.active  trap only while the overlay is open
 * @param {boolean} [options.restoreFocus=true]  return focus to the opener on close
 * @param {*} [options.extraContainers]  additional focusable region(s): ref(s) / element(s)
 */
export function useFocusTrap(panelRef, { active, restoreFocus = true, extraContainers = [] } = {}) {
  // Read the latest extra containers at event time without re-arming the trap
  // when a caller passes a fresh array literal each render.
  const extrasRef = useRef(extraContainers);
  extrasRef.current = extraContainers;

  useEffect(() => {
    if (!active) return undefined;
    const panel = panelRef.current;
    if (!panel) return undefined;

    const regions = () => [panel, ...resolveContainers(extrasRef.current)];
    const within = (el) => !!el && regions().some((r) => r === el || r.contains(el));
    const collectFocusable = () => {
      const out = [];
      for (const region of regions()) {
        region.querySelectorAll(FOCUSABLE_SELECTOR).forEach((el) => {
          if (isFocusable(el)) out.push(el);
        });
      }
      return out;
    };

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Move focus into the panel — but never yank it away from a control that
    // already claimed focus inside it (an auto-focused input, say).
    let addedTabindex = false;
    if (!panel.contains(document.activeElement)) {
      if (!panel.hasAttribute('tabindex')) {
        panel.setAttribute('tabindex', '-1');
        addedTabindex = true;
      }
      // preventScroll: focusing the container has no reason to move the
      // viewport (Tab-cycle focus() below intentionally scrolls, to reveal a
      // control inside a long form).
      panel.focus({ preventScroll: true });
    }

    function onKeyDown(e) {
      if (e.key !== 'Tab') return;
      const activeEl = document.activeElement;
      // Only steer Tab when focus is actually inside our region — so two
      // stacked traps can't fight over focus that belongs to neither.
      if (!within(activeEl)) return;
      const focusables = collectFocusable();
      if (focusables.length === 0) {
        // Nothing tabbable inside: keep focus pinned on the container.
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        // Backward off the first element (or off the non-tabbable container)
        // wraps to the last; interior steps fall through to the browser.
        if (activeEl === first || !focusables.includes(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last) {
        // Forward off the last element wraps to the first.
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (addedTabindex) panel.removeAttribute('tabindex');
      if (restoreFocus && previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [active, restoreFocus, panelRef]);
}
