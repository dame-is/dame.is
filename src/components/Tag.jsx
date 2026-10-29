/**
 * A record's state where it's listed (styles/controls.css .tag): draft,
 * private, on PDS, connected. `on` gives a live state the shared selected
 * look; `tone="danger"` marks a state that warns, such as an entry the
 * language filter hid. A tag never does anything; an action is a Button.
 */
export default function Tag({ on = false, tone, className = '', children, ...rest }) {
  const cls = ['tag', tone === 'danger' && 'tag--danger', on && 'is-on', className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
