---
bump: minor
type: added
brief: VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md
---

`verify:verdict-adoption` gains a `contributions` leg, and its population is a brief table rather
than a list inside the gate. The five figures that owe the new block live in §2 of the
VERDICT-CONTRIBUTIONS brief. The leg parses that table at every run and compares it with the rows in
`tools/verdict-adoption.json` both ways.

A figure added to the table with no row reds with its name, and a row for no table figure reds with
its name. Neither side drifts quietly, because a hand-kept second copy of a population is how a gate
comes to examine nothing. A renamed §2 heading reads as zero figures, and the leg reds on that too
rather than passing over an empty set.

Each row declares `file`, `method`, `status` and a `since` date; the file and the method must match
the table, the method must sit in the closed set of three, and an undated row reds because it cannot
be read as debt. All five land `pending`, which is the honest state today.

An `adopted` row must name `emits`, the gate reads that object, and `validate()` must report
`contributions` among the fields it EXAMINED. A valid object whose validator never looked at the
block is not an adoption; it is a pass over something never read.

Nineteen selftests plant each arm, two of them for the leg's own blindness: the renamed heading and
the examined-nothing adoption. Two more run the shipped `verdict.js` validator over a real block and
over an object without one, so the requirement is satisfiable by the validator that ships rather
than by a stub alone.
