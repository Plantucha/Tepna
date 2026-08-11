<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
Add --incremental to mutation sweeps: replay the kills that are still provably kills.

A full fleet re-sweep is ~24 h and the 99% programme runs ~15 of them — ~360 h. Between sweeps we add
ONE test group and change nothing else, so most of that work is repeated.

WHAT IS SOUND, AND WHAT IS NOT. The tempting version — "nothing changed, reuse everything" — is FALSE
for survivors: a newly added group can kill any survivor anywhere, and without per-test coverage there
is no way to know which. Reusing a survived verdict would record a mutant as alive that the new test
already kills: a wrong number wearing the shape of progress.

What is sound is the other half. A mutant KILLED by group G stays killed while (a) its enclosing
function's source is byte-identical and (b) group G still exists with a byte-identical body. Nothing
else in the file can resurrect it.

That bounds the saving at the killed fraction — 3702 of 9996 on the current fleet. Measured on a
60-mutant sweep: 23 kills replayed, 38 re-tested, 38% of the work avoided, and the result IDENTICAL to
a cold sweep (tested 60, killed 23, survivors 37, same survivor set). An earlier estimate of ~90% was
wrong and is corrected in the brief; the honest figure is ~37%, so ~360 h becomes ~230 h.

Granularity is what makes it work at all. The fingerprints are per-FUNCTION (an edit elsewhere in the
file does not invalidate a mutant) and per-GROUP (an edit to one group invalidates only what that
group killed). Hashing the whole source or the whole test file would invalidate everything on every
commit and save nothing — the version that looks incremental and is not.

Two bugs found by testing rather than by reading:
- --incremental read no journal at all, because the journal was only loaded under --resume. It
  produced the right answer by doing ALL the work and printing nothing, which is exactly the silent
  no-op this programme keeps finding. A zero-reuse run now says so explicitly.
- --incremental truncated the journal it was about to read.

11 known-answer selftests on the reuse rule, including that a SURVIVED verdict is never reusable
however unchanged, that a kill with no named killer cannot be verified and is re-tested, and that a
group body with nested braces is captured whole.
