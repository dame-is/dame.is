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
| `site` | `https://dame.is` | Home page a tap opens. |
| `theme` | `auto` | `auto` tracks system light/dark; force with `light` or `dark`. |
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

## `dame-state-poster.js` — current state → PDS

Writes Dame's live physical + ambient state (heart rate, activity, battery,
ambient sound, calories) to the PDS, powering the atmosphere-bar **vitals
panel** on [dame.is](https://dame.is). Each run does two writes:

- **`is.dame.state/self`** — the singleton "right now", overwritten in place
  (`putRecord`). This is what the site's vitals panel reads.
- **`is.dame.state.sample`** — an append-only history record (`createRecord`),
  so the same readings accumulate over time for later charts / timelines.

Unlike the now-widget this isn't a home-screen widget — it's a poster the
**Shortcut** runs. It doesn't read the sensors itself; the Shortcut gathers
them (HealthKit heart rate + active energy, Environmental Sound Levels, device
battery + charging, motion state) and hands the script a dictionary.

### The key trick: it accepts your existing keys as-is

The poster reads **both** the raw iPhone keys and the normalized lexicon keys,
so the exact blob you're already producing works unchanged:

```json
{
  "environmentSound": "66",
  "heartRate": "68",
  "physicalActivity": "Stationary",
  "isCharging": "Yes",
  "batteryLevel": "40",
  "caloriesBurned": "138"
}
```

Everything is coerced hard on the way in: `"66"` → `66`, `"Yes"` → `true`,
`"Stationary"` → `"stationary"`. Any field you can't supply on a given run is
simply omitted (a missing heart rate is absent, not a bogus `0`), and unknown
`physicalActivity` values fall through to `"unknown"`.

### Install

1. Scriptable → **+** → paste `dame-state-poster.js` → name it **`dame.is state`**
   (the Shortcut references it by this exact name).
2. Press ▶ once in the editor. With no input it posts a placeholder sample so
   you can confirm the write path, and prompts once for your handle + app
   password (+ optional deploy hook). Credentials are stored in the **Keychain**
   and shared with the now-widget — if you've already set up posting there,
   this reuses the same login with no prompt.

### Wire it into your Shortcut

Whatever Shortcut already assembles that dictionary just needs **one more
step** at the end:

> **Run Script** (Scriptable action) → Script: **`dame.is state`** → Input:
> *the dictionary*.

That's it — the dictionary flows in as the script input (`args.shortcutParameter`),
the script writes both records, and (if you set a deploy hook) pings it so the
static snapshot rebuilds too. The record is live on the PDS immediately either
way, since the site reads the PDS directly.

**Cadence.** Because the singleton is overwritten each run, you can post as
often as you like — e.g. a personal-automation that runs every 10–15 minutes,
or on a charging/motion trigger — without piling up `self` records. Only the
`.sample` history grows; cap or prune it upstream if it ever gets large.

**Privacy note.** Heart rate + activity + charging + battery together read as a
presence/routine signal (they can imply when you're asleep, working out, or
away). That's fine to publish — it's your data — but decide deliberately which
fields the Shortcut includes, the same way the iNaturalist mirror deliberately
strips location.

> Credentials never live in the committed file. To change or clear them, edit
> the Keychain keys `dame.now.identifier` / `dame.now.appPassword` /
> `dame.now.deployHook` (shared with the now-widget).
