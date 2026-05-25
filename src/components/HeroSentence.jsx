import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

/**
 * The home-page hero is one combinatorial sentence:
 *
 *   dame is [a — role with article] [who — relative clause]
 *
 * Each part rotates independently, every few seconds, at organic
 * intervals (random 4–8 s) so you almost never see the same pair
 * twice in a row. "dame is" itself stays put as the muted lead.
 *
 * Pools are intentionally short and editable in-file — adding a new
 * role or clause is a one-line append to the relevant const.
 */
const VARIANTS_A = [
  'a design engineer',
  'a creative technologist',
  'a lepidopterist',
  'an artist',
];

const VARIANTS_B = [
  'who makes social software with open protocols',
  'who sometimes stays up late mothing',
];

const EASE = [0.22, 0.61, 0.36, 1];

// Motion variants for the word-by-word stagger inside each rotator.
// The container itself has no visual animation — it just orchestrates
// timing for its word children via `staggerChildren`. Children inherit
// the variant name set on the parent (hidden / visible / exit) so the
// same machinery drives both entry and exit.
const phraseVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
  exit: { transition: { staggerChildren: 0.04 } },
};

const wordVariants = {
  hidden: { opacity: 0, y: -18, transition: { duration: 0.4, ease: EASE } },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
  exit: { opacity: 0, y: 18, transition: { duration: 0.3, ease: EASE } },
};

export default function HeroSentence({ shuffleRef = null } = {}) {
  const reduce = useReducedMotion();
  // Random starting pair so returning visitors don't always see the
  // same opener. Under reduced motion both pin to 0 for a predictable,
  // non-surprising default.
  const [indexA, setIndexA] = useState(() =>
    reduce ? 0 : Math.floor(Math.random() * VARIANTS_A.length),
  );
  const [indexB, setIndexB] = useState(() =>
    reduce ? 0 : Math.floor(Math.random() * VARIANTS_B.length),
  );

  // Imperative shuffle handle the parent (Home) wires to a button so
  // users can advance the sentence manually instead of waiting for the
  // next timed swap. Always picks a fresh A and B both — picking the
  // same pair would feel like a broken button.
  useEffect(() => {
    if (!shuffleRef) return undefined;
    shuffleRef.current = () => {
      setIndexA((i) => pickDifferent(i, VARIANTS_A.length));
      setIndexB((i) => pickDifferent(i, VARIANTS_B.length));
    };
    return () => {
      if (shuffleRef.current) shuffleRef.current = null;
    };
  }, [shuffleRef]);
  const [paused, setPaused] = useState(false);
  const [minHeight, setMinHeight] = useState(null);
  const wrapRef = useRef(null);
  const measureRef = useRef(null);

  // Part-A timer: schedule the next swap whenever index, pause, or
  // reduced-motion state changes. Random interval per round so two
  // adjacent swaps never feel metronomic.
  useEffect(() => {
    if (reduce || paused) return;
    const ms = 4000 + Math.random() * 4000;
    const id = setTimeout(
      () => setIndexA((i) => (i + 1) % VARIANTS_A.length),
      ms,
    );
    return () => clearTimeout(id);
  }, [indexA, paused, reduce]);

  // Part-B timer: same logic, but a small phase offset (4500 base
  // instead of 4000) so A and B drift independently rather than
  // locking into a shared rhythm.
  useEffect(() => {
    if (reduce || paused) return;
    const ms = 4500 + Math.random() * 4000;
    const id = setTimeout(
      () => setIndexB((i) => (i + 1) % VARIANTS_B.length),
      ms,
    );
    return () => clearTimeout(id);
  }, [indexB, paused, reduce]);

  // Pause when the tab is hidden — otherwise the timer fires
  // unattended and the user comes back to an arbitrary mid-cycle pair.
  useEffect(() => {
    function onVisibility() {
      if (document.hidden) setPaused(true);
      else setPaused(false);
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Reserve vertical space equal to the tallest A×B combination so the
  // feed below the hero doesn't jump as variants cycle. Wrapping
  // depends on both parts combined, so per-part measurement isn't
  // enough — we measure every combination in the hidden layer.
  useEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;

    function recompute() {
      let max = 0;
      for (const child of measure.children) {
        const h = child.getBoundingClientRect().height;
        if (h > max) max = h;
      }
      if (max > 0) setMinHeight(max);
    }

    // The serif font loads asynchronously; measuring before fonts
    // settle yields the (shorter) fallback's height and forces a
    // shift on first cycle. Gate the first measure behind fonts.ready.
    const fontsReady = document.fonts?.ready;
    if (fontsReady && typeof fontsReady.then === 'function') {
      fontsReady.then(recompute);
    } else {
      recompute();
    }

    // Re-measure on container resize (width changes alter wrapping,
    // and therefore which combination is tallest).
    const ro = new ResizeObserver(recompute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  return (
    <span
      ref={wrapRef}
      className="hero-sentence"
      style={minHeight ? { minHeight: `${minHeight}px` } : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <span className="hero-sentence-lead">dame is</span>{' '}
      <Rotator index={indexA} pool={VARIANTS_A} reduce={reduce} className="hero-rotator-a" />{' '}
      <Rotator index={indexB} pool={VARIANTS_B} reduce={reduce} className="hero-rotator-b" />

      {/* Each measure entry mirrors the live nested structure (lead +
          two inline-block rotators) so wrapping at the rotator
          boundaries matches the live render. A flat text equivalent
          would let the browser break mid-phrase and report a shorter
          height than the live layout — which then shows up as a feed
          jump on narrow viewports. */}
      <span
        aria-hidden="true"
        className="hero-sentence-measure"
        ref={measureRef}
      >
        {VARIANTS_A.flatMap((a) =>
          VARIANTS_B.map((b) => (
            <span key={`${a}|${b}`}>
              <span className="hero-sentence-lead">dame is</span>{' '}
              <span className="hero-rotator hero-rotator-a">
                <span className="hero-rotator-phrase">{a}</span>
              </span>{' '}
              <span className="hero-rotator hero-rotator-b">
                <span className="hero-rotator-phrase">{b}</span>
              </span>
            </span>
          )),
        )}
      </span>
    </span>
  );
}

function pickDifferent(current, length) {
  if (length <= 1) return 0;
  let next;
  do {
    next = Math.floor(Math.random() * length);
  } while (next === current);
  return next;
}

function Rotator({ index, pool, reduce, className = '' }) {
  // Split the active phrase into words once per index change. Real
  // space text nodes between word spans preserve the wrap-anywhere
  // behavior the measure layer already counts on.
  const words = useMemo(() => pool[index].split(' '), [pool, index]);

  return (
    <span className={`hero-rotator ${className}`}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={index}
          className="hero-rotator-phrase"
          variants={reduce ? undefined : phraseVariants}
          initial={reduce ? false : 'hidden'}
          animate={reduce ? undefined : 'visible'}
          exit={reduce ? { opacity: 0 } : 'exit'}
        >
          {words.map((word, i) => (
            <Fragment key={i}>
              <motion.span
                className="hero-rotator-word"
                variants={reduce ? undefined : wordVariants}
              >
                {word}
              </motion.span>
              {i < words.length - 1 && ' '}
            </Fragment>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
