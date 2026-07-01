import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { CreatingGridSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import {
  fetchChannelMeta,
  fetchChannelPage,
  normalizeBlock,
  arenaChannelUrl,
} from '../lib/arena.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './Creating.css';
import './Curating.css';

/**
 * Which galleries exist is an `is.dame.arena.channel` record per channel
 * (rkey = site slug); the images themselves live on are.na. The live pass
 * re-reads the records, refreshes each channel's title/description/count
 * from the are.na API, and reuses the snapshot's cover so it costs one
 * request per channel (plus one page fetch for channels added since the
 * last build).
 */
async function loadGalleries() {
  const pds = await resolvePds(ME_DID);
  const records = await listRecords(pds, {
    repo: ME_DID,
    collection: COLLECTIONS.arenaChannel,
    max: 100,
  });
  const enabled = records
    .map((r) => ({ rkey: rkeyFromAtUri(r.uri), value: r.value || {} }))
    .filter((g) => g.rkey && g.value.arenaSlug && g.value.enabled !== false)
    .sort((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0));

  const snapCovers = await fetchSnapshot('curating')
    .then((s) => new Map((s?.galleries || []).map((g) => [g.slug, g.cover])))
    .catch(() => new Map());

  const galleries = [];
  for (const g of enabled) {
    try {
      const meta = await fetchChannelMeta(g.value.arenaSlug);
      let cover = snapCovers.get(g.rkey) || null;
      if (!cover) {
        const page = await fetchChannelPage(g.value.arenaSlug, 1, 10);
        cover = (page?.data || []).map(normalizeBlock).find(Boolean)?.thumb || null;
      }
      galleries.push({
        slug: g.rkey,
        arenaSlug: g.value.arenaSlug,
        title: g.value.title || meta?.title || g.rkey,
        description: g.value.description || meta?.description || '',
        blockCount: meta?.counts?.blocks ?? null,
        arenaUrl: arenaChannelUrl(g.value.arenaSlug),
        cover,
        order: g.value.order ?? 0,
      });
    } catch {
      // A channel that fails live just keeps its snapshot presence (if any).
    }
  }
  return { galleries };
}

export default function Curating() {
  const { title, intro } = usePageContent('curating');

  const { items: galleries, status } = useLiveFeed({
    strategy: 'snapshot-first',
    name: 'curating',
    fetchLive: loadGalleries,
    mapItems: (d) => (Array.isArray(d?.galleries) ? d.galleries : null),
  });

  const loading = status === 'loading';
  const list = galleries || [];

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/curating`}
      headTitle="Curating — Dame is&hellip;"
    >
      {loading ? (
        <CreatingGridSkeleton cells={6} />
      ) : list.length === 0 ? (
        <p className="feed-empty">No galleries yet.</p>
      ) : (
        <ul className="creating-grid reveal-stagger">
          {list.map((g) => (
            <li key={g.slug} className="creating-grid-cell">
              <Link to={`/curating/${g.slug}`} className="creating-grid-link">
                {g.cover?.src ? (
                  <img
                    src={g.cover.src}
                    srcSet={g.cover.src2x ? `${g.cover.src2x} 2x` : undefined}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="creating-grid-placeholder" aria-hidden="true">&#x273A;</div>
                )}
                <div className="creating-grid-meta">
                  <span className="small-caps creating-grid-kind">are.na</span>
                  <h3 className="creating-grid-title">{g.title}</h3>
                  {g.blockCount != null && (
                    <span className="gutter">{g.blockCount} blocks</span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
