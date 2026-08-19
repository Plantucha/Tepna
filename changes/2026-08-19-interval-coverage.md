<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
§3 executed end-to-end: interval coverage (§3c's validated design) is BUILT — and the better
instrument re-confirmed the selection quarantine on stronger evidence.

`tests/run-tests.mjs --interval-coverage` collects each group's OWN execution via the V8 inspector
(baseline take discarded after load; reset-on-read makes the second take the interval);
`per-group-coverage.mjs` consumes it instead of c8. The c8 defect's signature fully reversed: the
Clock-Contract group carried hrvdex's whole 384-line load baseline under c8 and now attributes
nothing; a certain-execution group attributes 243 real lines.

With collection fixed, per-line selection is STILL unsound — three mechanisms, each measured on
paired hrvdex sweeps: state-dependent paths (lines in the killing group's SET-run interval but not
its SOLO one), load-executed lines (in no interval by design, killed via load state), and
non-behavioural reds — the undeclared-skip audit in `.git`-less mutation workers fabricated 22/22
kills before three `known-drift` declarations landed in `tests/expected-skips.json`. Final paired
run: tag 38 kills, selection 31. So the map is a DIAGNOSTIC: selection is opt-in
(`--use-coverage-map`), the tag filter stays the default, and the evidence sits at the refusal site.
The sound successor (union-with-tag, a superset that cannot lose a tag kill) is specified in §3d.

Also: mutate.mjs vets the zero-attribution set with a worker-clean baseline plus a comment-only
integrity probe, and the fabricated-kill incident is documented at each mechanism.
