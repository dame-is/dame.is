import PageShell from '../components/PageShell.jsx';
import { ProseSkeleton } from '../components/Skeleton.jsx';
import { usePageContent } from '../hooks/usePageContent.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

export default function Sharing() {
  // Title / intro / body all resolve from `is.dame.page/sharing` when present,
  // falling back to the local defaults in the page registry.
  const { title, intro, html, loading } = usePageContent('sharing');

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
      ) : (
        <p className="feed-empty">
          No <code>is.dame.page/sharing</code> record yet — write one and refresh.
        </p>
      )}
    </PageShell>
  );
}
