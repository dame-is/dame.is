import { lazy, memo, Suspense } from 'react';
import BottomSheet from './BottomSheet.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { usePageContent } from '../hooks/usePageContent.js';
import './InfoSheet.css';

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
    <BottomSheet
      open={open}
      onClose={closePanel}
      title={heading}
      id="chrome-info-sheet"
      size="fill"
      className="info-sheet-panel"
      bodyClassName="info-sheet-content"
    >

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
