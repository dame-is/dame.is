# Design

How I want agents to approach visual design and UX. It grew out of this post on Bluesky (2026-11-06, https://bsky.app/profile/dame.is/post/3mznrxbk5j22y):

> want your app/website to look less like AI slop? easiest things you can do:
>
> 1. remove "eyebrows" over headers
> 2. pick one font, don't pair fonts
> 3. avoid all caps / small caps
> 4. less is more (AI prefers more)
> 5. explore 5 diff aesthetics + layouts
> 6. iterate/refine, no "one shots"
> 7. test

As I said in the replies, that's practical advice for this moment, aimed mostly at people who use AI in their work and aren't designers. It isn't a set of hard rules. Treat everything here as defaults to question, and when a project already has its own design language, the project wins.

## How to work

1. **Start from a brief.** Before drawing anything, know the story, who it's for, what it's trying to get across, and the themes that matter. If there's no brief, ask me for one or draft one with me. A few references (images, sites, objects, anything) help more than adjectives.
2. **Explore about five directions** that differ in layout and aesthetic, not only in color. Distrust the first set. A reply on the thread listed the ones agents offer every time: the black minimal SaaS one, the purple dreamlike one, the green one with orange accents, the tan serif book-like one.
3. **Iterate.** No one-shots. Pick a direction with me, refine it in passes, and show me each pass.
4. **Use realistic stand-in content.** Synthetic content that behaves like the real thing shows problems that lorem ipsum hides: long names, empty states, one item and a thousand, a post with an image and one without. This matters most when people will add their own content. It's for building, not for shipping; the real words come from me (see `writing.md`).
5. **Test it.** Look at it at phone and desktop widths, use it with a keyboard, check the contrast, and try the edge cases from step 4. Show me screenshots of what you checked.
6. **Skip the popular design skills and prompts for agents.** I think they're a trap: they steer every project toward the same look. A brief and references do more.

## Defaults to avoid

From the post:

- **Eyebrows:** the small label above a heading ("FEATURES", "01 / ABOUT"). Let the heading stand on its own.
- **Paired fonts.** Pick one family and get hierarchy from size, weight and space. dame.is, for example, sets all visible text in one serif and uses a monospace only for code, URIs and record IDs (checked in `src/styles/theme.css`, 2026-11-11).
- **All caps and small caps,** including tracked-out uppercase labels.
- **More of everything.** Agents add sections, cards, a subtitle under every heading, badges, icons and extra fields. Start with less, and add only what earns its place.

Others agents reach for (added by Claude, 2026-11-11, not from the post; edit freely):

- The landing-page template: gradient hero, centered headline, two buttons, three feature cards with icons, a stats row, testimonials.
- Purple-to-blue gradients, glassy panels and glows.
- Large rounded corners and soft shadows on everything.
- Pill badges and status chips used as decoration.
- Emoji or stock icons standing in for a label.
- Decorative section numbers ("01", "02").
- Small gray text on white (a reply on the thread raised this one).

## UX

- Words come first. A button says what it does, and labels use the words people would use.
- Phones count as much as laptops. Check a 390px-wide screen as carefully as a wide one.
- Accessibility is part of done: body text at a contrast of at least 4.5:1 (WCAG AA), tap targets around 44px, a visible focus ring, text that still works at 200% zoom, and reduced motion respected.
- Design every state: empty, loading, error, one item, too many.
- Keep people's place. Back goes back, links are real links, and nothing jumps while the page loads.

The UX list leans on what the dame.is design audit found (`docs/design-audit/`). Contrast was its first finding, and broken Back and layout shift on load were both in it.

## Where this comes from

- The post above and my replies in its thread, 2026-11-06: on coming in with rough concepts or a brief, on realistic placeholder copy (especially for user-generated content), and on popular design skills being a trap.
- The dame.is design and typography audits in `docs/`.
- The second list under "Defaults to avoid" is Claude's, not mine yet.
