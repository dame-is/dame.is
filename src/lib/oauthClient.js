// Lazy singleton for the BrowserOAuthClient.
//
// Production: burns metadata that mirrors what /client-metadata.json serves.
// Development: uses the loopback fallback the spec provides for localhost,
//   which means we don't need to tunnel for the OAuth server to fetch our
//   metadata. The library auto-redirects `localhost` origins to `127.0.0.1`.

import { BrowserOAuthClient } from '@atproto/oauth-client-browser';

let _client = null;
let _loopbackUrl = null;

const SCOPE = 'atproto transition:generic';

function isLoopbackHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function buildLoopbackMetadataUrl(origin, redirectPath) {
  // Per the lib docs, when running on a loopback origin, `client_id` must
  // be `http://localhost?redirect_uri=<encoded>` even though the actual
  // page runs at 127.0.0.1 — the library handles the dance.
  const redirect = `${origin}${redirectPath}`;
  return `http://localhost?redirect_uri=${encodeURIComponent(redirect)}`;
}

export function getOauthClient() {
  if (_client) return _client;

  const origin = window.location.origin;
  const redirectPath = '/oauth/callback';

  if (isLoopbackHost(window.location.hostname)) {
    _loopbackUrl = buildLoopbackMetadataUrl(origin, redirectPath);
    _client = new BrowserOAuthClient({
      handleResolver: 'https://bsky.social',
      clientMetadata: _loopbackUrl,
    });
    return _client;
  }

  _client = new BrowserOAuthClient({
    handleResolver: 'https://bsky.social',
    clientMetadata: {
      client_id: `${origin}/client-metadata.json`,
      client_name: 'dame.is',
      client_uri: origin,
      logo_uri: `${origin}/images/favicon.png`,
      redirect_uris: [`${origin}${redirectPath}`],
      scope: SCOPE,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
      dpop_bound_access_tokens: true,
    },
  });
  return _client;
}

export const OAUTH_SCOPE = SCOPE;
