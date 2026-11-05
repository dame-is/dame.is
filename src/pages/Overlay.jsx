// /overlay/:id — one stream overlay, for an OBS browser source (or any
// streaming tool that composites a web page over the stream; stream.place
// takes what OBS sends it, so this is how an overlay reaches stream.place).
//
// It is the canvas and nothing else: no chrome, no dock, a transparent page,
// scaled to whatever size the source is (set it to 1920x1080 for a 1:1).
// The overlay is is.dame.overlay/{id}, read from the PDS with no sign-in, and
// it follows saves live two ways: the Jetstream socket that also carries the
// chat hears the save within a second or two, and the shared 30s refresh tick
// re-reads the record whenever the repo head has moved, in case the socket
// is down.
//
// The address takes two extras, for this browser source only:
//
//   ?hour=19   paint it in this Eastern hour's sky, whatever the record says
//   ?demo      fill the live widgets with examples, for lining it up in OBS
//
// App.jsx renders this OUTSIDE the site's providers and chrome, so nothing
// here may use a hook that needs one.

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import OverlayCanvas from '../overlay/OverlayCanvas.jsx';
import { getRecord, getRepoRev, isRecordNotFound, listRecords, resolvePds, resolveProfiles } from '../lib/atproto.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import { easternHour } from '../lib/time.js';
import { CANVAS_H, CANVAS_W, OVERLAY_NSID, fromRecord, isOverlayId } from '../lib/overlay.js';
import {
  BLOCK,
  CHAT_EMPTY,
  blockedDids,
  chatReducer,
  listenStream,
} from '../lib/overlayStream.js';
import { ME_DID } from '../config.js';

const BLOCKS_MS = 10 * 60_000;

/** The Eastern hour, kept current to the minute. */
function useEasternHour() {
  const [hour, setHour] = useState(() => easternHour());
  useEffect(() => {
    const id = window.setInterval(() => setHour(easternHour()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return hour;
}

/** The scale that fits the canvas in the window, and where it sits. */
function useFit() {
  const read = () => {
    const w = window.innerWidth || CANVAS_W;
    const h = window.innerHeight || CANVAS_H;
    const scale = Math.min(w / CANVAS_W, h / CANVAS_H);
    return { scale, x: (w - CANVAS_W * scale) / 2, y: (h - CANVAS_H * scale) / 2 };
  };
  const [fit, setFit] = useState(read);
  useEffect(() => {
    const on = () => setFit(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return fit;
}

export default function Overlay() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const demo = params.has('demo') && !/^(off|no|false|0)$/i.test(params.get('demo') || '');
  const hourParam = Number(params.get('hour'));
  const fixedHour = params.get('hour') !== null && Number.isInteger(hourParam) && hourParam >= 0 && hourParam <= 23 ? hourParam : null;

  const [config, setConfig] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | missing | error
  const [chat, dispatch] = useReducer(chatReducer, CHAT_EMPTY);
  const [names, setNames] = useState({});
  const asked = useRef(new Set());
  const clockHour = useEasternHour();
  const fit = useFit();
  const valid = isOverlayId(id);

  // The page is see-through for as long as it is up.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-overlay', '');
    return () => root.removeAttribute('data-overlay');
  }, []);

  // The record: read once, then again whenever the repo head moves.
  useEffect(() => {
    if (!valid) {
      setState('missing');
      return undefined;
    }
    let cancelled = false;
    let lastRev = null;
    async function read() {
      try {
        const rev = await getRepoRev(ME_DID).catch(() => null);
        if (rev && rev === lastRev) return;
        const pds = await resolvePds(ME_DID);
        const res = await getRecord(pds, { repo: ME_DID, collection: OVERLAY_NSID, rkey: id });
        if (cancelled) return;
        lastRev = rev;
        setConfig(fromRecord(res?.value));
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        const missing = isRecordNotFound(err);
        // A blip after a good read keeps the overlay on screen as it was.
        setState((s) => (s === 'ready' ? s : missing ? 'missing' : 'error'));
      }
    }
    read();
    const unsubscribe = subscribeRefreshTick(read);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id, valid]);

  // The stream: chat, and saves to this overlay.
  useEffect(() => {
    if (!valid) return undefined;
    return listenStream(ME_DID, {
      onEvent: (e) => {
        if (e.type === 'overlay') {
          if (e.rkey === id) {
            setConfig(fromRecord(e.value));
            setState('ready');
          }
          return;
        }
        if (e.type === 'unoverlay') return;
        dispatch(e);
      },
    });
  }, [id, valid]);

  const hasChat = Boolean(config?.widgets.some((w) => w.kind === 'chat'));

  // Whoever dame has blocked stays off screen, as stream.place keeps them out
  // of its own chat.
  useEffect(() => {
    if (!hasChat) return undefined;
    let cancelled = false;
    async function read() {
      try {
        const pds = await resolvePds(ME_DID);
        const recs = await listRecords(pds, { repo: ME_DID, collection: BLOCK, max: 2000 });
        if (!cancelled) dispatch({ type: 'blocked', blocked: blockedDids(recs) });
      } catch {
        /* keep the list we had */
      }
    }
    read();
    const t = window.setInterval(read, BLOCKS_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [hasChat]);

  // Handles for whoever is chatting, asked for once each.
  useEffect(() => {
    const fresh = chat.messages.map((m) => m.did).filter((d) => !asked.current.has(d));
    if (!fresh.length) return;
    for (const d of fresh) asked.current.add(d);
    resolveProfiles(fresh).then((found) => {
      setNames((prev) => {
        const next = { ...prev };
        for (const [did, p] of Object.entries(found)) if (p.handle && p.handle !== 'handle.invalid') next[did] = p.handle;
        return next;
      });
    });
  }, [chat.messages]);

  const lines = useMemo(
    () => chat.messages.map((m) => ({ id: m.id, handle: names[m.did] || '', text: m.text })),
    [chat.messages, names],
  );

  const hour = fixedHour ?? config?.hour ?? clockHour;

  if (state === 'missing' || state === 'error') {
    return (
      <div className="ov-page">
        <p className="ov-page-note">
          {state === 'missing'
            ? `There is no overlay called “${id}” on dame.is. Make one in the admin’s Overlays studio.`
            : 'The overlay could not be read just now. It will keep trying.'}
        </p>
      </div>
    );
  }
  if (!config) return <div className="ov-page" />;

  return (
    <div className="ov-page">
      <div style={{ transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`, transformOrigin: '0 0' }}>
        <OverlayCanvas config={config} hour={hour} demo={demo} chat={lines} />
      </div>
    </div>
  );
}
