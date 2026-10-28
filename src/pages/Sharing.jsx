import { useMemo } from 'react';
import PageShell from '../components/PageShell.jsx';
import { ProseSkeleton } from '../components/Skeleton.jsx';
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
  // The authoring hint is for the owner, signed in; a visitor just sees that
  // there's nothing here yet. (It used to tell everyone to go and write a
  // record — and claimed there wasn't one when the record existed with an
  // empty body.)
  const { did } = useAtprotoSession();
  const isOwner = did === ME_DID;

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
          )}
        </p>
      ) : (
        <p className="feed-empty">Nothing here yet.</p>
      )}
    </PageShell>
  );
}
