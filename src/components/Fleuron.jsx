import './Fleuron.css';

/**
 * The site's one ornament: the hedera ❧. It closes an essay, ends the home
 * ledger and stands in for a missing photograph, so a blank reads as a
 * printer's mark rather than an emoji or a broken-image glyph (IDN-12).
 *
 * The self-hosted Crimson Pro carries U+2767 (fonts.css keeps it in the latin
 * file), so the glyph is drawn in the house face; one component keeps it
 * swappable for a drawn mark later without touching every place that uses
 * it. Decorative, so
 * it is hidden from assistive tech: say what's missing in the surrounding
 * text instead.
 */
export default function Fleuron({ className = '' }) {
  return (
    <span className={`fleuron ${className}`.trim()} aria-hidden="true">
      &#x2767;
    </span>
  );
}
