---
name: memory-append
description: Use when recording a lesson, a correction or session state to the shared fleet memory directory — the frontmatter shape, which index file the pointer belongs in, and the read-before-write rule for a directory that has no conflict surface. Use when about to write or overwrite any memory file.
---

# Appending to fleet memory

The memory directory is **shared by every fleet session, un-versioned, with no conflict surface** — an
overwrite leaves no conflict, no gate and no symptom.

1. **Read the file before overwriting it.** Prefer appending a dated section to an existing entry over
   creating a near-duplicate. Delete a memory only when it is wrong.
2. Frontmatter: `name` (kebab-case slug matching the filename), `description` (one line, used for
   recall), `metadata.type` of `user` | `feedback` | `project` | `reference`.
3. Body: the fact; for `feedback`/`project` follow with why it matters and how to apply it. Link
   related entries with `[[their-name]]` — liberally; a link to an entry that does not exist yet marks
   something worth writing.
4. **The pointer goes in the entry's lane INDEX file**, not in `MEMORY.md` — every session loads that file whole,
   and the harness cuts it past ~24 KB. Only read-on-resume state belongs there.
5. Convert relative dates to absolute. Never record what the repo already states.

## Measured

The staleness guard fires on any memory file that moved during a command this session had not read —
it reported a concurrent write roughly a dozen times in one evening on 2026-10-11, which is how often
two sessions are in that directory at once.

Every session loads `MEMORY.md` in full, so a lesson written there rather than in its lane index
costs every session tokens forever.

Memory: the lane indexes `INDEX-fleet-ops`, `INDEX-git-and-queue`, `INDEX-code-and-capture`,
`INDEX-instruments-and-inference`.
