import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { resolvePds, listRecords, explorerPathFromAtUri } from '../lib/atproto.js';
import { renderMarkdown } from '../lib/markdown.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { ResumeSkeleton } from '../components/Skeleton.jsx';
import { showOnCreating, workSlug } from '../lib/publications.js';
import { coverThumb } from '../lib/creatingHelpers.js';
import {
  resolveResume,
  pickDefaultResume,
  findResumeBySlug,
} from '../lib/resumeHelpers.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './Resume.css';

const STANDARD_DOC = 'site.standard.document';

async function fetchResumeBundle() {
  const pds = await resolvePds(ME_DID);
  const [resumes, jobs, education, docs] = await Promise.all([
    listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.resume, max: 50 }).catch(() => []),
    listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.resumeJob, max: 200 }).catch(() => []),
    listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.resumeEducation, max: 100 }).catch(() => []),
    // Portfolio posts, so a job's `work` links can render as live embeds
    // (cover + title). Blob URLs are annotated for the covers.
    listRecords(pds, { repo: ME_DID, collection: STANDARD_DOC, max: 200 }).catch(() => []),
  ]);
  transformRecords(docs, STANDARD_DOC, pds, ME_DID);
  const documents = docs.filter((r) => showOnCreating(r?.value));
  return { resumes, jobs, education, documents };
}

/** Shape one resolved link for rendering: title, href, thumbnail, external? */
function displayLink(link) {
  if (link.isWork && link.doc) {
    const slug = workSlug(link.doc);
    return {
      id: link.id,
      title: link.label || link.doc.title || slug,
      description: link.description,
      href: slug ? `/creating/${slug}` : null,
      thumb: coverThumb(link.doc),
      external: false,
    };
  }
  // External link, or a `work` ref whose post wasn't found (fall back to any url).
  const href = link.url || null;
  if (!href && !link.label) return null;
  return {
    id: link.id,
    title: link.label || href,
    description: link.description,
    href,
    thumb: null,
    external: true,
  };
}

/** "Selected work" row under a role: portfolio embeds + external links. */
function RoleWork({ links }) {
  const items = (links || []).map(displayLink).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="resume-work">
      <span className="resume-work-label small-caps">Selected work</span>
      <ul className="resume-work-list">
        {items.map((it) => (
          <li key={it.id} className={`resume-work-item${it.thumb ? ' has-thumb' : ''}`}>
            <ResumeWorkLink item={it} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResumeWorkLink({ item }) {
  const inner = (
    <>
      {item.thumb && (
        <span className="resume-work-thumb">
          <img src={item.thumb.url} alt={item.thumb.alt || ''} loading="lazy" />
        </span>
      )}
      <span className="resume-work-body">
        <span className="resume-work-title">{item.title}</span>
        {item.description && <span className="resume-work-desc">{item.description}</span>}
      </span>
      {item.external && item.href && <span className="resume-work-ext" aria-hidden="true">↗</span>}
    </>
  );
  if (!item.href) return <span className="resume-work-link is-static">{inner}</span>;
  if (item.external) {
    return (
      <a className="resume-work-link" href={item.href} target="_blank" rel="noreferrer noopener">
        {inner}
      </a>
    );
  }
  return (
    <Link className="resume-work-link" to={item.href}>
      {inner}
    </Link>
  );
}

export default function Resume() {
  const { slug } = useParams();
  const { title: pageTitle, intro: pageIntro } = usePageContent('resume');

  const { items, status } = useLiveFeed({
    name: 'resume',
    strategy: 'live-first',
    deps: [slug || ''],
    fetchLive: fetchResumeBundle,
    mapItems: (data) => (data && Array.isArray(data.resumes) ? data : null),
  });

  const resumes = items?.resumes || [];
  const resolved = useMemo(() => {
    const chosen = slug ? findResumeBySlug(resumes, slug) : pickDefaultResume(resumes);
    return chosen
      ? resolveResume(chosen, items?.jobs, items?.education, items?.documents)
      : null;
  }, [resumes, items, slug]);

  const summaryHtml = useMemo(() => {
    const v = resolved?.value;
    return v?.summary ? renderMarkdown(v.summary, v.summaryFormat || 'markdown') : '';
  }, [resolved]);

  if (status === 'loading') {
    return (
      <PageShell headTitle="dame.is available" atUri={`at://${ME_DID}/is.dame.page/resume`}>
        <ResumeSkeleton />
      </PageShell>
    );
  }

  if (!resolved) {
    return (
      <PageShell
        title={pageTitle}
        headTitle="dame.is available"
        atUri={`at://${ME_DID}/is.dame.page/resume`}
      >
        <p className="feed-empty">
          {slug ? (
            <>
              No resume version <code>{slug}</code>.{' '}
              <Link to="/available">See the default resume.</Link>
            </>
          ) : (
            'No resume published yet.'
          )}
        </p>
      </PageShell>
    );
  }

  const v = resolved.value;
  const contact = resolved.contact;

  return (
    <PageShell
      headTitle={`${v.headline || pageTitle || 'Available'} — dame.is`}
      atUri={resolved.uri}
      cid={resolved.cid}
    >
      <article className="resume reveal">
        <header className="resume-header">
          <div>
            <h1 className="resume-title">{pageTitle || 'Available'}</h1>
            {v.headline && <p className="resume-headline">{v.headline}</p>}
          </div>

          {contact && (
            <ul className="resume-contact">
              {contact.location && <li>{contact.location}</li>}
              {contact.email && (
                <li>
                  <a href={`mailto:${contact.email}`}>{contact.email}</a>
                </li>
              )}
              {(contact.links || []).map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noreferrer noopener">
                    {l.label || l.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </header>

        {summaryHtml && (
          <section className="resume-section resume-summary">
            <div className="blog-prose" dangerouslySetInnerHTML={{ __html: summaryHtml }} />
          </section>
        )}

        {resolved.experience.length > 0 && (
          <section className="resume-section">
            <h2 className="resume-section-title small-caps">Experience</h2>
            <div className="resume-orgs">
              {resolved.experience.map((org, oi) => (
                <div className="resume-org" key={`${org.organization}-${oi}`}>
                  <div className="resume-org-head">
                    <h3 className="resume-org-name">
                      {org.organizationUrl ? (
                        <a href={org.organizationUrl} target="_blank" rel="noreferrer noopener">
                          {org.organization}
                        </a>
                      ) : (
                        org.organization
                      )}
                    </h3>
                  </div>
                  {org.roles.map((role) => (
                    <div className="resume-role" key={role.uri}>
                      <div className="resume-role-head">
                        <h4 className="resume-role-title">{role.title}</h4>
                        <span className="resume-role-dates gutter">{role.dateRange}</span>
                      </div>
                      <div className="resume-role-meta">
                        {[role.employmentType, role.locationType, role.location]
                          .filter(Boolean)
                          .join(' · ')}
                        {explorerPathFromAtUri(role.uri) && (
                          <Link
                            className="resume-record-link"
                            to={explorerPathFromAtUri(role.uri)}
                            title="View the underlying job record"
                          >
                            ↗ record
                          </Link>
                        )}
                      </div>
                      {role.summary && <p className="resume-role-summary">{role.summary}</p>}
                      {role.highlights.length > 0 && (
                        <ul className="resume-highlights">
                          {role.highlights.map((h) => (
                            <li
                              key={h.refId || h.id}
                              className={`resume-highlight ${h.featured ? 'is-featured' : ''} ${
                                h.metric ? 'is-metric' : ''
                              }`}
                            >
                              {h.text}
                            </li>
                          ))}
                        </ul>
                      )}
                      <RoleWork links={role.links} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        {resolved.education.length > 0 && (
          <section className="resume-section">
            <h2 className="resume-section-title small-caps">Education</h2>
            <div className="resume-orgs">
              {resolved.education.map((e) => (
                <div className="resume-role" key={e.uri}>
                  <div className="resume-role-head">
                    <h4 className="resume-role-title">
                      {e.value.institutionUrl ? (
                        <a href={e.value.institutionUrl} target="_blank" rel="noreferrer noopener">
                          {e.value.institution}
                        </a>
                      ) : (
                        e.value.institution
                      )}
                    </h4>
                    {e.dateRange && <span className="resume-role-dates gutter">{e.dateRange}</span>}
                  </div>
                  {(e.value.studyType || e.value.area) && (
                    <p className="resume-role-summary">
                      {[e.value.studyType, e.value.area].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {e.highlights.length > 0 && (
                    <ul className="resume-highlights">
                      {e.highlights.map((h) => (
                        <li key={h.refId || h.id} className="resume-highlight">
                          {h.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {resolved.skills.length > 0 && (
          <section className="resume-section">
            <h2 className="resume-section-title small-caps">Skills</h2>
            <dl className="resume-skills">
              {resolved.skills.map((group, gi) => (
                <div className="resume-skill-group" key={group.category || gi}>
                  {group.category && <dt className="resume-skill-cat">{group.category}</dt>}
                  <dd className="resume-skill-items">
                    {(group.items || []).map((s) => (
                      <span className="resume-skill" key={s}>
                        {s}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {pageIntro && <p className="resume-footnote gutter">{pageIntro}</p>}
      </article>
    </PageShell>
  );
}
