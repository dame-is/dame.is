/**
 * Renders a creative piece made in the Anisota Lab — the `crafting` verb.
 * One card handles every studio's output plus authored spells, branching on
 * the record's collection (derived from its at:// URI):
 *
 *   net.anisota.lab.poetry     — a Word Magnets poem (assembled text)
 *   net.anisota.lab.redaction  — an erasure/found poem (surviving words)
 *   net.anisota.lab.sigil      — a sigil, drawn as a standalone SVG
 *   net.anisota.lab.carving    — a relief print (PNG data-URL thumbnail)
 *   net.anisota.lab.inkblot    — a symmetric inkblot (PNG data-URL)
 *   net.anisota.lab.petri      — a petri culture (PNG data-URL)
 *   net.anisota.lab.synth      — a multitrack synth loop (tempo/steps meta)
 *   net.anisota.spell.custom   — an authored spell (name + description)
 *
 * The bulky reproduction data (tile layouts, gouge paths, event grids…) is
 * stripped upstream in feedBuilder.transformRecords — only the finished
 * text / figure / print reaches this card.
 */
import { renderPlainTextWithTruncatedUrls } from '../../lib/feedUrlFormat.jsx';
import { nsidFromAtUri } from '../../lib/verbRegistry.js';

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

export default function AnisotaLabCard({ payload, atUri }) {
  const v = payload || {};
  const nsid = nsidFromAtUri(atUri);
  const kind = KIND_LABEL[nsid] || 'lab piece';
  // Inkblots carry no user name (their rkey is their identity), so only the
  // kind label leads them; every other piece can front its title.
  const title = nsid === 'net.anisota.lab.inkblot' ? null : v.name || null;

  return (
    <article className="lab-card feed-card" data-at-uri={atUri} data-nsid={nsid || undefined}>
      <header className="lab-card-head">
        <span className="small-caps lab-card-kind">{kind}</span>
        {title && <h3 className="lab-card-title">{title}</h3>}
      </header>
      <LabBody nsid={nsid} value={v} />
    </article>
  );
}

function LabBody({ nsid, value: v }) {
  switch (nsid) {
    case 'net.anisota.lab.poetry':
    case 'net.anisota.lab.redaction':
      return v.text ? <p className="lab-card-text">{v.text}</p> : null;

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
      const src = sigilSvgSrc(v.svg);
      return src ? (
        <div className="lab-card-figure lab-card-figure-sigil">
          <img src={src} alt={v.name ? `Sigil: ${v.name}` : 'A sigil'} loading="lazy" />
        </div>
      ) : null;
    }

    case 'net.anisota.lab.carving':
    case 'net.anisota.lab.inkblot':
    case 'net.anisota.lab.petri':
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
 * A sigil is stored as a standalone SVG document. Render it through an
 * `<img>` data URL rather than inlining the markup, so the figure can't run
 * scripts even though it's the owner's own record. Returns null for anything
 * that isn't actually an SVG.
 */
function sigilSvgSrc(svg) {
  if (typeof svg !== 'string' || !svg.includes('<svg')) return null;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Only render `image` fields that are self-contained data URLs. */
function isDataImage(image) {
  return typeof image === 'string' && image.startsWith('data:image/');
}

function altForImage(nsid, name) {
  const kind = KIND_LABEL[nsid] || 'lab piece';
  return name ? `${kind}: ${name}` : `A ${kind}`;
}
