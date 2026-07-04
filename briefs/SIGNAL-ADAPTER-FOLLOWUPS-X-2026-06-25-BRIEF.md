<!--
  SIGNAL-ADAPTER-FOLLOWUPS-X-2026-06-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-25 · **Created:** 2026-06-25 · **Follows:** SIGNAL-ADAPTER-FOLLOWUPS-IX-2026-06-25-BRIEF.md (§1 the HRVDex full-recording export-scope fix) · **Sibling-of:** -II … -IX · **Followed-by:** SIGNAL-ADAPTER-FOLLOWUPS-XI-2026-06-25-BRIEF.md

> **Executed 2026-06-25.** **§1** — the HRVDex render-coverage leg is now END-TO-END: it ISOLATES a single
> recording (`commitRows(parseRows(csv),{replace:true})`; operator `localStorage` snapshot in `prep` →
> restore in a `finally`) and diffs `exportGanglior()` ≡ `compute({text})` on the text→parse path the
> seam-parity diff never exercised — **byte-identical** (HRVDex render-coverage group 17/17 ✓). **§2** —
> DECISION recorded: the human `exportCSV`/`exportJSONL` KEEP the filtered dashboard-window scope (option
> (a), "export what you're looking at"); a VISIBLE export-bar hint ("JSON / CSV export the current view —
> last N days[, mornings only]") now makes that truncation non-silent (`hrvdex-dsp.js` `_hrvRefreshChrome`
> + new `_hrvUpdateExportHint`, synced from `hrvdex-render.js` `rerender`). UI-chrome-only → export/compute
> builders untouched → both HRVDex code-gated fixtures export-inert. HRVDex re-bundled `94450ff5b53c`→
> `50d1a34cc950` (buildHash `de20db283366` unchanged, external-JS-only); GATE A + both fixture
> `manifestHash`es re-recorded (NO re-export). **§3** — CONTRIBUTING concurrent-run flake note added.
> **§4** — Node-CI `env.equiv` debt carried (no Node host). Gates: `Dex-Test-Suite.html` all-green 928/60;
> `verify-provenance.html` GATE A 8/8 + both HRVDex fixtures reproducible ✓ (code-gated). Spawned -XI.

# Signal-adapter Phase-9 — follow-ups X (residue the IX HRVDex export-scope fix carried / exposed)

> Round X. The 2026-06-25 -IX pass executed §1: HRVDex's `exportGanglior()` was silently truncating the Ganglior
> bus export to the dashboard's last-7-day `getFilteredRows()` window; it now exports the FULL `allRows`
> recording (matching the headless `compute({text})`/Unifier scope). HRVDex re-bundled
> (`12ee06f41b0f`→`94450ff5b53c`), GATE A + both fixture `manifestHash`es re-recorded (content unchanged). Both
> gates green (`Dex-Test-Suite.html` 943/61 same-origin; `verify-provenance.html` GATE A/B clean). -IX §1 also
> CORRECTED its own premise — the divergence was scope, NOT rounding (the export was always full-precision).
> This file carries -IX's deferred §2/§3/§4 + what the fix exposed. Read `CLAUDE.md` first; both provenance
> gates + the Clock Contract rule. Do NOT edit -II…-IX.

---

## 1 · ◷ The HRVDex §1 render-coverage diff tests SEAM parity, not the text→parse path (carried from -IX §2)

**What surfaced.** -IX §1 fixed the scope bug, but the `Dex-Test-Suite.html` HRVDex spot check still compares
`compute({rows: allRows})` to `exportGanglior()` (both wrap `hrvBuildNodeExport` on the SAME `allRows`), so it
proves the two ENTRY SEAMS agree but does NOT exercise the `{text}`→`_hrvParseSummaryRows` path end-to-end (the
path VII §1's sort bug lived in). OxyDex (`{text}`) and PulseDex (`parseRRInput`+`{intervals}`) legs DO test
parse→build vs the app end-to-end. The blocker for an HRVDex end-to-end `compute({text})` ≡ `exportGanglior`
diff is HRVDex's **accumulating running log**: `allRows` is restored from `localStorage` + merged across
sessions, so it is a SUPERSET of any single pasted CSV — a multi-file feature, not a bug.

**Do (low priority).** Make the HRVDex leg end-to-end by ISOLATING a single recording without disturbing the
operator's stored log: e.g. snapshot `localStorage[HRV_STORE_KEY]`, `clearAll`-equivalent reset in the rig,
load exactly one CSV, diff `compute({text})` ≡ `exportGanglior()`, then RESTORE the snapshot. (Per CLAUDE.md,
never leave the user's storage clobbered — snapshot+restore, don't `removeItem` and walk away.) If isolation is
too fragile in the shared rig, leave the seam-parity diff and keep the comment explaining WHY. **Gate cost:**
test-only.

## 2 · ◷ Confirm the FILTERED-view scope is intentional for the HUMAN exports (exportCSV / exportJSONL)

**What surfaced.** -IX §1 changed ONLY the Ganglior BUS export (`exportGanglior`) to full-recording scope. The
human-facing `exportCSV()` and `exportJSONL()` in `hrvdex-app.js` STILL build from `getFilteredRows()` (the
last-7-day / morning-only dashboard view). That is defensible ("export what I'm looking at"), but it was never
explicitly decided — and it means a user's CSV/JSONL download silently omits >7-day-old measurements too.

**Do (low priority, decision).** Confirm the intent: (a) human exports = filtered view (current — then add a
visible UI hint "exporting the current N-day window", so the truncation is not silent); or (b) human exports =
full log like the bus export (change both to `allRows`). Recommendation: (a) + a hint — the human is choosing a
window on purpose; only the machine bus export must be complete. **Gate cost:** docs/UI-only (a); re-bundle (b).

## 3 · ◷ The render-coverage suite false-reds under CONCURRENT runs (carried from -IX §3)

**What surfaced.** Running two `Dex-Test-Suite.html` instances at once (main preview + forked verifier) produced
transient reds that vanished on an isolated re-run: `Render coverage — ECGDex … bundle loads in iframe` (8 s
onload missed) and `OxyDex heavy-dropout hang guard … watchdog 12s — WATCHDOG TIMEOUT`. A single isolated run
is clean. Pure wall-clock contention on the shared hidden `<iframe>` + fixed 8 s/12 s budgets, not logic.

**Do (low priority).** Add a CONTRIBUTING note: "run `Dex-Test-Suite.html` in ONE tab at a time; a lone
ECGDex-bundle-load or OxyDex-watchdog red under contention is a flake — re-run isolated before treating it as
real." (Or make the budgets adaptive.) **Gate cost:** docs-only.

## 4 · ◷ The `env.equiv` Node-CI path is STILL unverified (standing -IV §7 / -V §4 / -VI §3 / -VII / -VIII §2 / -IX §4 debt)

**What surfaced.** No Node host this pass (the standing constraint). The five equivalence cases + the `HRVDex
recording block` group are verified GREEN in the BROWSER only. The render-coverage §1 spot checks are
browser-only by construction (they boot app bundles in an iframe) → they will NEVER run under Node CI; that is
expected, not debt.

**Do.** When a Node host is available, run `node tests/run-tests.mjs`, confirm exit 0 + the equivalence group
green for all five cases. **Not new work.** **Gate cost:** none.

---

### Gate posture for this brief
- All four items are LOW priority / standing debt — none block anything shipped (both gates green as of
  2026-06-25, HRVDex `manifestHash 94450ff5b53c`).
- **§1** end-to-end HRVDex test (gated on safe single-recording isolation); **§2** human-export scope decision;
  **§3** concurrent-run flake CONTRIBUTING note; **§4** standing Node-CI verification.
- Stamp `Status: DONE` only once the items acted on are complete AND `Dex-Test-Suite.html` is all-green
  (same-origin host) + `verify-provenance.html` GATE A/B clean (+ any re-bundle/fixtures regenerated if §2(b)).
  Index in `DOCS-INDEX.md`; spawn `-XI` only if new residue surfaces.
