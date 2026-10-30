import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { matchQuote, quoteFrom, quoteHref, QUOTE_PARAM, QUOTE_MAX_CHARS } from '../lib/quote.js';
import { selectedProse, rangeForQuote } from '../lib/quoteDom.js';
import './QuoteShare.css';

// The name the landing highlight registers under (::highlight(dame-quote) in
// QuoteShare.css).
const HIGHLIGHT = 'dame-quote';

// How long a selection has to hold still before the toolbar offers it, so a
// drag in progress or a handle being nudged doesn't make it jump about.
const SETTLE_MS = 180;

// Clearance between the selection and the toolbar. On touch it goes under the
// selection, below the drag handle, where the system's own menu doesn't sit.
const GAP = 10;
const TOUCH_GAP = 30;
const EDGE = 8;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const coarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Quoting a document (src/lib/quote.js), on the page: select a passage of the
 * prose and a small toolbar offers a link to it, whose card on Bluesky and
 * everywhere else is that passage; arrive by such a link and the passage is
 * highlighted and scrolled to.
 *
 * `docRef` is the document's root and `content` its pub.leaflet.content, the
 * record the link's quote is checked against. A selection the record doesn't
 * hold as the author's own prose (it runs into an embed, a quotation, a
 * credit) gets no toolbar, because its link would unfurl as the plain essay.
 */
export default function QuoteShare({ docRef, content }) {
  useQuoteLanding(docRef, content);
  const pick = useQuotedSelection(docRef, content);
  if (!pick || typeof document === 'undefined') return null;
  return createPortal(<QuoteToolbar pick={pick} />, document.body);
}

/** The selection as a passage of the document, or null. Holds the Range so
 *  the toolbar can follow it as the page scrolls. */
function useQuotedSelection(docRef, content) {
  const [pick, setPick] = useState(null);
  useEffect(() => {
    let timer = 0;
    // A pointer still down is a drag in progress; wait for it to land.
    let pressing = false;
    const read = () => {
      const root = docRef.current;
      const sel = window.getSelection?.();
      if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return setPick(null);
      const range = sel.getRangeAt(0);
      // One end in the essay is enough: a triple-click on its last paragraph
      // ends at the start of whatever follows it. selectedProse keeps only
      // the essay's part.
      if (!root.contains(range.startContainer) && !root.contains(range.endContainer)) {
        return setPick(null);
      }
      const found = matchQuote(content, selectedProse(root, range));
      setPick(found ? { ...found, range: range.cloneRange() } : null);
    };
    const settle = () => {
      clearTimeout(timer);
      if (!pressing) timer = setTimeout(read, SETTLE_MS);
    };
    const down = (e) => {
      if (e.target?.closest?.('.quote-share')) return;
      pressing = true;
      clearTimeout(timer);
      setPick(null);
    };
    const up = () => {
      if (!pressing) return;
      pressing = false;
      settle();
    };
    document.addEventListener('selectionchange', settle);
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', settle);
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    };
  }, [docRef, content]);
  return pick;
}

function QuoteToolbar({ pick }) {
  const barRef = useRef(null);
  const [place, setPlace] = useState(null);
  const [status, setStatus] = useState('');
  const [dismissed, setDismissed] = useState(false);

  // A new selection starts fresh: no "copied" left over from the last one.
  useEffect(() => {
    setStatus('');
    setDismissed(false);
  }, [pick]);

  // Over the selection's first line, or under its last when there's no room
  // above (or on touch, where the system's menu has the space above).
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return undefined;
    let frame = 0;
    const measure = () => {
      const rects = Array.from(pick.range.getClientRects()).filter((r) => r.width > 0);
      if (!rects.length) return setPlace(null);
      const first = rects[0];
      const last = rects[rects.length - 1];
      const { offsetWidth: w, offsetHeight: h } = bar;
      const touch = coarsePointer();
      const above = first.top - GAP - h;
      const top = !touch && above > EDGE ? above : last.bottom + (touch ? TOUCH_GAP : GAP);
      const anchor = touch || above <= EDGE ? last : first;
      const centre = anchor.left + anchor.width / 2;
      const left = Math.min(Math.max(EDGE, centre - w / 2), window.innerWidth - w - EDGE);
      setPlace({ top: Math.round(top), left: Math.round(left) });
    };
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', follow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', follow);
      window.removeEventListener('resize', follow);
    };
    // `status` too: "link copied" is wider than "copy link".
  }, [pick, status]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setDismissed(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (dismissed) return null;

  const url = `${window.location.origin}${quoteHref(window.location.pathname, pick.words)}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: document.title, text: `“${pick.display}”`, url });
    } catch {
      /* dismissed, or the share target refused: nothing to undo */
    }
  };

  return (
    <div
      ref={barRef}
      className="quote-share"
      role="toolbar"
      aria-label="Share this passage"
      style={place ? { top: place.top, left: place.left } : { visibility: 'hidden', top: 0, left: 0 }}
      // Pressing a button mustn't drop the selection it's about to share.
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="quote-share-mark" aria-hidden="true">
        “
      </span>
      {pick.tooLong ? (
        <span className="quote-share-note">
          too long to quote, {QUOTE_MAX_CHARS} characters at most
        </span>
      ) : (
        <>
          <button type="button" className="quote-share-action" onClick={copy}>
            {status === 'copied' ? 'link copied' : status === 'failed' ? 'couldn’t copy' : 'copy link'}
          </button>
          {canShare && (
            <button type="button" className="quote-share-action" onClick={share}>
              share
            </button>
          )}
          <a
            className="quote-share-action"
            href={`https://bsky.app/intent/compose?text=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            post on Bluesky
          </a>
        </>
      )}
      <span className="visually-hidden" aria-live="polite">
        {status === 'copied' ? 'Link to this passage copied' : ''}
      </span>
    </div>
  );
}

/**
 * Arriving by a quote link: find the passage, highlight it, and take the
 * reader to it. Only the record's words are looked for, so a quote the essay
 * doesn't hold highlights nothing. The document can still be drawing when this
 * first runs (an embed holds back what follows it), so it keeps looking as the
 * page fills in, for a while.
 *
 * The highlight is the CSS Custom Highlight API, which marks the text without
 * touching the DOM React owns. Where it's missing, the page still scrolls.
 */
function useQuoteLanding(docRef, content) {
  const { search } = useLocation();
  const asked = new URLSearchParams(search).get(QUOTE_PARAM) || '';
  useEffect(() => {
    const root = docRef.current;
    const words = asked && content ? quoteFrom(content, asked)?.words : null;
    if (!root || !words) return undefined;
    const highlights = typeof CSS !== 'undefined' ? CSS.highlights : null;
    let done = false;
    let observer = null;
    let timer = 0;
    const land = () => {
      if (done) return;
      const range = rangeForQuote(root, words);
      if (!range) return;
      done = true;
      observer?.disconnect();
      clearTimeout(timer);
      if (highlights && typeof Highlight === 'function') highlights.set(HIGHLIGHT, new Highlight(range));
      // Only from the top of the page: a reload that put the reader back
      // where they were reading, or a reader already scrolling, keeps its place.
      if (window.scrollY > 40) return;
      requestAnimationFrame(() => {
        const box = range.getBoundingClientRect();
        const top = window.scrollY + box.top - window.innerHeight * 0.3;
        window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
      });
    };
    land();
    if (!done) {
      observer = new MutationObserver(land);
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      timer = setTimeout(() => observer.disconnect(), 10_000);
    }
    return () => {
      done = true;
      observer?.disconnect();
      clearTimeout(timer);
      highlights?.delete(HIGHLIGHT);
    };
  }, [asked, content, docRef]);
}
