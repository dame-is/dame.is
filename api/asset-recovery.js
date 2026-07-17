// Recovery endpoint for requests to deleted build assets.
//
// Every deploy content-hashes the bundle (/assets/index-<hash>.js) and deletes
// the previous hashes. An HTML shell cached anywhere — Vercel's edge, a browser
// HTTP cache, an in-app webview — can outlive the deploy that built it, and its
// asset requests then miss. Vercel's default answer is a 404 served as
// text/plain, which browsers refuse to execute as a module ("blocked because
// of a disallowed MIME type"), leaving the page permanently blank.
//
// index.html carries an inline recovery script for exactly that failure, but it
// can only save shells that already contain it. Shells cached before it shipped
// — or HTML mangled by some cache we've never heard of — still die. This
// endpoint closes that hole from the server side: vercel.json rewrites misses
// under /assets/* here (static files win over rewrites, so live assets never
// hit this), and a missing *script* gets a tiny valid-MIME module that performs
// the same guarded one-shot reload. A fresh, cache-busted navigation re-fetches
// HTML that points at the current build.
//
// The "_r" query param on the page URL is the shared loop guard (same protocol
// as the inline script, stripped on successful boot in src/main.jsx): if it's
// already present, the previous recovery attempt didn't produce a working
// shell, so we log and stop — a genuine outage must never reload-loop.
//
// Everything is no-store: no cache may ever adopt a recovery response as the
// real asset.
//
// Routed in vercel.json:    /assets/:path*  ->  /api/asset-recovery?path=:path*
// (only when no static file matches)

export default function handler(req, res) {
  const raw = req.query?.path;
  const path = String(Array.isArray(raw) ? raw.join('/') : raw || '');

  res.statusCode = 200;
  res.setHeader('Cache-Control', 'no-store');

  if (path.endsWith('.css')) {
    // A stale shell's stylesheet link. Valid empty CSS keeps the console quiet
    // for the moment before the script-side recovery reloads the page.
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.end('/* dame.is: stale asset — recovered on reload */\n');
    return;
  }

  if (path.endsWith('.js') || path.endsWith('.mjs')) {
    // The missing path is echoed into the snippet for console forensics;
    // JSON.stringify makes it safe to embed.
    const assetPath = JSON.stringify(`/assets/${path}`);
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end(
      '(function () {\n' +
        '  try {\n' +
        '    var u = new URL(window.location.href);\n' +
        "    if (u.searchParams.has('_r')) {\n" +
        '      // Already retried once — the fresh shell still references a\n' +
        '      // missing asset, so the deploy itself is broken. Stop here.\n' +
        `      console.error('[dame.is] asset still missing after recovery reload:', ${assetPath});\n` +
        '      return;\n' +
        '    }\n' +
        `    console.warn('[dame.is] stale shell detected (missing', ${assetPath}, ') — reloading fresh');\n` +
        "    u.searchParams.set('_r', Date.now().toString(36));\n" +
        '    window.location.replace(u.toString());\n' +
        '  } catch (e) {}\n' +
        '})();\n',
    );
    return;
  }

  // Images, fonts, sourcemaps… nothing executable hangs on these — keep honest
  // 404 semantics.
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found\n');
}
