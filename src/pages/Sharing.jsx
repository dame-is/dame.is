import { useMemo } from 'react';
import PageShell from '../components/PageShell.jsx';
import { ProseSkeleton } from '../components/Skeleton.jsx';
import NotFound from './NotFound.jsx';
import { usePageContent } from '../hooks/usePageContent.js';
import { renderMarkdown } from '../lib/markdown.js';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

export default function Sharing() {
  // Title / intro / body all resolve from `is.dame.page/sharing` when present,
  // falling back to the local defaults in the page registry.
  const { title, intro, body, bodyFormat, loading, source } =
    usePageContent('sharing');
  const html = useMemo(
    () => renderMarkdown(body, bodyFormat),
    [body, bodyFormat],
  );
  const { did } = useAtprotoSession();
  const isOwner = did === ME_DID;

  // With nothing to share (no record, or one with no body yet), a visitor
  // gets the not-found page with the site's contents, not the owner's note to
  // themselves. The owner still sees the page and its hint, so it stays easy
  // to fill. /ethos redirects here, so it reads the same.
  if (!loading && !html && !isOwner) return <NotFound />;

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/sharing`}
      headTitle="dame.is sharing"
    >
      {loading ? (
        <ProseSkeleton paragraphs={4} />
      ) : html ? (
        <div className="blog-prose reveal" dangerouslySetInnerHTML={{ __html: html }} />
      ) : isOwner ? (
        <p className="feed-empty">
          {source === 'pds' ? (
            <>
              <code>is.dame.page/sharing</code> has no body yet — add one and refresh.
            </>
          ) : (
            <>
              No <code>is.dame.page/sharing</code> record yet — write one and refresh.
            </>
          )}{' '}
          Only you can see this note.
        </p>
      ) : (
        <p className="feed-empty">Nothing here yet.</p>
      )}
    </PageShell>
  );
}
