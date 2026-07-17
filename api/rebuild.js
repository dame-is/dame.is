// Vercel serverless function: pings the project's Deploy Hook URL so the
// site rebuilds with fresh PDS data. Wired into vercel.json as a 6-hour cron;
// can also be POSTed manually from publishing flows (Apple Shortcuts, etc.)
// the moment a record is written.

export default async function handler(req, res) {
  // Require the shared cron secret. Vercel's scheduler sends it automatically
  // as `Authorization: Bearer <CRON_SECRET>` for cron invocations; manual
  // callers (Apple Shortcuts, publishing flows) must send the same header.
  // Fail CLOSED: if CRON_SECRET is unset, refuse rather than allow anonymous
  // deploys — an unset secret must never mean "open to everyone".
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res
      .status(401)
      .json({ error: 'CRON_SECRET must be configured to authorize rebuilds.' });
  }
  const auth = req.headers?.authorization || '';
  if (auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const hook = process.env.DEPLOY_HOOK_URL;
  if (!hook) {
    return res.status(500).json({ error: 'DEPLOY_HOOK_URL is not configured.' });
  }
  try {
    const response = await fetch(hook, { method: 'POST' });
    const ok = response.ok;
    return res.status(ok ? 200 : 502).json({
      triggered: ok,
      status: response.status,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'rebuild trigger failed' });
  }
}
