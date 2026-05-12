import {
  NotebookPen,
  MessageCircle,
  BookOpen,
  Headphones,
  Hammer,
} from 'lucide-react';

export const VERB_ICONS = {
  logging: NotebookPen,
  posting: MessageCircle,
  blogging: BookOpen,
  listening: Headphones,
  creating: Hammer,
};

/**
 * Small, currentColor-friendly glyph for a feed verb.
 * Defaults to the type-aligned size used by the verb column / chips.
 */
export default function VerbIcon({ verb, size = 14, strokeWidth = 1.75, ...rest }) {
  const Icon = VERB_ICONS[verb];
  if (!Icon) return null;
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" {...rest} />;
}
