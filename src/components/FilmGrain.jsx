import './FilmGrain.css';

/**
 * Fixed-position SVG-noise overlay that sits above all page content and
 * blends into it via `mix-blend-mode: soft-light`. The blend means the
 * noise darkens light areas and lightens dark areas — same way real film
 * grain reads as part of the substrate, not a film stuck on top.
 *
 * Two stacked layers (one finer, one coarser) at offset scales break up
 * the regularity of a single-frequency turbulence so the grain looks
 * organic rather than digital.
 *
 * Visibility is gated by `html[data-grain="on"]` (see FilmGrain.css), so
 * the toggle in ActionDock just flips that attribute — no mount/unmount.
 *
 * Raised surfaces (chrome bars, modal panels, etc.) get a second, finer
 * grain via `::before` pseudo-elements so they don't look like flat
 * cutouts on a grainy page. See `.film-grain-surface` in the CSS.
 */
export default function FilmGrain() {
  return (
    <div className="film-grain" aria-hidden="true">
      <div className="film-grain-layer film-grain-fine" />
      <div className="film-grain-layer film-grain-coarse" />
    </div>
  );
}
