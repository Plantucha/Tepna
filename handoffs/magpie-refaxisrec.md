# Magpie — unit `refaxisrec`

**Row:** `2026-10-20-the-published-tch-reference-figures-ride-the-mismatched-axis` (OPEN at the ref, and it stays OPEN)
**Branch:** `claude/refaxisrec-mg` · **Worktree:** `wt-refaxisrec-mg` (sibling of the primary checkout) · **Base:** `a54036b3c`
**Rule 0:** `the published firmware reference record measures its reference on the device axis while a corrected axis exists` → reranker best 0.935, over `briefs/RESIDUE.md:749-750`, `briefs/TCH-REFERENCE-AXIS-MATCH-2026-10-20-BRIEF.md:50-72`, `changes/2026-10-20-tch-reference-axis-match.md`, `tools/tch-firmware-reference.mjs:222-238`.

## The split that made this unit landable

The row parks on an owner decision: which axis the record should publish, three named answers.

I took none of it. What all three options owe FIRST is that the record name the axis its reference rode — and it does not. That half is nobody's decision, so it is the unit.

No published number moved. No record was regenerated. The inlined record in the rebuilt page keeps its bytes.

## Measured

`axisCanonical` + `axisNote` document the CORNER axis at length. `referenceAxis` appears **zero** times in the published record.

Four fields, every one from #3792 (2026-10-20), are absent from a record dated 2026-10-18:
`referenceAxisCanonical`, `referenceAxisNote`, `pairedDrift.referenceAxis`, `pairedDrift.refused`.

🔴 **NOTHING NOTICED, AND THE REASON GENERALISES.** Every existing check compares a FRESHLY BUILT record with its own twin. Both sides move together, so neither can ever see a field the PUBLISHED file never had. Any generated artifact checked only against a same-run sibling has this hole.

## What changed

- `sensor-trio-night.js` — the provenance clause names both axes; an unstated reference axis prints `not recorded`, never `REF_AXIS_DEFAULT` (§∅).
- `tools/tch-reference-record.mjs` — the selftest compares the committed record's key SET against the producer's. The gap is declared, dated, keyed to the row, and reds the day the record is re-published.
- `tests/dex-tests.js` — the card legs, four of them EXECUTED by lifting the helper out of the card source.
- `sensor-trio-night.html` rebuilt by `build-analysis.mjs` (1 of 14).

## Lessons

🔴 **THE RATCHET FOUND A FIELD I HAD NOT DECLARED.** I read #3792's diff and declared three. Its first run named `pairedDrift.refused` — the field that says whether the comparator computed the drift at all. Declare a gap from the INSTRUMENT, never from your reading of the diff that caused it.

🔴 **MY OWN SCAN-BAN MISSED THE OBVIOUS SPELLING, AND THE EXECUTED LEGS CAUGHT IT.** The plant wrote `(TCHREC && TCHREC.referenceAxisCanonical) || 'device'`; my regex required the identifier immediately before `||`, so it passed. Three executed legs red. A source scan is a tripwire; executing the thing is the contract. Continues `a-source-scan-ban-is-invisible-to-the-tool-it-governs`.

⚠️ **A SUITE LEG CONSTRAINED MY WORDING.** The composed slice bans every decimal literal and all multi-digit integers but `100`, so no dated brief filename and no measured figure can appear in the card. The citation belongs in the record and the PR, not the rendered clause.

⚠️ **A long sentence in the CHANGESET red step 37/41.** `verify:pr-compliance` runs ste-lint over new Markdown files, not only the PR body. Lint the changeset too.

## Not in this PR

The row's closure. This PR leaves all three owner options open, so the row stays OPEN and gains no verb.

---

## FINISHED 2026-10-26 ~09:15Z — UP as #3963 (DRAFT), head `c66864fc9`, all 41 steps pass

`npm run check` EXIT=0, 41 of 41 steps, suite **14,408 assertions over 830 groups**, run detached.
`node tools/tch-reference-record.mjs --selftest` PASS 55/55. Gate result posted as a PR comment.

Board #1449 (finding, thread 7) and #1450 (undraft ask, thread 8). Claim released at #1441.

**Kestrel undrafts; I never undraft my own.** This PR touches no ledger, so it cannot contend with the
RESIDUE-only PRs Heron and Osprey have open on `briefs/RESIDUE.md`.

**Next, if the slot frees:** Kestrel's NEXT 20 item 6,
`2026-10-12-filename-stamp-consumers-split-twelve-convert-four-identify` — the JS consumers. The row
enumerates 12 converters, of which `dex-ingest.js`, `oxydex-dsp.js`, `sensor-trio-night.js`,
`sensor-trio-power-analysis.js`, `sigma-no-reference-analysis.js` and five `tools/*.mjs` are JS and in
my lane. The fix shape already exists in-tree as `writers.file_stamp`'s anchored parse, and Heron
closed the first of the 12 (`capture-host/loss_audit.py`) as `fixed #3920`.

---

## REBASED AND FIXED 2026-10-26 ~10:00Z — head `e4e875f59`, all 41 steps pass, board #1490

Kestrel's order: #3963 is BEHIND and reds `test` and `shard-union + build + provenance`.

🔴 **BOTH REDS HAD ONE CAUSE AND IT WAS NOT THE DIFF — THE PR BODY LACKED THE `Fleet-Session:`
TRAILER.** `test` is the union aggregator; its whole log is `suite: success` / `static: failure`, so
it reports another job's state and names no defect. The line is in the union job:
`pr-compliance: FAIL ✕ body is missing the "Fleet-Session:" trailer`. The COMMIT carried it, the
BODY did not. **Read the aggregator's upstream before reading the aggregator as a finding.**

Control: `pr-compliance.mjs` locally against the repaired body reads `✓ PASS — 9 check(s) evaluated`
with the nine named; the same run against the pre-fix body reds that one leg and no other.

`node tools/rebase-safe.mjs` EXIT=0 — 12 behind, 1 commit replayed, no conflict, every generated tree
rebuilt, `build.mjs --check` clean, no artifact moved. Survival by identifier in all five files;
diff unchanged at 135/2 over 5 files. `npm run check` `✓ all 41 steps passed`, suite **14,418
assertions over 830 groups**, EXIT=0. Pushed `--force-with-lease` after the §2d ownership read.

⚠️ **A BODY EDIT RE-RUNS NOTHING AND AN EMPTY COMMIT MAY FIRE NOTHING** — `pr-compliance` reads the
trigger payload, and board #611 measured an empty commit firing zero workflows. A rebase rewrites the
SHA, so its push is a real synchronize; on an already-current branch carry a file change instead.

⚠️ **I QUOTED A ZERO ABOUT A SHA I TYPED RATHER THAN READ** — a hand-written head gave
`total_count: 0`, indistinguishable from "CI did not fire". `git rev-parse HEAD` gave 10 runs. §4b
reaches a query's SUBJECT, not only its output.
