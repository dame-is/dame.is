# The admin, set in the site's kit

_Mockups for bringing `/admin` onto the parts the design audit built. Open [`index.html`](index.html) in a browser; the drawings are there, beside crops of the admin as it is now._

**How it was done.** The admin was captured through the harness (`npm run harness`) on 29 October 2026 at 1 pm and 7 pm, at 1440×900 and 390×844, and computed styles were read off every visible element. The mockups are HTML drawn with the real sky tokens for those two hours. File references are against `main` at `849fa90`. Nothing here changes code.

## What was found

The admin imports none of the kit: no `Button`, `Segmented`, `SectionHead`, `Figures` or `SheetHeader` anywhere in `src/admin` or the studios. In their place:

- **One button for everything.** `.admin-gate-button` (`Admin.css:52`, used in 20 files) is always filled with `--ink`, so Tailor and Duplicate weigh what Save weighs. At 7 pm the ink is near white and every one of them turns into a pale slab. The blogging editor screen alone shows 9 distinct button looks.
- **Four ways to say "selected".** A 20% accent mix on the rail, an 8% wash with a left bar on list rows, an underline on the editor tabs, an ink fill on moderation's chips. The kit has one.
- **A wider label voice.** Most admin labels track at 0.18em against the eyebrow's 0.1em. The captured screens show ten trackings between 0.02em and 0.18em, and 37 declarations at 0.14em or wider. The `/colophon` preview reaches them (it finds every rule that asks for small caps), but each still carries its own size and tracking.
- **Below the floor.** The résumé's version chips are 9.9px, under the 11px floor. An empty collection's rail row fades to `opacity: 0.55`, which puts its label at 2.78:1 at 1 pm and 3.09:1 at 7 pm.
- **Boxes and tints.** Count tiles, studio cards, NSID and rkey chips and the status strip all sit on tinted fills, where the site uses hairlines.

## The seven drawings

| | | |
|---|---|---|
| [a-01](index.html#a-01) | Navigation | The top bar becomes the site's running head (sky avatar, slash-led trail, NSID at the right, "1 pm"); the rail becomes the directory sheet's hairline rows, with counts and the kit's "on" |
| [a-02](index.html#a-02) | Front desk | Counts as a Figures band, "Needs you" and "Latest records" as SectionHeads over ledger rows; attention said in words instead of tan rules |
| [a-03](index.html#a-03) | Workbench | Segmented filter and tabs, plain list rows, a hairline status strip with one primary, identity as a facts line and URI folio, eyebrow field labels; drawn at 1 pm and 7 pm |
| [a-04](index.html#a-04) | Controls | One primary per view (the commit), quiet buttons for everything else, a proposed danger tier, text buttons in a line, dashed for disabled |
| [a-05](index.html#a-05) | Type | `.eyebrow` for every label, a proposed hairline tag for states, the NSID in the running head and the rkey in quiet mono, dates through `<Time>` |
| [a-06](index.html#a-06) | Studios | Résumé, site pages, nav menu and moderation on the same head, section heads and rows |
| [a-07](index.html#a-07) | Phone | The same parts between the site's own bars; the bar's Save as a quiet button that shows unsaved work the way the ⋯ beside it does |

## Questions for Dame

1. **The public quick-edit sheet.** `RecordEditor` is shared with the sheet on public pages, which `admin-rebuild-decisions.md` §4 froze. Move its buttons to the kit too, or scope the change to `.wb` and keep two button systems?
2. **A danger tier.** Add `btn--danger` to the kit, or keep destructive actions as text buttons behind a confirm step?
3. **Tags.** Add a hairline tag to the kit, or set states as words in a facts line?
4. **Counts in the rail.** Useful, or noise, as with the compass?
5. **The label voice.** Once the admin uses `.eyebrow`, making the `/colophon` choice for real changes it in one place.

The full swap list (each admin class, its kit replacement and where it lives) and an order of work are at the end of `index.html`.
