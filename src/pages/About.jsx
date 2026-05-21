import PageShell from '../components/PageShell.jsx';
import { useProfile } from '../hooks/useProfile.js';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, getRecord } from '../lib/atproto.js';
import { renderMarkdown } from '../lib/markdown.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './About.css';

export default function About() {
  const { profile } = useProfile();
  const { items: extended } = useLiveFeed({
    name: 'extendedProfile',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return getRecord(pds, { repo: ME_DID, collection: COLLECTIONS.profile, rkey: 'self' });
    },
    mapItems: (rec) => (rec && (rec.uri || rec.value) ? rec : null),
  });

  const longBody = extended?.value?.body;
  const longFormat = extended?.value?.bodyFormat || 'markdown';
  const tagline = extended?.value?.tagline;
  const links = extended?.value?.links || [];

  const longHtml = longBody ? renderMarkdown(longBody, longFormat) : '';

  return (
    <PageShell
      title={profile?.displayName || 'About'}
      headTitle="About — Dame is…"
      atUri={`at://${ME_DID}/is.dame.profile/self`}
    >
      <section className="about-card">
        {profile?.avatar && (
          <img className="about-avatar" src={profile.avatar} alt={profile.displayName || 'Avatar'} loading="lazy" />
        )}
        <div className="about-meta">
          <h2 className="about-handle">@{profile?.handle || 'dame.is'}</h2>
          {tagline && <p className="about-tagline">{tagline}</p>}
          {profile?.description && (
            <p className="about-bio">{profile.description}</p>
          )}
          {links.length > 0 && (
            <ul className="about-links">
              {links.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noreferrer noopener">
                    {l.label || l.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {longHtml && (
        <details className="about-readmore">
          <summary>Read more</summary>
          <div
            className="blog-prose about-longform"
            dangerouslySetInnerHTML={{ __html: longHtml }}
          />
        </details>
      )}
    </PageShell>
  );
}
