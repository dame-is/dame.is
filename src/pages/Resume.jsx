import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { resolvePds, listRecords, explorerPathFromAtUri } from '../lib/atproto.js';
import { renderMarkdown } from '../lib/markdown.js';
import {
  resolveResume,
  pickDefaultResume,
  findResumeBySlug,
  listPublicResumes,
} from '../lib/resumeHelpers.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './Resume.css';

async function fetchResumeBundle() {
  const pds = await resolvePds(ME_DID);
  const [resumes, jobs, education] = await Promise.all([
    listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.resume, max: 50 }).catch(() => []),
    listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.resumeJob, max: 200 }).catch(() => []),
    listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.resumeEducation, max: 100 }).catch(() => []),
  ]);
  return { resumes, jobs, education };
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
    return chosen ? resolveResume(chosen, items?.jobs, items?.education) : null;
  }, [resumes, items, slug]);

  const versions = useMemo(() => listPublicResumes(resumes), [resumes]);

  const summaryHtml = useMemo(() => {
    const v = resolved?.value;
    return v?.summary ? renderMarkdown(v.summary, v.summaryFormat || 'markdown') : '';
  }, [resolved]);

  if (status === 'loading') {
    return (
      <PageShell headTitle="dame.is for hire" atUri={`at://${ME_DID}/is.dame.page/resume`}>
        <p className="placeholder-card">Loading resume…</p>
      </PageShell>
    );
  }

  if (!resolved) {
    return (
      <PageShell
        title={pageTitle}
        headTitle="dame.is for hire"
        atUri={`at://${ME_DID}/is.dame.page/resume`}
      >
        <p className="feed-empty">
          {slug ? (
            <>
              No resume version <code>{slug}</code>.{' '}
              <Link to="/for-hire">See the default resume.</Link>
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
      headTitle={`${v.headline || pageTitle || 'For hire'} — dame.is`}
      atUri={resolved.uri}
      cid={resolved.cid}
    >
      <article className="resume reveal">
        <header className="resume-header">
          <div className="resume-headline-row">
            <div>
              <h1 className="resume-title">{pageTitle || 'For hire'}</h1>
              {v.headline && <p className="resume-headline">{v.headline}</p>}
            </div>
            <button
              type="button"
              className="resume-print-btn"
              onClick={() => window.print()}
              aria-label="Print this resume"
              title="Print / save as PDF"
            >
              <Printer size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>Print</span>
            </button>
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

          {versions.length > 1 && (
            <nav className="resume-versions" aria-label="Resume versions">
              <span className="small-caps">Versions</span>
              {versions.map((r) => {
                const s = r.value.slug;
                const active = s === resolved.slug;
                return (
                  <Link
                    key={r.uri}
                    to={`/for-hire/${s}`}
                    className={`resume-version-chip ${active ? 'is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    {r.value.title || s}
                  </Link>
                );
              })}
            </nav>
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
                              key={h.id}
                              className={`resume-highlight ${h.featured ? 'is-featured' : ''} ${
                                h.metric ? 'is-metric' : ''
                              }`}
                            >
                              {h.text}
                            </li>
                          ))}
                        </ul>
                      )}
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
                        <li key={h.id} className="resume-highlight">
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
