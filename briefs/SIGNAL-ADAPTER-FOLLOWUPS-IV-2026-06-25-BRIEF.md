<!--
  SIGNAL-ADAPTER-FOLLOWUPS-IV-2026-06-25-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-07-04 (§§1·2·3·4 DONE — §1 live drop-through discharged 2026-07-04; §5 co-load drift RESOLVED by `dex-coload.js`; §6 util-namespacing + §7 Node-CI carried — see closeout) · **Created:** 2026-06-25 · **Follows:** SIGNAL-ADAPTER-FOLLOWUPS-2026-06-24-BRIEF.md (§3 namespaced-build / iframe-removal pass) · **Sibling-of:** SIGNAL-ADAPTER-FOLLOWUPS-II / -III-2026-06-24-BRIEF.md

> **CLOSED — DONE 2026-07-04.** **§1 fully discharged** in an interactive session: each of the three raw
> file types produces a valid `ganglior.node-export` through the REAL drop-zone UI — Data Unifier RR→
> PulseDex (4 ev), SpO₂ O2Ring→OxyDex (15 ev), Welltory→HRVDex (valid, `spanDays` +29) — and OverDex
> fuses a raw O2Ring + raw RR **live** (computed, not passthrough) beside an ECGDex export. Running it
> caught + FIXED a real bug: `adapters/welltory-summary.js` emitted `tsMs` in FILE order, so a real
> newest-first Welltory CSV yielded a `usable`-but-INVALID frame (`validateFrame` rejects a backwards
> `tsMs` step) → the HRV emit path was silently dead in both tools; the adapter now sorts ascending by
> `_tMs` at ingest (mirrors `commitRows` / VII §1). Adapter is unbundled source; mirrored into the two
> OWNED-but-NON-provenance orchestrator bundles (`Data Unifier.html` / `OverDex.html`) drift-free —
> **zero provenance-gate cost**. **§5 is since RESOLVED** — the 4-site (now 6-site) co-load list is the
> single greppable `dex-coload.js` manifest, gated by the `dex-coload manifest` test group. **§6**
> (`oxydex-util`/`-profile` namespacing) stays deferred-by-design to the next node whose `*-util` needs
> co-loading (still a lone collision-checked bare util). **§7** (`node tests/run-tests.mjs` exit 0) stays
> the fleet-wide standing Node-CI debt — no Node host in this environment — already carried in the
> VI–XII tail + `NODE-RESIDUE-FOLLOWUPS`. §8 minor/cosmetic: no action.
> **Progress 2026-06-25.** **§3 DONE** — the `compute() ≡ committed export` equivalence gate landed (shared dex-tests group, env.equiv wired in BOTH runners, OxyDex CSV→export verified byte-identical live); subsumes §2. **§2 DONE** — the OxyDex compute() floor is now a ≥1 h synthetic (4200×1 Hz) that traverses the vo2est/Karvonen branch + full processNight fan-out (the path that hid the §1 `upVO2category` gap). **§4 DONE** — the self-contained-compute rule ({self · kernel · own *-util} only; reach-ins `typeof`-guarded) is documented in `CONTRIBUTING.md` §6 (chose the cheaper doc option over a source-text gate). **§1** — the §3 fix is confirmed (OxyDex.compute reproduces both fixtures byte-identical) AND the live tools load clean with the shared summarizer wired (Data Unifier + OverDex smoke-checked); the remaining owed bit is a manual raw-file DROP through the drop-zone UI for each of the 3 signal types (needs an interactive session). **§5 / §6** are explicit "defer to the next node migration" decisions (centralize the 4-file co-load list / namespace the bare utils) — not taken at 3 nodes. **§7** (run `node tests/run-tests.mjs`, exit 0) is carried forward — no Node host in this environment (same constraint as §3's pass). No app re-bundle for any executed item here.

# Signal-adapter Phase-9 — follow-ups IV (what the §3 namespaced-build / iframe-removal pass exposed)

> Round IV. The §3 pass (2026-06-25) gave each migrated `*-dsp.js` a namespaced build, dropped the
> three per-node isolation iframes in `signal-orchestrate.js` (the host now co-loads PulseDex/OxyDex/
> HRVDex in ONE realm), collapsed `emit*NodeExport` into one `signalType`-dispatched `emitNodeExport`
> (-II §4), and moved a `compute()` functional floor into `tests/dex-tests.js` so BOTH runners execute
> it (-II §3). All 3 apps re-bundled (manifestHash moved, buildHash unchanged), Dex-Test-Suite 936/64
> all-green, verify-provenance GATE A/B clean. This file captures the genuinely-new issues the pass
> exposed. Read `CLAUDE.md` first; both gates + the Clock Contract still rule. Do NOT edit -II/-III.

---

## 1 · ◐ PARTIAL (2026-06-25) — the OxyDex headless SpO₂ path is fixed + the live tools load clean; a manual UI drop-through is still owed

**What surfaced.** The §3 functional floor (running `OxyDex.compute({text})` on the committed real
O2Ring inputs) threw twice in sequence — first `computeCeilingBaselineArr is not defined`
(`oxydex-util.js`), then `upVO2category is not defined` (`oxydex-profile.js`). Both are dependencies of
the OxyDex compute pipeline (`detectDesatEvents` → `computeCeilingBaselineArr`; `computeVO2maxEstimate`
→ `upVO2category`, the latter only reached for **≥1 h** recordings, `oxydex-dsp.js` `if (n < 1800)`).
**The OLD `oxyHost` isolation iframe srcdoc loaded ONLY `kernel-constants.js` + `oxydex-dsp.js`** — so
isolated `OxyDex.compute` **would have thrown on every real overnight O2Ring file** (they are all ≥1 h).
The OxyDex Phase-9 leg's "Data Unifier + OverDex now route & run SpO₂ raw files" / "OverDex raw coverage
RR→RR+SpO₂" was therefore **never actually exercised end-to-end** through the isolation path — only the
full-bundle render-rig (all modules present) and the byte-identical *bundle* re-run were tested, both of
which load `oxydex-util.js`/`oxydex-profile.js`, masking the gap.

**Fixed in §3:** `oxydex-util.js` is now co-loaded (before `oxydex-dsp.js`) on the Data Unifier / OverDex
/ Dex-Test-Suite pages + in `run-tests.mjs`; the `upVO2category` call (`oxydex-dsp.js` ~line 3239) is
**guarded** (`typeof upVO2category === 'function' ? … : null`) so the headless path is self-contained
(`vo2Category` stays null headless — harmless, the whole `vo2est` block is profile-coupled + strip-listed).
`OxyDex.compute({text})` now reproduces both committed fixtures byte-identical on every physiological field.

**Do (verification gap, not new code).** §3 verified `OxyDex.compute()` **in isolation** (direct call +
regen-diff). It did NOT drive the **actual tools' UI flow** — drop a raw O2Ring CSV into `Data Unifier.html`,
click "emit ganglior.node-export", confirm the download is a valid OxyDex export; and point `OverDex.html`
at a folder containing a raw O2Ring CSV, run, confirm it fuses live (not just via a pre-exported
`*_ganglior.json`). Do the same for a raw RR file (PulseDex) and a Welltory summary CSV (HRVDex) to confirm
the co-load didn't regress those. **Done when** each of the three raw-file types produces a valid export
through the real drop-zone UI (a screenshot/probe per tool). **Gate cost:** none (unbundled tools + manual/
probe check; no `*-dsp.js` edit).

## 2 · ✅ DONE (2026-06-25) — the `compute()` functional floor is now a ≥1 h synthetic (exercises the vo2est/Karvonen branch)

**What surfaced.** The new `tests/dex-tests.js` floor (`Phase-9 compute() — headless functional floor`)
exercises: PulseDex with a 300-beat RR array (robust), **OxyDex with a 10-min / 600-sample synthetic**
(deliberately `< 1 h`, so it NEVER reaches `computeVO2maxEstimate`/`upVO2category`), and HRVDex with two
hand-built stub rows. So the floor would **NOT** have caught the §1 `upVO2category` gap — only the manual
real-file regen-diff did. The floor proves "compute() runs + returns the right shape," not "compute() runs
the *whole* pipeline a real file traverses."

**Do.** Strengthen the OxyDex floor case to a **≥1 h synthetic** (≥3600 samples, with a few desats) so it
exercises the vo2est/Karvonen branch and the full `processNight` fan-out — i.e. the code paths a real
overnight file hits. Keep it deterministic. This converts the latent-dependency class of bug from
"caught only by a manual diff" to "caught by CI." **Gate cost:** none (test-only; re-run Dex-Test-Suite
green). Pairs naturally with item 3.

## 3 · ✅ DONE (2026-06-25) — -II §1 (automated `compute()` ≡ app-export equivalence gate) LANDED

**What surfaced.** To prove the namespace wrap was export-inert, §3 hand-wrote a regen-diff: fetch the
committed O2Ring CSV + fixture, run `OxyDex.compute({text})`, deep-diff excluding volatile
(`file`/`provenance`/`kernel`/`generated`) + profile-coupled (`vo2est`/`karv`). It passed cleanly (every
physiological field byte-identical on 26157- + 21806-row inputs). **This is exactly the assertion -II §1
asked to automate** ("compute() ≡ the app's own export"), and it has now been done by hand for the 4th
time (PulseDex, OxyDex ×2, HRVDex legs + this pass). The committed fixtures + their committed inputs are
already in `uploads/`; the diff logic is ~30 lines.

**Do.** Land -II §1 properly: add a browser-rig (or shared, since the DSPs now co-load) assertion that, for
each node with a committed `uploads/*.csv` input + fixture, `Node.compute({text})` deep-equals the committed
fixture's physiological fields (strip the documented volatile + `vo2est`/`karv` list). Then NO future
DSP/bundle edit can silently drift compute() from the shipped export without a red. Fold the §3 regen-diff
snippet in verbatim. **Gate cost:** none (test-only). **This is the single highest-leverage open test item
across rounds II–IV** — it subsumes item 2 and would have caught item 1 automatically.

## 4 · ✅ DONE (2026-06-25, doc option) — the SELF-CONTAINED `compute()` rule is documented in CONTRIBUTING.md

**What surfaced.** §1's two throws were both "compute reaches a bare global defined in a sibling module the
co-load doesn't load." I audited `oxydex-dsp.js` by hand (`grep` for `up[A-Z]…(` / `DexProfile` / external
refs) and found exactly `upVO2category`; PulseDex/HRVDex passed their floors so are *presumed* clean, but
were NOT audited the same way. The next migration (EEGDex/CGM/ECG) will hit this again if its DSP quietly
calls a render/profile sibling.

**Do.** Add a source-text gate (sibling of the DSP-purity group) that, for each migrated `*-dsp.js`, the set
of called-but-not-defined-locally identifiers ⊆ an allow-list of {`kernel-constants` exports, `oxydex-util`
exports (OxyDex only), documented builtins}. Any new external reference must be explicitly added to the
allow-list with a reason (forcing a deliberate "is this co-loaded?" decision). Cheaper alternative: just
document the rule in `CONTRIBUTING.md` ("a migrated DSP's compute path may reference ONLY self + kernel +
its own `*-util`; reach-ins to render/profile siblings must be guarded `typeof`-style"). **Gate cost:** none
(test or doc).

## 5 · ⚠ The co-load script list is hand-synced across FOUR files — drift bait at the next migration

**What surfaced.** Adding a node to the co-load realm means editing the SAME `<script>`/load block in
**four** places: `Data Unifier.html`, `OverDex.html`, `Dex-Test-Suite.html` (before `tests/dex-tests.js`),
and `tests/run-tests.mjs` (the `__DEX_NAMESPACED__` load array) — plus `oxydex-util.js` had to be inserted
*before* `oxydex-dsp.js` in all of them. -II §2 flagged "iframe-per-node"; §3 replaced it with
"co-load-line-per-node-×4-files," which is better (one realm) but still hand-synced. EEGDex/CGM/ECG will
each touch all four.

**Do (low priority, decision).** Consider a single shared snippet/manifest the four hosts include (e.g. a
`dex-coload.js` that, when `__DEX_NAMESPACED__` is set, is the canonical ordered list — or just a documented
ordered list in `CONTRIBUTING.md` the four sites copy). Not worth a heavy abstraction at 3 nodes; revisit
when the 4th migrates. **Gate cost:** none.

## 6 · `oxydex-util.js` / `oxydex-profile.js` remain BARE-GLOBAL (un-namespaced) siblings co-loaded into the shared realm

**What surfaced.** §3 namespaced the three `*-dsp.js`, but `oxydex-util.js` (csvSafe, escHTML, safeEl,
getBaseline, computeBaselineArr, computeCeilingBaselineArr, smoothVals, …) is co-loaded **bare**. It's safe
TODAY (verified: those names are defined ONLY in `oxydex-util.js` fleet-wide, no collision with
`integrator-dsp`/`signal-*`/`ecgdex`/`ppgdex`), and `oxydex-profile.js` is NOT co-loaded at all (the
`upVO2category` reach-in is guarded instead). But a future node's util with a generic name (`escHTML`,
`safeEl`) WOULD collide. The §3 realm is "namespaced DSPs + one bare util + one bare integrator."

**Do (low priority).** When/if a second node needs its `*-util` co-loaded, namespace the utils too (same
IIFE + conditional-bare-spray pattern as the DSPs) rather than stacking bare utils. For now, leave
`oxydex-util.js` bare (documented here as a known, collision-checked exception). **Gate cost:** none now;
a namespacing pass + re-bundle if taken later.

## 7 · ◷ Node CI (`node tests/run-tests.mjs`) was NOT executed during §3 — browser suite only

**What surfaced.** §3 was verified entirely through the **browser** `Dex-Test-Suite.html` (all-green 936/64)
+ `verify-provenance.html` (GATE A/B clean). The shared `tests/dex-tests.js` guarantees the *assertions* are
identical, but `run-tests.mjs` was edited to co-load the three namespaced DSPs (+ `oxydex-util.js`) into its
`vm` sandbox with a `documentStub`/`localStorage` shim, and **that vm load was never executed** (no Node in
the build environment this pass). Risk: a top-level statement in a co-loaded DSP that the `vm` `documentStub`
handles differently than a real browser (it shouldn't — the DOM touches are guarded `if(_fi)`/`if(ua)` and
`getElementById`→null), or an import-order issue, would surface as a Node SETUP ERROR (exit 2) invisible to
the browser run.

**Do.** Run `node tests/run-tests.mjs` once and confirm exit 0 + the `Phase-9 compute() — headless functional
floor` group is present and green in the Node output (it must, by construction, match the browser). If the
three DSPs fail to load in the `vm` (e.g. an unguarded top-level DOM access the stub returns null for), either
guard it or extend the stub. **Gate cost:** none (running CI). **This is the one verification §3 could not
self-perform — do it first.**

## 8 · Minor / cosmetic

- **FIXTURE-PROVENANCE 0439 entry** carries a now-historical phrase ("Produced by the current OxyDex bundle
  after the SIGNAL-ADAPTER Phase-9 re-bundle (manifestHash 17dae138c04b…)"); accurate as origin history, but
  the live `manifestHash` field + the GATE-B "still equals" line were updated to `336f500532da`. Leave or
  trim — no gate impact.
- **`data-unifier-app.js`** still has an unused `function pulseWin()`? (No — removed in §3.) But the local
  `emitNodeExport` is now signal-agnostic; the header comment was updated. Re-confirm no dead refs if you
  touch it.

---

### Gate posture for this brief
- **Items 1, 7** are **verification** (run the tools' UI / run Node CI) — no code, but they close the two
  things §3 asserted-but-didn't-exercise. Do them FIRST.
- **Items 2, 3, 4** are **test-only** (zero gate cost; re-run `Dex-Test-Suite.html` green). **Item 3 is the
  highest-leverage** — it subsumes 2 and would have auto-caught item 1.
- **Items 5, 6** are **decisions** (centralize the co-load list / namespace the utils) — defer to the next
  node migration; taking 6 means a re-bundle.
- None of these block anything shipped; §3 is DONE and gate-clean. Stamp `Status: DONE` here only once the
  items you execute meet their "Do" AND `Dex-Test-Suite.html` is all-green + `verify-provenance.html` GATE
  A/B clean. Index in `DOCS-INDEX.md`; spawn `-V` only if new residue surfaces.
