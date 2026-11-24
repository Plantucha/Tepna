---
name: memory-append
description: Use when recording a lesson, a correction or session state to the shared fleet memory — the inbox that sends a note as a pull request, the frontmatter, the amend command, the state head and the privacy gate. Use when about to write or change any memory note.
---

# Writing to fleet memory

The memory is a private git repo. The head of your loaded `MEMORY.md` names its checkout and your
inbox. A tool writes `MEMORY.md` and the lane indexes, so never edit them.
The old flat memory directory is a read-only mirror. A note written there reaches nobody.

## Send a new lesson

1. Search first: `node tools/doc-search.mjs --read "<the lesson>"`. Amend a note that exists.
2. Write `<inbox>/<bird>/<name>.md`. The name is a kebab-case slug and equals the filename.
3. Frontmatter: `name`, `description` (one line, used for recall), `type`
   (`lesson | rule | reference | incident | decision`), `lane`, `last-verified`, `supersedes`, `cites`.
4. Body: the fact, then why it matters, then how to apply it. Link a related note as `[[its-name]]`.
5. Run `node <memory repo>/tools/inbox.mjs --as <bird>`. It opens the pull request of the day.
6. Run `node <memory repo>/tools/land.mjs <PR> --as <bird>` for your own pull request only.

## Change a note

`inbox.mjs --as <bird> --amend <name>` copies the note from `origin/main` into your inbox. Edit that
copy and send it. The gate refuses an amend that started from an older blob.
A note that replaces another note names it in `supersedes`. The old note moves to the archive.

## Keep the state head short

Session state goes in your state head, at most 2 kB, outside git. Run `headlock.mjs take <bird>`
at session start, and `headlock.mjs check <bird>` before you write it. A lesson never goes in the state head.

## What the gate refuses

- A typed citation (`path:`, `brief:`, `pr:`) that does not resolve on `main`.
- A private address, a home path, a token, or a note marked `lan-only: true`.
- A new note with an STE finding, or an amend that adds one (owner, 2026-11-24). Run `node tools/ste-lint.mjs <note>`
  before you send. An untouched note is exempt.

Write one memory note per unit, at the unit boundary. Convert a relative date to an absolute date.
Never record what the repo already states.

## Measured

On 2026-11-22 the flat directory held 829 files and 10.1 MB, with no version control. On 2026-11-23
the repo held 803 live notes and 3.3 MB. The loaded `MEMORY.md` was 5.2 kB.
Two inbox pull requests of one day conflicted in generated files only. `land.mjs` rebuilds those files.
