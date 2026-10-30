// Leaflet's way back for a newsletter subscriber.
//
// Once a reader confirms their address, Leaflet sends them to
// /receive_auth_callback on the site the form was on, with a token only
// Leaflet can read, rather than to the form's own redirect (see
// src/lib/newsletter.js). The form noted its page in a cookie as it left, so
// this answers with a redirect to that page, marked so the form says thanks,
// and clears the cookie. It needs no records and reads nothing else: the
// token is Leaflet's and is ignored.
//
// Wired up in vercel.json, which rewrites /receive_auth_callback here.

import { returnLocation, RETURN_COOKIE_CLEARED } from '../src/lib/newsletter.js';

export default function handler(req, res) {
  res.setHeader('Location', returnLocation(req.headers?.cookie));
  res.setHeader('Set-Cookie', RETURN_COOKIE_CLEARED);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(303).end();
}
