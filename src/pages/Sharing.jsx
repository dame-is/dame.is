import { useEffect, useMemo, useState } from 'react';
import PageShell from '../components/PageShell.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { renderMarkdown } from '../lib/markdown.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

export default function Sharing() {
  const [record, setRecord] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot('pages').then((pages) => {
      if (cancelled) return;
      if (pages && pages.sharing) setRecord(pages.sharing);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      {html ? (
        <div className="blog-prose" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="feed-empty">
          No <code>is.dame.page/sharing</code> record yet — write one and refresh.
        </p>
      )}
    </PageShell>
  );
}
