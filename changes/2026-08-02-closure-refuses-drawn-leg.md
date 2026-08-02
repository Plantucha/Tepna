---
bump: minor
type: added
brief: WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md
---

`fitClockClosure` now refuses a source whose time axis carries no timing. Closure's claim is that three
INDEPENDENT measurements over-determine each other; a drawn axis (`sample_index × an assumed rate`)
contributes a constant, so both of its pairs faithfully measure a fiction and closure returns a
confident number about nothing — which is how six nights failed with "all legs confident".

Sources may declare `timingSource` (straight from a node export's `quality.timingSource`). A `'none'`
leg is excluded and named in the refusal; two `'host'` legs raise `sharedHostTimebase`, since they still
close but are less independent than the identity's derivation assumes. An omitted `timingSource` stays
usable, so every existing caller is byte-unchanged and no fixture moves. `trio-batch` passes it through
and prints refusals.

Also fixes `mergePpg` dropping `hostAxis`, which left `quality.timingSource` null on every folded night —
the field existed and was never populated. The merged verdict is sample-weighted, not worst-case: a
worst-case rule was measured to void 2026-07-28, a night that genuinely reports real timestamps.

PAT was re-run on the disciplined axis and is unchanged (130–215 ms beat-to-beat IQR against a 60 ms
bar, vs 139–197 ms before), so PAT is not alignment-limited.
