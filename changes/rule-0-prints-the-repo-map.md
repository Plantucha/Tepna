---
bump: minor
type: added
brief: none
---

**Rule 0 now names what each code file in its hits declares and exposes.**

`tools/doc-search.mjs` prints one line per distinct code file among the hits, in both lanes: the
file's functions, its exports, and the method that read them. A map nothing points at goes unused,
and every session passes through Rule 0 several times a day.

`tools/repo-map.mjs --write` writes a compact view to the shared state directory, so one copy serves
every worktree. The search reads that file and never rebuilds it: a full scan costs 0.9 s against a
~1 s answer. Measured on this repository &mdash; 919 files, 20508 functions, 12514 exports; the full
map is 3.25 MB and parses in 8.1 ms, the compact view is 1.30 MB and parses in 2.4 ms.

**Identity is the file's bytes, never its mtime.** `git worktree add` stamps every file at checkout
time, so a map written in the main checkout is older than every file in the tree the fleet works in.
Measured 2026-10-12: `clock.js` reads mtime 2026-10-12 in a fresh worktree and 2026-09-24 in the main
checkout, with identical bytes and a last commit of 2026-09-22. An mtime rule would print nothing
there and report nothing wrong, so the reader compares a sha256 prefix.

A file whose bytes moved gets no line, and the search says how many it suppressed. A stale symbol
list is worse than no list, and a silent suppression is worse than both. A brief, a `docs/` page and
an external path get no line and no note, because the map does not hold them.

`--brief` keeps the line. The short form drops the passage, which is the long part, and the map line
is the one thing a path list alone cannot give. `--no-map` prints the output as it was. The line does
not appear over a refusal, where the paths carry a banner that calls them weak guesses.

The Rule 0 skill documents the line under "Read a hit", beside the flags that shorten the output.
