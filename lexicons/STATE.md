# is.dame.state — live vitals

Dame's physical + ambient state (heart rate, activity, battery, ambient sound,
calories), sampled from an iPhone and rendered in the site's top-chrome
**atmosphere bar** (the vitals panel beside LISTENING TO / FOLLOWED BY).

`is.dame.state` is an **append-only log** (`key: tid`). One `createRecord` per
push:

- The **latest** record is the live "right now" the vitals panel reads
  (`listRecords limit 1` — same one-call read the listening signal uses). Within
  ~30s of a write, and on every first paint from the build snapshot.
- The **full series** is the history — on hand for a future charts view.
- Each record is **immutable** (permanent rkey), so an `is.dame.now` status can
  strong-ref the one captured alongside it — see the `stateRef` field. That's
  how a note ("dame.is finished a 5k") remembers the body-state behind it.

## Posting from an Apple Shortcut

No Scriptable, no server: the Shortcut signs in with a Bluesky **app password**,
then writes records straight to the PDS with `Get Contents of URL`. Plain XRPC.

### Values you'll need

| | Value |
|---|---|
| PDS host | `https://pds.atpota.to` |
| Repo (identifier) | `dame.is` |
| App password | **bsky.app → Settings → App Passwords** (enable **write**) — revocable, scoped; never your main password |

> If you ever migrate PDS, update the host in the URLs below. (Resolve the
> current one from `https://plc.directory/did:plc:gq4fo3u6tqzzdkjlwzpb23tj`.)

### The one gotcha: JSON types

Your phone data is all strings (`"68"`, `"Yes"`), but the fields are typed —
numbers for the readings, a boolean for charging. The reliable way to build
correctly-typed JSON in Shortcuts is a **Text** action holding the template with
variables interpolated, then **Get Dictionary from Input** to parse it. Numeric
and boolean variables go *without* quotes; strings go *inside* quotes:

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

If a HealthKit value arrives with a unit ("68 count/min"), run it through **Get
Numbers from Input** first so only the number is interpolated.

### Shared prep (both flows)

1. **App password** → a `Text` action → **Set Variable** `AppPassword`.
2. **Gather** your six readings into variables: `HeartRate`, `Activity`,
   `Battery`, `IsCharging`, `Sound`, `Calories`.
3. **Normalize:** **Change Case** → lowercase on `Activity`; an **If**
   `IsCharging` is `Yes` → set `ChargingBool` to text `true`, **Otherwise**
   `false`.
4. **Timestamp:** **Current Date** → **Format Date** (Date Format: *ISO 8601*)
   → Set Variable `Now` (e.g. `2026-07-13T14:03:00-04:00`, valid RFC 3339).
5. **Sign in** — **Get Contents of URL**:
   - `https://pds.atpota.to/xrpc/com.atproto.server.createSession`
   - **POST**, header `Content-Type: application/json`
   - Request Body **JSON**: `identifier` = `dame.is`, `password` = `AppPassword`

   Then **Get Dictionary Value** → `accessJwt` → Set Variable `Token`.
6. **Build the state record:** the `Text` template above → **Get Dictionary from
   Input** → Set Variable `StateRecord`.

### Flow A — the hourly automation (state only)

7. **Write it** — **Get Contents of URL**:
   - `https://pds.atpota.to/xrpc/com.atproto.repo.createRecord`
   - **POST**; headers `Content-Type: application/json`,
     `Authorization: Bearer ⟨Token⟩`
   - Request Body **JSON**:

   ```json
   { "repo": "dame.is", "collection": "is.dame.state", "record": ⟨StateRecord⟩ }
   ```

   (`record` field type = **Dictionary**, pointing at `StateRecord`.) Done — the
   vitals panel picks it up within ~30s. No `now` record, nothing in the feeds.

### Flow B — a manual status (state + a linked note)

Same as Flow A step 7, then capture the ref and post the status:

8. From that createRecord response, **Get Dictionary Value** → `uri` → Set
   Variable `StateUri`; again → `cid` → Set Variable `StateCid`.
9. **Ask for Input** (or however you compose it) → Set Variable `StatusText`.
10. **Build the now record** — a `Text` action → **Get Dictionary from Input** →
    `NowRecord`:

    ```text
    {
      "$type": "is.dame.now",
      "status": "⟨StatusText⟩",
      "createdAt": "⟨Now⟩",
      "stateRef": { "uri": "⟨StateUri⟩", "cid": "⟨StateCid⟩" }
    }
    ```

11. **Write it** — **Get Contents of URL**, same headers, Request Body **JSON**:

    ```json
    { "repo": "dame.is", "collection": "is.dame.now", "record": ⟨NowRecord⟩ }
    ```

The status lands in `/logging` + the home feed as usual; the `stateRef` links it
to the exact vitals snapshot from that moment. (Drop the `stateRef` line for a
plain status with no body-state attached — it's optional.)

### Notes

- **Cadence.** Every push is one immutable `createRecord`, so post as often as
  you like (hourly automation, or on a charging/motion trigger). The log grows;
  if it ever gets large, prune old records — but **spare any that an
  `is.dame.now.stateRef` points at**, or that status's link will dangle.
- **Staleness.** The panel dims and reads "last seen" once the latest reading is
  >30 min old, so a sleeping phone never presents an old heart rate as live.
- **Reverse lookup.** Because the ref is a real backlink, Constellation (the same
  index behind the guestbook) can find the status from the state record too — no
  extra data stored.
- **If a write is rejected** with a lexicon-resolution error, add
  `"validate": false` beside `repo`/`collection` in the createRecord body. (Not
  normally needed — `is.dame.now` already writes here the same way.)
- **Privacy.** Heart rate + activity + charging + battery together read as a
  presence/routine signal (when you're asleep, working out, away). Fine to
  publish — it's your data — but choose deliberately which fields the Shortcut
  includes, the way the iNaturalist mirror deliberately strips location.
