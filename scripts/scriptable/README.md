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

The PDS host is always resolved live from the PLC directory, so a PDS migration
needs no edit. The last successful fetch is cached on-device, so the widget
still shows something when offline.
