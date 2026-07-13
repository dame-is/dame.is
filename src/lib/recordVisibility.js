// How each collection expresses "hidden from the public site", so the admin
// record list can flag hidden records with a chip and flip their visibility in
// bulk. Every PDS record is technically public — this is *site display intent*,
// the same notion the public surfaces already honor:
//
//   - site.standard.document → `draft: true` keeps a work off /creating and
//     /blogging (see lib/publications.js `isDraft`).
//   - is.dame.arena.channel  → `enabled: false` pulls a gallery off /curating
//     (see pages/Curating.jsx, pages/CuratingChannel.jsx).
//   - is.dame.hero.phrase    → `enabled: false` drops a phrase from the home
//     hero rotation (see components/HeroSentence.jsx).
//   - is.dame.resume         → `visibility` other than "public" keeps a resume
//     off the listed /for-hire surface (see lib/resumeHelpers.js).
//
// Collections without a visibility concept (logging, posting, profile, …)
// return null and simply get no chip or hide/unhide controls.

import { COLLECTIONS } from '../config.js';

const STANDARD_DOC = 'site.standard.document';

const MODELS = {
  [STANDARD_DOC]: {
    isHidden: (v) => v?.draft === true,
    chipLabel: () => 'draft',
    setHidden: (v, hidden) => {
      const next = { ...v };
      if (hidden) next.draft = true;
      else delete next.draft;
      return next;
    },
  },

  [COLLECTIONS.arenaChannel]: {
    isHidden: (v) => v?.enabled === false,
    chipLabel: () => 'hidden',
    setHidden: (v, hidden) => ({ ...v, enabled: !hidden }),
  },

  [COLLECTIONS.heroPhrase]: {
    isHidden: (v) => v?.enabled === false,
    chipLabel: () => 'disabled',
    setHidden: (v, hidden) => ({ ...v, enabled: !hidden }),
  },

  [COLLECTIONS.resume]: {
    // Match the admin resume selector's convention: a missing visibility reads
    // as private. Anything short of "public" counts as hidden from the listing.
    isHidden: (v) => (v?.visibility || 'private') !== 'public',
    chipLabel: (v) => v?.visibility || 'private',
    // Hiding forces private; unhiding promotes to public. The three-state
    // "unlisted" middle ground stays reachable through the full editor.
    setHidden: (v, hidden) => ({ ...v, visibility: hidden ? 'private' : 'public' }),
  },
};

/**
 * The visibility model for a collection, or null when the collection has no
 * public-visibility concept. A model is `{ isHidden, chipLabel, setHidden }`:
 *
 *   - isHidden(value)          → is this record hidden from the site?
 *   - chipLabel(value)         → short word for the status chip (e.g. "draft")
 *   - setHidden(value, hidden) → a new record value with the flag applied
 *                                (shallow copy; callers pass a plain object)
 */
export function visibilityModelFor(collection) {
  return MODELS[collection] || null;
}
