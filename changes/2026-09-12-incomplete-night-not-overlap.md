---
bump: patch
type: fixed
nodes: [suite]
brief: residue 2026-09-07-partial-exports-survive-child-abort
---

An incomplete night reported as an overlap failure — one string for two causes.

A `trio-batch` fold child that dies on a V8 heap-limit abort leaves the exports it had already
written in the night directory and no `.trio-stamp` (the stamp is written only at 3/3).
`tch-multinight --dir` is the consumer that lists such a directory — `readdirSync` plus every
`*.json` — and it never read the stamp, so a 2-of-3 night fell through to `alignTriplet`, produced an
empty intersection, and was reported as `overlap 0 < 12`.

Measured side by side against the pre-fix tool on two planted directories: a 2-of-3 night and a
genuine three-corner night with disjoint epoch ranges BOTH print `overlap 0 < 12`. The cause a reader
would chase — epoch alignment — is not the one that happened.

The residue row proposed writer-side remedies (a temp name plus rename, or a `.partial` marker) and
blocked on "no such consumer has been shown to exist". One does, and `trio-batch.mjs`'s own `STAMP`
comment names it. The protection it needs is already on disk, so the fix is that the reader USES the
fold's stamp rather than the writer dropping a second marker; the writer-side options remain
unexercised and unneeded for this consumer.

`classifyCompleteness` is pure, so the seven known-answer cases run with no filesystem and no corpus
— `--dir` needs the gitignored recordings, and that gap is exactly how a `ReferenceError` in
`readNightDir` once reached main. The control is the point rather than the positive: a full corner
set must return null and leave overlap its own verdict, verified after the fix on the same
disjoint-epoch night. Both mutants red 5 of 7 — one that falls back to the overlap wording, one that
never convicts.
