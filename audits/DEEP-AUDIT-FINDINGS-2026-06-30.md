<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** AUDIT FINDINGS (deep-correctness pass per `AUDIT-PROMPT.md`) · **Created:** 2026-06-30 · **Auditor:** AI agent · **Method:** invariant + counterexample, differential/metamorphic, live module probing, end-to-end trace

# Deep-audit findings — Tepna Dex suite (2026-06-30)

Executed the `AUDIT-PROMPT.md` MISSION. Established baseline, then hunted the 10 bug classes,
weighting **"plausible but wrong number"** highest. Verified live against the loaded modules in
`Dex-Test-Suite.html` (real `GLUDSP`/`ECGDSP`/`PPGDSP`/`DexUnits`/`IntegratorDSP`/registries) and
drove the real PB-render path inside `Integrator.html`'s own realm.

**Net:** the suite is in genuinely strong shape — the high-fear classes (Clock Contract, Baevsky
units, glycemic constants, fabricated-absence gates, fusion noisy-OR) are correct and well-gated.
Three findings: **one real surfaced-number + evidence-grade defect (PulseDex, MED)**, **one
test-infrastructure red that breaks the "green baseline" precondition (LOW/process)**, and **one
units-mandate presentation gap (GlucoDex mmol/L, LOW)**. A short verified-clean ledger follows so the
next pass doesn't re-spend the effort.

---

## Finding 1 — Baseline gate state (the mission's mandated finding #1)

- **Severity:** robustness / **test-infrastructure** (NOT a wrong number). But it makes the canonical
  signal — the `Dex-Test-Suite` all-green pill — **non-deterministically RED**, which is the
  precondition every future audit/contributor relies on.
- **Symptom:** On a cold load, `Dex-Test-Suite.html` settles to **`✕ 1 failing / 1553 passed / 100
  groups`**. The single failing assertion is **`Render coverage — Integrator periodic breathing →
  DOM · bundle loads in iframe` (0/1)**. `verify-provenance.html` is **green** (GATE A 8/8 + GATE B,
  `__provenanceOK=true`).
- **Reproduction / proof it is a flake, not a product defect:**
  - The rig (`Dex-Test-Suite.html:665` `renderCoverageIntegratorPB`) is the **3rd sequential boot** of
    the shared `#rig` iframe (after `renderCoverageECGDex` + `renderCoverageCPAPDex`), navigating it to
    `Integrator.html` with a fixed `setTimeout(resolve, 9000)` watchdog (`:670`). `booted` only
    becomes true if `rig.onload` fires inside 9 s; on a **cold** Integrator.html load it can exceed
    that, so `booted=false` → the assertion fails and the rig short-circuits (`:672`).
  - The **sibling** rig `Render coverage — Integrator computed → DOM` (the generic
    `renderCoverageApp`, later in `APP_COVERAGE`) boots the **same** `Integrator.html` and passes
    **9/9** — i.e. the bundle boots fine in this environment once the HTTP cache is warm.
  - The **headless** PB-fusion group `Integrator periodic-breathing corroboration (§2)` passes.
  - **I drove the rig's exact product path directly in `Integrator.html`'s realm**
    (`normalizeFile`×2 → `runFusion` → `renderAll` → `showView('findings')`): result = 1 corroborated
    PB block, **conf 0.872** (noisy-OR of OxyDex `0.60×0.6` and CPAPDex `0.80×1.0` = `1−0.64·0.2` =
    0.872, exactly right), observers `[OxyDex, CPAPDex]`, card renders "periodic breathing" + "signals
    agree" + both node names + the `.fc-ev` evidence badge, and the finding reaches `#findTable`.
    **Every assertion the rig would have made passes** — so the rig red is purely the iframe-boot
    watchdog, not the PB feature.
- **Root cause:** three heavy bundles now boot **serially through one shared `#rig`** with fixed 8–9 s
  watchdogs. The newest rig (`renderCoverageIntegratorPB`, added 2026-06-30 with cross-node PB fusion)
  is a **cold** Integrator.html boot at position 3; the later Integrator boot is warm. A boot
  **timeout is treated as a hard FAIL**, so an inconclusive timing event reds the canonical pill. This
  is the documented render-coverage timing class (`GENERIC-EMIT-GATE-FOLLOWUPS §3`,
  `GATE-LIVE-RUNNABILITY §4`, `SIGNAL-ADAPTER-FOLLOWUPS-IX §3`) — but those briefs address *count
  drift*, not a *persistent single-leg hard-fail on the all-green pill*. **This is in-scope** because
  the out-of-scope note explicitly affirms "the all-green pill IS the signal," and it is red.
- **Fix sketch + gate cost:** test-infra only, **no re-bundle**, no fixture change. Options (pick one):
  (a) on watchdog timeout, **retry the boot once** before failing (a timeout is inconclusive, not a
  proven defect); (b) **warm** Integrator.html (the later rig already does, for free) by ordering the
  light Integrator-computed rig before the PB rig, or pre-fetching once; (c) make a boot timeout a
  **visible SKIP** (yellow), not a FAIL, so the all-green pill reflects assertions actually run; (d)
  bump the PB rig's watchdog and/or give it a **dedicated iframe** so it doesn't inherit teardown from
  the two prior heavy boots. (a)+(c) together is the most honest — keeps teeth, removes the false red.
  Re-run `Dex-Test-Suite.html` to confirm all-green; `verify-provenance` untouched.

---

## Finding 2 — PulseDex surfaces & "validated"-badges two whole-night spectral rows from the crude `rmssd²` proxy, not Lomb–Scargle  *(the real defect)*

- **Severity:** **MEDIUM** — *mis-states a surfaced number* **and** *over-grades it* (top-tier symptom
  class), but **contained to PulseDex's own UI + CSV** (it is **NOT** in the cross-node
  `ganglior.node-export`, so fusion is unaffected). Hits audit class **#6 (spectral honesty)** and
  **#7 (evidence honesty)** simultaneously. Closes the long-open `SIGNAL-ADAPTER-AND-FRONTIER §622`
  action item ("confirm no surfaced number uses the crude `spectral()` path; if live, route to LS").
- **Symptom:** For any **long recording**, the PulseDex metrics table (and its CSV export) renders two
  frequency-domain rows — **"VLF (night)"** and **"Total Pwr (night)"**, unit **ms²** — sitting
  directly beneath the real **"VLF Power" / "Total Power"** (Lomb–Scargle) rows. Their values come
  from the crude `spectral()` proxy (`hf = rmssd²`; `lf = max(0, tp·0.35 − hf·0.1)`; `vlf = tp − hf −
  lf`), **not** the Lomb–Scargle PSD used by every adjacent spectral row. Worse, both rows carry the
  **`validated`** evidence disc with a Task-Force / Lomb–Scargle citation (via registry label
  aliases), so a crude variance-residual is presented as a method-validated band power.
- **Reproduction (file-backed, no live call needed — the crude row diverges 4–8× from the real LS row
  in the same committed file):**
  - `uploads/PulseDex_2026-06-13_1701_summary.json`: `"vlf": 1166` (Lomb–Scargle) vs `"vlfNight":
    8921` (crude) — **7.65×**. Also `_2026-06-12_0821`: `939` vs `3740` (4.0×); `_2026-06-13_1055`:
    `1384` vs `15033` (10.9×).
  - `uploads/PulseDex_2026-06-17_1623_summary.csv` rows 28–30 show them side-by-side, both ms²:
    `"VLF Power","1166",…,"Lomb–Scargle VLF"` then `"VLF (night)","8921",…,"Whole-night VLF/ULF …"`.
  - Code chain:
    - `pulsedex-render.js:182-183` — surfaces `r.vlfNight`/`r.tpNight` as rows, badged by `evBadge(m)`
      (line ~239 builds `${evBadge(m)}${m}` for **every** row).
    - `pulsedex-app.js:381` `const spNight = longRec ? spectral(a) : null;` → `:455`
      `vlfNight: spNight?spNight.vlf:null, tpNight: spNight?spNight.tp:null`.
    - `pulsedex-dsp.js:102-109` `function spectral(a){ … const hf=rmssd(a)**2; const lf=Math.max(0,
      tp*0.35-hf*0.1); const vlf=Math.max(0,tp-hf-lf); … }` — the `hf≈rmssd²` proxy.
    - `pulsedex-registry.js:125` aliases `'vlf (night)':'vlf'` and `:124 'total pwr (night)':'tp'`, and
      `:60`/`:57` grade `vlf`/`tp` **`evidence:'validated'`** with cites *"VLF power (Task Force
      1996)"* / *"Lomb–Scargle total spectral power"*. So the night rows inherit a `validated` badge
      and a method citation their value does not satisfy.
- **Root cause:** `spectral()` was the pre–Lomb–Scargle estimator. The main path was correctly
  migrated to LS (`pulsedex-app.js:376` `const ls = lombScargle(…)` is "the single source of truth")
  — but the **whole-night ULF "context" rows were left wired to `spectral()`** and never migrated.
  `tpNight` is numerically defensible (whole-night RR variance ≈ total power by Parseval) but is still
  **mis-cited** as *Lomb–Scargle*; `vlfNight` is the genuinely wrong number — a variance **residual**
  after subtracting an `rmssd²` HF guess and an arbitrary `0.35/0.1` LF split, with no PSD basis. The
  earlier brief's "if dead code, delete it" branch is **moot**: `spectral()` has a **live caller**
  (`pulsedex-app.js:381`) and a **surfaced, badged output**.
- **Fix sketch + gate cost (one gated change):**
  - Cheapest honest fix: **drop the two "(night)" rows** — the LS "VLF Power" row already covers VLF,
    and a trustworthy whole-night ULF isn't recoverable from the `rmssd²` proxy anyway. Removes both
    the wrong number and the mis-grade in one edit.
  - Or, to keep the rows: compute whole-night VLF/ULF from a **real** low-frequency periodogram
    (route to `lombScargle` over the full night with a ULF band), and keep `tpNight` only if relabeled
    "Whole-night RR variance" with the Lomb–Scargle cite removed.
  - Either way, **remove the `'vlf (night)'→vlf` / `'total pwr (night)'→tp` registry aliases** (or
    point them at honest, lower-tier entries) so the night rows can't borrow the `validated`
    Task-Force grade.
  - **Gate cost:** edits `pulsedex-app.js` (+ likely `-render.js`/`-registry.js`) → **re-bundle
    PulseDex** → **GATE A** `manifestHash` bump in `BUILD-MANIFEST.json`. **EXPORT-INERT**: `vlfNight`/
    `tpNight` are **app-display-only** and absent from the headless `buildNodeExport`
    (`pulsedex-dsp.js:797` `frequency:{lf,hf,vlf,lfhf}` are all LS), so the `pulsedex_equiv` fixture
    (`compute()≡export`) stays **byte-identical** — re-record its `manifestHash`, no regeneration. The
    committed `uploads/PulseDex_*_summary.{json,csv}` carrying `vlfNight` are **samples, not code-gated
    fixtures** → no GATE-B action. Then re-run `Dex-Test-Suite.html` (add a regression assertion — see
    below) + `verify-provenance.html`.
  - **Suggested regression assertion** (proves the finding, becomes the gate): in a co-loaded realm
    where `spectral`+`lombScargle` are reachable, assert on a synthetic long RR that
    `|spectral(a).vlf − lombScargle(a).vlf| / lombScargle(a).vlf` is **large** (documents the proxy is
    not LS) **and** that no *surfaced* PulseDex row whose value derives from `spectral()` resolves to a
    `validated` registry grade. (Today `spectral` is not on the namespaced `PulseDex` surface, so the
    cleaner gate is a `pulsedex-registry`/render structural check: the `'… (night)'` labels must not
    alias onto a `validated` entry.)

---

## Verified clean (checked this pass — do not re-spend effort here)

- **Clock Contract** (class #2): `ECGDSP`/`PPGDSP`/`IntegratorDSP` `parseTimestamp` return **`null`**
  on garbage/empty (no `now()` fabrication); overnight `22:00→06:00` = **8 h** monotonic (no 24 h
  jump); a zoned `+02:00` stamp and the same-wall-clock no-zone stamp produce the **same floating
  `tMs`** (`offsetMin=120`). Floating-`tMs` + `getUTC*` discipline holds in the paths probed.
- **Baevsky SI/CSI units** (class #1, the canonical example): `DexUnits.guardBaevsky` normalizes both
  `0.9 s / 0.3 s` **and** `900 ms / 300 ms` to seconds `{0.9, 0.3}`, flips `assumedMs` (false vs
  true), and `baevskySI` is **unit-invariant** (`SI=74.07` both ways; `RR_MS_THRESHOLD=10`). The
  sibling `d_csi` correctly consumes the guard-normalized seconds via `r._baevskyS`
  (`hrvdex-dsp.js:372` sets it; `:419` reads it) — the -III §1 fix is genuinely wired, not just
  commented.
- **GlucoDex glycemic constants** (class #1): `GMI = 3.31 + 0.02392·mean` ✓, `eA1c = (mean+46.7)/28.7`
  ✓, `LBGI/HBGI` Kovatchev `f = 1.509·((ln BG)^1.084 − 5.381)`, `r = 10f²` ✓, `J-index =
  0.001·(mean+SD)²` ✓; `TIR_CUT = {54,70,180,250}` ✓; band counts partition exactly (the per-band
  `%.1f` summing to 100.1 is display rounding, not a count error). Internal storage is **mg/dL** (the
  unit the CGM-consensus metrics + LBGI/HBGI/GMI/J-index literature constants are all defined in) — a
  defensible domain choice, not a wrong-number slip. **See Finding 3** for the one residual: there is
  no mmol/L *display* path at all.
- **Fabricated-absence gates** (class #3): the named zero-seed composites are correctly gated on
  inputs **present (>0)**, not `!=null` — `d_welfare`/Restoration (`hrvdex-dsp.js:544`),
  `d_efc` (`:434`), `d_ans_load` (`:401`), `d_coh_energy/d_pti/d_sfd/d_focus_eff` via `_hasSubj`
  (`:354`). The adapter seeds subjective fields to `0` (`:321`) and the `>0` gates convert that
  absence to `NaN`, not a fake score.
- **Cross-node PB fusion** (classes #5/#8): `fusePeriodicBreathing` requires **≥2 distinct** observer
  nodes, collapses multi-recording nodes to one observer (no inflation), tier-weights
  device>CVHR>proxy, and confidences via noisy-OR `combineConf` capped 0.97 — verified end-to-end
  (conf 0.872 exact). `_pbObserver` returns `null` (not a fabricated observer) when a node lacks PB
  evidence / `cvhrIndex < PB_CVHR_MIN`.
- **`std()` / SDNN unification** (class #5): all HRV/cross-node nodes use **sample SD (÷N−1)**
  consistently (`ecgdex`, `pulsedex`, `ppgdex`, `hrvdex`, `glucodex`). The population-SD (÷N) variants
  are confined to **non-cross-node** surfaces where N is large and the difference is negligible
  (`oxydex-dsp` `stdDev` for the SpO₂-pulse `hrSdnn` *proxy*; `ecgdex-morph` QT-SD; `pulsedex-overview`
  display) — an intentional, harmless difference, not a drift to "fix."
- **Provenance** (class #9): `verify-provenance.html` green — GATE A 8/8 `manifestHash` matches
  `BUILD-MANIFEST.json`, GATE B content-addressed fixtures reproducible, `__provenanceOK=true`.
- **PulseDex/HRVDex headless spectral export honesty**: the **cross-node** `frequency:{lf,hf,vlf,lfhf}`
  is sourced from `lombScargle`, not `spectral()` (PulseDex headless `buildNodeExport`). Only the
  app-display rows in Finding 2 use the proxy.

---

## Prioritized punch-list (correctness first)

1. **Finding 2 (MED, real):** PulseDex "VLF (night)" / "Total Pwr (night)" — surfaced from the crude
   `spectral()` proxy and badged `validated`/Task-Force. Drop the rows (or route to a real ULF
   periodogram) + remove the `'… (night)'→vlf/tp` validated aliases. One gated PulseDex re-bundle;
   export-inert (equiv fixture byte-identical). **Closes the open `SIGNAL-ADAPTER §622` item.**
2. **Finding 1 (LOW/process):** make the render-coverage iframe-boot watchdog non-fatal (retry-once /
   SKIP-on-timeout / warm-first / dedicated iframe) so the all-green pill is deterministic. Test-infra
   only, no re-bundle.
3. **Finding 3 (LOW / product-decision):** GlucoDex renders glucose **only in mg/dL** — TIR 70–180,
   TBR <54/<70, TAR >180/250, GMI, nocturnal-hypo <70 are all mg/dL, and there is **no mmol/L display
   toggle anywhere** (grepped: the only mmol/L references are the `parseCSV` auto-detect at
   `glucodex-dsp.js:147` and the `how-to-collect/` docs). CLAUDE's units mandate is "metric is the
   default on first load; an imperial/alternate display switch is permissible" — for glucose the SI
   metric unit is **mmol/L** and mg/dL is the US-customary one, so the suite defaults to (and only
   offers) the non-SI unit. **Why LOW:** mg/dL is itself a metric-derived mass-concentration (not
   "imperial" like lb/ft/°F), and the entire CGM consensus (Battelino 2019: TIR 70–180 mg/dL, the
   GMI/LBGI/HBGI constants) is authored in mg/dL — so *computing* in mg/dL is correct and the numbers
   are right; this is a presentation-mandate gap, not a correctness defect. Fix (product call): add a
   read-only mmol/L display switch (÷18.018 at the render boundary only — `GLUDSP.MGDL_PER_MMOL`
   already exists), default per the mandate; or record an explicit mg/dL-canonical CGM exception in
   `CLAUDE.md`. No compute/fixture change; display-only re-bundle if implemented.
