<!--
  SIGNAL-ADAPTER-FOLLOWUPS-VI-2026-06-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-25 · **Created:** 2026-06-25 · **Follows:** SIGNAL-ADAPTER-FOLLOWUPS-II-2026-06-24-BRIEF.md (§1) + -IV §3 (the equivalence gate) + -III §2 (meta.derived) · **Sibling-of:** -II / -III / -IV / -V

> **Execution note (2026-06-25).** **§1 (the real work) DONE:** the Phase-9 `compute() ≡ committed
> export` equivalence gate now covers all three migrated nodes, not just OxyDex. Added two committed
> ganglior-export fixtures + their `FIXTURE-PROVENANCE.json` entries — `uploads/PulseDex_2026-06-25_equiv.node-export.json`
> (← `Polar_H10_AAAAAAAA_20260613_204448_RR.txt`, producing bundle `PulseDex.html` manifestHash
> `3c85d78cd9c2`) and `uploads/HRVDex_2026-06-25_equiv.node-export.json` (← the 20May–17Jun Welltory CSV,
> `HRVDex.html` manifestHash `ea74b3639c33`; HRVDex's FIRST code-gated fixture). The shared
> `tests/dex-tests.js` equivalence group was generalized to a per-node CASES table: OxyDex `compute({text})`
> → `nights[0]`; **PulseDex** `parseRRInput(text)` → `compute({intervals,tsMs,t0Ms,offsetMin})` → whole
> node-export; **HRVDex** `compute({text})` → whole node-export. `env.equiv` is wired in BOTH runners
> (`Dex-Test-Suite.html` + `tests/run-tests.mjs`). Byte-identity **HELD cleanly** for both new nodes — 0
> differing fields after the documented EXCL strip (`file·provenance·kernel·vo2est·karv` + **`generated`**,
> added this round because the PulseDex/HRVDex export carries a per-run `schema.generated` timestamp that
> OxyDex's compared night element does not). No exclusion was widened beyond that one volatile timestamp;
> the diff is otherwise full-tree. **NO app re-bundle** (fixtures are produced BY the current gate-clean
> bundles; GATE A untouched, GATE B passes by construction against the recorded current manifestHashes).
> Verified the gate logic green out-of-band (both nodes: compute() ≡ committed fixture, 0 diffs) and that
> `tests/dex-tests.js` parses/exports cleanly. **§2 — decision (a):** the committed-fixture proxy is
> accepted as sufficient (the fixture WAS produced by the app's shared builder, and GATE A/B red it the
> moment the producing code changes); option (b) (a direct live `appExport ≡ compute()` diff in the
> browser `extraProbe`) was NOT folded in — the per-node §1 extension did not make it cheap (the app
> export entries are DOM-coupled + trigger a download rather than returning the object). **§4** — left as
> source-only; rides the next Integrator re-bundle (no re-bundle done here). **§5** — confirmed an
> environment limitation of the cross-origin preview (not a code regression) and added a one-line note by
> the render-coverage rig in `Dex-Test-Suite.html`; the shared assertions are the origin-independent CI
> floor. **§3** — the `env.equiv` Node-CI path remains UNVERIFIED here (no Node host this pass); it folds
> into the standing -IV §7 / -V §4 Node-CI debt, now with the PulseDex/HRVDex equivalence cases to eyeball
> when that debt is discharged. **Spawned `SIGNAL-ADAPTER-FOLLOWUPS-VII-2026-06-25-BRIEF.md`** for the
> residue this extension exposed: §1 (🔴) HRVDex `compute({text})` skips the `commitRows` sort that the
> app path applies → a real `compute() ≠ app-export` divergence (newest-first Welltory ⇒ `startEpochMs` is
> the LAST day, `spanDays = -27`) — the first concrete instance of -VI §2's "fixture ≠ live app export"
> gap actually hiding a divergence; §2 the equivalence gate exercises ZERO events on both new nodes (event
> `t`/ordering/meta byte-identity still untested); §3 carries the Node-CI debt.

# Signal-adapter Phase-9 — follow-ups VI (residue from landing the equivalence gate + the -II–V execution pass)

> Round VI. The 2026-06-25 pass executed **-II §§1·5·6·7·8·9**, **-III §2**, **-IV §§2·3·4**, **-V §§1·2**
> (test/doc/unbundled-tool work + ONE HRVDex re-bundle for -V §1: manifestHash `dd380264fcef→ea74b3639c33`,
> buildHash unchanged; GATE A updated; both gates green; Dex-Test-Suite shared assertions all-green). The
> headline win is that **-II §1 / -IV §3 (the automated `compute() ≡ committed export` equivalence gate)
> finally LANDED** — a shared `tests/dex-tests.js` group runs `OxyDex.compute({text})` on a committed
> O2Ring CSV and deep-diffs the committed export (volatile/profile fields excluded), wired into `env.equiv`
> by BOTH runners (`Dex-Test-Suite.html` + `tests/run-tests.mjs`). This file captures what THAT landing
> exposed. Read `CLAUDE.md` first; both gates + the Clock Contract rule. Do NOT edit -II/-III/-IV/-V.

---

## 1 · ⚠ HIGHEST — the equivalence gate is OxyDex-ONLY; PulseDex + HRVDex equivalence is STILL by-construction

**What surfaced.** -IV §3 asked for the gate "for **each** node with a committed `uploads/*.csv` input +
fixture." The landed gate covers exactly **one** node — OxyDex — because OxyDex is the only node whose
input→export pairing is recorded in `FIXTURE-PROVENANCE.json` (`OxyDex_2026-06-13_1056_summary.json` ←
`O2Ring S 2100_20260612230016.csv`, and a second 0439/0624 pair). The gate (`env.equiv.oxydex`) runs
`OxyDex.compute({text})` → deep-diffs `nights[0]` against the committed fixture, excluding `{file,
provenance, kernel, vo2est, karv}` — verified **byte-identical** live. But **PulseDex** (RR) and **HRVDex**
(Welltory summary) have NO equivalent `env.equiv` entry, so their `compute() ≡ exportGanglior` equivalence
is — for the 5th time — guaranteed only by-construction (one shared builder) + the one-time hand checks the
legs ran. A future edit that drifts PulseDex's or HRVDex's app-export from its `compute()` would NOT trip a red.

**Do.** Extend `env.equiv` to PulseDex + HRVDex and add their cases to the
`Phase-9 compute() ≡ committed export — equivalence gate` group:
- **PulseDex:** pick a committed RR input (e.g. a `uploads/Polar_H10_*_RR.txt`) + the export it produces;
  record the pair in `FIXTURE-PROVENANCE.json` (re-run `PulseDex.compute(text)` → re-export → commit the
  fixture + record the producing bundle's `manifestHash`). Then assert `PulseDex.compute(text)` deep-equals
  it (exclude the volatile set; RR has no profile-coupled `vo2est`/`karv`, but confirm there is no other
  profile-coupled field before trusting byte-identity).
- **HRVDex:** likewise with a committed Welltory CSV (`uploads/WELLTORY_HRV_DATA_EXPORT_*.csv`) → its export.
  ⚠ HRVDex has NO code-gated fixtures today (pre-R1 'no provenance'); this would ADD its first one, so it
  must be done as a real fixture-provenance addition (re-run + re-export + record `manifestHash`), NOT a
  hand-built expectation.
**Risk to budget for:** byte-identity may NOT hold out of the box for these two the way it did for OxyDex —
event `t` strings, ordering, or a subtle profile-coupled field may differ; if so, widen the documented
exclusion set DELIBERATELY (and minimally), don't weaken the diff wholesale. **Gate cost:** test + a
committed fixture per node + a `FIXTURE-PROVENANCE.json` entry per node; **no app re-bundle** (the fixtures
are produced by the CURRENT bundles, which are gate-clean). This is the single highest-value open test item.

## 2 · ⚠ The gate compares to the committed FIXTURE, not to the LIVE app export

**What surfaced.** -II §1's literal target was "`compute()` ≡ **the app's own export**." The landed gate
compares `compute()` to the **committed export fixture** — a strong proxy (the fixture WAS produced by the
app) PLUS the `manifestHash` GATE A/B that reds the fixture the moment the producing code changes. Together
that catches the realistic drift. But it does NOT catch the narrow case where the app's CURRENT
`exportJSON`/`exportGanglior` path drifts from `compute()` while the committed fixture is left stale (GATE B
would red the fixture, but only if someone notices the fixture is now unreproducible — it wouldn't directly
say "the two CODE paths disagree").

**Do (decision, low priority).** Either (a) accept the committed-fixture proxy as sufficient (it is, given
GATE A/B) and record that here as the rationale; or (b) add — in the browser render-coverage `extraProbe`
where the app bundle is already booted with `win.exportGanglior`/`win.exportJSON` in scope — a direct
`appExport ≡ compute()` diff on the SAME synthetic input. Note (b) is browser-only (the app export entries
are DOM-coupled, not headless) and the export functions trigger a download rather than returning the object,
so it needs a small capture hook. **Gate cost:** none (test-only) if taken. Recommendation: (a) + this note,
unless §1's per-node extension makes (b) cheap to fold in.

## 3 · ◷ The `env.equiv` Node-CI path is UNVERIFIED (folds into the standing Node-CI debt)

**What surfaced.** `readEquiv()` was added to `tests/run-tests.mjs` (reads the committed O2Ring CSV +
fixture from `uploads/` into `env.equiv`), mirroring `readFixtures()`. It was verified in the **browser**
(the gate runs green there) but `node tests/run-tests.mjs` was NOT run (no Node host this pass — the same
constraint as -IV §7 / -V §4). If the `vm` load or the `uploads/` read behaves differently under Node, the
equivalence group could error or silently skip on CI.

**Do.** When a Node host is available, run `node tests/run-tests.mjs`, confirm exit 0, and confirm the
`Phase-9 compute() ≡ committed export — equivalence gate` group is present + green (it must, by construction,
match the browser). This is **not new work** — it's the existing -IV §7 / -V §4 Node-CI verification debt,
now with one more thing to eyeball when it's discharged. **Gate cost:** none (running CI).

## 4 · The -III §2 `meta.derived` note in `integrator-dsp.js` is SOURCE-ONLY (not in the shipped bundle)

**What surfaced.** -III §2 took the cheap doc-note option: an "audit-only / not yet consumed by fusion" note
was added to `integrator-dsp.js` (on `effConf`'s header) AND to `adapters/welltory-summary.js` (the emit
site). The adapter is unbundled (the note is live there). But `integrator-dsp.js` is BUNDLED into
`Integrator.html`, and the note was added **comment-only WITHOUT re-bundling** (correct — a comment is
runtime-inert, so re-bundling just to carry it would needlessly move `manifestHash` and flip the Integrator
fixture's GATE B). Consequence: the note exists in SOURCE but not in the shipped `Integrator.html` — a coder
reading only the bundle won't see it. This is intentional + gate-safe (verify-provenance checks the bundle,
which is unchanged), but it's a small source-vs-bundle skew to be aware of.

**Do.** Nothing urgent. Fold the comment into the bundle naturally **the next time `integrator-dsp.js` is
re-bundled for any real reason** (most likely the real fusion-side `meta.derived` down-weight that -III §2
scheduled — when `effConf` actually attenuates derived events + a posterior-ordering test lands). Do NOT
re-bundle the Integrator solely to carry a comment. **Gate cost:** rides whatever the next Integrator pass is.

## 5 · ◷ The browser render-coverage rig is UNRUNNABLE in a cross-origin preview sandbox (clarify: env limit, not a gate gap)

**What surfaced.** In the sandboxed preview used this pass, `Dex-Test-Suite.html` showed **9 persistent reds**
— all in the iframe-driven **render-coverage** groups ("bundle loads in iframe", "render-coverage rig ran
without throwing — Failed to read a named property 'addEventListener' from 'Window': Blocked a frame with
origin …", + a hang-probe worker error). These are **cross-origin isolation** failures: the rig boots each
app bundle in an `<iframe>` and reaches into `contentWindow.addEventListener`, which the preview's
per-document opaque origins block. The **shared** assertions (the ones `node tests/run-tests.mjs` runs) were
ALL green (876 passed); the reds are exclusively the browser-only render-coverage layer + verify-provenance's
runtime `buildHash` read (which also briefly timed out for OxyDex for the same reason).

**Do.** Confirm + document that this is an **environment limitation of the cross-origin preview**, not a code
regression: served over a normal same-origin static host (the documented way to run the suite), the rig boots
fine and these go green. If this preview environment is going to be a recurring test surface, consider a
one-line note near the render-coverage rig in `Dex-Test-Suite.html` ("render-coverage + verify-provenance
runtime reads require a same-origin host; cross-origin sandboxes block the iframe reach-in — the shared
`tests/dex-tests.js` assertions are origin-independent and are the CI floor"). **Gate cost:** none (doc).
**Do NOT** try to "fix" the rig by loosening origin handling — the isolation is the point elsewhere.

---

### Gate posture for this brief
- **§1** is the real work — test + one committed fixture per node + a `FIXTURE-PROVENANCE.json` entry per
  node; **no app re-bundle**. Budget for byte-identity NOT holding cleanly the way OxyDex did.
- **§§2·4·5** are decisions / docs (zero gate cost); **§4** explicitly rides the next Integrator re-bundle.
- **§3** is the standing Node-CI verification debt (-IV §7 / -V §4) with one more group to eyeball.
- None of these block anything shipped — the equivalence gate, both provenance gates, and the shared suite
  are green as of 2026-06-25. Stamp `Status: DONE` here only once the items you execute meet their "Do" AND
  `Dex-Test-Suite.html` is all-green (on a same-origin host) + `verify-provenance.html` GATE A/B clean. Index
  in `DOCS-INDEX.md`; spawn `-VII` only if new residue surfaces.
