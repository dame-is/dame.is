/**
 * Renders a creative piece made in the Anisota Lab — the `crafting` verb.
 * One card handles every studio's output plus authored spells, branching on
 * the record's collection (derived from its at:// URI). Each type is rendered
 * faithfully to how Anisota itself displays it (the layout / tokenise math is
 * ported in src/lib/anisotaLab.js):
 *
 *   net.anisota.lab.poetry     — Word Magnets poem, re-laid from tiles + board
 *   net.anisota.lab.redaction  — erasure poem, drawn as the post it blacked out
 *   net.anisota.lab.sigil      — a sigil, its standalone SVG (sandboxed <img>)
 *   net.anisota.lab.carving    — a relief print (PNG data-URL)
 *   net.anisota.lab.inkblot    — a symmetric inkblot (PNG data-URL)
 *   net.anisota.lab.petri      — a petri culture (PNG data-URL)
 *   net.anisota.lab.synth      — a multitrack synth loop (tempo/steps meta)
 *   net.anisota.spell.custom   — an authored spell (name + description)
 *
 * `variant="record"` is the larger treatment used on the single-record page,
 * which also surfaces a "view on anisota" link to the piece's page there.
 */
import { renderPlainTextWithTruncatedUrls } from '../../lib/feedUrlFormat.jsx';
import { nsidFromAtUri } from '../../lib/verbRegistry.js';
import {
  computePoemLayout,
  sigilSvgDataUrl,
  anisotaWorkUrl,
} from '../../lib/anisotaLab.js';
import InkblotFigure from './InkblotFigure.jsx';
import RedactedPost from './RedactedPost.jsx';

/** Short, lowercase label for each Lab collection — shown in small caps. */
const KIND_LABEL = {
  'net.anisota.lab.poetry': 'poem',
  'net.anisota.lab.redaction': 'erasure poem',
  'net.anisota.lab.sigil': 'sigil',
  'net.anisota.lab.carving': 'carving',
  'net.anisota.lab.inkblot': 'inkblot',
  'net.anisota.lab.petri': 'culture',
  'net.anisota.lab.synth': 'synth',
  'net.anisota.spell.custom': 'spell',
};

export default function AnisotaLabCard({ payload, atUri, subject = null, variant = 'feed' }) {
  const v = payload || {};
  const nsid = nsidFromAtUri(atUri);
  const kind = KIND_LABEL[nsid] || 'lab piece';
  // Inkblots carry no user name (their rkey is their identity), so only the
  // kind label leads them; every other piece can front its title.
  const title = nsid === 'net.anisota.lab.inkblot' ? null : v.name || null;
  const isRecord = variant === 'record';
  const anisotaUrl = isRecord ? anisotaWorkUrl(atUri) : null;

  return (
    <article
      className={`lab-card feed-card lab-card-${isRecord ? 'record' : 'feed'}`}
      data-at-uri={atUri}
      data-nsid={nsid || undefined}
    >
      <header className="lab-card-head">
        <span className="small-caps lab-card-kind">{kind}</span>
        {title && <h3 className="lab-card-title">{title}</h3>}
      </header>
      <LabBody nsid={nsid} value={v} subject={subject} />
      {anisotaUrl && (
        <a
          className="lab-card-source small-caps"
          href={anisotaUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          view on anisota →
        </a>
      )}
    </article>
  );
}

function LabBody({ nsid, value: v, subject }) {
  switch (nsid) {
    case 'net.anisota.lab.poetry':
      return <PoemBody value={v} />;

    case 'net.anisota.lab.redaction':
      return <RedactedPost value={v} subject={subject} />;

    case 'net.anisota.spell.custom':
      return v.description ? (
        <p className="lab-card-desc">{renderPlainTextWithTruncatedUrls(v.description)}</p>
      ) : null;

    case 'net.anisota.lab.synth': {
      const parts = [];
      if (v.tempo) parts.push(`${v.tempo} bpm`);
      if (v.steps) parts.push(`${v.steps} steps`);
      if (v.scale) parts.push(v.scale);
      return parts.length ? (
        <p className="lab-card-meta gutter small-caps">{parts.join(' · ')}</p>
      ) : null;
    }

    case 'net.anisota.lab.sigil': {
      // Re-ink the stroke in the page's ink via a CSS mask over a flat fill,
      // rather than showing the color Anisota baked into the SVG. Pure CSS, so
      // it tracks the sky palette with no repaint of our own.
      const src = sigilSvgDataUrl(v.svg);
      return src ? (
        <div className="lab-card-figure lab-card-figure-sigil">
          <div
            className="lab-sigil"
            role="img"
            aria-label={v.name ? `Sigil: ${v.name}` : 'A sigil'}
            style={{ WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")` }}
          />
        </div>
      ) : null;
    }

    case 'net.anisota.lab.inkblot':
      // Duotoned per pixel into the live palette (see InkblotFigure); the
      // `palette` slot picks which theme ramp it's re-inked along.
      return isDataImage(v.image) ? (
        <div className="lab-card-figure lab-card-figure-inkblot">
          <InkblotFigure image={v.image} palette={v.palette} label={altForImage(nsid, v.name)} />
        </div>
      ) : null;

    case 'net.anisota.lab.carving':
    case 'net.anisota.lab.petri':
      // Left with their baked color — these aren't single-ink figures, so the
      // theme-derived recolor that suits sigils and inkblots doesn't apply.
      return isDataImage(v.image) ? (
        <div className="lab-card-figure">
          <img src={v.image} alt={altForImage(nsid, v.name)} loading="lazy" decoding="async" />
        </div>
      ) : null;

    default:
      return null;
  }
}

/**
 * A Word Magnets poem, re-laid from its saved tile layout. Poems that carry a
 * `board` snapshot render as positioned cream tiles exactly as arranged; older
 * poems (no board) fall back to the assembled `text`.
 */
function PoemBody({ value: v }) {
  const layout = computePoemLayout(v.tiles, v.board);
  if (!layout) {
    return v.text ? <p className="lab-card-text">{v.text}</p> : null;
  }
  return (
    <div
      className="lab-poem-field"
      style={{ aspectRatio: String(layout.fieldAspect), '--tile-font': `${layout.fontCqw}cqw` }}
      role="img"
      aria-label={v.text ? `Poem: ${v.text}` : 'A poem'}
    >
      {layout.tiles.map((tile, i) => (
        <span
          key={i}
          className={`lab-poem-tile${tile.fragment ? ' is-fragment' : ''}`}
          style={{ left: `${tile.left}%`, top: `${tile.top}%`, '--rot': `${tile.rot}deg` }}
          aria-hidden="true"
        >
          {tile.word}
        </span>
      ))}
    </div>
  );
}

/** Only render `image` fields that are self-contained data URLs. */
function isDataImage(image) {
  return typeof image === 'string' && image.startsWith('data:image/');
}

function altForImage(nsid, name) {
  const kind = KIND_LABEL[nsid] || 'lab piece';
  return name ? `${kind}: ${name}` : `A ${kind}`;
}
