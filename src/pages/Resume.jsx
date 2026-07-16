import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import { XraySubstratePanel } from '../components/XraySubstrate.jsx';
import { useXray } from '../hooks/useXray.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
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
import { atUriParts } from '../lib/xray.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './Resume.css';

const STANDARD_DOC = 'site.standard.document';

// Printed, the résumé is a formal document, so the on-screen page title
// ("Available") gives way to Dame's name — at the top of the first sheet and on
// the identity block repeated above the experience section. Screen view keeps
// the "Available" title; only the printout swaps in the name. See Resume.css
// (.resume-title-print / .resume-running-header, @media print).
const PRINT_NAME = 'Dame';

/**
 * The x-ray annotation for a resume part — names the canonical record the
 * resume version backlinks (a job / education entry), so the mode reveals
 * the site's backlinked resume model: one version curating many records.
 * Hidden until the data-xray root attribute is set; see Xray.css.
 */
function ResumeXrayTag({ nsid, atUri, note }) {
  const parts = atUriParts(atUri);
  return (
    <div className="resume-xray-tag" aria-hidden="true">
      <span className="nsid">{nsid}</span>
      {parts && <span className="uri">…/{parts.nsid}{parts.rkey}</span>}
      {note && <span className="note">{note}</span>}
      <span className="resume-xray-tag-cta">tap to inspect →</span>
    </div>
  );
}

/**
 * A resume role / education entry wrapped for x-ray: while the mode is armed it
 * recedes its prose and slides a record tag into the right margin (the ambient
 * "this is its own is.dame.resume.job record" cue). Tapping it focuses that
 * record — the tag gives way to the full you-are-here substrate panel and the
 * other entries recede — mirroring how the feed rows inspect. Outside x-ray it
 * renders as a plain `.resume-role`.
 */
function ResumeXrayRole({ atUri, nsid, note, children }) {
  const xray = useXray();
  const inspectable = xray.active && !!atUri;
  const focused = inspectable && xray.focusUri === atUri;
  return (
    <div
      className={`resume-role resume-xray${focused ? ' is-xray-focus' : ''}`}
      data-atproto={atUri ? '' : undefined}
      data-at-uri={atUri || undefined}
      onClickCapture={
        inspectable
          ? (e) => {
              // Let real links (org / institution / portfolio work) and the
              // open panel's own links through; anything else inspects.
              if (e.target.closest('a, button, .xray-substrate')) return;
              e.preventDefault();
              e.stopPropagation();
              xray.toggleFocus(atUri);
            }
          : undefined
      }
    >
      <div className="resume-xray-content">{children}</div>
      {inspectable && !focused && <ResumeXrayTag nsid={nsid} atUri={atUri} note={note} />}
      {focused && <XraySubstratePanel atUri={atUri} />}
    </div>
  );
}

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
      {item.external && item.href && (
        <span className="resume-work-ext" aria-hidden="true"><ExternalLink size={12} /></span>
      )}
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

/**
 * The résumé's identity block — title, headline, and contact line. Rendered in
 * the page header and again (print-only) above the experience section so a
 * multi-page printout carries the name + contact onto the continuation sheet.
 * On screen the title shows `screenTitle` ("Available"); in print it swaps to
 * `printName` (see the .resume-title-live/-print rules in Resume.css).
 */
function ResumeIdentity({ screenTitle, printName, headline, contact }) {
  return (
    <>
      <div>
        <h1 className="resume-title">
          <span className="resume-title-live">{screenTitle}</span>
          <span className="resume-title-print">{printName}</span>
        </h1>
        {headline && <p className="resume-headline">{headline}</p>}
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
    </>
  );
}

export default function Resume() {
  const { slug } = useParams();
  const { title: pageTitle, intro: pageIntro } = usePageContent('resume');

  const { items, status } = useLiveFeed({
    name: 'resume',
    // Paint the prebuilt /data/resume.json snapshot instantly, then confirm
    // with a live re-fetch — the resume rarely changes, so a skeleton on every
    // cold load (which 'live-first' forced, using the snapshot only on error)
    // was needless. This is what the snapshot was written for.
    strategy: 'snapshot-first',
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
          <ResumeIdentity
            screenTitle={pageTitle || 'Available'}
            printName={PRINT_NAME}
            headline={v.headline}
            contact={contact}
          />
        </header>

        {summaryHtml && (
          <section className="resume-section resume-summary">
            <div className="blog-prose" dangerouslySetInnerHTML={{ __html: summaryHtml }} />
          </section>
        )}

        {resolved.experience.length > 0 && (
          <section className="resume-section resume-experience">
            {/* Print-only: repeat the identity block above the experience so a
                multi-page printout carries the name + contact onto the second
                sheet. Hidden on screen; see .resume-running-header in the CSS. */}
            <header className="resume-header resume-running-header" aria-hidden="true">
              <ResumeIdentity
                screenTitle={pageTitle || 'Available'}
                printName={PRINT_NAME}
                headline={v.headline}
                contact={contact}
              />
            </header>
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
                    <ResumeXrayRole
                      key={role.uri}
                      atUri={role.uri}
                      nsid="is.dame.resume.job"
                      note="canonical role — the bullets live here, shared across resume versions"
                    >
                      <div className="resume-role-head">
                        <h4 className="resume-role-title">{role.title}</h4>
                        <span className="resume-role-dates gutter">{role.dateRange}</span>
                      </div>
                      <div className="resume-role-meta">
                        {[role.employmentType, role.locationType, role.location]
                          .filter(Boolean)
                          .join(' · ')}
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
                    </ResumeXrayRole>
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
                <ResumeXrayRole
                  key={e.uri}
                  atUri={e.uri}
                  nsid="is.dame.resume.education"
                  note="canonical education record"
                >
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
                </ResumeXrayRole>
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
