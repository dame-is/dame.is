import {
  NotebookPen,
  MessageCircle,
  BookOpen,
  Headphones,
  Hammer,
  Heart,
  Repeat2,
  UserPlus,
  ListChecks,
  Rss,
  MessagesSquare,
  FlaskConical,
  Camera,
  FileText,
  Bug,
  Binoculars,
} from 'lucide-react';
import { verbConfig } from '../lib/verbRegistry.js';

/**
 * Lookup table from lucide icon name (string in the registry) to the
 * actual component. Adding a new icon means importing it above and
 * registering it here.
 */
const LUCIDE_BY_NAME = {
  NotebookPen,
  MessageCircle,
  BookOpen,
  Headphones,
  Hammer,
  Heart,
  Repeat2,
  UserPlus,
  ListChecks,
  Rss,
  MessagesSquare,
  FlaskConical,
  Camera,
  FileText,
  Bug,
  Binoculars,
};

/**
 * Public legacy export: { verb -> Icon component } for any code that wants
 * to render an icon without going through this component.
 */
export const VERB_ICONS = new Proxy({}, {
  get(_, verb) {
    const cfg = verbConfig(verb);
    return cfg ? LUCIDE_BY_NAME[cfg.icon] || null : null;
  },
});

/**
 * Small, currentColor-friendly glyph for a feed verb. Defaults to the
 * type-aligned size used by the verb column / chips. The verb-to-icon
 * mapping lives in `src/lib/verbRegistry.js`; add new verbs there.
 */
export default function VerbIcon({ verb, size = 14, strokeWidth = 1.75, ...rest }) {
  const cfg = verbConfig(verb);
  const Icon = cfg ? LUCIDE_BY_NAME[cfg.icon] : null;
  if (!Icon) return null;
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" {...rest} />;
}
