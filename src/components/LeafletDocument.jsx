import {
  createContext,
  Fragment,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ledeEnd,
  renderLeafletText,
  splitLeafletText,
  unlinkInitial,
} from '../lib/leafletRichText.jsx';
import { countStraightMarks, smartenText } from '../lib/smartPunctuation.js';
import { renderPostText } from '../lib/postRichText.jsx';
import { getPostThread } from '../lib/atproto.js';
import { avatarThumb } from '../lib/avatarThumb.js';
import PostEmbed from './PostEmbed.jsx';
import { AltList, BlobPlate } from './XrayBlob.jsx';
import { useXray } from '../hooks/useXray.jsx';
import Time from './Time.jsx';
import LinkCard from './LinkCard.jsx';
import Lightbox from './Lightbox.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { Skeleton, SkeletonText } from './Skeleton.jsx';
// Where RatioedBlock used to be imported: the stylesheets it brings stay here,
// so the CSS lands where it always has. See loadRatioedBlock below.
import './ScrollFrame.css';
import './RatioedHandle.css';
import './blocks/RatioedBlock.css';
import { Link } from 'react-router-dom';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { ME_DID } from '../config.js';
import { videoEmbedSrc } from '../lib/videoEmbed.js';
import { SIGNUP_BLOCK_TYPE, signupBlockIds } from '../lib/newsletter.js';
import NewsletterSignup from './NewsletterSignup.jsx';
import QuoteShare from './QuoteShare.jsx';
import './LeafletDocument.css';

// Lazy: Ratioed's charts appear in one essay, but they carry the project's
// whole seed (every piece and every participant), and this file is reached
// from every page that draws a document: About, every blog post and work, and
// the record editor's preview. Statically imported, that seed rode with all of
// them, and in the entry chunk itself while the debug sheet still imported the
// editor eagerly. Only the JavaScript moves; the CSS is imported above, in its
// old cascade position (see lib/pageStyles.js for why that matters).
//
// The document stops short of a chart until the chunk is in, the way it holds
// for an embedded post (see useEmbedCutoff), and a chart mounted after that is
// drawn as `RatioedChart`, the loaded component itself. Through `lazy()` it
// would suspend once even then, and React keeps a boundary's placeholder up
// for a beat before revealing what replaced it, long enough for the rest of
// the essay to be drawn beneath the placeholder and pushed down. The lazy
// version covers what mounts first: the block-editor preview, which has no
// hold, and a hold that times out before the chunk arrives.
let RatioedChart = null;
const loadRatioedBlock = () =>
  import('./blocks/RatioedBlock.jsx').then((mod) => {
    RatioedChart = mod.default;
    return mod;
  });
const RatioedBlockLazy = lazy(loadRatioedBlock);

// Lets an ImageBlock deep in the tree open the document's shared lightbox
// at its own image. Null when a block is rendered outside a full document
// (e.g. the admin block-editor preview) — there the image stays static.
const LeafletLightboxContext = createContext(null);

// A long document's sections (`contents` on LeafletDocument): each level-2
// heading block mapped to its anchor id and number, and which one opens the
// first section, where the contents row goes. Null when the document keeps
// no contents.
const LeafletSectionsContext = createContext(null);

// Each signup block's form id (signupBlockIds), so a reader confirming their
// address comes back to the form they used. Null outside a full document (the
// block-editor preview), where a form makes up an id of its own.
const LeafletSignupContext = createContext(null);

// Fewer sections than this and a contents row is longer than the walk.
const CONTENTS_MIN_SECTIONS = 4;

/** The document's sections: every level-2 heading, numbered from 1, with an
 *  id that reads as its title and never repeats. */
export function documentSections(pages) {
  const byBlock = new Map();
  const list = [];
  const used = new Set();
  for (const page of pages || []) {
    for (const wrap of Array.isArray(page?.blocks) ? page.blocks : []) {
      const block = wrap?.block;
      if (block?.$type !== 'pub.leaflet.blocks.header' || clampLevel(block.level) !== 2) continue;
      const text = (block.plaintext || '').trim();
      if (!text) continue;
      const base = `section-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || list.length + 1}`;
      let id = base;
      for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
      used.add(id);
      const section = { id, text, number: list.length + 1 };
      byBlock.set(block, section);
      list.push(section);
    }
  }
  return { list, byBlock, first: list[0] ? [...byBlock.keys()][0] : null };
}

function imageBlockUrl(block) {
  // `_url` is set by annotateLeafletBlobs once the blob ref is resolved
  // against the PDS. `block.url` is the legacy escape hatch for records
  // migrated from is.dame.creating.work's old media[] array, where images
  // were stored as plain external URLs rather than blob refs.
  return block?.image?._url || block?.url || null;
}

function collectImages(pages) {
  const out = [];
  for (const page of pages) {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (const entry of blocks) {
      const block = entry?.block;
      if (block?.$type !== 'pub.leaflet.blocks.image') continue;
      const url = imageBlockUrl(block);
      if (!url) continue;
      const ar = block.aspectRatio;
      // No reverse-image-search control — that belongs to the curated
      // galleries, where a block arrived from somewhere else and finding
      // where is the point. These are the author's own illustrations.
      out.push({
        src: url,
        alt: block.alt || '',
        width: ar?.width || undefined,
        height: ar?.height || undefined,
      });
    }
  }
  return out;
}

/**
 * Renders a `pub.leaflet.document` value — the body of a leaflet.pub
 * long-form post. Walks each page's `linearDocument` blocks and
 * dispatches per block `$type`.
 *
 * Block types handled (set covers the leaflet schema observed in the
 * wild; anything else falls through silently):
 *   - pub.leaflet.blocks.text          (paragraph w/ optional facets)
 *   - pub.leaflet.blocks.header        (heading; level → 1–6)
 *   - pub.leaflet.blocks.image         (image w/ optional alt + AR)
 *   - pub.leaflet.blocks.website       (link card w/ preview)
 *   - pub.leaflet.blocks.bskyPost      (embedded Bluesky post)
 *   - pub.leaflet.blocks.code          (preformatted code)
 *   - pub.leaflet.blocks.blockquote    (a quotation, set like an inset)
 *   - pub.leaflet.blocks.unorderedList (recursive list w/ #listItem children)
 *   - pub.leaflet.blocks.orderedList   (same shape as unorderedList)
 *   - pub.leaflet.blocks.signup        (the newsletter's email form)
 *
 * Empty text blocks act as paragraph breaks.
 *
 * `quotable` lets a reader share a passage of the prose by selecting it, and
 * highlights the one a `?quote=` link arrived for (QuoteShare.jsx). Only for
 * a site.standard.document, the one kind of record whose quote links unfurl
 * as the passage (see middleware.js).
 */
export default function LeafletDocument({ doc, contents = false, quotable = false }) {
  const docRef = useRef(null);
  const pages = useMemo(() => (Array.isArray(doc?.pages) ? doc.pages : []), [doc?.pages]);
  // A long piece opens with its contents, and its section heads carry their
  // numbers (COL-13). Only where the caller asks: an essay reads straight
  // through.
  const sections = useMemo(() => {
    if (!contents) return null;
    const found = documentSections(pages);
    return found.list.length >= CONTENTS_MIN_SECTIONS ? found : null;
  }, [contents, pages]);
  const images = useMemo(() => collectImages(pages), [pages]);
  const signupIds = useMemo(() => signupBlockIds(pages), [pages]);
  const cutoff = useEmbedCutoff(pages);
  const indexBySrc = useMemo(() => {
    const m = new Map();
    images.forEach((im, i) => {
      if (!m.has(im.src)) m.set(im.src, i);
    });
    return m;
  }, [images]);
  const [lightbox, setLightbox] = useState(-1);

  if (pages.length === 0) {
    return <p className="feed-empty">This document has no body yet.</p>;
  }

  const ctx = { openImage: (src) => setLightbox(indexBySrc.get(src) ?? -1) };
  // The opening paragraph takes the drop cap. Found here, on the record,
  // rather than by a :first-child selector: a document can open on an empty
  // spacer block or a heading, and the cap belongs to the first words.
  const firstIndex = firstTextIndex(pages[0]);

  return (
    <LeafletLightboxContext.Provider value={ctx}>
      <LeafletSectionsContext.Provider value={sections}>
        <LeafletSignupContext.Provider value={signupIds}>
          <div ref={docRef} className={sections ? 'leaflet-doc leaflet-doc-sectioned' : 'leaflet-doc'}>
            {pages.map((page, pi) =>
              cutoff && pi > cutoff.page ? null : (
                <LeafletPage
                  key={pi}
                  page={page}
                  firstIndex={pi === 0 ? firstIndex : -1}
                  upTo={cutoff && pi === cutoff.page ? cutoff.block : null}
                />
              ),
            )}
          </div>
          {quotable && <QuoteShare docRef={docRef} content={doc} />}
        </LeafletSignupContext.Provider>
        {images.length > 0 && (
          <Lightbox
            open={lightbox >= 0}
            index={Math.max(0, lightbox)}
            onClose={() => setLightbox(-1)}
            images={images}
          />
        )}
      </LeafletSectionsContext.Provider>
    </LeafletLightboxContext.Provider>
  );
}

export const IMAGE_BLOCK_TYPE = 'pub.leaflet.blocks.image';

/**
 * Gallery layout — a dame.is rendering extension stored as `gallery` on each
 * image block, in the same family as `indent` / `spaceTop` / `spaceBottom`.
 *
 * Adjacent image blocks group into one gallery, and they group only with
 * neighbours carrying the SAME value — so two differently-shaped galleries can
 * sit back to back, and `standalone` opts an image out of grouping entirely
 * (each renders full width, exactly as a lone image block does).
 *
 * A column choice is honored at EVERY width — 3 across stays 3 across on a
 * phone. Galleries used to guess their columns from the image count and had a
 * narrow-screen collapse that (through a CSS specificity accident) never fired,
 * so what published was hard to predict from the editor. An explicit count that
 * doesn't change under you is the point of the control.
 */
export const GALLERY_DEFAULT_LAYOUT = 'justified';

export const GALLERY_LAYOUTS = [
  {
    value: 'justified',
    label: 'Justified rows',
    hint: 'Each photo whole, rows ending flush, wider than the text (default)',
  },
  { value: 'one-up', label: '1 across', hint: 'A single tight column' },
  { value: 'two-up', label: '2 across', hint: 'Two columns at every width' },
  { value: 'three-up', label: '3 across', hint: 'Three columns at every width' },
  { value: 'four-up', label: '4 across', hint: 'Four columns — small on a phone' },
  { value: 'filmstrip', label: 'Filmstrip', hint: 'One row that scrolls sideways' },
  { value: 'standalone', label: 'Separate images', hint: 'No grouping — full-width, stacked' },
];

const GALLERY_LAYOUT_VALUES = new Set(GALLERY_LAYOUTS.map((l) => l.value));

/**
 * The effective layout of an image block. An absent field (every image block
 * written before this control existed) reads as the default: justified rows,
 * which keep each photo's own shape. It used to be a two-up grid, which left
 * a hole beside every portrait in a mixed series.
 */
export function galleryLayoutOf(block) {
  return GALLERY_LAYOUT_VALUES.has(block?.gallery) ? block.gallery : GALLERY_DEFAULT_LAYOUT;
}

/**
 * Split a page's blocks into gallery runs: maximal spans of adjacent image
 * blocks that share one layout. Shared with the admin blocks editor so the
 * editor's grouping is the published grouping, not a second guess at it.
 *
 * Returns `[{ start, end, size, layout }]` for every run of two or more —
 * including `standalone` runs, which the editor surfaces as "not grouped" but
 * the renderer emits as individual images.
 */
export function galleryRuns(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const runs = [];
  let i = 0;
  while (i < list.length) {
    if (list[i]?.block?.$type !== IMAGE_BLOCK_TYPE) {
      i += 1;
      continue;
    }
    const layout = galleryLayoutOf(list[i].block);
    let j = i;
    while (
      j < list.length &&
      list[j]?.block?.$type === IMAGE_BLOCK_TYPE &&
      galleryLayoutOf(list[j].block) === layout
    ) {
      j += 1;
    }
    if (j - i >= 2) runs.push({ start: i, end: j - 1, size: j - i, layout });
    i = j;
  }
  return runs;
}

/* ------------------------------------------------------------------ */
/* Embedded posts: loading, and holding the page back for them          */
/* ------------------------------------------------------------------ */

const BSKY_POST_TYPE = 'pub.leaflet.blocks.bskyPost';
const RATIOED_TYPE = 'is.dame.blocks.ratioed';
// Stands in for a post's at:// URI among the holds below. Every Ratioed chart
// waits on the same thing, the first time: the chunk that draws them.
const RATIOED_CHUNK = 'ratioed-chunk';

// How long the rest of a document waits on its embedded posts before it is
// drawn anyway, with placeholders where they haven't answered.
const EMBED_HOLD_MS = 2000;

// Post views by at:// URI, shared by every document on the page and kept for
// the session, so coming back to a post draws its embeds at once, with
// `pendingPosts` holding the reads still in flight. A failed read isn't kept,
// so the next mount tries again.
const embeddedPosts = new Map(); // uri -> { status: 'ready' | 'missing', post }
const pendingPosts = new Map(); // uri -> Promise<entry>

function loadEmbeddedPost(uri) {
  const held = embeddedPosts.get(uri);
  if (held) return Promise.resolve(held);
  if (pendingPosts.has(uri)) return pendingPosts.get(uri);
  const promise = getPostThread(uri, { depth: 0, parentHeight: 0 })
    .then((thread) => {
      const post = thread?.thread?.post || null;
      const entry = post ? { status: 'ready', post } : { status: 'missing', post: null };
      embeddedPosts.set(uri, entry);
      return entry;
    })
    .catch(() => ({ status: 'error', post: null }))
    .finally(() => pendingPosts.delete(uri));
  pendingPosts.set(uri, promise);
  return promise;
}

/**
 * Where to stop drawing a document while its embedded posts load:
 * `{ page, block }` of the first top-level bskyPost block that hasn't
 * answered yet, or null to draw everything.
 *
 * An embedded post loads from the AppView after the document mounts, and it
 * can be anything from two lines to a screenful once its quote and pictures
 * are in. Drawn as a short placeholder with the rest of the document under it,
 * every paragraph after the first embed jumped when it landed — most of a
 * phone screen on /creating/ratioed. So the document stops at the first embed
 * still loading (its placeholder included) and the rest follows when the posts
 * have answered, or after EMBED_HOLD_MS. Text arriving below what's on screen
 * moves nothing anyone is reading.
 *
 * A Ratioed chart holds the document too, the first time one is drawn this
 * visit: it stops just short of the chart, placeholder and all, until the
 * chart's lazy chunk is in, so the essay is never drawn beneath a placeholder
 * that the chart then pushes down.
 */
function useEmbedCutoff(pages) {
  const uris = useMemo(() => {
    const out = [];
    pages.forEach((page, pi) => {
      (Array.isArray(page?.blocks) ? page.blocks : []).forEach((entry, bi) => {
        const block = entry?.block;
        if (block?.$type === BSKY_POST_TYPE && block.postRef?.uri) {
          out.push({ uri: block.postRef.uri, page: pi, block: bi });
        } else if (block?.$type === RATIOED_TYPE && !RatioedChart) {
          // Stops before the chart rather than at it: nothing should mount
          // one until the chunk is in (see RatioedSlot).
          out.push({ uri: RATIOED_CHUNK, page: pi, block: bi - 1 });
        }
      });
    });
    return out;
  }, [pages]);
  const key = uris.map((u) => u.uri).join(' ');
  const [, setSettled] = useState(0);
  // Reads that failed. They aren't cached (so a later mount retries), so this
  // is what stops one from holding the document until the timeout.
  const [failed, setFailed] = useState(() => new Set());
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!uris.length) return undefined;
    let cancelled = false;
    setExpired(false);
    const timer = setTimeout(() => {
      if (!cancelled) setExpired(true);
    }, EMBED_HOLD_MS);
    for (const uri of new Set(uris.map((u) => u.uri))) {
      const load =
        uri === RATIOED_CHUNK
          ? loadRatioedBlock().then(
              () => ({ status: 'ready' }),
              () => ({ status: 'error' }),
            )
          : loadEmbeddedPost(uri);
      load.then((entry) => {
        if (cancelled) return;
        if (entry.status === 'error') setFailed((prev) => new Set(prev).add(uri));
        else setSettled((n) => n + 1);
      });
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (expired) return null;
  const settled = (uri) =>
    uri === RATIOED_CHUNK ? RatioedChart !== null : embeddedPosts.has(uri);
  const first = uris.find(({ uri }) => !settled(uri) && !failed.has(uri));
  return first ? { page: first.page, block: first.block } : null;
}

function useEmbeddedPost(uri) {
  const [entry, setEntry] = useState(() => (uri ? embeddedPosts.get(uri) || null : null));
  useEffect(() => {
    if (!uri) return undefined;
    let cancelled = false;
    const held = embeddedPosts.get(uri);
    setEntry(held || null);
    if (!held) {
      loadEmbeddedPost(uri).then((next) => {
        if (!cancelled) setEntry(next);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return entry;
}

// A drop cap is three lines tall, so it waits for a paragraph that runs to
// at least three: on a two-line note ("Note: you can also read this in…") it
// hung past the paragraph's end. The essay's own opening is rarely further
// than the second or third paragraph, so the search stops there.
const DROP_CAP_MIN_CHARS = 140;
const DROP_CAP_SEARCH = 3;

function firstTextIndex(page) {
  const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
  let seen = 0;
  for (let i = 0; i < blocks.length && seen < DROP_CAP_SEARCH; i += 1) {
    const block = blocks[i]?.block;
    if (block?.$type === 'pub.leaflet.blocks.header') return -1;
    if (block?.$type !== 'pub.leaflet.blocks.text') continue;
    const text = (block.plaintext || '').trim();
    if (!text) continue;
    seen += 1;
    // A quotation, a credit or a stacked line is never where the text begins.
    if (TEXT_LAYOUT_VALUES.has(block.layout)) continue;
    if (text.length >= DROP_CAP_MIN_CHARS) return i;
  }
  return -1;
}

function LeafletPage({ page, firstIndex = -1, upTo = null }) {
  const sections = useContext(LeafletSectionsContext);
  const { active: inspecting } = useXray();
  const all = Array.isArray(page?.blocks) ? page.blocks : [];
  // `upTo` is the last block to draw while an embed holds the rest back.
  const blocks = upTo == null ? all : all.slice(0, upTo + 1);
  const out = [];
  const runStarts = new Map();
  for (const run of galleryRuns(blocks)) runStarts.set(run.start, run);
  let i = 0;
  while (i < blocks.length) {
    // Collapse a run of adjacent image blocks into a gallery so a photo set
    // reads as one unit instead of a tall stack. `standalone` runs skip the
    // wrapper and fall through to the per-block path below.
    const run = runStarts.get(i);
    if (run && run.layout !== 'standalone') {
      out.push(
        <div
          className="leaflet-gallery"
          data-count={run.size}
          data-layout={run.layout}
          key={`g-${i}`}
        >
          {blocks.slice(run.start, run.end + 1).map((wrap, j) => (
            <LeafletBlock key={j} block={wrap?.block} index={run.start + j} inGallery />
          ))}
        </div>,
      );
      // A gallery's tiles are too small to hold their alt text, so x-ray
      // prints it for the whole run under the gallery.
      if (inspecting) {
        const alts = galleryAlts(blocks, run);
        if (alts.length) {
          out.push(<AltList key={`g-${i}-alts`} items={alts} field={(n) => `blocks[${n}].alt`} />);
        }
      }
      i = run.end + 1;
      continue;
    }
    if (sections?.first && blocks[i]?.block === sections.first) {
      out.push(<LeafletContents key="contents" sections={sections.list} />);
    }
    out.push(
      <LeafletBlock key={`b-${i}`} block={blocks[i]?.block} first={i === firstIndex} index={i} />,
    );
    i += 1;
  }
  return <Fragment>{out}</Fragment>;
}

// Optional per-block layout hints (dame.is rendering extensions, set in the
// admin blocks editor): `indent` forces a text paragraph's first-line indent
// on/off (overriding the automatic book-style adjacency indent), and
// `spaceTop`/`spaceBottom` add extra margin above/below any block so an author
// can open up space without inserting empty spacer blocks.
const BLOCK_SPACE_SCALE = {
  sm: 'var(--space-4)',
  md: 'var(--space-6)',
  lg: 'var(--space-8)',
};

// The author's paragraph roles (dame.is rendering extension, set in the admin
// blocks editor beside indent and spacing). Never guessed from the text: an
// italic paragraph is not necessarily a quotation.
//   inset  — a quotation, set on the blockquote rule with its text on the indent
//   stack  — a run of short specimen lines, unindented and close together
//   credit — a photo credit, at caption size directly under its figure
export const TEXT_LAYOUTS = [
  { value: 'inset', label: 'Quotation', hint: 'Inset on a rule, like a blockquote' },
  { value: 'stack', label: 'Stacked line', hint: 'Short lines that read as a list of examples' },
  { value: 'credit', label: 'Credit', hint: 'Caption-size, tucked under the figure above' },
];
const TEXT_LAYOUT_VALUES = new Set(TEXT_LAYOUTS.map((l) => l.value));

function blockLayoutStyle(block) {
  const style = {};
  if (BLOCK_SPACE_SCALE[block.spaceTop]) style.marginTop = BLOCK_SPACE_SCALE[block.spaceTop];
  if (BLOCK_SPACE_SCALE[block.spaceBottom]) style.marginBottom = BLOCK_SPACE_SCALE[block.spaceBottom];
  // Indent is a paragraph concept; only text blocks honor it. `null`/absent =
  // leave the CSS default (adjacent paragraphs auto-indent) untouched.
  if (block.$type === 'pub.leaflet.blocks.text' && block.indent != null) {
    style.textIndent = block.indent ? '1.5em' : '0';
  }
  return Object.keys(style).length ? style : null;
}

/**
 * `index` is the block's place in its page's `blocks`, which x-ray names an
 * image block's blob by; `inGallery` says it is one tile of a gallery run,
 * whose alt text the page prints for the run (LeafletPage).
 */
export function LeafletBlock({ block, first = false, index = null, inGallery = false }) {
  if (!block) return null;
  // Layout hints ride as an inline style on the block's own root element so
  // they win over the stylesheet's adjacency rules (e.g. the `margin-bottom: 0`
  // on stacked paragraphs) without wrapping the block — wrapping would break
  // those `+` selectors. `null` when the block carries no hints.
  const style = blockLayoutStyle(block);
  switch (block.$type) {
    case 'pub.leaflet.blocks.text':
      return <TextBlock block={block} style={style} first={first} />;
    case 'pub.leaflet.blocks.header':
      return <HeaderBlock block={block} style={style} />;
    case 'pub.leaflet.blocks.image':
      return <ImageBlock block={block} style={style} index={index} inGallery={inGallery} />;
    case 'pub.leaflet.blocks.website':
      return <WebsiteBlock block={block} style={style} />;
    case 'pub.leaflet.blocks.bskyPost':
      return <BskyPostBlock block={block} style={style} />;
    case 'pub.leaflet.blocks.code':
      return <CodeBlock block={block} style={style} />;
    case 'pub.leaflet.blocks.blockquote':
      return <BlockquoteBlock block={block} style={style} />;
    case 'pub.leaflet.blocks.unorderedList':
    case 'pub.leaflet.blocks.orderedList':
      return (
        <ListBlock
          block={block}
          ordered={block.$type === 'pub.leaflet.blocks.orderedList'}
          style={style}
        />
      );
    case SIGNUP_BLOCK_TYPE:
      return <SignupBlock block={block} style={style} />;
    // Site-local block type. Other renderers of pub.leaflet.content fall through
    // to `null` here, which is why a ratioed block should always be followed by
    // a text block carrying the same figures in prose.
    //
    // The chart is a lazy chunk, so it gets a boundary of its own: a chunk that
    // fails to load (or a chart that throws) costs that one figure, not the
    // essay around it, and the prose after it still carries the numbers.
    case RATIOED_TYPE:
      return (
        <ErrorBoundary
          fallback={
            <p className="ratioed-note" style={style || undefined}>
              This chart couldn’t be drawn. Reloading usually fixes it.
            </p>
          }
        >
          <Suspense
            fallback={
              <figure
                className="ratioed"
                style={{ minHeight: '12rem', ...(style || {}) }}
                aria-busy="true"
              />
            }
          >
            <RatioedSlot block={block} style={style} />
          </Suspense>
        </ErrorBoundary>
      );
    default:
      return null;
  }
}

/**
 * Leaflet's signup block carries no data: it stands for "the publication's
 * subscribe form here", which on dame.is is the newsletter's.
 */
function SignupBlock({ block, style }) {
  const ids = useContext(LeafletSignupContext);
  return <NewsletterSignup id={ids?.get(block)} style={style} />;
}

/**
 * A Ratioed chart: the loaded component when its chunk is already in, the
 * lazy one when it isn't. Chosen once, at mount, so a chart that started out
 * lazy isn't remounted (and its data re-read) when the chunk lands.
 */
function RatioedSlot({ block, style }) {
  const [Chart] = useState(() => RatioedChart || RatioedBlockLazy);
  return <Chart block={block} style={style} />;
}

const utf8 = new TextEncoder();

/**
 * Drop the line breaks a block opens or closes on, shifting the facets to
 * match. A credit written as "\nimage source: …" rendered a blank line first
 * and sat 75px under the caption it belongs to. Facet offsets are UTF-8 byte
 * positions, so the shift is counted in bytes; a newline is one byte.
 */
export function trimBlockText(text, facets) {
  const lead = text.length - text.replace(/^\n+/, '').length;
  const trimmed = text.replace(/^\n+/, '').replace(/\n+$/, '');
  if (trimmed === text) return { text, facets };
  const end = utf8.encode(trimmed).length;
  const shifted = Array.isArray(facets)
    ? facets
        .map((f) => {
          const s = f?.index?.byteStart;
          const e = f?.index?.byteEnd;
          if (s == null || e == null) return f;
          const byteStart = Math.max(0, s - lead);
          const byteEnd = Math.min(end, e - lead);
          return byteEnd > byteStart ? { ...f, index: { ...f.index, byteStart, byteEnd } } : null;
        })
        .filter(Boolean)
    : facets;
  return { text: trimmed, facets: shifted };
}

function TextBlock({ block, style, first = false }) {
  const raw = block.plaintext || '';
  // Empty text blocks function as paragraph breaks. Render an empty
  // spacer paragraph rather than nothing so the rhythm is preserved.
  if (!raw.trim()) {
    return <p className="leaflet-spacer" aria-hidden="true" style={style || undefined} />;
  }
  const { text, facets } = trimBlockText(raw, block.facets);
  const layout = TEXT_LAYOUT_VALUES.has(block.layout) ? block.layout : null;
  const classes = ['leaflet-paragraph'];
  if (first) classes.push('first-paragraph');
  if (layout) classes.push(`leaflet-${layout}`);
  const marks = countStraightMarks(text);
  // The opening paragraph sets its first phrase in small caps after the drop
  // cap (Blogging.css .leaflet-lede), rather than its whole first line.
  const [lede, rest] = first
    ? splitLeafletText(text, unlinkInitial(text, facets), ledeEnd(text))
    : [null, null];
  return (
    <p className={classes.join(' ')} style={style || undefined}>
      {lede?.text ? (
        <>
          <span className="leaflet-lede">{renderLeafletText(lede.text, lede.facets, { smart: true })}</span>
          {renderLeafletText(rest.text, rest.facets, { smart: true, prev: lede.text.slice(-1) })}
        </>
      ) : (
        renderLeafletText(text, facets, { smart: true })
      )}
      {/* The manuscript, for x-ray: the record's own text beside the typeset
          paragraph, so curling a quote on the page never hides what was
          written. Hidden until inspect is on. */}
      {marks > 0 && (
        <span className="leaflet-xray-raw" aria-hidden="true">
          <span className="leaflet-xray-raw-label">record text, as written</span>
          <span className="leaflet-xray-raw-text">{text}</span>
          <span className="leaflet-xray-raw-note">
            {marks} typewriter {marks === 1 ? 'mark' : 'marks'}, typeset on the page only
          </span>
        </span>
      )}
    </p>
  );
}

/**
 * Leaflet's own quotation block. It used to fall through to nothing, so an
 * essay written in Leaflet lost every quotation it set this way, Jack
 * Dorsey's and Jay Graber's among them, and read as if it introduced them and
 * moved on. Set exactly as a text block's Quotation layout is (inset on the
 * accent rule, in italic), so a quotation looks the same whichever editor
 * wrote it, and wearing the same classes, so the paragraph after it starts
 * flush as it does after an inset. Its text is somebody else's, so quoting a
 * passage (src/lib/quote.js) leaves it out, as it does an inset.
 */
function BlockquoteBlock({ block, style }) {
  const raw = block.plaintext || '';
  if (!raw.trim()) return null;
  const { text, facets } = trimBlockText(raw, block.facets);
  return (
    <blockquote className="leaflet-paragraph leaflet-inset" style={style || undefined}>
      {renderLeafletText(text, facets, { smart: true })}
    </blockquote>
  );
}

function HeaderBlock({ block, style }) {
  const level = clampLevel(block.level);
  const Tag = `h${level}`;
  const text = block.plaintext || '';
  const section = useContext(LeafletSectionsContext)?.byBlock.get(block);
  return (
    <Tag
      className={`leaflet-heading leaflet-heading-${level}`}
      style={style || undefined}
      id={section?.id}
      tabIndex={section ? -1 : undefined}
      data-section={section?.number}
    >
      {section && (
        <span className="leaflet-section-num" aria-hidden="true">
          {section.number}
        </span>
      )}
      {renderLeafletText(text, block.facets, { smart: true })}
    </Tag>
  );
}

/**
 * The contents row a long piece opens on, just before its first section: each
 * section's number and title, in one wrapping line. A tap scrolls to the
 * section and moves focus there rather than changing the URL, so the router
 * never sees a navigation and Back still leaves the page.
 */
function LeafletContents({ sections }) {
  const go = (e, id) => {
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  };
  return (
    <nav className="leaflet-contents" aria-label="Contents">
      <p className="leaflet-contents-label eyebrow">Contents</p>
      <ol className="leaflet-contents-list">
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} onClick={(e) => go(e, s.id)}>
              <span className="leaflet-contents-num">{s.number}</span> {smartenText(s.text)}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ImageBlock({ block, style, index = null, inGallery = false }) {
  const lightbox = useContext(LeafletLightboxContext);
  const { active: inspecting } = useXray();
  const plateId = useId();
  const url = imageBlockUrl(block);
  if (!url) return null;
  const alt = block.alt || '';
  // `caption` is the visible caption; `alt` stays the screen-reader text.
  // Legacy blocks doubled `alt` as the caption, so fall back to it.
  const caption = block.caption || alt;
  const field = index == null ? 'image' : `blocks[${index}]`;
  const ar = block.aspectRatio;
  const imgStyle = ar?.width && ar?.height
    ? { aspectRatio: `${ar.width} / ${ar.height}` }
    : undefined;
  // The figure carries its ratio for a justified gallery's row maths.
  const figureStyle = ar?.width && ar?.height ? { ...(style || {}), '--ar': ar.width / ar.height } : style;
  const img = (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      style={imgStyle}
    />
  );
  return (
    <figure className="leaflet-image" style={figureStyle || undefined}>
      {lightbox?.openImage ? (
        <button
          type="button"
          className="leaflet-image-button"
          onClick={() => lightbox.openImage(url)}
          aria-label={alt ? `View image: ${alt}` : 'View image'}
          aria-describedby={inspecting ? plateId : undefined}
        >
          {img}
          {/* Under x-ray, the blob this block's `image` points at. A legacy
              block with a plain URL has none, and says nothing. */}
          {inspecting && block.image && (
            <BlobPlate
              id={plateId}
              field={field}
              blob={block.image}
              url={url}
              aspectRatio={block.aspectRatio}
            />
          )}
        </button>
      ) : (
        img
      )}
      {caption && <figcaption className="leaflet-image-caption">{caption}</figcaption>}
      {inspecting && !inGallery && altHidden(block) && (
        <AltList items={[{ index: index ?? 0, alt }]} field={() => `${field}.alt`} />
      )}
    </figure>
  );
}

/**
 * Whether an image block's alt text is out of sight: it has none, or it has a
 * caption of its own to show instead. A block with no caption shows its alt
 * as one (see ImageBlock), so x-ray has nothing to add there.
 */
function altHidden(block) {
  const alt = block?.alt || '';
  return !alt || Boolean(block.caption && block.caption !== alt);
}

/** The alt text of a gallery run's tiles that x-ray has to print for them. */
function galleryAlts(blocks, run) {
  const out = [];
  for (let k = run.start; k <= run.end; k += 1) {
    const block = blocks[k]?.block;
    if (!block || !imageBlockUrl(block) || !altHidden(block)) continue;
    out.push({ index: k, alt: block.alt || '' });
  }
  return out;
}

function WebsiteBlock({ block, style }) {
  const raw = block.src;
  if (!raw) return null;
  // Authors can enter a bare host ("anisota.net"); make the link (and the
  // hostname parse below) work by assuming https when no scheme is present.
  const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  // Known video hosts render as an inline player instead of a link card.
  const embed = videoEmbedSrc(href);
  if (embed) {
    return (
      <figure className="leaflet-embed" style={style || undefined}>
        <div className="leaflet-embed-frame">
          <iframe
            src={embed}
            title={block.title || 'Embedded video'}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        {block.title && <figcaption className="leaflet-image-caption">{block.title}</figcaption>}
      </figure>
    );
  }

  // Everything else is the site's one reference card, at its full size: the
  // same object as a post's link embed, a size up for a document.
  return (
    <LinkCard
      size="full"
      className="leaflet-website"
      href={href}
      title={block.title}
      description={block.description}
      thumb={block?.previewImage?._url || null}
      style={style}
    />
  );
}

function CodeBlock({ block, style }) {
  const code = block.plaintext || block.code || '';
  const lang = block.language || '';
  // highlight.js is lazy-loaded so it never weighs down pages without code.
  const [html, setHtml] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!code.trim()) return undefined;
    import('../lib/highlight.js')
      .then(({ highlightCode }) => {
        if (cancelled) return;
        try {
          setHtml(highlightCode(code, lang.toLowerCase()));
        } catch {
          setHtml(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  return (
    <pre className="leaflet-code hljs" style={style || undefined}>
      {html ? (
        <code dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code>{code}</code>
      )}
    </pre>
  );
}

/**
 * Recursive list. Each `#listItem` carries a `content` text block and
 * an optional `children` array of more list items (nested lists).
 */
function ListBlock({ block, ordered, style }) {
  const Tag = ordered ? 'ol' : 'ul';
  const items = Array.isArray(block?.children) ? block.children : [];
  return (
    <Tag className="leaflet-list" style={style || undefined}>
      {items.map((item, i) => (
        <ListItem key={i} item={item} ordered={ordered} />
      ))}
    </Tag>
  );
}

function ListItem({ item, ordered }) {
  const content = item?.content;
  const text = content?.plaintext || '';
  const facets = content?.facets;
  const children = Array.isArray(item?.children) ? item.children : [];
  return (
    <li>
      {renderLeafletText(text, facets, { smart: true })}
      {children.length > 0 && (
        <ListBlock block={{ children }} ordered={ordered} />
      )}
    </li>
  );
}

/**
 * Embedded Bluesky post. Loads the post via the AppView `getPostThread`
 * endpoint (depth 0), through the shared cache above. On miss, renders a hint
 * linking to bsky.app so the reader can still chase the reference.
 */
function BskyPostBlock({ block, style }) {
  const uri = block?.postRef?.uri || null;
  const entry = useEmbeddedPost(uri);
  const post = entry?.post || null;

  if (!uri) return null;
  if (!entry) {
    // Shaped like the post it stands in for (byline, a few lines), so the
    // block opens at something near its size rather than as one short line.
    return (
      <div
        className="leaflet-bsky-post leaflet-bsky-post-loading"
        style={style || undefined}
        role="status"
        aria-label="Loading post"
      >
        <div className="leaflet-bsky-post-head" aria-hidden="true">
          <Skeleton width={28} height={28} />
          <Skeleton width="9rem" height="0.85em" />
        </div>
        <SkeletonText lines={3} />
      </div>
    );
  }
  if (!post) {
    return (
      <div className="leaflet-bsky-post leaflet-bsky-post-missing" style={style || undefined}>
        <a href={bskyAppUrlFromAtUri(uri)} target="_blank" rel="noreferrer noopener">
          Open the embedded post on bsky.app
        </a>
      </div>
    );
  }

  const author = post.author || {};
  const text = post.record?.text || '';
  const facets = post.record?.facets || null;
  const ts = post.record?.createdAt || post.indexedAt;
  const isMine = author.did === ME_DID;
  const localHref = isMine && post.uri ? recordPathFromAtUri(post.uri) : null;
  const externalHref = !localHref ? bskyAppUrlFromAtUri(post.uri, author.handle) : null;

  return (
    <article className="leaflet-bsky-post" data-at-uri={post.uri} style={style || undefined}>
      <header className="leaflet-bsky-post-head">
        {author.avatar && (
          <img
            className="leaflet-bsky-post-avatar"
            src={avatarThumb(author.avatar)}
            alt=""
            width={28}
            height={28}
            loading="lazy"
          />
        )}
        <div className="leaflet-bsky-post-byline">
          <span className="leaflet-bsky-post-author">
            {author.displayName && (
              <span className="leaflet-bsky-post-name">{author.displayName}</span>
            )}
            {author.handle && (
              <span className="leaflet-bsky-post-handle">@{author.handle}</span>
            )}
          </span>
          {ts && (
            <span className="leaflet-bsky-post-time gutter">
              {localHref ? (
                <Link to={localHref}><Time value={ts} variant="relative" /></Link>
              ) : externalHref ? (
                <a href={externalHref} target="_blank" rel="noreferrer noopener">
                  <Time value={ts} variant="relative" />
                </a>
              ) : (
                <Time value={ts} variant="relative" />
              )}
            </span>
          )}
        </div>
      </header>
      {/* The post's own facets — links, mentions, tags — through the same
          renderer the replies under a post use, so an embed links what they do. */}
      {text && <p className="leaflet-bsky-post-text">{renderPostText(text, facets)}</p>}
      {/* The block itself is one level into the nesting scale, so the quotes
          inside it start at two rather than repainting its own colour. */}
      {post.embed && <PostEmbed embed={post.embed} did={author.did} nest={1} />}
    </article>
  );
}

function bskyAppUrlFromAtUri(atUri, handle) {
  if (!atUri) return null;
  const m = String(atUri).match(/^at:\/\/([^/]+)\/[^/]+\/([^/?#]+)/);
  if (!m) return null;
  const who = handle || m[1];
  return `https://bsky.app/profile/${who}/post/${m[2]}`;
}

// The page owns the h1 (its title), so a document's level-1 heading reads as
// h2 and the ladder below it is unchanged.
function clampLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 2;
  return Math.min(6, Math.max(2, Math.round(n)));
}
