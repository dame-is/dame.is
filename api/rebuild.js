// Vercel serverless function: pings the project's Deploy Hook URL so the
// site rebuilds with fresh PDS data. Wired into vercel.json as a 6-hour cron;
// can also be POSTed manually from publishing flows (Apple Shortcuts, etc.)
// the moment a record is written.

export default async function handler(req, res) {
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
