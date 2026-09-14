// The mark a lifer wears — the first time a species turns up in the record.
//
// One component for every surface that draws an observation (the feed in both
// layouts, the /mothing grid and ledger, a night's page, a record page), so
// the words and the weight stay the same wherever a first is claimed. Which
// sightings qualify is decided in lib/firstSightings.js; this only says so.
//
// `count` lets a collapsed run speak for the sightings underneath it: a night
// at the light that turned up three new species says "3 first sightings"
// where a single row says "First sighting".

import { firstSightingLabel } from '../lib/firstSightings.js';
import './FirstSightingChip.css';

export default function FirstSightingChip({ count = 1, size = 'default' }) {
  const label = firstSightingLabel(count);
  if (!label) return null;
  return (
    <span
      className={`first-sighting small-caps${size === 'small' ? ' first-sighting-sm' : ''}`}
      title={
        count > 1
          ? `${count} species recorded here for the first time`
          : 'First time this species has been recorded here'
      }
    >
      {label}
    </span>
  );
}
