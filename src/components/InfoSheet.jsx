import { X } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import './InfoSheet.css';

/**
 * "What is this site?" primer, expanded up out of the bottom chrome bar's
 * info button (see useChromePanel). Plain prose — atmosphere, atproto, PDS,
 * what you can actually do here — written for first-time visitors who don't
 * yet have the vocabulary for any of it.
 */
export default function InfoSheet() {
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'info';

  return (
    <BottomSheet open={open} onClose={closePanel} label="About this site" id="chrome-info-sheet" size="fill" className="info-sheet-panel">
      <div className="info-sheet-header">
        <span className="small-caps">about this site</span>
        <button
          type="button"
          className="info-sheet-close"
          onClick={closePanel}
          aria-label="Close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="info-sheet-body">
        <p>
          <strong>dame.is</strong> is a personal website built on top
          of the <em>AT Protocol</em>. It's where Dame writes, posts,
          plays music, ships projects, and keeps a running log of what
          they're up to. The data behind every record on this page is
          portable, open, and not stuck on this website.
        </p>

        <h3>What is atproto?</h3>
        <p>
          The Authenticated Transfer Protocol (<strong>atproto</strong>{' '}
          for short) is an open networking protocol designed by Bluesky.
          It separates <em>where your data lives</em> from{' '}
          <em>which apps you use to read or write it</em>. Anyone can
          build an app on atproto and read from the same shared,
          user-owned data layer.
        </p>

        <h3>What's the Atmosphere?</h3>
        <p>
          "The Atmosphere" is the affectionate nickname for the
          ecosystem of apps and services built on atproto, including
          Bluesky, Tangled, Grain, Leaflet, Flushes, and many others.
          Each app is a different view into the same shared network
          of people and records.
        </p>

        <h3>Where does this content live?</h3>
        <p>
          Every record you see on this site (posts, status updates,
          songs played, blog entries, project pages) is stored on
          Dame's own <strong>Personal Data Server</strong> (their PDS).
          They own it. This site is just one of many possible windows
          into that data, and the data comes with them if they ever
          move PDSes or build another frontend.
        </p>
      </div>
    </BottomSheet>
  );
}
