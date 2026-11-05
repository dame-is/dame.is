// Vercel serverless function: the atmosphere's weather for the stream
// overlays, passed on from atpota.to's weather station.
//
//   /api/atmosphere?what=now        the live minute (atpota.to/api/atmosphere)
//   /api/atmosphere?what=forecast   the next hours (atpota.to/api/weather-forecast)
//
// Why pass it on rather than read it from the browser: atpota.to's forecast
// doesn't answer other origins, and an overlay left running in OBS for an
// evening asks every fifteen seconds, which the CDN can answer for every
// overlay at once from here. The body is handed on as it came; the overlay
// checks every field before it shows one (src/lib/atmosphere.js).

const UPSTREAM = {
  now: { url: 'https://atpota.to/api/atmosphere', cache: 'public, max-age=0, s-maxage=10, stale-while-revalidate=30' },
  forecast: { url: 'https://atpota.to/api/weather-forecast', cache: 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' },
};

const TIMEOUT_MS = 8000;

export default async function handler(req, res) {
  const what = String((req.query && req.query.what) || 'now');
  const upstream = UPSTREAM[what];
  if (!upstream) {
    res.status(400).json({ error: 'what must be now or forecast' });
    return;
  }
  try {
    const answer = await fetch(upstream.url, {
      headers: { accept: 'application/json', 'user-agent': 'dame.is overlay' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!answer.ok) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(502).json({ error: `the weather station answered ${answer.status}` });
      return;
    }
    const body = await answer.json();
    res.setHeader('Cache-Control', upstream.cache);
    res.status(200).json(body);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'the weather station could not be reached' });
  }
}
