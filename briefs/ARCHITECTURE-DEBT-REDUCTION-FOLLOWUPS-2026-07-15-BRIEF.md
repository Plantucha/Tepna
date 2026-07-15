<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-15

# Architecture-debt reduction — follow-ups surfaced executing P4 (whole-tree Biome reflow)

> Spawned per `CLAUDE.md` §📌 after executing **P4** of
> `ARCHITECTURE-DEBT-REDUCTION-2026-07-14-BRIEF.md` (whole-tree reflow + retire the formatter override).
> P4 itself is DONE and its gates are green; these are the items its execution *surfaced*.
> **Supersedes:** none. **Superseded-by:** none.

---

## F1 — Re-verify the 14 corpus-backed fixtures on the FULL corpus (owner action, pre-release) · **required before next release**

**What.** The P4 reflow rewrote DSP source *text* inside every app's **compute closure**, so `computeHash`
(the projection over that closure — `manifest-gate.js` §1) moved on all 8 apps. Per the
FIXTURE-VERIFICATION-GATE rule, a moved `computeHash` **expires** each corpus-backed fixture's
`verifiedUnder` stamp. All **14** are now UNVERIFIED:

```
OxyDex_2026-06-13_1056_summary · OxyDex_2026-06-25_0439_summary ·
PulseDex_2026-06-25_equiv · PulseDex_2026-06-25_events ·
HRVDex_2026-06-25_equiv · HRVDex_2026-06-25_events ·
GlucoDex_2026-06-27_equiv · PpgDex_2026-06-27_equiv · ECGDex_2026-06-27_equiv ·
cpapdex-2026-06-12 · cpapdex-2026-06-16 ·
cpapdex_synthetic_golden · cpapdex_synthetic_multinight_golden · integrator_tch_golden
```

**Why it was not done in the P4 PR.** `tools/verify-fixtures.mjs` is the ONLY sanctioned writer of
`verifiedUnder`, and it **fail-closed refuses** to stamp unless *every* corpus input the ledger names is
present. The P4 execution environment carried only a **partial** corpus (missing the gitignored personal
recordings — the O2Ring CSVs, Polar H10/Verity raw txt, the Welltory export, the 06-12 CPAP EDF night,
etc.). A verification you did not run is exactly the false claim that gate exists to abolish, so the tool
(correctly) wrote nothing and `verifiedUnder` was left honestly stale rather than hand-edited.

**This does NOT block merge.** No merge gate reds: `run-tests` asserts `verifiedUnder` *presence* (all 14
still carry one), not freshness; `verify-manifest` GATE A/B is byte-integrity and passes; the export bytes
are provably unchanged (0 output/input hashes moved across all 24 fixtures). The reflow is genuinely
export-inert. What is stale is only the *claim* "these bytes were reproduced under the current code."

**The fix (one command, on the machine that holds the corpus):**
```sh
DEX_UPLOADS=/path/to/full/uploads node tools/verify-fixtures.mjs   # green run → re-stamps all 14
```
A green run re-stamps each `verifiedUnder` to the new `computeHash`. Because the reflow is format-only, the
app re-runs will reproduce every fixture byte-identical, so the run is expected to pass on the first try.
**`tools/release.mjs` WILL refuse to cut a release until this is done** — that wall is intentional and is
the thing that makes F1 required rather than optional.

**Done-when:** `node tools/verify-fixtures.mjs --check` reports 0 unverified; commit the re-stamped
`FIXTURE-PROVENANCE.json` (no bundle/source change — a fixture-only re-record needs no rebuild).

---

## F2 — Lesson: a "reflow-safe gate" audit must read files the CI actually never format-checked · **process note, no code owed**

P4-prep concluded the format-sensitive-gate breakage was "mostly a myth" — it reflowed a copy of the
override-listed + worker/app files and found only `ppgdex-app.js`'s XSS-sink scans broke. That measurement
had a **blind spot**: it did not test the source-mirror gates that read files which were *never actually
format-checked in CI* (the PR lane runs `biome ci --changed` = changed files only; the pre-P4 push lane ran
`biome lint` = no format check). Those files (e.g. the `*-cross.js` significance rule, many HRV/GlucoDex/ECG
render+dsp mirrors) carried un-canonical source (`mk.tau||0`, `x=>`, `(cond)?…`, object `key:'v'`) that the
reflow legitimately normalized — breaking ~14 gate groups the prep did not anticipate. **All were hardened
in the P4 PR** (whitespace / optional-paren / arrow-paren / indent tolerance, each adversarially re-checked
to still reject a broken form), so nothing is owed here — but record the method for the next tree-wide
formatting change: *enumerate every source-text gate and test it against reflowed bytes, not just the files
you expect the reflow to touch.* The deeper cure is P5 (ES modules kill most source-mirror gates by making
the coupling machine-checked) — still deferred.

## F3 — Note: Biome 2.5.3 formatter is non-idempotent on some JSDoc-cast constructs · **watch-out, no code owed**

Two files (`ecgdex-dsp.js`, `integrator-dsp.js`) needed a **second** `format --write` pass to reach the
fixpoint: biome relocates a dangling trailing `/** @type {any} */` comment and strips redundant parens
*inside* a cast on a subsequent pass, so a single `format --write .` left them in a state `biome ci` still
flagged. Both second-pass changes were runtime-inert (comment reposition; `(endMs)` → `endMs`) and tsc
stayed green. **Watch-out for future reflows:** after `format --write`, run `biome ci` and re-format any
file it still flags until the pass is a no-op; a mid-expression JSDoc cast (`+(/** @type {x} */ (a - b).toFixed(1))`)
is the shape that trips it — prefer hoisting the cast to a `var` declaration (as done for `oxydex-dsp.js`'s
`q1hr`/`q3hr`) where tsc would otherwise break.
