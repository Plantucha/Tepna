# Unit `regid` — close the two-registry-ids residue row

**Status:** DRAFT #4171 open, awaiting an undraft decision · **Session:** Magpie · **Date:** 2026-10-31

- **Branch:** `claude/regid-mg` · **Worktree:** `wt-regid-mg` (sibling of the primary checkout)
- **Row:** `2026-10-06-two-registry-ids-are-structural-not-drifts`, source `#3356`, closed as `fixed #3388`
- **Diff:** one line in `briefs/RESIDUE.md`. No code moved, so the PR drops no changeset.

## Rule 0

`registry id crCoupling crcPLV duplicate cmpResidSD nested path binding rename` → `briefs/RESIDUE.md` 0.687,
`ext:memory/kestrel-state-2026-10-06-evening.md` 0.604, `CHANGELOG.md` 0.596, `ecgdex-registry.js` 0.595.

## What the row asked, and what already answered it

The row ruled out a rename for both ids and demanded a separate decision on each. `#3388` landed both on
2026-10-10 as `96efc2e9c`:

- `crCoupling` left the registry. `ecgdex-registry.js` registers it zero times and `crcPLV` once, so no
  rename merged two registered ids. The label alias `'cr coupling'` points at `crcPLV`.
- `cmpResidSD` kept its name and declared its path: `emittedAt: 'scale.residSD'`, matching the
  `scale: { a, b, residSD }` that `cpapdex-cross.js:727` emits.

## Verification

- The suite walks the declared path on a committed export and finds 0.0008674638896919611 in
  `cpapdex_comparator_golden.json`. A control leg proves the walk can fail.
- `node tests/run-tests.mjs --group='DECLARED binding'` reads 56 assertions over 527 ids across 8 registries.
- `node tools/residue-ids.mjs --open` names the close as its one disagreement with the ref, which is the
  correct shape for a close. The `docs-ledger` group passes 102 assertions on the tree.
- `npm run check` read all 45 steps with EXIT=0.
- `node tools/secret-scan.mjs` reads NOT_RUN, because `gitleaks` is absent from rig-x870.

## Stopping point and next step

CI runs on #4171. I never undraft my own PR, so the next step belongs to Kestrel or the owner. After the
merge, retire the worktree with `node tools/wt-done.mjs <path>`.

## Open question

Today's two residue assignments both named a defect the repo had already fixed. A coordinator reading
`residue-ids.mjs --open` gets the ledger state, never the code state. Worth a tripwire that re-checks a
row's own evidence cell against the tree before anyone sizes the work.

Fleet-Session: Magpie
