<!--
  SIGNAL-ADAPTER-FOLLOWUPS-VII-2026-06-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-25 · **Created:** 2026-06-25 · **Follows:** SIGNAL-ADAPTER-FOLLOWUPS-VI-2026-06-25-BRIEF.md (§1 — extending the equivalence gate to PulseDex + HRVDex) · **Sibling-of:** -II / -III / -IV / -V / -VI

> **Execution note (2026-06-25).** **§1 (🔴, DONE):** `hrvBuildNodeExport` (`hrvdex-dsp.js`) now sorts
> `dated` ascending by floating `_tMs` — ONE ordering rule for both callers (the app's `exportGanglior`
> passes already-`commitRows`-sorted `allRows` = idempotent re-sort; the headless `compute({text})` path
> previously left newest-first Welltory rows in file order). On the committed 20-May Welltory CSV the
> recording block flipped from `startEpochMs/firstTMs`=last-day, `spanDays`=**−27** to
> `startEpochMs/firstTMs` 1779254174000 (earliest), `lastTMs` 1781674922000, **`spanDays`=29** — Clock
> Contract §4/§6 satisfied. DSP change → **HRVDex re-bundled** (manifestHash `ea74b3639c33`→`12ee06f41b0f`;
> buildHash `de20db283366` unchanged, external-JS-only); BUILD-MANIFEST GATE A updated; the -VI HRVDex equiv
> fixture regenerated (re-run `HRVDex.compute({text})` on the committed CSV, FIXTURE-PROVENANCE manifestHash
> re-recorded). New test group `HRVDex recording block — startEpochMs earliest, spanDays ≥ 0 (VII §1)`
> asserts `startEpochMs===firstTMs`, `firstTMs<=lastTMs`, `spanDays>=0`. Events are unchanged (already
> `.sort` by tMs in `hrvEventsFromRows`). **§2 (⚠, DONE):** the equivalence gate exercised ZERO events on
> both new nodes, so event `t`/conf/meta/ordering byte-identity went untested. Added two event-coverage
> cases (`env.equiv.hrvdex_events` + `env.equiv.pulsedex_events`) wired into BOTH runners + the per-node
> `CASES` table: **HRVDex** `uploads/HRVDex_2026-06-25_events.csv` (purpose-built 4-row newest-first Welltory
> CSV crossing both thresholds → `hrv_low` measured + `stress_high` heuristic/`meta.derived:true`, 4 events
> sorted ascending, `spanDays`=4) → `HRVDex_2026-06-25_events.node-export.json` (manifestHash `12ee06f41b0f`);
> **PulseDex** `uploads/PulseDex_2026-06-25_events_RR.txt` (deterministic synthetic 92-min/6153-beat Polar RR
> with one low-HRV window → windowed `hrv_drop` + `stress_peak`) → `PulseDex_2026-06-25_events.node-export.json`
> (manifestHash `3c85d78cd9c2`, **no PulseDex re-bundle** — committed real overnight RR is healthy-subject
> data that emits 0 events, so a synthetic input was required). Both fixtures produced BY the current bundles'
> shared builders → byte-identical to the app export; equivalence diff 0 fields. FIXTURE-PROVENANCE gained
> both entries; `verify-provenance.html`'s stale sandbox fallback list updated to include the four VI/VII
> node-export fixtures so GATE B audits them in a cross-origin preview too. **§3 (◷):** the `env.equiv`
> Node-CI path is STILL unverified here (no Node host) — folds into the standing -IV §7 / -V §4 / -VI §3
> debt, now with 5 equivalence cases (incl. 2 event cases) + the VII §1 group to eyeball. **Gates (green,
> same-origin/this preview):** `Dex-Test-Suite.html` ✓ all green, **887 passed / 57 groups** (VII §1 group +
> both event cases present + green); `verify-provenance.html` **GATE A PASS** (8/8 match — HRVDex
> `12ee06f41b0f`, PulseDex `3c85d78cd9c2`), **GATE B** all four 2026-06-25 node-export fixtures `reproducible
> ✓ (code-gated)`, no drift. **Spawned `SIGNAL-ADAPTER-FOLLOWUPS-VIII-2026-06-25-BRIEF.md`** for the residue:
> §1 (⚠) the -VI §2 gap is now PROVEN real (VII §1 was a genuine `compute() ≠ app-export` divergence the
> fixture-proxy gate did NOT catch — found by reading the export, not a red) → add option (b), a direct live
> `appExport ≡ compute()` diff (browser `extraProbe` + a capture hook on the download-triggering export), at
> least as a spot check, so a sorted-vs-unsorted-style divergence on ANY node reds; VII §1 closed it for
> HRVDex *by construction* (shared sorted builder) but OxyDex/PulseDex app-vs-compute parity is still
> by-construction + committed-fixture proxy only. §2 (◷) the Node-CI debt. §3 (note) the verify-provenance
> directory-listing audit only works same-origin; the hand-maintained fallback list is the recurring
> sync-debt surface.

# Signal-adapter Phase-9 — follow-ups VII (residue the VI equivalence-gate extension exposed)

> Round VII. The 2026-06-25 -VI pass extended the `compute() ≡ committed export` equivalence gate to
> PulseDex + HRVDex (two committed input→export fixtures + `FIXTURE-PROVENANCE.json` entries; both
> reproduced byte-identical against a fixture **generated from `compute()` itself**). Generating those
> fixtures + reading the resulting HRVDex export surfaced the items below. Read `CLAUDE.md` first; both
> provenance gates + the Clock Contract rule. Do NOT edit -II/-III/-IV/-V/-VI.

---

## 1 · 🔴 HIGHEST — HRVDex `compute({text})` does NOT sort rows; the APP path DOES → a real `compute() ≠ app-export` divergence (and a negative `spanDays`)

**What surfaced.** The HRVDex export's `recording.startEpochMs`/`firstTMs`/`lastTMs`/`spanDays` are built
from `dated[0]` / `dated[last]` in `hrvBuildNodeExport(rows)` (`hrvdex-dsp.js`), where `dated` is the row
array **in the order it arrives**. The two row sources order differently:
- **App path:** `parseCSV()` → `commitRows()`, and `commitRows` runs `allRows.sort((a,b)=>a._tMs-b._tMs)`
  (`hrvdex-dsp.js:232`) — rows ascending by time — BEFORE `exportGanglior` builds the export.
- **Headless `compute({text})` path:** `_hrvRowsFromInput` → `_hrvParseSummaryRows(text)` **directly**, with
  **no sort** (the `commitRows` sort is skipped). Rows stay in **file order**.

The committed Welltory export (`WELLTORY_HRV_DATA_EXPORT_*.csv`) is **newest-row-first**, so on the headless
path `dated[0]` is the **latest** measurement and `dated[last]` the earliest. The -VI HRVDex equiv fixture
captured exactly that: `startEpochMs`/`firstTMs` = 2026-06-17 (the newest row), `lastTMs` = 2026-05-20, and
**`spanDays = -27`** (negative). Two concrete problems:
1. **Correctness:** `recording.startEpochMs` is contractually the recording START (earliest valid sample —
   Clock Contract §4/§6: `t0Ms` = tMs of the *first* valid sample, and consumers reconstruct event absolute
   time from `startEpochMs`'s **date**). Here it is the *last* day of the span, and `spanDays` is negative —
   nonsensical for any downstream consumer (the Integrator included).
2. **The equivalence gate is self-consistent but does NOT match the live app export.** Because the -VI
   fixture was generated FROM `compute()` (unsorted), `compute() ≡ fixture` passes — but
   `HRVDex.html`'s own `exportGanglior` runs on the **sorted** `allRows`, so it would emit a DIFFERENT
   `recording` block (ascending start, positive spanDays). **This is the first concrete instance of the
   exact gap -VI §2 flagged** ("the gate compares to the committed fixture, not the live app export"): the
   fixture proxy here hides a real `compute()`-vs-app divergence rather than catching it.

**Do.** Make the headless `compute()`/builder path order rows the SAME way the app does, in the shared
builder so there's ONE ordering rule:
- Sort `dated` ascending by `_tMs` inside `hrvBuildNodeExport` (or in `_hrvRowsFromInput`/`HRVDex.compute`
  before the builder) — matching `commitRows`. Confirm `recording.startEpochMs` becomes the **earliest**
  sample, `spanDays` is **positive**, and events are unchanged (they are already `.sort((a,b)=>a.tMs-b.tMs)`
  in `hrvEventsFromRows`, so event order/content does not move — only the `recording` block does).
- This is a **DSP change** (`hrvdex-dsp.js`) → **re-bundle `HRVDex.html`**, update its `manifestHash` in
  `BUILD-MANIFEST.json` (GATE A), and **regenerate the -VI HRVDex equiv fixture** by re-running
  `HRVDex.compute({text})` on the committed Welltory CSV + re-recording the producing bundle's new
  `manifestHash` in `FIXTURE-PROVENANCE.json` (GATE B). The fixture's `recording` block WILL move
  (start/first/last/spanDays) — that is the intended fix, not a regression.
- After the fix, **the §2 gap closes for HRVDex by construction**: a sorted-vs-unsorted divergence can no
  longer exist because both paths share the one ordering. Note in the executed brief that this validates
  -VI §2's worry was real (so a future round may want option (b) — a direct live-`appExport ≡ compute()`
  diff — after all, at least as a spot check; see §3).

**Gate cost:** one `hrvdex-dsp.js` edit + HRVDex re-bundle + BUILD-MANIFEST + fixture regen + a test that
asserts `spanDays >= 0` and `startEpochMs === min(tMs)` on the committed CSV. **Risk:** verify no other
HRVDex consumer relied on the file-order `startEpochMs` (the app already sorts, so the app is unaffected; the
Unifier/OverDex call `compute()` and WANT the sorted/correct value).

## 2 · ⚠ The equivalence gate exercises ZERO events on both new nodes — event `t`/ordering/meta byte-identity is still UNTESTED

**What surfaced.** Both -VI fixtures have **`ganglior_events: []`**: the PulseDex RR input
(`Polar_H10_…_20260613_204448_RR.txt`, a 7.3-min spot reading) triggers no `hrv_drop`/`stress_peak` windows,
and the Welltory CSV has no row with `rmssd < 20` (→ `hrv_low`) or `stress >= 70` (→ `stress_high`). So the
gate confirms the event builder *runs and returns empty* (which IS sensitive to a threshold drift that would
make events appear), but it never byte-checks an actual event — exactly the `t`-string format / ordering /
`meta` payload that -VI §1 explicitly named as the byte-identity risk for these two nodes. The risk was
flagged and then went **unexercised**.

**Do.** Add (or swap to) a committed input per node that emits **≥1 event of each impulse**, and extend the
equivalence fixture so the diff covers the event array:
- **HRVDex:** the other committed Welltory file (`WELLTORY_HRV_DATA_EXPORT_04_May_2026_…_02_Jun_2026_….csv`)
  or a small purpose-built summary CSV containing at least one `rmssd<20` row (→ `hrv_low`, measured) and one
  `stress>=70` row (→ `stress_high`, `meta.derived:true`, heuristic). This positively checks the
  `_hrvClockS` `t` string + the `meta` block + ascending sort.
- **PulseDex:** an RR input long/variable enough to produce ≥1 `hrv_drop` and ≥1 `stress_peak` window (an
  overnight `Polar_H10_*_RR.txt` already committed), so the full windowing (`pdEventsFromResult`) is
  byte-checked end to end.
- This rides on §1's HRVDex re-gen anyway (same regenerate-fixture workflow). Budget for the event `t`
  strings being the place byte-identity is most likely to wobble; if it does, fix the divergence, do NOT
  widen the exclusion to skip events. **Gate cost:** test + (possibly) one more committed fixture; **no app
  re-bundle** beyond §1's HRVDex one.

## 3 · ◷ Node-CI verification of `env.equiv` (PulseDex + HRVDex cases) — still the standing -IV §7 / -V §4 debt

**What surfaced.** -VI wired `readEquiv()` in `tests/run-tests.mjs` to read the two new input→fixture pairs,
and verified the gate logic green **in the browser**, but `node tests/run-tests.mjs` was NOT run (no Node
host this pass — same constraint as -IV §7 / -V §4 / -VI §3). If the `vm` co-load or `uploads/` read behaves
differently under Node for the RR-text/Welltory-CSV pairs, the equivalence group could error or silently skip
on CI.

**Do.** When a Node host is available, run `node tests/run-tests.mjs`, confirm exit 0, and confirm the
`Phase-9 compute() ≡ committed export — equivalence gate` group is present + green for **all three** nodes
(oxydex/pulsedex/hrvdex). After §1 lands, this is also where option (b) from -VI §2 (a direct
live-`appExport ≡ compute()` diff) is cheapest to add as a Node-side spot check if desired. **Not new
work** — the existing Node-CI debt, with the PulseDex/HRVDex equivalence cases added to eyeball. **Gate
cost:** none (running CI).

---

### Gate posture for this brief
- **§1** is the real work — a DSP fix + HRVDex re-bundle + BUILD-MANIFEST update + equiv-fixture regen +
  a `spanDays>=0` / `startEpochMs===min` test. It also closes -VI §2's gap for HRVDex by construction.
- **§2** is test-coverage hardening (event byte-identity); rides §1's regenerate workflow, no extra
  re-bundle.
- **§3** is the standing Node-CI verification debt (-IV §7 / -V §4 / -VI §3) with the new cases to eyeball.
- Stamp `Status: DONE` here only once §1's fix meets its acceptance (sorted recording block, positive
  spanDays, fixture regenerated) AND `Dex-Test-Suite.html` is all-green (same-origin host) +
  `verify-provenance.html` GATE A/B clean (HRVDex `manifestHash` updated in BUILD-MANIFEST + the sidecar).
  Index in `DOCS-INDEX.md`; spawn `-VIII` only if new residue surfaces.
