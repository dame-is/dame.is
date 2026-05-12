import { useEffect, useState } from 'react';
import PageShell from '../components/PageShell.jsx';
import { useProfile } from '../hooks/useProfile.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { renderMarkdown } from '../lib/markdown.js';
import { ME_DID } from '../config.js';
import './About.css';

export default function About() {
  const { profile } = useProfile();
  const [extended, setExtended] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot('extendedProfile').then((rec) => {
      if (cancelled) return;
      if (rec && (rec.uri || rec.value)) setExtended(rec);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const longBody = extended?.value?.body;
  const longFormat = extended?.value?.bodyFormat || 'markdown';
  const tagline = extended?.value?.tagline;
  const links = extended?.value?.links || [];

  const longHtml = longBody ? renderMarkdown(longBody, longFormat) : '';

  return (
    <PageShell
      verb="introducing"
      title={<><span className="gerund">Dame is&hellip;</span> {profile?.displayName || 'Dame'}</>}
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
