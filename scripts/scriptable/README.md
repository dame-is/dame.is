# Scriptable widgets

iOS home-screen widgets built with [Scriptable](https://scriptable.app). Each
file here is a self-contained script you paste into the app.

## `dame-now-widget.js` — latest "now" status

Shows the most recent `is.dame.now` status update(s) — the same records behind
[dame.is/logging](https://dame.is/logging) — pulled live from the AT Protocol
PDS. `now` records are public, so there's no login and no Bluesky AppView: the
widget resolves the PDS host from the PLC directory and reads records straight
from it with `com.atproto.repo.listRecords`, exactly like the site does.

The look mirrors the site — flat earthy palette, a serif voice (Charter, the
closest iOS system serif to the site's Crimson Pro), mono timestamps, square
corners, hairline rules — and follows the phone's light/dark appearance.

### Install

1. Install **Scriptable** from the App Store.
2. Open Scriptable → **+** → paste the contents of `dame-now-widget.js`. Name it
   e.g. `dame.is now`.
3. On the home screen: long-press → **+** → **Scriptable** → choose a size → add.
4. Long-press the new widget → **Edit Widget** → **Script** → pick `dame.is now`.

Press ▶ inside the editor to preview it first.

### Sizes

- **Small** — the single latest status, big, with a relative timestamp.
- **Medium / Large** — a short history of the most recent updates.

### Options (optional)

In **Edit Widget → Parameter**, pass `key=value` pairs separated by `;`:

| Key | Default | Meaning |
|---|---|---|
| `did` | `did:plc:gq4fo3u6tqzzdkjlwzpb23tj` | The repo (DID) whose `now` records to read. |
| `count` | `4` | How many updates to show (medium/large). |
| `site` | `https://dame.is` | Where a tap opens (deep-links to the record when possible). |
| `shortcut` | *(none)* | Name of an Apple Shortcut to run on tap instead of opening `site`. |
| `post` | *(off)* | Set `post=1` to show a "＋ new" button that posts a new status. |

Example — show five updates:

```
count=5
```

### Run a Shortcut on tap

Set `shortcut` to the exact name of a Shortcut and tapping the widget runs it
(via the `shortcuts://run-shortcut` URL scheme) instead of opening the site.
The latest status text is passed as the Shortcut's input (available as
"Shortcut Input" inside the Shortcut). Note: this briefly foregrounds the
Shortcuts app — a Scriptable widget can't run a Shortcut silently in the
background the way a native App Intent widget can.

```
shortcut=Log a status
```

### Post a new status on tap

Set `post=1` and the header shows a small **＋ new** button. Tapping it opens
Scriptable, prompts you for a status, and writes a new `is.dame.now` record to
your PDS. The rest of the widget still opens `site` (or runs `shortcut`) — only
the ＋ triggers posting.

```
post=1
```

**Keep credentials out of the committed file.** The first time you post, you're
prompted for your handle, an app password, and (optionally) a deploy-hook URL.
These are stored in the device **Keychain** only, so nothing secret is committed
to the repo.

If you'd rather not use the Keychain, there's a `LOCAL = { identifier,
appPassword, deployHook }` block near the top of the script you can fill in — but
**only in your on-device Scriptable copy, never in the committed file** (pushing
real values would leak your app password). Note that re-pasting the script from
the repo to pick up an update will overwrite that block, whereas Keychain values
survive updates — which is why the Keychain is the recommended path.

Setup steps:

1. Create an app password at **bsky.app → Settings → App Passwords** (enable
   write access so it can create records).
2. Add `post=1` to the widget's **Parameter**.
3. Tap **＋ new** → enter your handle + app password (+ optional deploy hook) →
   they're saved to the Keychain.

Posting writes straight to your PDS via `com.atproto.server.createSession` +
`com.atproto.repo.createRecord`, so the new status is live immediately (the site
reads the PDS directly). If you also provide a **deploy hook URL** (Vercel →
Settings → Git → Deploy Hooks), it's pinged after each post to rebuild the
static snapshot too. To change or clear stored credentials, tap ＋ new again
after removing them, or use Scriptable's Keychain — the keys are
`dame.now.identifier`, `dame.now.appPassword`, and `dame.now.deployHook`.

> The ＋ button is its own tap target, which requires iOS 17+. On older iOS the
> whole widget falls back to its normal tap (opening `site`).

The PDS host is always resolved live from the PLC directory, so a PDS migration
needs no edit. The last successful fetch is cached on-device, so the widget
still shows something when offline.
