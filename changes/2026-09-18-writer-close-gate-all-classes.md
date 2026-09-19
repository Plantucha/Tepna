---
bump: patch
type: fixed
brief: CAPTURE-HOST-RESOURCE-ORCHESTRATION-AUDIT-2026-09-05-BRIEF.md
---

The gate that exists because unclosed-writer tail loss is invisible could itself only see **4 of 13**
writers. Test-only — no production code changed.

Closes residue `2026-09-16-devcaps-has-no-branch-consumer`'s sibling
`2026-09-06-writer-close-list-hand-kept` at its detection level.

## What was wrong with the detector

`test_every_StreamWriter_a_runner_opens_is_also_closed` asserted that every writer a runner opens is
also closed — the right invariant, guarding the loss S1 calls the charter's unforgivable failure: an
unclosed writer does not error, does not warn and does not lose the file, it loses the **unflushed
tail**, header and nearly all rows present.

Its own scoping sentence is why nobody noticed the hole: *"scoped to EVERY function that constructs a
StreamWriter … so the next runner to grow a writer is covered without anyone remembering this test
exists."* True of `StreamWriter`; false of the intent, three independent ways:

1. **One class, hardcoded.** `writers` exports **8** writer classes and the gate recognised one. The
   other 7 have 9 construction sites. And note the asymmetry that created: the **write** side
   (`_FlushHealth.put`) discovers classes with `dir(writers)` precisely *"so a ninth cannot dodge the
   gate"*, while the **close** side named one. Same module, same risk, opposite methods.
2. **A factory.** `run_polar` builds `hr_writer = w("hr")` through a local helper returning a
   `StreamWriter`, so the binding is a call to `w`, not to a class.
3. **A non-literal sweep.** `run_polar` closes via
   `for wr in list(writers.values()) + ([hr_writer] if hr_writer else [])` — a BinOp over a dict's
   values. Only a literal tuple/list was recognised, so that whole runner's close discipline was
   invisible.

## Why it stayed hidden, and why the three had to land together

**2 and 3 cancelled.** `run_polar`'s writers were invisibly *opened* and invisibly *closed*, so nothing
ever reddened. That cancellation is luck, not design: visible-open plus invisible-close is a false
**positive**, and invisible-open plus never-closed is the false **negative** the gate exists to prevent.

Measured consequence: fixing the factory alone would have made `hr_writer` visible as opened while its
sweep-close stayed invisible — **reddening correct code.** That is not a hypothesis; it is mutation M2
below.

## No live loss — and that is why this is worth doing now

Every one of the 13 writers across all 8 classes **is** closed today. The blind spot was **latent**,
which is exactly how it survived: there was no symptom to notice. The fix is to the detector, before a
real omission arrives.

## Proof the gate was blind, not merely incomplete

Dropping `rtcwr` — a `RingClockLogWriter`, one class over from the guarded one — out of `run_oxyii`'s
close set:

| gate | result |
|---|---|
| **old** (StreamWriter only) | **15 passed** — completely blind |
| **new** (8 classes, derived) | fails: `run_oxyii() opens ['rtcwr'] but never closes them` |

That is the 2026-09-06 `plethawr` bug reproduced in a different class, and the old gate does not see it.

Two further mutations, each killed:

- revert class discovery to `{"StreamWriter"}` → the **coverage assertion** fires (13 → 4);
- drop the non-literal sweep branch → `run_polar() opens ['hr_writer'] but never closes them`, the
  predicted false positive.

## The class list is derived, and the gate publishes its population

Classes now come from the `writers` module, so a ninth cannot dodge the close side either — the write
side's own rule, applied where it was missing.

And the closing assertion is an **equality against a recorded population** rather than `checked > 0`.
That floor passed while coverage was 4 of 13, so it is precisely the shape that could not notice the
gate going blind — `a floor cannot detect exclusion`. It now names the count, the function breakdown,
and what a drop means: *"the scan stopped seeing writers, not that writers stopped existing."*

## Not done here

The row's **level 2** — production shape, where construction and registration are one act so no
hand-kept close set exists at all — is deliberately not in this PR. It is a refactor of the capture hot
path with a real design fork (a registering factory versus a manual append list), and it would change
what this gate should assert. Detection first, on evidence; the shape change wants its own decision.
