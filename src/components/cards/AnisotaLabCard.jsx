/**
 * Renders a creative piece made in the Anisota Lab — the `crafting` verb.
 * One card handles every studio's output plus authored spells, branching on
 * the record's collection (derived from its at:// URI). Each type is rendered
 * faithfully to how Anisota itself displays it (the layout / tokenise math is
 * ported in src/lib/anisotaLab.js):
 *
 *   net.anisota.lab.poetry     — Word Magnets poem, re-laid from tiles + board
 *   net.anisota.lab.redaction  — erasure poem, original text with words blacked out
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
  tokenizePost,
  isRedactable,
  sigilSvgDataUrl,
  anisotaWorkUrl,
} from '../../lib/anisotaLab.js';

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

export default function AnisotaLabCard({ payload, atUri, variant = 'feed' }) {
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
      <LabBody nsid={nsid} value={v} />
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

function LabBody({ nsid, value: v }) {
  switch (nsid) {
    case 'net.anisota.lab.poetry':
      return <PoemBody value={v} />;

    case 'net.anisota.lab.redaction':
      return <RedactionBody value={v} />;

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
      const src = sigilSvgDataUrl(v.svg);
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

/**
 * An erasure poem: the source post's original text with the redacted words
 * blacked out, and the surviving found poem beneath. Falls back to the
 * surviving `text` alone when no `original` snapshot was saved.
 */
function RedactionBody({ value: v }) {
  const original = typeof v.original === 'string' ? v.original : '';
  const redacted = Array.isArray(v.redacted) ? new Set(v.redacted) : new Set();
  if (!original) {
    return v.text ? <p className="lab-card-text">{v.text}</p> : null;
  }
  const tokens = tokenizePost(original);
  return (
    <div className="lab-redaction-wrap">
      <p className="lab-redaction" aria-label={v.text ? `Erasure poem: ${v.text}` : 'An erasure poem'}>
        {tokens.map((t, i) =>
          isRedactable(t) && redacted.has(t.index) ? (
            <span key={i} className="lab-redaction-word is-redacted" aria-hidden="true">
              {t.text}
            </span>
          ) : (
            <span key={i}>{t.text}</span>
          ),
        )}
      </p>
      {v.text && <p className="lab-redaction-found">{v.text}</p>}
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
