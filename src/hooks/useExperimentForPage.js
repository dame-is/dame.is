// The experiment record that points at a page of this site.
//
// An experiment built into the site is not a record. What puts it on the
// bench is an ordinary `is.dame.experiment` record whose "Try it" is the
// page's address, and this finds that record by the address: the same read
// the bench itself makes (the build's snapshot, confirmed against the PDS),
// with only the one record wanted from it. Null until one has been posted.
// See lexicons/EXPERIMENTING.md, "Experiments built into the site".

import { useMemo } from 'react';
import { useLiveFeed } from './useLiveFeed.js';
import { experimentForPage } from '../lib/experiments.js';
import { fetchExperimentRecords } from '../lib/experimentReactions.js';

export function useExperimentForPage(path) {
  const { items: records } = useLiveFeed({
    name: 'experimenting',
    strategy: 'snapshot-first',
    fetchLive: async () => ({ experiments: await fetchExperimentRecords() }),
    mapItems: (data) =>
      Array.isArray(data?.experiments) ? data.experiments : null,
  });
  return useMemo(() => experimentForPage(records, path), [records, path]);
}
