import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, Compass, SlidersHorizontal } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import Button from '../components/Button.jsx';
import Segmented from '../components/Segmented.jsx';
import Figures from '../components/Figures.jsx';
import SectionHead from '../components/SectionHead.jsx';
import LinkCard from '../components/LinkCard.jsx';
import DocumentMeta from '../components/DocumentMeta.jsx';
import { SheetHeader } from '../components/BottomSheet.jsx';
import NotFound from './NotFound.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { contrastRatio, paletteForHour, skyHourLabel } from '../lib/skyTheme.js';
import { labelPreviewOn, setLabelPreview } from '../lib/labelPreview.js';
import { ME_DID } from '../config.js';
import '../components/BottomSheet.css';
import './Colophon.css';

// Dawn, day, dusk and night: the four hours the design audit drew its
// mockups at, and between them the full range the palette has to hold.
const HOURS = [6, 13, 19, 0];

const INKS = [
  ['--sky-ink', 'ink'],
  ['--sky-ink-soft', 'soft'],
  ['--sky-ink-muted', 'muted'],
  ['--sky-ink-faint', 'faint'],
  ['--sky-accent', 'accent'],
];

/** An hour's palette as inline custom properties: the --sky-* values, and the
 *  site's own tokens mapped onto them the way theme.css maps them on <html>,
 *  so a specimen reads its hour rather than the page's. */
function hourStyle(vars) {
  const style = { ...vars };
  for (const [name, value] of Object.entries(vars)) {
    style[`--${name.slice('--sky-'.length)}`] = value;
  }
  return style;
}

/**
 * The colophon: the site's shared parts, set under four hours of sky, so a
 * change to one is seen everywhere it lands before it ships (SYS-09). Only
 * the owner can open it; anyone else gets the not-found page.
 *
 * It's also where the label voice is decided. Today's labels are small caps
 * the browser draws by shrinking capitals; the audit proposes real capitals
 * at an 11px floor. Each hour shows the two side by side, and the switch at
 * the top previews the capitals on every page of the site, in this browser.
 */
export default function Colophon() {
  const { did, loading } = useAtprotoSession();
  const [caps, setCaps] = useState(labelPreviewOn);
  const [range, setRange] = useState('7');

  if (loading) return <PageShell headTitle="Colophon — dame.is" />;
  if (did !== ME_DID) return <NotFound />;

  const toggleCaps = (value) => {
    const on = value === 'caps';
    setCaps(on);
    setLabelPreview(on);
  };

  return (
    <PageShell
      title="Colophon"
      intro="The site's parts, each set under four hours of sky. Only you can see this page."
      headTitle="Colophon — dame.is"
    >
      <div className="kit-switch">
        <span className="kit-switch-lead">Labels</span>
        <Segmented
          label="Label voice"
          value={caps ? 'caps' : 'small'}
          onChange={toggleCaps}
          options={[
            { value: 'small', label: 'Small caps (now)' },
            { value: 'caps', label: 'Capitals (proposed)' },
          ]}
        />
        <p className="kit-switch-note">
          {caps
            ? 'Capitals are on across the site in this browser until you switch back. Go and look at a few pages.'
            : 'Switch to capitals to see them on every page of the site, in this browser only.'}
        </p>
      </div>

      <div className="kit-hours">
        {HOURS.map((hour) => (
          <KitHour key={hour} hour={hour} range={range} onRange={setRange} />
        ))}
      </div>
    </PageShell>
  );
}

function KitHour({ hour, range, onRange }) {
  const palette = paletteForHour(hour);
  const { vars } = palette;
  return (
    <section
      className="kit-hour"
      style={hourStyle(vars)}
      data-scheme={palette.colorScheme}
      aria-label={`At ${skyHourLabel(hour)}`}
    >
      <p className="kit-hour-name">{skyHourLabel(hour)}</p>

      <KitPart title="Buttons">
        <div className="kit-row">
          <Button variant="primary">Resume</Button>
          <Button>Projects</Button>
          <Button variant="text">Open in…</Button>
          <Button variant="icon" aria-label="Filter" title="Filter">
            <SlidersHorizontal size={16} strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </div>
        <div className="kit-row">
          <Button size="sm">Load more</Button>
          <Button size="sm" variant="text">
            Inspect record
          </Button>
          <Button size="sm" variant="icon" aria-label="Top" title="Top">
            <ArrowUp size={14} strokeWidth={1.5} aria-hidden="true" />
          </Button>
          <Button size="sm" disabled>
            Disabled
          </Button>
        </div>
      </KitPart>

      <KitPart title="On">
        <div className="kit-row">
          <Segmented
            label="Range"
            value={range}
            onChange={onRange}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Button on aria-pressed="true">
            <Compass size={16} strokeWidth={1.5} aria-hidden="true" /> Open
          </Button>
        </div>
      </KitPart>

      <KitPart title="Figures">
        <Figures
          label="Listening in figures"
          items={[
            { key: 'min', value: 463, label: 'Minutes', note: '≈ 7.7 hrs' },
            { key: 'plays', value: 126, label: 'Plays' },
            { key: 'artists', value: 36, label: 'Artists' },
          ]}
        />
        <Figures
          layout="inline"
          label="Mothing in figures"
          items={[
            { key: 'nights', value: 58, label: 'Nights' },
            { key: 'moths', value: 519, label: 'Moths' },
            { key: 'species', value: 212, label: 'Species' },
          ]}
        />
      </KitPart>

      <KitPart title="Heads and colophons">
        <SectionHead title="Signatures" meta="36" as="h3" />
        <DocumentMeta date="2026-07-16T12:00:00Z" verb="Published" tag="hiring" />
      </KitPart>

      <KitPart title="Labels">
        <dl className="kit-labels">
          <div>
            <dt className="eyebrow">Now</dt>
            <dd className="kit-label-specimen">
              {/* Not .small-caps: the site-wide preview restyles that class,
                  and this column has to keep showing what's live. */}
              <span className="kit-label kit-label-now">Listening to</span>
              <span className="kit-label kit-label-now">Followed by</span>
              <span className="kit-label kit-label-now">
                65 <span className="unit">dB</span>
              </span>
              <span className="kit-label kit-label-now">
                updated 1<span className="unit">mo</span>
              </span>
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Proposed</dt>
            <dd className="kit-label-specimen">
              <span className="kit-label kit-label-caps">Listening to</span>
              <span className="kit-label kit-label-caps">Followed by</span>
              <span className="kit-label kit-label-caps">
                65 <span className="unit">dB</span>
              </span>
              <span className="kit-label kit-label-caps">
                updated 1<span className="unit">mo</span>
              </span>
            </dd>
          </div>
        </dl>
      </KitPart>

      <KitPart title="Link cards">
        <LinkCard
          href="https://atproto.com/"
          title="The AT Protocol"
          description="An open, decentralized network for building social applications."
        />
      </KitPart>

      <KitPart title="Sheet header">
        <div className="kit-sheet">
          <SheetHeader title="Filter" meta="14 of 17 kinds" onClose={() => {}} />
        </div>
      </KitPart>

      <KitPart title="Inks on the page">
        <ul className="kit-inks">
          {INKS.map(([name, label]) => {
            const ratio = contrastRatio(vars[name], vars['--sky-page']);
            return (
              <li key={name}>
                <span className="kit-ink-chip" style={{ background: vars[name] }} aria-hidden="true" />
                <span className="kit-ink-name" style={{ color: vars[name] }}>
                  {label}
                </span>
                <span className={`kit-ink-ratio${ratio < 4.5 ? ' is-short' : ''}`}>
                  {ratio.toFixed(1)}:1
                </span>
              </li>
            );
          })}
        </ul>
      </KitPart>

      <p className="kit-hour-foot">
        <Link to="/admin?view=sky">Tune this hour</Link>
      </p>
    </section>
  );
}

function KitPart({ title, children }) {
  return (
    <div className="kit-part">
      <h2 className="kit-part-title eyebrow">{title}</h2>
      {children}
    </div>
  );
}
