import { useEffect } from 'react';
import { useAtUri } from '../hooks/useAtUri.js';

/**
 * Injects the atmospheric <head> hints that let other AT clients discover
 * the canonical record(s) backing the current view.
 *
 *   <link rel="alternate" type="application/at-record+json" href="at://..." />
 *   <meta name="atproto:uri" content="at://..." />
 *   <meta name="atproto:cid" content="bafy..." />
 *
 * Pulls the live AT URI / CID from `useAtUri`. Pages can pass `atUri`/`cid`
 * to override (e.g. when you already know the record and want to skip the
 * route lookup).
 */
export default function AtUriHead({ atUri, cid, title }) {
  const ctx = useAtUri(atUri ? { atUri, cid } : undefined);
  const effectiveAtUri = atUri || ctx.atUri;
  const effectiveCid = cid || ctx.cid || ctx.record?.cid || null;

  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  useEffect(() => {
    const head = document.head;
    const cleanups = [];

    if (effectiveAtUri) {
      const link = document.createElement('link');
      link.rel = 'alternate';
      link.type = 'application/at-record+json';
      link.href = effectiveAtUri;
      link.dataset.atproto = 'true';
      head.appendChild(link);
      cleanups.push(() => head.removeChild(link));

      const uriMeta = document.createElement('meta');
      uriMeta.name = 'atproto:uri';
      uriMeta.content = effectiveAtUri;
      uriMeta.dataset.atproto = 'true';
      head.appendChild(uriMeta);
      cleanups.push(() => head.removeChild(uriMeta));
    }

    if (effectiveCid) {
      const cidMeta = document.createElement('meta');
      cidMeta.name = 'atproto:cid';
      cidMeta.content = effectiveCid;
      cidMeta.dataset.atproto = 'true';
      head.appendChild(cidMeta);
      cleanups.push(() => head.removeChild(cidMeta));
    }

    return () => cleanups.forEach((fn) => fn());
  }, [effectiveAtUri, effectiveCid]);

  return null;
}
