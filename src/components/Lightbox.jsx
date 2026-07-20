import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import Modal from './Modal.jsx';
import './Lightbox.css';

/**
 * Image lightbox. Built on top of <Modal />, so it inherits the scrim
 * click + Escape dismiss and the symmetric enter/exit animation.
 *
 * Pass either a single image as the first/only entry, or an array — when
 * there's more than one, prev/next chevrons and arrow-key navigation
 * appear. The image itself doesn't dismiss on click so the reader can
 * actually rest their eyes on it; close happens via scrim, Escape, or
 * the explicit close button.
 *
 * Each entry is `{ src, alt }` plus optional extras:
 *   - `width` / `height`: intrinsic dimensions. Passed through as <img>
 *     attributes so the browser reserves the final display box before the
 *     file arrives — without them the image pops from a dot to full size.
 *   - `thumb`: a small already-cached variant painted behind the full image
 *     while it loads (grid thumbnails are ideal).
 *   - `sourceUrl` / `searchUrl`: render a caption row under the image with
 *     a link to the original source and/or a reverse-image search.
 */
export default function Lightbox({ open, onClose, images, index = 0 }) {
  const list = Array.isArray(images) ? images.filter((im) => im?.src) : [];
  const count = list.length;
  const [active, setActive] = useState(index);
  const [loadedSrcs, setLoadedSrcs] = useState(() => new Set());
  const reduce = useReducedMotion();
  // The control bar is portalled to <body> (a scale transform on the Modal
  // panel would trap the fixed bar inside the panel's box), so it lives outside
  // the dialog's DOM subtree. Handing this ref to the Modal's focus trap keeps
  // the controls inside the lightbox's Tab cycle even from there.
  const controlsRef = useRef(null);
  const markLoaded = useCallback((src) => {
    setLoadedSrcs((prev) => (prev.has(src) ? prev : new Set(prev).add(src)));
  }, []);

  // Sync external index changes (e.g. opening to a different starting
  // image without unmounting). Also re-clamp when the source list shrinks.
  useEffect(() => {
    if (!open) return;
    setActive(Math.min(Math.max(0, index), Math.max(0, count - 1)));
  }, [open, index, count]);

  const prev = useCallback(() => {
    if (count < 2) return;
    setActive((i) => (i - 1 + count) % count);
  }, [count]);
  const next = useCallback(() => {
    if (count < 2) return;
    setActive((i) => (i + 1) % count);
  }, [count]);

  useEffect(() => {
    if (!open || count < 2) return;
    function onKey(e) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, count, prev, next]);

  if (count === 0) return null;
  const current = list[active] || list[0];
  const alt = current.alt || '';
  // With intrinsic dimensions we can size the frame before the file
  // arrives: natural width, clamped by the panel width and by the
  // viewport-height budget (transferred through the aspect ratio).
  // Without them the image sizes itself on load, as before.
  const ratio = current.width > 0 && current.height > 0 ? current.width / current.height : null;
  const frameStyle = ratio
    ? {
        width: `min(${current.width}px, 100%, calc(var(--lightbox-maxh) * ${ratio.toFixed(5)}))`,
      }
    : undefined;
  // The sizer holds the frame's box open. When the intrinsic ratio is known it
  // reserves the exact box immediately (before any pixels arrive); otherwise it
  // sizes to the thumb's own aspect once that small, already-cached image
  // paints — either way the full-res photo fades in over a sized, visible
  // frame instead of a collapsed box (the old "flash on open").
  const sizerStyle = ratio
    ? { width: '100%', aspectRatio: `${current.width} / ${current.height}` }
    : undefined;
  const label = alt
    ? `Image: ${alt}`
    : count > 1
      ? `Image ${active + 1} of ${count}`
      : 'Image';

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      label={label}
      motionPreset="scale"
      scrim="dark"
      className="lightbox-panel"
      scrimLabel="Close image"
      focusTrapRef={controlsRef}
    >
      <figure className="lightbox-figure">
        <div className="lightbox-frame" style={frameStyle}>
          {/* In-flow sizer: the low-res thumb (already cached from the grid the
              lightbox was opened from) gives the frame real dimensions the
              instant it opens, so the full-resolution photo — which usually has
              to download — fades in over a visible picture rather than a blank,
              collapsed box. Decorative; the real alt lives on the full image
              below. Falls back to the full src when a caller passes no thumb. */}
          <img
            src={current.thumb || current.src}
            alt=""
            aria-hidden="true"
            className="lightbox-sizer"
            decoding="async"
            style={sizerStyle}
          />
          <img
            key={current.src}
            src={current.src}
            alt={alt}
            className={`lightbox-image${loadedSrcs.has(current.src) ? ' is-loaded' : ''}`}
            decoding="async"
            onLoad={() => markLoaded(current.src)}
            ref={(el) => {
              // onLoad can be missed for cache hits that complete before
              // React attaches the handler; the ref callback catches those.
              if (el?.complete && el.naturalWidth) markLoaded(current.src);
            }}
          />
        </div>
      </figure>
    </Modal>
      {/* Control bar — pinned to the viewport bottom at the exact
          position + height of the bottom chrome nav, on the same raised
          surface, so the nav appears to morph into the photo controls
          when the lightbox opens (and back on close). Portalled to
          <body> because the Modal panel carries a scale transform, which
          would otherwise trap this fixed bar inside the panel's box. It
          sits above the Modal scrim (z 60) so it reads as the persistent
          chrome the rest of the page dims behind. */}
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              key="lightbox-controls"
              ref={controlsRef}
              className="lightbox-controls"
              role="group"
              aria-label="Image controls"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
              transition={{ duration: reduce ? 0 : 0.26, ease: [0.32, 0.72, 0, 1] }}
            >
              <div className="lightbox-controls-row">
                <div className="lightbox-controls-cluster lightbox-controls-links">
                  {current.sourceUrl && (
                    <a
                      href={current.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="lightbox-controls-link"
                    >
                      source
                    </a>
                  )}
                  {current.searchUrl && (
                    <a
                      href={current.searchUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="lightbox-controls-link"
                    >
                      reverse image search
                    </a>
                  )}
                </div>

                <div className="lightbox-controls-spacer" aria-hidden="true" />

                {count > 1 && (
                  <div className="lightbox-controls-cluster lightbox-controls-nav">
                    <button
                      type="button"
                      className="lightbox-ctl"
                      onClick={prev}
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="lightbox-ctl-glyph" aria-hidden="true" />
                    </button>
                    <span className="lightbox-controls-count" aria-hidden="true">
                      {active + 1} / {count}
                    </span>
                    <button
                      type="button"
                      className="lightbox-ctl"
                      onClick={next}
                      aria-label="Next image"
                    >
                      <ChevronRight className="lightbox-ctl-glyph" aria-hidden="true" />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="lightbox-ctl lightbox-ctl-close"
                  onClick={onClose}
                  aria-label="Close image"
                >
                  <X className="lightbox-ctl-glyph" aria-hidden="true" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
