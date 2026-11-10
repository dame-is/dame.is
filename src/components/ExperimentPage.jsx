// The page round an experiment that is built into the site: its title, its
// pitch, the way back up to the bench and the way on to its reactions. What
// goes inside is the experiment itself.
//
// Such a page is not a record. What puts it on the bench is an ordinary
// `is.dame.experiment` record whose "Try it" points at `path`; when there is
// one, this finds it by that address and offers "Say what you make of it".
// Until one is posted the page only links back to the bench. See
// lexicons/EXPERIMENTING.md, "Experiments built into the site".

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import PageShell from './PageShell.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import {
  EXPERIMENTING_PATH,
  experimentForPage,
  experimentPath,
} from '../lib/experiments.js';
import { fetchExperimentRecords } from '../lib/experimentReactions.js';

export default function ExperimentPage({ path, title, intro, children }) {
  // The same read the bench itself makes: the build's snapshot, confirmed
  // against the PDS. Only the record that points here is wanted from it.
  const { items: records } = useLiveFeed({
    name: 'experimenting',
    strategy: 'snapshot-first',
    fetchLive: async () => ({ experiments: await fetchExperimentRecords() }),
    mapItems: (data) =>
      Array.isArray(data?.experiments) ? data.experiments : null,
  });
  const record = useMemo(
    () => experimentForPage(records, path),
    [records, path],
  );

  return (
    <PageShell
      title={title}
      intro={intro}
      facts={
        <>
          <span>
            <Link to={EXPERIMENTING_PATH}>An experiment</Link>
          </span>
          {record && (
            <span>
              <span aria-hidden="true"> · </span>
              <Link to={`${experimentPath(rkeyFromAtUri(record.uri))}#react`}>
                Say what you make of it
              </Link>
            </span>
          )}
        </>
      }
      headTitle={`${title} — dame.is experimenting`}
    >
      {children}
    </PageShell>
  );
}
