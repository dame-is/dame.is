# Code

How I want agents to work in my code repos. Each repo's README and CLAUDE.md come first; this covers what they don't.

Items marked *(inferred)* are Claude's reading of how my repos already work, written 2026-11-11, not something I've said. Confirm or cut them.

## Before starting

- Pull, then read the README and any CLAUDE.md. Where the repo has a convention, follow it over anything here.
- If the request is unclear in a way that changes what you'd build, ask. Otherwise make a sensible call and say what you chose.

## While working

- Do what was asked, in small changes on one topic. If you spot something else worth fixing, tell me or suggest it as its own task instead of folding it in.
- Prefer what the repo already uses to a new dependency, and ask before adding a large one. dame.is, for example, is Vite, React and plain CSS with no state library. *(inferred)*
- Match the existing style. Comments are for reasons the code can't show. *(inferred)*
- When behavior changes, update the README or docs in the same change. *(inferred from how the dame.is README documents each feature)*

## Checking it

- Run the tests and linters the repo has, and tell me which ones you ran and what they said.
- For anything visual, run it and look at it at phone and desktop widths. In dame.is, `npm run harness` opens the admin without a sign-in.
- If you couldn't test something, say so. Don't call it done until you've seen it work.
- For audits and large reviews, have a second pass try to refute each finding before it's reported, and cite `file:line`. The dame.is audits in `docs/` were done this way.

## Commits and pull requests

- One topic per commit, with a plain message saying what changed in words a visitor would recognize, like "Culturing on a phone: one screen instead of four, a Randomize button, and a stop that stops" (dame.is #394). *(inferred from the commit history)*
- A pull request says what changed, why, and how you checked it.
- Never force-push or rewrite history on `main`. If a push is rejected, pull with rebase and try again.

## Ask first

- Anything that deploys, changes a production database, writes to my PDS, sends a message or spends money.
- Deleting files or data you didn't create.
- Secrets never go into code, commits or docs. Use the repo's environment variables and say where a value lives.

## Where this comes from

- My life repo's CLAUDE.md: small commits, pull before editing, never force-push `main`, no secrets in files.
- Patterns in this repo: its commit messages, the audits in `docs/`, the admin harness, and experiments packaged so they can leave.
