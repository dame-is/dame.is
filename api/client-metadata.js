// Vercel serverless function that serves the ATProto OAuth client metadata.
//
// We host the site on more than one domain (dame.is and testing.dame.is),
// and the ATProto OAuth spec requires:
//   - client_id to equal the URL the metadata JSON is served from
//   - every redirect_uri to share the same origin as client_id
//
// So we can't ship a single static JSON file — we generate per-host metadata
// here. Each host is treated as an independent OAuth client by the AS.
//
// Routed in vercel.json:    /oauth-client-metadata.json  ->  /api/client-metadata

const ALLOWED_HOSTS = new Set([
  'dame.is',
  'testing.dame.is',
  // Vercel preview deployments — wildcard handled below via suffix match.
]);

function isAllowedHost(host) {
  if (!host) return false;
  if (ALLOWED_HOSTS.has(host)) return true;
  // Preview deployments live under *.vercel.app. Allow them for testing.
  if (host.endsWith('.vercel.app')) return true;
  return false;
}

export default function handler(req, res) {
  const rawHost = (req.headers['x-forwarded-host'] || req.headers.host || '')
    .toString()
    .split(',')[0]
    .trim()
    .toLowerCase();

  if (!isAllowedHost(rawHost)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: `Unrecognized host: ${rawHost}` });
  }

  const origin = `https://${rawHost}`;

  const metadata = {
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: 'dame.is',
    client_uri: origin,
    logo_uri: `${origin}/api/favicon`,
    redirect_uris: [`${origin}/oauth/callback`],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Short cache so updates to this function propagate quickly while still
  // letting CDNs and AS implementations cache modestly.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  return res.status(200).send(JSON.stringify(metadata, null, 2));
}
