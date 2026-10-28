import { lazy, memo, Suspense } from 'react';
import { ArrowLeft, ArrowUp, ChevronDown, Compass, ListFilterPlus, Microscope, X } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { usePageContent } from '../hooks/usePageContent.js';
import { useTheme } from '../hooks/useTheme.jsx';
import { skyHourLabel } from '../lib/skyTheme.js';
import './InfoSheet.css';

// The key to the two bars, at the top of the sheet: each control as it looks
// in the bar, with a line on what it does. The bar's chips are glyphs, and on
// a phone nothing else names them once the first-visit captions have gone.
// Static, unlike the about text below it, which the owner edits on the PDS.
const KEY = [
  {
    word: 'atmosphere',
    Glyph: ChevronDown,
    gloss:
      'What Dame is doing and listening to, and the readings from their phone. It sits at the top of every page, and the chevron brings it back while you read.',
  },
  {
    word: 'sky',
    sky: true,
    gloss:
      'The colours follow the sky in Dame’s hourly avatar, on Eastern time. Pick an hour to see the site in another.',
  },
  {
    word: 'filter',
    Glyph: ListFilterPlus,
    gloss: 'On a feed, choose which kinds of records it shows.',
  },
  {
    word: 'inspect',
    Glyph: Microscope,
    gloss: 'Turn the page inside out: each part shows the AT Protocol record behind it.',
  },
  {
    word: 'back',
    Glyph: ArrowLeft,
    gloss: 'Back to the page you were on.',
  },
  {
    word: 'top',
    Glyph: ArrowUp,
    gloss: 'Back to the top. On a feed it names the day you’re reading.',
  },
  {
    word: 'menu',
    Glyph: Compass,
    gloss: 'Every page Dame is: available, welcoming, creating, blogging…',
  },
];

function BarKey() {
  const { skyHour } = useTheme();
  return (
    <section className="info-key" aria-labelledby="info-key-title">
      <h3 className="info-key-title" id="info-key-title">
        A key to the two bars
      </h3>
      <dl className="info-key-list">
        {KEY.map(({ word, Glyph, sky, gloss }) => (
          <div className="info-key-row" key={word}>
            <dt className="info-key-term">
              <span className={`info-key-chip${sky ? ' is-text' : ''}`} aria-hidden="true">
                {sky ? `${skyHourLabel(skyHour)} et` : <Glyph strokeWidth={1.75} />}
              </span>
              <span className="info-key-word">{word}</span>
            </dt>
            <dd className="info-key-gloss">{gloss}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// The body is markdown, and marked is bigger than everything else the chrome
// carries put together, so it loads when the sheet first opens (BottomSheet
// mounts its children then, not before) instead of with the entry. The sheet
// sits outside the routes' error boundary, so a failed load must not throw:
// it shows the text as written instead.
const PageMarkdown = lazy(() =>
  import('./PageMarkdown.jsx').catch(() => ({ default: PlainBody })),
);

function PlainBody({ body, className }) {
  return (
    <div className={className} style={{ whiteSpace: 'pre-line' }}>
      {body}
    </div>
  );
}

const LOADING = (
  <div className="info-sheet-body">
    <p>Loading…</p>
  </div>
);

/**
 * "What is this site?" primer, expanded up out of the bottom chrome bar's
 * info button (see useChromePanel). Plain prose — atmosphere, atproto, PDS,
 * what you can actually do here — written for first-time visitors who don't
 * yet have the vocabulary for any of it.
 *
 * Content is backed by the `about` page (see pageRegistry): it renders the
 * hardcoded local default until it's migrated to an `is.dame.page/about`
 * record from the admin panel, after which it's editable on the PDS.
 */
function InfoSheet() {
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'info';
  const { title, body, bodyFormat } = usePageContent('about');
  const heading = title || 'About this site';

  return (
    <BottomSheet open={open} onClose={closePanel} label={heading} id="chrome-info-sheet" size="fill" className="info-sheet-panel">
      <div className="info-sheet-header">
        <span className="small-caps">{heading}</span>
        <button
          type="button"
          className="info-sheet-close"
          onClick={closePanel}
          aria-label="Close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <BarKey />

      {body ? (
        <Suspense fallback={LOADING}>
          <PageMarkdown
            className="info-sheet-body"
            body={body}
            format={bodyFormat}
          />
        </Suspense>
      ) : (
        LOADING
      )}
    </BottomSheet>
  );
}

// Memoised: it takes no props, and the bottom bar that renders it re-renders
// as the page scrolls.
export default memo(InfoSheet);
