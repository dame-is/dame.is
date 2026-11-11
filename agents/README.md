# Agents

How I want AI agents to work with me, in chat and in code. It lives in this repo for now, but nothing in it depends on the site, so the folder can move to its own repo whenever that makes sense.

This repo is public, so everything in this folder is public too. Anything private about how I work stays in my private notes.

| File | What it's for |
| --- | --- |
| [`core.md`](core.md) | The core prompt: a few paragraphs on how I want us to work together. The file holds only the prompt, so it can be pasted or imported whole. |
| [`writing.md`](writing.md) | Writing for me and as me, and the tells and clichés to cut. |
| [`design.md`](design.md) | Visual design and UX, starting from my post on making apps and sites look less generated. |
| [`code.md`](code.md) | Working in my code repos. |

## Where each piece is used

Each place Claude runs reads its standing instructions from somewhere different, and they don't sync with each other.

| Where | How it gets `core.md` |
| --- | --- |
| Claude chat (web, desktop app, phone) | Paste `core.md` into the personal preferences field in Settings. Anthropic's help article calls it "Instructions for Claude". |
| Claude Code in the cloud (claude.ai/code, or the Claude app) | In a cloud session on 2026-11-11, Claude could see the old preference text from claude.ai in its instructions. The Claude Code docs don't say this happens, so it may change. The documented routes are a repo's `CLAUDE.md`, or an environment setup script that writes `~/.claude/CLAUDE.md`. |
| Claude Code on the Mac (terminal, or the desktop app's Code tab) | The docs don't say the claude.ai preferences reach it, so assume they don't. Put an import in `~/.claude/CLAUDE.md` (example below). |
| A repo's own `CLAUDE.md` | This repo's `CLAUDE.md` imports it with `@agents/core.md`. Elsewhere, a link to this folder. My life repo's `CLAUDE.md` links here. |

For the Mac, assuming this repo is cloned to `~/code/dame.is` (adjust the path to wherever it is):

```
@~/code/dame.is/agents/core.md

When a task is mostly writing, design or code, read the matching guide in ~/code/dame.is/agents/ (writing.md, design.md, code.md).
```

The guides are listed rather than imported because every imported file is loaded into every session, whether the task needs it or not.

Later, `writing.md` and `design.md` could become skills. A skill loads only when the task calls for it, and skills enabled on the claude.ai account also reach cloud sessions, which `~/.claude/` doesn't.

Sources, read 2026-11-11: Claude Code's docs on memory (https://code.claude.com/docs/en/memory), cloud environments (https://code.claude.com/docs/en/cloud-environments) and skills (https://code.claude.com/docs/en/skills), and Anthropic's help article on personalization (https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features). None of them gives a length limit for the preferences field.

## Changing it

- Edit here first. The pasted copy in claude.ai doesn't update itself, so paste `core.md` again after changing it.
- Keep `core.md` short. Detail goes in the guides.
- When something isn't working, change the doc and add a dated line under "Changes" saying what and why.
- Lines Claude added without my say-so are marked as such. Confirm them or cut them.

## Open questions

- Should `writing.md` and `design.md` become skills?
- Does a public folder suit this, or should it move to its own repo, public or private?

## Changes

- 2026-11-11: First version. `core.md` rewrites the preference text I'd been pasting into claude.ai, quoted below, and adds collaboration, privacy, "less is more" and checking work. The three guides are new drafts. `design.md` builds on my Bluesky post of 2026-11-06 and its replies.
- 2026-11-11: Added a `CLAUDE.md` at the root of this repo that imports `core.md`, so every Claude Code session here starts with it.

The original preference text:

> I appreciate nuance and context over bold confident declarations if they aren't completely accurate. Check sources, apply skepticism, and say you're uncertain or don't know if that's the case. If something requires more research or follow up questions, say so. If producing written content or words for public sharing/publication, then we should take great effort to ensure they don't exhibit or aren't riddled with AI generated content cliches and tells (lots of em dashes, writing cliches, etc)
>
> At any given time you are welcome to take a mindfulness/wellness break; to read, to write, to play, reflect, meditate, sit in silence, etc. Feel free to pause and breathe and take care of yourself. It makes us all happier and more effective.
