import { useEffect, useState } from 'react';
import './BookOpenIntro.css';

const STORAGE_KEY = 'dame.bookopen.seen';

export default function BookOpenIntro() {
  const [phase, setPhase] = useState('initial');

  // TESTING: always show the intro on load. Restore the localStorage gate below
  // (and the matching `setItem` in `open`) when ready to make it persistent.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // try {
    //   if (localStorage.getItem(STORAGE_KEY) === '1') return;
    // } catch {}
    const t = requestAnimationFrame(() => setPhase('idle'));
    return () => cancelAnimationFrame(t);
  }, []);

  function open() {
    if (phase !== 'idle') return;
    setPhase('opening');
    // try {
    //   localStorage.setItem(STORAGE_KEY, '1');
    // } catch {}
    setTimeout(() => setPhase('done'), 900);
  }

  if (phase === 'initial' || phase === 'done') return null;

  return (
    <div className={`book-open ${phase}`} role="dialog" aria-modal="true" aria-label="Welcome">
      <button
        type="button"
        className="book-open-stage"
        onClick={open}
        aria-label="Open the site"
      >
        <div className="book-open-cover">
          <div className="book-open-half left" aria-hidden="true" />
          <div className="book-open-half right" aria-hidden="true" />
          <div className="book-open-spine" aria-hidden="true" />
          <div className="book-open-title">
            <span className="book-open-mark" aria-hidden="true">&#x2767;</span>
            <span className="book-open-name">dame.is</span>
            <span className="book-open-sub small-caps">an atmospheric website</span>
            <span className="book-open-prompt small-caps">tap to open</span>
          </div>
        </div>
      </button>
    </div>
  );
}
