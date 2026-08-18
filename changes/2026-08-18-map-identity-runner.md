<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
The coverage map's identity stamp had a hole: it hashed `tests/dex-tests.js` and the DSP sources, but
**not `tests/run-tests.mjs` — the program that enumerates the group indices the map is keyed on.**

The map's values are group **indices**, produced by `tests/run-tests.mjs --list`. A change to that
enumerator — an added filter, a reordering, a skip rule — shifts every index while the suite file is
untouched. The stamp would have reported "unchanged" and let the map select group 41 believing it was
group 40, which is the mis-selection the stamp exists to prevent.

Found by a peer session asking whether their edit to `run-tests.mjs`'s `readSources` affected this.
It did not — adding a source entry adds no group — but the question exposed the gap, and *"this
particular change was harmless"* is not the same as *"this input cannot matter"*.

`runner` is now hashed alongside `tests`, and a map lacking the field is refused rather than treated
as matching: absent is unattributable, and unattributable never passes. Four assertions pin it; a
planted deletion of the check fails four of them.

No behaviour change while the map is quarantined (§3 — coverage capture under-reports for 188 of 494
groups), but the guard must be sound before selection is ever re-enabled.
