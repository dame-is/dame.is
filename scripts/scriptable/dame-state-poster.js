// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: heartbeat;
//
// dame.is — "state" poster for the Scriptable app (https://scriptable.app)
// ---------------------------------------------------------------------------
// Writes Dame's current physical + ambient state to the AT Protocol PDS:
//   • is.dame.state/self       — the live singleton (overwritten each run;
//                                 the site's atmosphere-bar vitals panel reads it)
//   • is.dame.state.sample     — an append-only history record (for charts later)
//
// It does NOT read the sensors itself — HealthKit heart rate / active energy,
// the ambient sound level, and CoreMotion activity all come from an Apple
// SHORTCUT, which gathers them and hands this script the values. See the
// "Shortcut" section in README.md for the exact Shortcuts actions.
//
// The Shortcut passes a dictionary as the script input; this script reads it
// from `args.shortcutParameter`, coerces the string values to typed ones, and
// writes both records. Credentials live in the device Keychain (shared with
// dame-now-widget.js), never in this file.
//
// SETUP
//   1. Install Scriptable from the App Store.
//   2. Scriptable → + (new script) → paste this whole file. Name it
//      "dame.is state" (the Shortcut references it by this name).
//   3. Build the companion Shortcut (README.md → "Shortcut"), whose last step
//      is: Run Script "dame.is state" with the assembled dictionary as input.
//   4. First run prompts once for your handle + app password (+ optional deploy
//      hook); they're saved to the Keychain.
//
//   Press ▶ in the editor to post a test sample with placeholder values.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // the repo we write to
const STATE_COLLECTION = 'is.dame.state';
const SAMPLE_COLLECTION = 'is.dame.state.sample';

const PLC_DIRECTORY = 'https://plc.directory';
const PDS_FALLBACK = 'https://pds.atpota.to';

// Keychain keys — shared with dame-now-widget.js so credentials are entered
// once and reused across both scripts.
const KEY_ID = 'dame.now.identifier';
const KEY_PW = 'dame.now.appPassword';
const KEY_HOOK = 'dame.now.deployHook';

// Optional in-script credentials. LEAVE EMPTY in the committed file — filling
// them in and pushing would leak your app password. Fill them only in your
// on-device copy if you'd rather not use the Keychain (note: re-pasting the
// script from the repo overwrites them, whereas Keychain values survive).
const LOCAL = { identifier: '', appPassword: '', deployHook: '' };

// Known CoreMotion activity classes → the lexicon's lowercased enum. Anything
// unrecognized falls through to 'unknown'.
const ACTIVITY_MAP = {
  stationary: 'stationary',
  walking: 'walking',
  running: 'running',
  cycling: 'cycling',
  automotive: 'automotive',
  driving: 'automotive',
};

// ---------------------------------------------------------------------------
// Coercion — Shortcuts stringifies everything, so normalize hard here.
// Accepts BOTH the raw iPhone keys (environmentSound, isCharging, …) and the
// already-normalized lexicon keys, so the Shortcut can forward its dict as-is.
// ---------------------------------------------------------------------------

function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (['yes', 'true', '1', 'on', 'charging'].includes(s)) return true;
  if (['no', 'false', '0', 'off', 'unplugged'].includes(s)) return false;
  return null;
}

function toActivity(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return ACTIVITY_MAP[s] || 'unknown';
}

function clampPct(n) {
  if (n === null) return null;
  return Math.max(0, Math.min(100, n));
}

// Build the lexicon record body from whatever the Shortcut handed us. Only
// includes fields that are actually present, so a missing sensor (e.g. no
// watch → no heart rate) is simply absent rather than a bogus 0.
function buildRecord(input, $type, nowIso) {
  const pick = (...keys) => {
    for (const k of keys) if (input[k] !== undefined && input[k] !== '') return input[k];
    return undefined;
  };
  const rec = { $type, createdAt: nowIso, capturedAt: nowIso };
  const heartRate = toInt(pick('heartRate', 'heart_rate', 'hr'));
  const activity = toActivity(pick('activity', 'physicalActivity', 'motion'));
  const batteryLevel = clampPct(toInt(pick('batteryLevel', 'battery', 'batteryPercent')));
  const charging = toBool(pick('charging', 'isCharging'));
  const soundLevel = toInt(pick('soundLevel', 'environmentSound', 'ambientDb', 'sound'));
  const caloriesBurned = toInt(pick('caloriesBurned', 'activeEnergy', 'calories'));

  if (heartRate !== null) rec.heartRate = heartRate;
  if (activity) rec.activity = activity;
  if (batteryLevel !== null) rec.batteryLevel = batteryLevel;
  if (charging !== null) rec.charging = charging;
  if (soundLevel !== null) rec.soundLevel = soundLevel;
  if (caloriesBurned !== null) rec.caloriesBurned = caloriesBurned;
  return rec;
}

// ---------------------------------------------------------------------------
// AT Protocol helpers — plain fetch + JSON (no SDK, no URLSearchParams).
// ---------------------------------------------------------------------------

async function getJson(url) {
  const req = new Request(url);
  req.timeoutInterval = 15;
  req.headers = { Accept: 'application/json' };
  return req.loadJSON();
}

async function postJson(url, body, jwt) {
  const req = new Request(url);
  req.method = 'POST';
  req.headers = {
    'Content-Type': 'application/json',
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
  };
  req.body = JSON.stringify(body);
  return (await req.loadJSON()) || {};
}

async function resolvePds(did) {
  try {
    const doc = await getJson(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`);
    const services = (doc && doc.service) || [];
    const svc = services.find((s) => s.id === '#atproto_pds') || services[0];
    if (svc && svc.serviceEndpoint) return svc.serviceEndpoint.replace(/\/$/, '');
  } catch (_) {
    // fall through to the last-known PDS
  }
  return PDS_FALLBACK;
}

async function createSession(pds, identifier, password) {
  const res = await postJson(`${pds}/xrpc/com.atproto.server.createSession`, {
    identifier,
    password,
  });
  if (!res.accessJwt || !res.did) {
    throw new Error(res.message || res.error || 'sign-in failed');
  }
  return res;
}

// Overwrite the singleton at .../is.dame.state/self.
async function putSelf(pds, jwt, did, record) {
  const res = await postJson(
    `${pds}/xrpc/com.atproto.repo.putRecord`,
    { repo: did, collection: STATE_COLLECTION, rkey: 'self', record },
    jwt,
  );
  if (!res.uri) throw new Error(res.message || res.error || 'putRecord failed');
  return res;
}

// Append a history sample (TID rkey, assigned by the PDS).
async function createSample(pds, jwt, did, record) {
  const res = await postJson(
    `${pds}/xrpc/com.atproto.repo.createRecord`,
    { repo: did, collection: SAMPLE_COLLECTION, record },
    jwt,
  );
  if (!res.uri) throw new Error(res.message || res.error || 'createRecord failed');
  return res;
}

async function pingHook(url) {
  const req = new Request(url);
  req.method = 'POST';
  await req.load();
}

// ---------------------------------------------------------------------------
// Credentials — Keychain, shared with the now-widget.
// ---------------------------------------------------------------------------

function readKeychain(key) {
  return Keychain.contains(key) ? Keychain.get(key) : '';
}

async function ensureCreds() {
  if (LOCAL.identifier && LOCAL.appPassword) {
    return { identifier: LOCAL.identifier, password: LOCAL.appPassword, hook: LOCAL.deployHook || '' };
  }
  const identifier = readKeychain(KEY_ID);
  const password = readKeychain(KEY_PW);
  if (identifier && password) {
    return { identifier, password, hook: readKeychain(KEY_HOOK) };
  }
  const a = new Alert();
  a.title = 'Set up dame.is posting';
  a.message =
    "Stored only in this device's Keychain — never in the script or repo. " +
    'Create an app password at bsky.app → Settings → App Passwords (enable write access).';
  a.addTextField('handle or email', identifier || 'dame.is');
  a.addSecureTextField('app password (xxxx-xxxx-xxxx-xxxx)', '');
  a.addTextField('deploy hook URL (optional)', readKeychain(KEY_HOOK));
  a.addAction('Save');
  a.addCancelAction('Cancel');
  if ((await a.presentAlert()) !== 0) return null;
  const id = (a.textFieldValue(0) || '').trim();
  const pw = (a.textFieldValue(1) || '').trim();
  const hook = (a.textFieldValue(2) || '').trim();
  if (!id || !pw) return null;
  Keychain.set(KEY_ID, id);
  Keychain.set(KEY_PW, pw);
  if (hook) Keychain.set(KEY_HOOK, hook);
  return { identifier: id, password: pw, hook };
}

async function note(title, message) {
  const a = new Alert();
  a.title = title;
  if (message) a.message = message;
  a.addAction('OK');
  await a.presentAlert();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function readInput() {
  // From a Shortcut's "Run Script" action, the passed dictionary lands in
  // `args.shortcutParameter`. Accept a JSON string too, just in case.
  let input = args.shortcutParameter;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch (_) {
      input = {};
    }
  }
  return input && typeof input === 'object' ? input : null;
}

async function main() {
  const nowIso = new Date().toISOString();
  const fromShortcut = readInput();

  // Standalone run (▶ in the editor, no Shortcut): post a placeholder sample so
  // you can confirm the pipeline end to end.
  const input = fromShortcut || {
    heartRate: 68,
    physicalActivity: 'Stationary',
    isCharging: 'Yes',
    batteryLevel: 40,
    environmentSound: 66,
    caloriesBurned: 138,
  };

  const creds = await ensureCreds();
  if (!creds) {
    if (!config.runsInApp) return;
    await note('Not configured', 'Missing handle / app password.');
    return;
  }

  const selfRecord = buildRecord(input, STATE_COLLECTION, nowIso);
  const sampleRecord = buildRecord(input, SAMPLE_COLLECTION, nowIso);

  try {
    const pds = await resolvePds(DID);
    const session = await createSession(pds, creds.identifier, creds.password);
    await putSelf(pds, session.accessJwt, session.did, selfRecord);
    await createSample(pds, session.accessJwt, session.did, sampleRecord);
    if (creds.hook) {
      try {
        await pingHook(creds.hook);
      } catch (_) {
        // rebuild is best-effort; the records are already live on the PDS
      }
    }
    // Only surface a confirmation when a human is watching — a background
    // Shortcut run should stay silent.
    if (!fromShortcut || config.runsInApp) {
      await note('Posted state', JSON.stringify(selfRecord, null, 1));
    }
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (config.runsInApp) await note('Post failed', msg);
    else console.error(msg);
  }
}

await main();
Script.complete();
