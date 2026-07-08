import { X } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { usePageContent } from '../hooks/usePageContent.js';
import './InfoSheet.css';

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
export default function InfoSheet() {
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'info';
  const { title, html } = usePageContent('about');
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

      {html ? (
        <div className="info-sheet-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="info-sheet-body">
          <p>Loading…</p>
        </div>
      )}
    </BottomSheet>
  );
}
