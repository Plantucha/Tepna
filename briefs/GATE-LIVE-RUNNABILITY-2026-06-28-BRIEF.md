<!--
  GATE-LIVE-RUNNABILITY-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **Created:** 2026-06-28 · **Follows:** `ECG-INGEST-FOLLOWUPS-GATE-RATIFY-2026-06-28-BRIEF.md` (this is the residue discovered while executing that ratification — which came back **clean/green**, no code defect) · **Theme:** verification *process*, not a code bug · **Executed 2026-06-28 (pure doc/harness — no `*-dsp.js`/`*-app.js`, no re-bundle, no fixture regen):** **§1** the `Dex-Test-Suite.html` ENV NOTE is rewritten to "the reach-in block is a property of the **HOST**, not a law of the preview — attempt the live gate first; ✓all-green WITH the render-coverage groups present = same-origin, gate satisfied in-environment; only fall back to an external host if you ACTUALLY see *Blocked-a-frame* reds"; mirrored as a one-liner in the `verify-provenance.html` preamble + a *try-live-first* note in `CONTRIBUTING.md` §4. **§1.3/§5** the live `env.equiv` byte-identity (ECGDex + PpgDex `compute() ≡ committed export` **byte-identical**, +Oxy/Pulse/HRV/Gluco green in the equivalence gate) is recorded as a **partial discharge** in BOTH standing Node-CI trackers (`GENERIC-EMIT-GATE-FOLLOWUPS-II §1` · `SIGNAL-ADAPTER-FOLLOWUPS-XII §3`); the *literal* `node tests/run-tests.mjs` exit-0 CLI run remains the residual debt there — **no third tracker**. **§2** the correction (legacy `ppgdex_20260610.json` + PulseDex summaries read **`no provenance (pre-R1)`**, not the predicted `buildHash-only/legacy`; only `integrator_fusion_*` hits that path) is canonical **here** — the imprecise wording survives only in DONE *historical* briefs (RATIFY §3, AUDIT-FOLLOWUPS-II/III), left untouched per the immutable-history convention; no living doc carries it (verify-provenance's verdict logic already distinguishes the two). **§3** an **in-memory red-branch unit** was added to the `Manifest JSON well-formed` group (both runners): it mirrors verify-provenance's `FIXPROV_ERR`/`MANIFEST_ERR` banner predicates, feeds a known-bad JSON string through the same `JSON.parse`+catch path, and asserts the FAIL banner is selected (+green contrast) **without touching the real sidecar**. **§4** the premature-green/settle-time corollary (the green pill appears incrementally as rigs boot ~50 s → only ✓all-green AFTER the group count stabilises is a pass) was folded into the existing `CONTRIBUTING.md` counts-are-snapshots note — no new doc. **Gates (this session, same-origin preview):** `Dex-Test-Suite.html` **✓ all-green 1257/79, 0 fails**, `bodyHasBlocked` false, `Manifest JSON well-formed` now **11/11** (the 5 new red-branch asserts pass); `verify-provenance.html` **GATE A PASS 8/8 + GATE B `parsed`, 0 reds — UNCHANGED**. Nothing unexpected moved. **A post-DONE "did anything surface?" re-audit DID find verification-*method* residue (no code defect) → spawned** `GATE-LIVE-RUNNABILITY-FOLLOWUPS-2026-06-28-BRIEF.md`: the headline (self-inflicted, reproduced live) is that softening the prose put the literal `Blocked a frame`/`opaque` tokens into `verify-provenance.html`'s preamble + `CONTRIBUTING.md`, so the *documented* `bodyHasBlocked` `innerText` same-origin check now **false-positives** (this session's own verify-provenance read returned `blocked:true` on a green 8/8 load) — committed automated gates are immune (they key off pill classes / table cells), so it is a manual-method trap, not a gate regression; + 3 minor doc/test-teeth items (the `~3 s`/`~50 s` contradiction, the deferred ans-design.css pass's stale fixture-flip prediction, and the red-branch unit mirroring vs gating verify-provenance's banner).

# Gate live-runnability — the preview can be same-origin; stop assuming the canonical gates can't run in-environment

> **Read `CLAUDE.md` first** (the two gates, the re-bundle ritual). **This brief contains NO code-defect.**
> Every gate ran **green**. It exists because executing the RATIFY brief disproved the *premise* that
> brief (and the `Dex-Test-Suite.html` ENV NOTE) was built on, and that premise is steering the team
> toward unnecessary work (external static hosts + HEADLESS-only DONE stamps + spawning RATIFY
> backstops). All items below are **doc / test-harness hardening — no app re-bundle.**

## The headline finding (§1, ⚠ process — highest value)

**The RATIFY brief, the `Dex-Test-Suite.html` ENV NOTE (lines ~283–291), and the `verify-provenance.html`
preamble all assert that "the cross-origin preview sandbox BLOCKS the iframe reach-in, so the
render-coverage + provenance gates show persistent reds / cannot run here." In this execution
environment that was FALSE — the preview served the files same-origin and every iframe-reach-in leg ran
GREEN.** Concretely, observed live this session (no external host, no `python3 -m http.server`):

- **`Dex-Test-Suite.html` → ✓ all-green, 1247 passed / 79 groups, 0 failing tests.** `bodyHasBlocked`
  (`/Blocked a frame|cross-origin|SecurityError|opaque/`) was **false** on every read. **All 9
  render-coverage groups booted a real bundle in a hidden iframe, reached into `contentWindow`, and
  passed** ([13/13] ECGDex, [13/13] CPAPDex, [15/15] OxyDex, [15/15] PulseDex, [17/17] HRVDex, [9/9]
  GlucoDex, [10/10] PpgDex, [9/9] Integrator). These groups assert *computed values reached the DOM
  inside the booted bundle* — they are **physically impossible to pass under a cross-origin block**, so
  their green is proof the reach-in worked.
- The §2 proof the RATIFY brief most wanted: **`Phase-9 compute() ≡ committed export — equivalence gate`
  [24/24]**, with **`ECGDex.compute() ≡ committed export` = byte-identical** and **`PpgDex.compute() ≡
  committed export` = byte-identical** — RUN, not just reasoned.
- **`verify-provenance.html` → GATE A PASS 8/8** (ECGDex `65e5eaaa152c`, PpgDex `71e712b0b87c`, other 6
  unchanged), **GATE B** all code-gated fixtures `reproducible ✓ (code-gated)`, the §6
  `FIXTURE-PROVENANCE.json parsed` pill renders, **zero red pills**. All 8 bundle-boots show
  `present` in the provenance-helper column — i.e. the runtime `GangliorProvenance.buildHash()`
  reach-in succeeded for every app.
- `fetch()` of `BUILD-MANIFEST.json`, `FIXTURE-PROVENANCE.json`, `uploads/*`, the bundles, and
  `tests/dex-tests.js` all resolved same-origin (the equivalence gate could not be green otherwise).

**Do NOT over-read this as "the sandbox was fixed."** It is **host-specific**: some preview hosts serve
per-document opaque origins (where the ENV NOTE's "persistent reds" is correct), this one served
same-origin. The actionable truth is: **the block is a property of the host, not a law of the preview —
so always *attempt the live gate first* and judge by what you actually observe.**

### Recommended actions for §1
1. **Soften the `Dex-Test-Suite.html` ENV NOTE** (it is a standalone harness, NOT a bundled `Foo.html`,
   so editing it is **not** a re-bundle — edit freely): change "A cross-origin preview sandbox … BLOCKS
   that reach-in, so these groups show persistent reds **there**" → make clear the block is
   **host-specific**; instruct: *run the suite, wait for the group count to STABILISE (see §4), and read
   the pill — if it is green with the render-coverage groups present, you are on a same-origin host and
   the gate is satisfied in-environment; only fall back to an external static host if you actually see
   "Blocked a frame with origin" reds.* Mirror the one-liner in `verify-provenance.html`'s preamble.
2. **Default the workflow to "try live, then fall back."** The HEADLESS-evidence-DONE → spawn-a-RATIFY-
   backstop cycle (which produced the RATIFY brief) is only necessary when the live gate is *actually*
   blocked. Add a line to `CONTRIBUTING.md` next to the gate instructions: attempt the canonical gates
   in-preview first; a same-origin preview discharges them with no external host.
3. **Partial discharge of standing Node-CI `env.equiv` debt:** this run live-confirmed the `env.equiv`
   byte-identity for **ECGDex + PpgDex** (and OxyDex/PulseDex/HRVDex/GlucoDex, all green in the
   equivalence-gate group). That does not retire the literal-`node` debt (see §5) but it is the
   strongest evidence to date for those nodes — note it where that debt is tracked
   (`GENERIC-EMIT-GATE-FOLLOWUPS-II §1`, `SIGNAL-ADAPTER-FOLLOWUPS-XII §3`).

## Secondary findings (all minor, no defect)

### §2 — `FIXTURE-PROVENANCE.json` prediction was slightly off for `ppgdex_20260610.json` (doc-accuracy)
The RATIFY brief §3 predicted the legacy fixtures `ppgdex_20260610.json` + the PulseDex summaries would
read **`reproducible ✓ (buildHash-only/legacy)`**. Live, they read **`no provenance (pre-R1 export)`** (a
yellow `warn`, **not** red — correct and expected: those exports carry no `provenance` block at all, so
there is no stamped buildHash to legacy-check). Only `integrator_fusion_2026-06-{11,13}.json` hit the
true `buildHash-only/legacy` path. Non-blocking — fix the *wording* in any future brief that copies that
prediction; the gate behaviour is right.

### §3 — the §6 hard-fail teeth-test mutates the REAL committed gate file (test-safety)
Confirming "corrupting `FIXTURE-PROVENANCE.json` flips GATE B red" (RATIFY §6) requires editing the
authoritative sidecar in place. This session did it safely (byte-exact backup → corrupt → reload → read
the red → restore from backup → delete backup → re-verify green), but the brief's "corrupt it
momentarily" instruction, followed naively, **risks shipping a corrupted gate** if any step between
corrupt and revert fails. **Recommendation:** add an **in-memory unit** to `tests/dex-tests.js`'s
`Manifest JSON well-formed` group (or a sibling) that feeds the `FIXPROV_ERR`/`MANIFEST_ERR` red-branch a
known-bad string and asserts the banner logic selects the FAIL message — so the red-branch is gate-backed
**without anyone touching the real file**. The green else-branch is already live-proven by the parsed
pill; this just closes the red-branch the safe way. (Test-only; no re-bundle.)

### §4 — settle-time / premature-green read (operational; reinforces `GENERIC-EMIT-GATE-FOLLOWUPS §3`)
`Dex-Test-Suite.html` reports `✓ all green` **incrementally** as groups are pushed: at ~6 s it read "all
green / **70** groups", climbing 70→77→**79** as the render-coverage rigs booted sequentially (~50 s to
settle); `verify-provenance.html` needs ~25 s to boot all 8 bundles before GATE A/B render. A coder who
reads too early sees *green-but-incomplete*; one who reads mid-boot can catch transient render-coverage
reds (the `waitForRender` 14 s/rig guard mitigates, not eliminates). This is exactly the
`GENERIC-EMIT-GATE-FOLLOWUPS §3` "counts are timing-dependent snapshots" caution. **Rule of record (do
not re-derive):** only **`✓ all green` AFTER the group count has stabilised** is a pass; the
counts (`1247/79` this session) are a **snapshot, not a baseline** — quote them as such, never gate on the
number.

## What is NOT broken (do not re-investigate)
- **No code defect surfaced.** The ECG-INGEST-FOLLOWUPS re-bundle is sound: GATE A 8/8, GATE B
  reproducible, equivalence gate byte-identical for both touched nodes, full suite all-green. The
  manifestHash re-records (`65e5eaaa152c` / `71e712b0b87c`) and the `*_equiv` fixture provenance are
  **correct and now LIVE-ratified** — the RATIFY brief is DONE.
- The `*_equiv` "re-record not regenerate" decision is **proven** (compute() ≡ committed export ran
  byte-identical), not merely reasoned — close that as settled.
- The legacy/pre-R1 `no provenance` and `buildHash-only/legacy` verdicts are **intended** (see §2).

## §5 — the one true residual gap: literal `node tests/run-tests.mjs` not invoked
This environment has **no shell / no Node**, so RATIFY Check 1 was not run as a CLI. Its **contract is
discharged by equivalence** — `Dex-Test-Suite.html` runs the **identical** `tests/dex-tests.js` (its
header: "Same assertions as `node tests/run-tests.mjs`") and is a **superset** (shared assertions +
render-coverage), all green; the prior headless replication independently re-ran it (977 passing + the new
groups green). The literal Node CLI run + exit-0 remains **standing debt**, already tracked at
`GENERIC-EMIT-GATE-FOLLOWUPS-II §1` and `SIGNAL-ADAPTER-FOLLOWUPS-XII §3` — fold this brief's "discharge it
on a Node host when one is available" into that, do **not** open a third tracker.

## Done when
§1 ENV-NOTE + `CONTRIBUTING.md` "try-live-first" note landed (no re-bundle) · §2 wording corrected wherever
re-used · §3 in-memory red-branch unit added to `tests/dex-tests.js` (both runners) and the suite stays
all-green · §4 folded into the existing counts-are-snapshots note (no new doc) · §5 merged into the
standing Node-CI debt tracker, not re-opened. Pure doc/harness pass: **no `*-dsp.js`/`*-app.js` change, no
re-bundle, no fixture regen** — so the gate ritual reduces to "`Dex-Test-Suite.html` still ✓ all-green;
`verify-provenance.html` GATE A/B unchanged." If any of those moves, something unexpected happened — stop
and diagnose. Then flip this header to `Status: DONE — <date>` in place and sync `DOCS-INDEX.md`.
