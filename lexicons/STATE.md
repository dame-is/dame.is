# is.dame.state — live vitals

Dame's current physical + ambient state (heart rate, activity, battery, ambient
sound, calories), sampled from an iPhone and rendered in the site's top-chrome
**atmosphere bar** (the vitals panel beside LISTENING TO / FOLLOWED BY).

Two collections, both written on each push:

| Collection | Key | Role |
|---|---|---|
| `is.dame.state` | `self` (singleton) | The live "right now". Overwritten in place with `putRecord`. This is what the site reads. |
| `is.dame.state.sample` | `tid` (append log) | A time-stamped copy of the same shape, so history accumulates for later charts. Optional. |

The site reads the singleton **live** — within ~30s of a write (and on every
first paint from the build snapshot) — so a push shows up without a redeploy.

## Posting from an Apple Shortcut

No Scriptable, no server: the Shortcut signs in with a Bluesky **app password**,
then writes the records straight to the PDS with two `Get Contents of URL`
calls. Everything below is plain AT Protocol XRPC.

### Values you'll need

| | Value |
|---|---|
| PDS host | `https://pds.atpota.to` |
| Repo (identifier) | `dame.is` |
| App password | create at **bsky.app → Settings → App Passwords** (enable **write**) — revocable, scoped; never your main password |

> If you ever migrate PDS, update the host in the three URLs below. (Resolve the
> current one from `https://plc.directory/did:plc:gq4fo3u6tqzzdkjlwzpb23tj`.)

### The one gotcha: JSON types

Your phone data is all strings (`"68"`, `"Yes"`), but the record fields are
typed — numbers for the readings, a boolean for charging. The reliable way to
build correctly-typed JSON in Shortcuts is a **Text** action holding the record
template with variables interpolated, then **Get Dictionary from Input** to
parse it. Put numeric/boolean variables *without* quotes and string variables
*inside* quotes:

```text
{
  "$type": "is.dame.state",
  "heartRate": ⟨HeartRate⟩,
  "activity": "⟨Activity⟩",
  "batteryLevel": ⟨Battery⟩,
  "charging": ⟨ChargingBool⟩,
  "soundLevel": ⟨Sound⟩,
  "caloriesBurned": ⟨Calories⟩,
  "createdAt": "⟨Now⟩",
  "capturedAt": "⟨Now⟩"
}
```

`⟨HeartRate⟩`, `⟨Battery⟩`, `⟨Sound⟩`, `⟨Calories⟩` render as JSON numbers;
`⟨ChargingBool⟩` must be the literal `true`/`false`; `⟨Activity⟩` and `⟨Now⟩`
are strings. If a HealthKit value arrives with a unit ("68 count/min"), run it
through **Get Numbers from Input** first so only the number is interpolated.

### Steps

**1. Set the app password.** A `Text` action with your app password →
**Set Variable** `AppPassword`.

**2. Gather your six readings** into variables (you already produce these):
`HeartRate`, `Activity`, `Battery`, `IsCharging`, `Sound`, `Calories`.

**3. Normalize:**
- **Change Case** → lowercase on `Activity` (so `Stationary` → `stationary`;
  the lexicon's known values are `stationary`, `walking`, `running`, `cycling`,
  `automotive` — anything else still stores fine and shows a generic glyph).
- **If** `IsCharging` is `Yes` → Set Variable `ChargingBool` to text `true`;
  **Otherwise** `false`.

**4. Timestamp.** **Current Date** → **Format Date** (Date Format: *ISO 8601*)
→ Set Variable `Now`. Gives e.g. `2026-07-13T14:03:00-04:00` (valid RFC 3339).

**5. Build the record.** The `Text` template above → **Get Dictionary from
Input** → Set Variable `Record`.
_(For step 7's history write, add a second `Text` identical except
`"$type": "is.dame.state.sample"` → `RecordSample`.)_

**6. Sign in — `createSession`.** **Get Contents of URL**:
- URL `https://pds.atpota.to/xrpc/com.atproto.server.createSession`
- Method **POST**, Header `Content-Type: application/json`
- Request Body **JSON**: `identifier` = `dame.is`, `password` = `AppPassword`

Then **Get Dictionary Value** → `accessJwt` → Set Variable `Token`.

**7. Write the singleton — `putRecord`.** **Get Contents of URL**:
- URL `https://pds.atpota.to/xrpc/com.atproto.repo.putRecord`
- Method **POST**
- Headers: `Content-Type: application/json`, `Authorization: Bearer ⟨Token⟩`
- Request Body **JSON**:

```json
{
  "repo": "dame.is",
  "collection": "is.dame.state",
  "rkey": "self",
  "record": ⟨Record⟩
}
```

Set the `record` field's type to **Dictionary** and point it at the `Record`
variable — Shortcuts nests it as a real JSON object.

**8. (Optional) Append history — `createRecord`.** Same as step 7 but URL
`…/com.atproto.repo.createRecord`, `collection` = `is.dame.state.sample`,
`record` = `RecordSample`, and **no** `rkey` (the PDS assigns a TID). Drop this
step if you only want the live panel and no history.

**9. (Optional) Rebuild the snapshot.** **Get Contents of URL** → POST your
Vercel deploy-hook URL. Not required — the site reads the PDS live; this only
refreshes the static first-paint snapshot.

### Notes

- **Cadence.** Because the singleton is overwritten, post as often as you like
  — a personal automation every 10–15 min, or triggered on charging/motion —
  without piling up `self` records. Only the `.sample` log grows; cap/prune it
  upstream if it gets large.
- **Staleness.** The panel dims and reads "last seen" once a reading is >30 min
  old, so a sleeping phone never presents an old heart rate as live.
- **If a write is rejected** with a lexicon-resolution error, add
  `"validate": false` beside `repo`/`collection` in the step 7/8 body. (Not
  normally needed — `is.dame.now` already writes here the same way.)
- **Privacy.** Heart rate + activity + charging + battery together read as a
  presence/routine signal (when you're asleep, working out, away). Fine to
  publish — it's your data — but choose deliberately which fields the Shortcut
  includes, the way the iNaturalist mirror deliberately strips location.
