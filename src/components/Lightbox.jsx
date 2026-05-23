import { useCallback, useEffect, useState } from 'react';
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
 */
export default function Lightbox({ open, onClose, images, index = 0 }) {
  const list = Array.isArray(images) ? images.filter((im) => im?.src) : [];
  const count = list.length;
  const [active, setActive] = useState(index);

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
  const label = alt
    ? `Image: ${alt}`
    : count > 1
      ? `Image ${active + 1} of ${count}`
      : 'Image';

  return (
    <Modal
      open={open}
      onClose={onClose}
      label={label}
      motionPreset="scale"
      scrim="dim"
      className="lightbox-panel"
      scrimLabel="Close image"
    >
      <button
        type="button"
        className="lightbox-close"
        onClick={onClose}
        aria-label="Close image"
      >
        <X size={20} aria-hidden="true" />
      </button>
      {count > 1 && (
        <>
          <button
            type="button"
            className="lightbox-nav lightbox-nav-prev"
            onClick={prev}
            aria-label="Previous image"
          >
            <ChevronLeft size={28} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lightbox-nav lightbox-nav-next"
            onClick={next}
            aria-label="Next image"
          >
            <ChevronRight size={28} aria-hidden="true" />
          </button>
        </>
      )}
      <figure className="lightbox-figure">
        <img
          key={current.src}
          src={current.src}
          alt={alt}
          className="lightbox-image"
          decoding="async"
        />
        {(alt || count > 1) && (
          <figcaption className="lightbox-caption">
            {alt && <span className="lightbox-caption-alt">{alt}</span>}
            {count > 1 && (
              <span className="lightbox-caption-count" aria-hidden="true">
                {active + 1} / {count}
              </span>
            )}
          </figcaption>
        )}
      </figure>
    </Modal>
  );
}
