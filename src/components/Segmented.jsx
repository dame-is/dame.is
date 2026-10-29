/**
 * A segmented control (styles/controls.css .segmented): a row of mutually
 * exclusive keys, one of them always pressed. A group of toggle buttons with
 * aria-pressed rather than a radio group, because each key acts the moment
 * it's pressed and the arrow keys are left to the page.
 *
 * `options` are `{ value, label, title?, ariaLabel? }`; `value` is the pressed
 * one. Pressing the
 * pressed key calls `onChange` with it again, which a page can ignore or, as
 * the Ratioed board does, read as "reverse the order". It replaces six copies
 * of the same markup and stylesheet (listening, logging, albums, and the three
 * Ratioed switches), each of which pressed to a solid fill.
 */
export default function Segmented({ options, value, onChange, label, className = '' }) {
  return (
    <div className={`segmented ${className}`.trim()} role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            className={`segmented-key${on ? ' is-on' : ''}`}
            aria-pressed={on}
            aria-label={o.ariaLabel}
            title={o.title}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
