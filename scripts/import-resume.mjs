#!/usr/bin/env node
// Import the resume data bundle into your PDS.
//
// Reads `scripts/resume-data.json` and writes one record per job, education
// entry, and resume version under the is.dame.resume* lexicons, resolving the
// resume → job / education backlinks into AT URIs along the way.
//
// Idempotent: every record is written with `putRecord` keyed by its slug
// (`rkey`), so re-running updates records in place instead of creating
// duplicates. Edit `scripts/resume-data.json`, then re-run to sync.
//
// Usage:
//   BSKY_IDENTIFIER=dame.is BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
//     node scripts/import-resume.mjs [--data path] [--pds url] [--dry-run]
//
//   --dry-run   Resolve + print every record without writing anything.
//   --data      Path to the data bundle (default: scripts/resume-data.json).
//   --pds       Override the PDS endpoint (default: resolved from your DID).
//
// Get an app password at https://bsky.app/settings/app-passwords (or your
// PDS's equivalent). Never commit it.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtpAgent } from '@atproto/api';

import { ME_HANDLE } from '../src/config.js';
import { resolveIdentifier } from '../src/lib/atproto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const JOB_NSID = 'is.dame.resume.job';
const EDU_NSID = 'is.dame.resume.education';
const RESUME_NSID = 'is.dame.resume';

const log = (...a) => console.log('[import-resume]', ...a);
const die = (msg) => {
  console.error('[import-resume] ERROR:', msg);
  process.exit(1);
};

function parseArgs(argv) {
  const args = { dryRun: false, data: resolve(ROOT, 'scripts/resume-data.json'), pds: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--data') args.data = resolve(process.cwd(), argv[++i]);
    else if (a === '--pds') args.pds = argv[++i];
    else die(`unknown argument: ${a}`);
  }
  return args;
}

const stripUndefined = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// Build the stored highlight value from a bundle highlight, dropping defaults
// and empty fields so records stay tidy.
function highlightValue(h) {
  return stripUndefined({
    id: h.id,
    text: h.text,
    visibility: h.visibility, // omit → renderer treats as "public"
    featured: h.featured ? true : undefined,
    metric: h.metric ? true : undefined,
    tags: h.tags && h.tags.length ? h.tags : undefined,
  });
}

function jobValue(job, now) {
  return stripUndefined({
    $type: JOB_NSID,
    organization: job.organization,
    organizationUrl: job.organizationUrl,
    title: job.title,
    employmentType: job.employmentType,
    location: job.location,
    locationType: job.locationType,
    startDate: job.startDate,
    endDate: job.endDate,
    current: job.current ? true : undefined,
    summary: job.summary,
    highlights: (job.highlights || []).map(highlightValue),
    skills: job.skills && job.skills.length ? job.skills : undefined,
    createdAt: now,
    updatedAt: now,
  });
}

function educationValue(edu, now) {
  return stripUndefined({
    $type: EDU_NSID,
    institution: edu.institution,
    institutionUrl: edu.institutionUrl,
    area: edu.area,
    studyType: edu.studyType,
    location: edu.location,
    startDate: edu.startDate,
    endDate: edu.endDate,
    current: edu.current ? true : undefined,
    summary: edu.summary,
    highlights: edu.highlights && edu.highlights.length ? edu.highlights.map(highlightValue) : undefined,
    createdAt: now,
    updatedAt: now,
  });
}

function resumeValue(resume, now, atUriFor) {
  const entries = (resume.entries || []).map((e) => {
    const uri = atUriFor(JOB_NSID, e.job);
    if (!uri) die(`resume "${resume.rkey}" references unknown job "${e.job}"`);
    return stripUndefined({
      job: uri,
      highlightIds: e.highlightIds && e.highlightIds.length ? e.highlightIds : undefined,
      titleOverride: e.titleOverride,
      summaryOverride: e.summaryOverride,
    });
  });
  const education = (resume.education || []).map((e) => {
    const uri = atUriFor(EDU_NSID, e.education);
    if (!uri) die(`resume "${resume.rkey}" references unknown education "${e.education}"`);
    return stripUndefined({
      education: uri,
      highlightIds: e.highlightIds && e.highlightIds.length ? e.highlightIds : undefined,
    });
  });
  return stripUndefined({
    $type: RESUME_NSID,
    title: resume.title,
    slug: resume.slug || resume.rkey,
    headline: resume.headline,
    summary: resume.summary,
    summaryFormat: resume.summaryFormat,
    visibility: resume.visibility,
    featured: resume.featured ? true : undefined,
    entries,
    education,
    skills: resume.skills && resume.skills.length ? resume.skills : undefined,
    contact: resume.contact,
    createdAt: now,
    updatedAt: now,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const raw = await readFile(args.data, 'utf-8').catch(() => die(`cannot read data file: ${args.data}`));
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch (err) {
    return die(`data file is not valid JSON: ${err.message}`);
  }

  const jobs = bundle.jobs || [];
  const education = bundle.education || [];
  const resumes = bundle.resumes || [];
  log(`loaded ${jobs.length} job(s), ${education.length} education entr(ies), ${resumes.length} resume(s)`);

  // Verify referenced backlinks resolve before touching the network.
  const jobKeys = new Set(jobs.map((j) => j.rkey));
  const eduKeys = new Set(education.map((e) => e.rkey));
  for (const r of resumes) {
    for (const e of r.entries || []) {
      if (!jobKeys.has(e.job)) die(`resume "${r.rkey}" references unknown job rkey "${e.job}"`);
    }
    for (const e of r.education || []) {
      if (!eduKeys.has(e.education)) die(`resume "${r.rkey}" references unknown education rkey "${e.education}"`);
    }
  }

  const identifier = process.env.BSKY_IDENTIFIER || process.env.ATP_IDENTIFIER || ME_HANDLE;
  const password = process.env.BSKY_APP_PASSWORD || process.env.ATP_APP_PASSWORD;

  // Resolve identity so we can mint correct AT URIs even in --dry-run.
  let did;
  let pds = args.pds;
  try {
    const ident = await resolveIdentifier(identifier);
    did = ident.did;
    if (!pds) pds = ident.pds;
  } catch (err) {
    return die(`could not resolve identity for "${identifier}": ${err.message}`);
  }
  log(`identity: ${identifier} → ${did}`);
  log(`pds: ${pds}`);

  const atUriFor = (nsid, rkey) => `at://${did}/${nsid}/${rkey}`;
  const now = new Date().toISOString();

  // Build every record value up front (also validates backlinks resolve).
  const writes = [
    ...jobs.map((j) => ({ collection: JOB_NSID, rkey: j.rkey, value: jobValue(j, now) })),
    ...education.map((e) => ({ collection: EDU_NSID, rkey: e.rkey, value: educationValue(e, now) })),
    ...resumes.map((r) => ({ collection: RESUME_NSID, rkey: r.rkey, value: resumeValue(r, now, atUriFor) })),
  ];

  if (args.dryRun) {
    log('--dry-run: the following records would be written:\n');
    for (const w of writes) {
      console.log(`# at://${did}/${w.collection}/${w.rkey}`);
      console.log(JSON.stringify(w.value, null, 2));
      console.log();
    }
    log(`dry run complete — ${writes.length} record(s) not written.`);
    return;
  }

  if (!password) {
    die(
      'missing app password. Set BSKY_APP_PASSWORD (and optionally BSKY_IDENTIFIER). ' +
        'Create one at https://bsky.app/settings/app-passwords. Use --dry-run to preview without credentials.',
    );
  }

  const agent = new AtpAgent({ service: pds });
  try {
    await agent.login({ identifier, password });
  } catch (err) {
    return die(`login failed: ${err.message}`);
  }
  log(`signed in as ${agent.session?.handle || identifier}`);

  let ok = 0;
  for (const w of writes) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: w.collection,
        rkey: w.rkey,
        record: w.value,
        validate: false, // is.dame.* lexicons aren't published to the PDS
      });
      ok++;
      log(`✓ at://${did}/${w.collection}/${w.rkey}`);
    } catch (err) {
      console.error(`[import-resume] ✗ failed ${w.collection}/${w.rkey}: ${err.message}`);
    }
  }

  log(`done — wrote ${ok}/${writes.length} record(s).`);
  if (ok < writes.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[import-resume] fatal', err);
  process.exitCode = 1;
});
