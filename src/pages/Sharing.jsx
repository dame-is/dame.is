import { useMemo } from 'react';
import PageShell from '../components/PageShell.jsx';
import { ProseSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, getRecord } from '../lib/atproto.js';
import { renderMarkdown } from '../lib/markdown.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/Feed.css';

export default function Sharing() {
  // The snapshot stores all pages keyed by rkey; the live fetch goes
  // directly for the single record. The mapper normalizes both into
  // the same `{uri, cid, value}` shape.
  const { items: record, status } = useLiveFeed({
    name: 'pages',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.page, rkey: 'sharing' });
    },
    mapItems: (data) => {
      if (!data) return null;
      // Snapshot shape: { home: {...}, sharing: {...}, ... }
      if (data.sharing) return data.sharing;
      // Live shape: { uri, cid, value }
      if (data.uri || data.value) return data;
      return null;
    },
  });

  const v = record?.value || {};
  const html = useMemo(() => {
    if (!v?.body) return '';
    return renderMarkdown(v.body, v.bodyFormat || 'markdown');
  }, [v]);

  return (
    <PageShell
      title={v.title || 'Sharing'}
      intro={v.intro || 'Things worth handing off.'}
      atUri={`at://${ME_DID}/is.dame.page/sharing`}
      headTitle="Sharing — Dame is&hellip;"
    >
      {status === 'loading' ? (
        <ProseSkeleton paragraphs={4} />
      ) : html ? (
        <div className="blog-prose" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="feed-empty">
          No <code>is.dame.page/sharing</code> record yet — write one and refresh.
        </p>
      )}
    </PageShell>
  );
}
