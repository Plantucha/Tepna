<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tooling]
brief: CPAP-AUTOHARVEST-FOLLOWUPS-II-2026-08-03-BRIEF.md
---
The guarantee census reported "0 promises ungated" because its survivor file never parsed.

`tools/guarantees.mjs` cross-references documented guarantees against surviving mutants — a survivor
under a documented promise is a promise nothing checks. Its `loadSurvivors` parsed **NDJSON only**:
split on newlines, `JSON.parse` each line, `catch { continue }`.

Handed a pretty-printed `.sweep.json` — which is exactly what `tools/mutation-crawl.mjs` writes to
`.mutation-crawl/<file>.sweep.json`, i.e. the survivor data this repo actually has on disk — **every
line throws, every throw is swallowed, and the map comes back empty.** The caller then does
`survivors.get(f) || []`, finds no hits, and prints **"0 with a SURVIVING mutant"**.

A total parse failure, rendered as a clean all-clear, by the tool whose entire purpose is finding
promises that nothing checks.

Whole-file JSON is now tried first with the NDJSON path kept as a fallback. And an empty map is now a
**refusal (exit 2)**, not a zero: a caller cannot distinguish "this file has no survivors" from
"nothing loaded", and only one of those is a result.

**Measured effect** — the 8 DSPs whose sweeps carry a `PASSED` canary, every one of which reported 0
before: **540 guarantee sites, 432 carrying a surviving mutant (80 %)**. The shape it finds is guard
lines whose own trailing comment states the promise, each with an unkilled mutant on the guard:
`// never fabricate…`, `// never a raw…`, `// unjoinable — never guessed into a night`.

78 % is a **prioritiser, not a defect count** — it separates "untested line" from "untested line we have
told the reader is guaranteed".

`clock.js` was re-swept (190 mutants) after being wrongly excluded for a `STALE` canary: it reproduced
almost exactly (145 killed vs 144, 33 of 34 survivor lines identical, zero new survivors) and still
reports `STALE`, because re-running does not re-learn a canary. `mutate.mjs`'s own rule is that **a high
kill rate is its own positive control**; `STALE`/`NONE` means *unguarded*, not *wrong*. By the correct
test — unguarded AND a low kill rate — only **6 of 30** sweeps are untrusted, led by `dex-coload.js` at
**0/4**, where "unkillable" and "blind" are indistinguishable.
