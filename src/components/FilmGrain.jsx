import './FilmGrain.css';

/**
 * Organic paper-and-ink texture, two cooperating halves:
 *
 * 1. Grain field — three fixed, viewport-filling layers (defined in
 *    FilmGrain.css) rendered as siblings rather than children of a
 *    wrapper: a positioned wrapper would create a stacking context,
 *    and `mix-blend-mode` on the layers could then only blend against
 *    the wrapper's transparent backdrop instead of the page itself.
 *    - "mottle": very low-frequency turbulence, soft-light blended —
 *      the large-scale unevenness of handmade paper.
 *    - "specks" (dark + light): turbulence pushed through a steep
 *      gamma curve so only sparse clusters survive as particles of
 *      varied size — silver-halide-style grain rather than the
 *      uniform per-pixel hiss a raw feTurbulence gives.
 *
 * 2. Ink roughen — the inline SVG filter below. CSS applies it to the
 *    page content and raised surfaces (see FilmGrain.css), where the
 *    high-frequency displacement nudges glyph edges by under a pixel:
 *    text reads as printed into fibrous paper instead of rendered.
 *    The <svg> must stay mounted (not display:none) or the
 *    `filter: url(#film-grain-ink)` references would go dangling and
 *    Chrome would refuse to paint the filtered elements at all.
 *
 * Visibility is gated by `html[data-grain="on"]`, so the toggle in
 * ActionDock just flips that attribute — no mount/unmount.
 */
export default function FilmGrain() {
  return (
    <>
      <svg className="film-grain-defs" aria-hidden="true" focusable="false">
        <filter id="film-grain-ink" x="-2%" y="-2%" width="104%" height="104%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="3" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.1" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div className="film-grain-layer film-grain-mottle" aria-hidden="true" />
      <div className="film-grain-layer film-grain-specks-dark" aria-hidden="true" />
      <div className="film-grain-layer film-grain-specks-light" aria-hidden="true" />
    </>
  );
}
