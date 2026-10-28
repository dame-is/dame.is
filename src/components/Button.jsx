import { forwardRef } from 'react';

/**
 * The site's one button (styles/controls.css). Four tiers on one base:
 *   variant 'quiet' (default) · 'primary' (one per view) · 'text' · 'icon'
 * and two sizes, 'md' (default) and 'sm' (28px, for record actions and an
 * in-table "more"). `on` gives it the shared selected look. Renders a
 * <button type="button"> unless `as` names something else, such as
 * react-router's Link or 'a', which then takes its own props (`to`, `href`).
 *
 * The classes work without it too: <a className="btn btn--sm">.
 */
const Button = forwardRef(function Button(
  { as: Comp = 'button', variant = 'quiet', size = 'md', on = false, className = '', type, ...rest },
  ref,
) {
  const cls = buttonClass({ variant, size, on, className });
  const typeProp = Comp === 'button' ? { type: type || 'button' } : type ? { type } : null;
  return <Comp ref={ref} className={cls} {...typeProp} {...rest} />;
});

export default Button;

/** The class string for a tier, for markup that can't use the component. */
export function buttonClass({ variant = 'quiet', size = 'md', on = false, className = '' } = {}) {
  return [
    'btn',
    variant !== 'quiet' && `btn--${variant}`,
    size === 'sm' && 'btn--sm',
    on && 'is-on',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}
