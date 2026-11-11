// The page round an experiment that is built into the site: its title, its
// pitch, the way back up to the bench and the way on to its reactions. What
// goes inside is the experiment itself.
//
// Such a page is not a record. What puts it on the bench is an ordinary
// `is.dame.experiment` record whose "Try it" points at `path`; when there is
// one, this finds it by that address and offers "Say what you make of it".
// Until one is posted the page only links back to the bench. See
// lexicons/EXPERIMENTING.md, "Experiments built into the site".
//
// An experiment that takes the whole window (a game) has no page round it and
// doesn't use this: see pages/Sunfarming.jsx.

import { Link } from 'react-router-dom';
import PageShell from './PageShell.jsx';
import { useExperimentForPage } from '../hooks/useExperimentForPage.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { EXPERIMENTING_PATH, experimentPath } from '../lib/experiments.js';

export default function ExperimentPage({ path, title, intro, children }) {
  const record = useExperimentForPage(path);

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
