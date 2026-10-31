import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useLinkPreviews } from '../hooks/useLinkPreviews.js';
import { monthLabel, previewCounts, previewLabel } from '../lib/linkPreviews.js';
import { avatarThumb } from '../lib/avatarThumb.js';
import { formatDateShort } from '../lib/time.js';
import './LinkPreview.css';

/**
 * Hover previews for the links in a document, and the site's icon after each.
 *
 * LeafletDocument wraps its blocks in a LinkPreviewProvider; the rich-text
 * renderer (lib/leafletRichText.jsx) draws each link as a PreviewLink with a
 * LinkIcon at its end. Outside a provider both are what they were before: a
 * plain link with its host in the tooltip, and no icon.
 *
 * The card opens a quarter second after a pointer settles on a link, or at
 * once when a link takes keyboard focus; it stays while the pointer moves
 * into it, and closes on leaving, on Esc, or on a press anywhere else. A
 * pointer crossing from one link to the next skips the wait, since a reader
 * already reading cards wants the next one now. Touch opens nothing: a tap
 * follows the link, as it always did.
 */
const LinkPreviewContext = createContext(null);

const OPEN_DELAY_MS = 260;
const CLOSE_DELAY_MS = 180;
// How soon after one card closes the next opens without the wait.
const WARM_MS = 350;
// Room the chrome takes at the top and bottom of the window, which a card
// keeps clear of when it can.
const CHROME_TOP = 64;
const CHROME_BOTTOM = 72;
const EDGE = 16;
const GAP = 8;

/** Which of a wrapped link's line boxes the pointer is on. */
function rectIndexAt(anchor, y) {
  const rects = anchor.getClientRects();
  for (let i = 0; i < rects.length; i += 1) {
    if (y >= rects[i].top - 2 && y <= rects[i].bottom + 2) return i;
  }
  return 0;
}

/** Start the card's pictures loading while the pointer is still deciding. */
function preload(preview) {
  for (const src of [preview?.image, preview?.thumb, preview?.banner, preview?.avatar && avatarThumb(preview.avatar)]) {
    if (src) {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }
  }
}

export function LinkPreviewProvider({ atUri, cid, links, children }) {
  const data = useLinkPreviews({ atUri, cid, links });
  const [open, setOpen] = useState(null); // { anchor, url, rectIndex }
  const cardId = useId();
  const openRef = useRef(null);
  const dataRef = useRef(data);
  const timers = useRef({ open: 0, close: 0 });
  const lastClosed = useRef(0);
  openRef.current = open;
  dataRef.current = data;

  // Stable for the provider's life, so a hover never re-renders the links.
  const api = useMemo(() => {
    const clear = () => {
      clearTimeout(timers.current.open);
      clearTimeout(timers.current.close);
    };
    const show = (anchor, url, rectIndex) => {
      clear();
      if (!dataRef.current.previews[url]) return;
      setOpen((prev) =>
        prev && prev.anchor === anchor && prev.url === url ? prev : { anchor, url, rectIndex },
      );
    };
    const hide = () => {
      clear();
      if (openRef.current) lastClosed.current = Date.now();
      setOpen(null);
    };
    const closeSoon = () => {
      clear();
      timers.current.close = setTimeout(hide, CLOSE_DELAY_MS);
    };
    return {
      enter(anchor, url, event) {
        if (event.pointerType === 'touch') return;
        const preview = dataRef.current.previews[url];
        if (!preview) return;
        clear();
        preload(preview);
        const rectIndex = rectIndexAt(anchor, event.clientY);
        const warm = openRef.current || Date.now() - lastClosed.current < WARM_MS;
        if (warm) show(anchor, url, rectIndex);
        else timers.current.open = setTimeout(() => show(anchor, url, rectIndex), OPEN_DELAY_MS);
      },
      leave(event) {
        if (event.pointerType !== 'touch') closeSoon();
      },
      focus(anchor, url) {
        // A click focuses a link too; only the keyboard's focus opens a card.
        if (anchor.matches(':focus-visible')) show(anchor, url, 0);
      },
      blur: closeSoon,
      keep: clear,
      release: closeSoon,
      hide,
    };
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      clearTimeout(pending.open);
      clearTimeout(pending.close);
    };
  }, []);

  const value = useMemo(() => ({ data, api, cardId }), [data, api, cardId]);
  const preview = open ? data.previews[open.url] : null;
  return (
    <LinkPreviewContext.Provider value={value}>
      {children}
      {preview && (
        <PreviewPopover
          id={cardId}
          open={open}
          preview={preview}
          icon={preview.icon ? data.icons[preview.icon] : null}
          api={api}
        />
      )}
    </LinkPreviewContext.Provider>
  );
}

/**
 * A link that can show its preview. `url` is the link as the document wrote
 * it, which is what previews are keyed by; `to` draws it as a route on this
 * site instead of a new tab (the newsletter link). The host stays the
 * tooltip until a card has something better to say.
 */
export function PreviewLink({ url, href, to, className, title, children }) {
  const ctx = useContext(LinkPreviewContext);
  const hasPreview = Boolean(ctx?.data.previews[url]);
  const handlers = ctx
    ? {
        onPointerEnter: (e) => ctx.api.enter(e.currentTarget, url, e),
        onPointerLeave: (e) => ctx.api.leave(e),
        onFocus: (e) => ctx.api.focus(e.currentTarget, url),
        onBlur: ctx.api.blur,
      }
    : {};
  const shared = { className, title: hasPreview ? undefined : title, ...handlers };
  if (to) {
    return (
      <Link to={to} {...shared}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" {...shared}>
      {children}
    </a>
  );
}

/**
 * A link's last word, held together with the icon after it (below) so the
 * icon never starts a line alone. Outside a document that looks its links up,
 * just the word.
 */
export function LinkEnd({ url, children }) {
  const ctx = useContext(LinkPreviewContext);
  if (!ctx || ctx.data.status === 'idle' || !/^https?:\/\//i.test(url || '')) return children;
  return (
    <span className="post-rich-link-end">
      {children}
      <LinkIcon url={url} />
    </span>
  );
}

/**
 * The linked site's icon, drawn after the link's last word. While the
 * previews are still loading it holds the icon's room, so the paragraph
 * doesn't reflow when they land.
 */
export function LinkIcon({ url }) {
  const ctx = useContext(LinkPreviewContext);
  const [failed, setFailed] = useState(false);
  if (!ctx || !/^https?:\/\//i.test(url || '')) return null;
  const { status, previews, icons } = ctx.data;
  const key = previews[url]?.icon;
  const src = key ? icons[key] : null;
  if (src && !failed) {
    // An icon that doesn't load gives its room back rather than leaving a gap.
    return (
      <img
        className="post-rich-link-icon"
        src={src}
        alt=""
        width="16"
        height="16"
        decoding="async"
        draggable="false"
        onError={() => setFailed(true)}
      />
    );
  }
  if (status === 'loading') return <span className="post-rich-link-icon is-pending" aria-hidden="true" />;
  return null;
}

/* ------------------------------------------------------------------ */
/* The card, floating by its link                                       */
/* ------------------------------------------------------------------ */

function PreviewPopover({ id, open, preview, icon, api }) {
  const ref = useRef(null);
  const { anchor } = open;

  // Placed before paint: under the line the pointer is on, or above it when
  // there's no room below, and kept inside the window.
  const place = () => {
    const card = ref.current;
    if (!card || !anchor.isConnected) return;
    const rects = anchor.getClientRects();
    const r = rects[Math.min(open.rectIndex, rects.length - 1)] || anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh) {
      api.hide();
      return;
    }
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const left = Math.max(EDGE, Math.min(r.left, vw - w - EDGE));
    let top = r.bottom + GAP;
    let above = false;
    if (top + h > vh - CHROME_BOTTOM && r.top - GAP - h >= CHROME_TOP) {
      top = r.top - GAP - h;
      above = true;
    }
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
    card.dataset.side = above ? 'above' : 'below';
  };

  useLayoutEffect(place);

  useEffect(() => {
    anchor.classList.add('is-previewing');
    anchor.setAttribute('aria-describedby', id);
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') api.hide();
    };
    const onPress = (e) => {
      if (!ref.current?.contains(e.target) && !anchor.contains(e.target)) api.hide();
    };
    window.addEventListener('scroll', onMove, { passive: true, capture: true });
    window.addEventListener('resize', onMove);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      cancelAnimationFrame(frame);
      anchor.classList.remove('is-previewing');
      anchor.removeAttribute('aria-describedby');
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress, true);
    };
    // `place` reads the latest open/anchor through closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, id, api]);

  // The card is the link's description, not a second control: a click on it
  // follows the link it describes, the way its own link would.
  const follow = () => {
    api.hide();
    anchor.click();
  };

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className={`link-preview is-${preview.kind}`}
      onPointerEnter={api.keep}
      onPointerLeave={(e) => e.pointerType !== 'touch' && api.release()}
      onClick={follow}
    >
      {/* Keyed by link, so moving to the next one replays the entrance. */}
      <PreviewCard key={open.url} preview={preview} icon={icon} />
    </div>,
    document.body,
  );
}

/** A picture that removes itself if it fails, rather than showing a broken one. */
function PreviewImage({ src, className }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return <img className={className} src={src} alt="" decoding="async" onError={() => setFailed(true)} />;
}

function Author({ preview }) {
  const p = preview;
  return (
    <div className="link-preview-author">
      {p.avatar ? (
        <PreviewImage className="link-preview-avatar" src={avatarThumb(p.avatar)} />
      ) : (
        <span className="link-preview-avatar is-initial" aria-hidden="true">
          {(p.name || p.handle || '?').charAt(0).toUpperCase()}
        </span>
      )}
      <span className="link-preview-who">
        <span className="link-preview-name">{p.name}</span>
        {p.handle && <span className="link-preview-handle">@{p.handle}</span>}
      </span>
      {p.when && <span className="link-preview-when">{formatDateShort(p.when)}</span>}
    </div>
  );
}

function dateOf(when) {
  if (!when) return '';
  return monthLabel(when) || formatDateShort(when);
}

function PreviewBody({ preview }) {
  const p = preview;
  const counts = previewCounts(p);
  switch (p.kind) {
    case 'post':
    case 'x-post':
      return (
        <div className="link-preview-body">
          <Author preview={p} />
          {p.text && <p className="link-preview-text">{p.text}</p>}
          <PreviewImage className="link-preview-post-image" src={p.image} />
          {p.ext && (
            <div className="link-preview-ext">
              <PreviewImage className="link-preview-ext-thumb" src={p.ext.thumb} />
              <span className="link-preview-ext-body">
                {p.ext.title && <span className="link-preview-ext-title">{p.ext.title}</span>}
                <span className="link-preview-ext-host">{p.ext.host}</span>
              </span>
            </div>
          )}
          {counts.length > 0 && <div className="link-preview-meta">{counts.join(' · ')}</div>}
        </div>
      );
    case 'profile':
      return (
        <>
          <PreviewImage className="link-preview-banner" src={p.banner} />
          <div className="link-preview-body">
            {p.avatar && <PreviewImage className="link-preview-avatar is-large" src={avatarThumb(p.avatar)} />}
            <span className="link-preview-who">
              <span className="link-preview-name">{p.name}</span>
              <span className="link-preview-handle">@{p.handle}</span>
            </span>
            {p.bio && <p className="link-preview-text is-bio">{p.bio}</p>}
            {counts.length > 0 && <div className="link-preview-meta">{counts.join(' · ')}</div>}
          </div>
        </>
      );
    case 'wikipedia':
      return (
        <div className="link-preview-body">
          {p.section && <div className="link-preview-section">§ {p.section}</div>}
          <div className="link-preview-wiki">
            <span className="link-preview-wiki-head">
              <span className="link-preview-title">{p.title}</span>
              {p.desc && <span className="link-preview-gloss">{p.desc}</span>}
            </span>
            <PreviewImage className="link-preview-thumb" src={p.thumb} />
          </div>
          {p.extract && <p className="link-preview-desc is-extract">{p.extract}</p>}
        </div>
      );
    default: {
      const meta = [p.kind === 'website' ? '' : p.site, p.author, dateOf(p.when)].filter(Boolean);
      return (
        <>
          <PreviewImage className="link-preview-image" src={p.image} />
          <div className="link-preview-body">
            {p.title && <span className="link-preview-title">{p.title}</span>}
            {meta.length > 0 && <div className="link-preview-meta">{meta.join(' · ')}</div>}
            {p.desc && <p className="link-preview-desc">{p.desc}</p>}
          </div>
        </>
      );
    }
  }
}

function PreviewCard({ preview, icon }) {
  const p = preview;
  return (
    <div className="link-preview-card">
      <div className="link-preview-head">
        {icon && <img className="link-preview-icon" src={icon} alt="" width="14" height="14" />}
        <span className="link-preview-host">{p.host}</span>
        <span className="link-preview-kind eyebrow">{previewLabel(p)}</span>
      </div>
      <PreviewBody preview={p} />
      <div className="link-preview-foot">
        <span className="link-preview-path">
          {p.path}
          {p.land && (
            <>
              {' → '}
              <b>{p.land}</b>
            </>
          )}
        </span>
        <span className="link-preview-go">{p.local ? 'Opens here' : 'Opens in a new tab ↗'}</span>
      </div>
    </div>
  );
}
