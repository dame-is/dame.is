import './FilmGrain.css';

/**
 * Organic paper-and-ink texture, two cooperating halves:
 *
 * 1. Paper grain — painted entirely in CSS as multi-layer
 *    background-image on <body> (see FilmGrain.css): a soft-light
 *    mottle like uneven paper stock under two fields of fine, crisp
 *    specks. Living on the body background makes it by definition
 *    sit behind all content — text, images, and surfaces stay clean
 *    on top — and it renders identically in every engine (an earlier
 *    fixed-overlay version painted fine in Chromium but iOS WebKit
 *    hid it). Raised opaque surfaces (chrome bars, modal panels) get
 *    a faint speck pass of their own via pseudo-elements.
 *
 * 2. Ink roughen — the inline SVG filter below. CSS applies it to
 *    every text-bearing building block (prose elements, feed items,
 *    cards, hero, footer, chrome-bar rows, modals — each a small,
 *    independently cached filter region; one whole-page filter costs
 *    ~40fps of scroll). The high-frequency displacement nudges glyph
 *    edges by about a pixel: text reads as printed into fibrous
 *    paper. The <svg> must stay mounted (not display:none) or the
 *    `filter: url(#film-grain-ink)` references would go dangling and
 *    Chrome would refuse to paint the filtered elements at all.
 *
 * Visibility is gated by `html[data-grain="on"]`, so the toggle in
 * ActionDock just flips that attribute — no mount/unmount.
 */
export default function FilmGrain() {
  return (
    <svg className="film-grain-defs" aria-hidden="true" focusable="false">
      <filter id="film-grain-ink" x="-2%" y="-2%" width="104%" height="104%">
        <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="3" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.1" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
