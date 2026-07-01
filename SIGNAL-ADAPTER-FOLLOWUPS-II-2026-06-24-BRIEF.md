<!--
  SIGNAL-ADAPTER-FOLLOWUPS-II-2026-06-24-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-25 · **Created:** 2026-06-24 · **Follows:** SIGNAL-ADAPTER-FOLLOWUPS-2026-06-24-BRIEF.md · **Sibling-of:** SIGNAL-ADAPTER-FOLLOWUPS-III-2026-06-24-BRIEF.md (HRVDex-leg round — activates §§6–9 below; adds the unguarded-native-SI correctness gap)
> **Closed 2026-06-25 (all 9 items):** §1 the automated `compute() ≡ committed export` equivalence gate LANDED — a shared dex-tests group runs `OxyDex.compute({text})` on the committed O2Ring CSV + deep-diffs the committed export (vol/profile excluded) in BOTH runners (env.equiv wired in Dex-Test-Suite.html + run-tests.mjs); verified byte-identical live. §2 RESOLVED (§3 namespaced build shipped). §3 DONE (Node-side compute() floor). §4 DONE (orchestrate retitle + one `emitNodeExport` dispatch). §5 DONE — the per-node display one-liner folded into ONE shared `SignalOrchestrate.nodeExportSummary(exp)` (keyed on `exp.schema.node`); OverDex `_computedDetail` + the Unifier `_emitNote` now delegate (verified live, all three node shapes). §6 DONE — `signal-frame.js validateFrame` now ENFORCES the irregular-tsMs contract (monotonic non-decreasing, gaps OK, backwards step rejected) + documents it; gappy-validates / backwards-rejects tests added. §7 DONE — `how-to-collect/oxydex-spo2.md` + `welltory-hrv.md` shipped. §8 DONE — a `SignalSpec.hrv` resolver-identity assertion pins `.compute`/`.rows` to `HRVDex.compute`/`.parseRows` (rename-proof). §9 DONE — the DSP-purity allow-list reasons refreshed to the post-Phase-9 guarded state. Dex-Test-Suite all-green (shared assertions; the 9 reds are the preview's cross-origin iframe render-coverage limit, not these); zero app re-bundle for this brief (all test/doc/unbundled-tool work). No new residue → no `-VI` spawned from this file.
> Captures what surfaced while EXECUTING SIGNAL-ADAPTER-FOLLOWUPS §§1·2·9a (PulseDex Phase-9) and §4
> OxyDex-leg (OxyDex Phase-9). The parent brief's remaining open items (§3 namespaced-build, §4-HRVDex,
> §6 EEGDex/SpiroDex resolvers, §8 manifest projections) are NOT duplicated here — only NEW issues the
> two migrations exposed. Read `CLAUDE.md` first; both gates + the Clock Contract still rule.

# Signal-adapter Phase-9 — follow-ups II (what the first two node migrations exposed)

PulseDex and OxyDex now both expose a headless `compute()` the Unifier + OverDex call through
`signal-orchestrate.js`. The pattern works (suite 892/62, both gates clean), but executing it surfaced
issues worth a deliberate look before the **next** node (HRVDex) migrates and bakes the same shapes in
deeper. **Items 1–5 are what the PulseDex/OxyDex execution newly exposed; items 6–9 are the
non-RR-adapter / `SignalSpec` / purity-allow-list follow-ups pre-registered in DOCS-INDEX for the
HRVDex leg, folded in here so this II brief is the single home for round-II residue.**

---

## 1 · ✅ DONE (2026-06-25) — the automated `compute() ≡ app/export` equivalence gate LANDED

**What surfaced.** The whole point of `compute()` is that a file dropped into the Data Unifier / OverDex
produces the SAME node-export as the same recording run through `PulseDex.html` / `OxyDex.html`. Right
now that equivalence is enforced **only by construction** (both call one shared builder —
`pdBuildNodeExport` / `oxyBuildNightElement`) and, for OxyDex, by a **one-time hand check** I ran this
pass (re-ran the bundle on the committed O2Ring input → byte-identical to the fixture, 26 145 rows).
Nothing in `Dex-Test-Suite.html` will catch a future edit that lets the two paths drift — e.g. someone
adds a field to `exportJSON`'s element inline instead of in `oxyBuildNightElement`, or changes
`compute()`'s opts plumbing. The existing Phase-9 groups are **source-mirror** (regex "does the string
`oxyBuildNightElement(` appear") + a render-coverage smoke probe ("compute() returns a schema-valid
object"); neither compares the two outputs.

**Do.** Add a path-equivalence assertion to the browser render-coverage rig (it already boots each app
bundle in an iframe and has `window.PulseDex` / `window.OxyDex` in scope): for a fixed synthetic input,
compute the node-export via `compute()` AND via the app's real export entry, JSON-stringify both with
the volatile/profile-coupled fields stripped (provenance, `schema.generated`, and OxyDex's documented
`newMetrics.vo2est`/`karv`), and assert byte-equality. This is the gate that gives "one shared builder"
teeth — without it the builder is a convention, not a contract. (Node CI can't do this — bare-global
DSP doesn't load in the vm; see §3.)

## 2 · ✅ RESOLVED (2026-06-25, decision taken) — Isolation-iframe proliferation paid down NOW

> **RESOLVED — the fork was decided in favor of "do it now," and §3 landed (2026-06-25).** The
> namespaced-build pass shipped at 3 migrated nodes (not deferred to 5): each `*-dsp.js` is IIFE-wrapped,
> hangs its surface off `PulseDex`/`OxyDex`/`HRVDex`, and suppresses bare spray under
> `root.__DEX_NAMESPACED__`, so the host co-loads all three in ONE realm and `signal-orchestrate.js`
> dropped all three isolation iframes. See parent SIGNAL-ADAPTER-FOLLOWUPS §3 (DONE 2026-06-25).

## 2 · (original) ⚠ Isolation-iframe proliferation — one hidden iframe per migrated node, and it compounds

**What surfaced.** `signal-orchestrate.js` now boots **two** hidden same-origin iframes (`pulseHost`
for `pulsedex-dsp.js`, `oxyHost` for `oxydex-dsp.js`) because each node's DSP is a pile of BARE GLOBALS
(`parseRRInput`/`rmssd` vs `parseCSV`/`parseTimestamp`/`avg`) that collide if co-loaded in one realm.
HRVDex will add a third; ECG/CGM a fourth/fifth. Each iframe is an `srcdoc` that re-fetches
`kernel-constants.js` + the node DSP — so N migrated nodes = N isolation hosts booting in parallel in
the Unifier/OverDex, each ~a few hundred KB of script eval. It works, but it's the **cost the parent
brief's §3 (namespaced builds) was meant to remove**, and it's now growing linearly with every
migration instead of being paid down.

**Do (decision, not code).** Decide whether §3 (give each `*-dsp.js` a namespaced build — e.g. an IIFE
that hangs `PulseDex`/`OxyDex`/`HRVDex` off one global and stops leaking bare names — so the host can
co-load them in ONE realm and drop the iframes) should land **before** HRVDex migrates, rather than
after all nodes are done. Argument for doing it now: every additional node migrated under the
iframe-per-node pattern is another host to later unwind, and the namespace work is the same size whether
done at 2 nodes or 5. Argument for waiting: the iframes are functionally fine and §3 is a bigger,
re-bundle-everything pass. Flagging it as a real fork, not a default.

## 3 · ✅ DONE (2026-06-25) — `compute()` now has a Node-side CI floor (rode the §3 pass)

> **DONE (2026-06-25).** Now that §3 namespaced the DSPs, BOTH runners co-load them in one realm
> (`tests/run-tests.mjs` sets `ctx.__DEX_NAMESPACED__` + loads `oxydex-util.js`/`pulsedex`/`oxydex`/
> `hrvdex-dsp.js`; `Dex-Test-Suite.html` does the same and adds `env.PulseDex`/`OxyDex`/`HRVDex`). A new
> shared group **"Phase-9 compute() — headless functional floor"** runs `compute()` on synthetic input
> and asserts a schema-valid `ganglior.node-export` with a non-null core metric for all three nodes — so
> the functional path executes in Node CI, not just the browser rig. (It also surfaced the latent OxyDex
> `oxydex-util.js`/`upVO2category` headless-dependency gap, now fixed — see parent §3.)

## 3 · (original) `compute()` correctness has NO Node-side CI floor — browser-rig only

**What surfaced.** Because the DSP modules are bare-global, they can't be `loadInto`'d the way the pure
`*-dsp.js` math is in `tests/run-tests.mjs` — so the **functional** `compute()` checks (does it actually
run the pipeline and emit events/nights) live ONLY in `Dex-Test-Suite.html`'s browser render-coverage
rig. `node tests/run-tests.mjs` covers the source-mirror group but never executes `compute()`. If the
browser rig is ever skipped or the iframe boot flakes, a broken `compute()` ships green on Node CI.

**Do.** Once §3 namespaces the DSP (so it loads headlessly), move a minimal `compute()` functional case
(synthetic input → assert schema-valid export with non-null core metric) into the shared
`tests/dex-tests.js` so BOTH runners execute it. Until then, document in the suite that compute()
functional coverage is browser-only (a one-line note near the Phase-9 groups) so a future coder doesn't
assume Node CI is the full floor.

## 4 · ✅ DONE (2026-06-25) — orchestrator re-titled + the `emit*` family collapsed to one dispatch

> **DONE (2026-06-25).** `signal-orchestrate.js`'s header now reads "shared node orchestration (RR · SpO₂
> · HRV · …)". The per-signal `emit{RR,SpO2,Summary}NodeExport` are kept as named wrappers (call sites +
> the source-mirror gate reference them) under ONE `signalType`-dispatched `emitNodeExport(frame)`; OverDex
> and the Data Unifier now call the single dispatch (the per-signal `switch` at each call site is gone).

## 4 · (original) `signal-orchestrate.js` is now multi-signal but still self-describes as "RR orchestration"

**What surfaced.** The module header / filename framing says "shared RR orchestration"; it now also
hosts SpO₂ (`oxyHost`/`emitSpO2NodeExport`) and will host summary/EEG/etc. Minor, but it's the kind of
naming drift CLAUDE.md warns about — and `emitRRNodeExport`/`emitSpO2NodeExport` are growing into a
family that could be one dispatch (`emitNodeExport(frame)` routing on `frame.signalType`).

**Do (low priority).** Re-title the module header to "shared node orchestration (RR · SpO₂ · …)" — a
comment-only edit, NO re-bundle (it's an unbundled tool dependency). Optionally, when HRVDex lands,
collapse the per-signal `emit*NodeExport` functions into one `signalType`-dispatched entry so OverDex /
the Unifier stop growing a `switch` at every call site. Do NOT rename the file (cross-referenced).

## 5 · ✅ DONE (2026-06-25) — OverDex / Unifier per-node display folded into ONE shared helper

**What surfaced.** I added `_computedDetail` (OverDex) and `_emitNote` (Unifier) that `if (hrv)…else
if (nights)…` to summarize a computed export ("3 ev, rmssd 41" vs "ODI 4, minSpO₂ 88%"). Each new node
adds another branch in two places. It's fine at 2 nodes; flag it so it doesn't silently sprawl.

**Do (low priority).** When HRVDex (3rd node) lands, consider a single `nodeExportSummary(exp)` helper
(in `signal-orchestrate.js`, shared by both surfaces) keyed on `exp.schema.node`, so the per-node
one-liner lives in ONE place instead of being copy-branched in OverDex + the Unifier.

## 6 · ✅ DONE (2026-06-25) — `validateFrame` irregular-`tsMs` relaxation recorded + given teeth (CGM inherits it)

**What surfaced.** The SpO₂ frame carries a per-sample `tsMs[]` that is NOT strictly regular (O2Ring
drops/repeats samples; 1 Hz nominal, not guaranteed), so `SignalFrame.validateFrame` must tolerate
irregular/again-monotonic-but-gappy `tsMs` for `kind:'samples'` signals rather than demanding a fixed
cadence. That relaxation is load-bearing for OxyDex and will be inherited by **GlucoDex** (CGM is the
canonical irregular-cadence sample stream). Right now the tolerance is implicit.

**Do.** Make the rule explicit and tested: document in `signal-frame.js` exactly what `validateFrame`
guarantees for irregular `tsMs` (monotonic-non-decreasing, gaps allowed, `t0Ms` = first finite stamp),
and add a `dex-tests.js` assertion that a deliberately gappy/irregular spo2 frame validates `ok` while a
non-monotonic one fails. Zero gate cost (test + core-module comment; `signal-frame.js` is an unbundled
dependency).

## 7 · ✅ DONE (2026-06-25) — `how-to-collect/` notes shipped for the non-RR adapters

**What surfaced.** The RR adapters have capture notes (`wahoo-tickr-rr.md`, `coospo-rr.md`); the new
non-RR adapters do not. `adapters/oxydex-spo2.js` shipped this pass with NO `how-to-collect/oxydex-spo2.md`,
and the planned `adapters/welltory-summary.js` (HRVDex leg) will need one too.

**Do.** Write `how-to-collect/oxydex-spo2.md` (O2Ring/Wellue/Checkme overnight CSV export steps, the
`detect()` confidence rule — `o2ring|wellue|viatom|checkme` mark → 0.95, header SpO₂+pulse+time → 0.8 —
and the MDY-default Clock-Contract note), mirroring `coospo-rr.md`'s shape. Pair `welltory-summary.md`
with the HRVDex-leg adapter when it lands. Zero gate cost (docs).

## 8 · ✅ DONE (2026-06-25) — the new `SignalSpec.hrv` resolver is pinned + tested

**What surfaced.** Adding the spo2 path exercised `SignalSpec`'s `spo2` entry; the `hrv` (summary)
resolver that the HRVDex leg needs is still a placeholder and untested. The `SignalSpec` `dsp` resolver
names must match what each migrated node actually exposes (`parseCSV` for spo2, the summary parser for
hrv) or routing silently no-ops.

**Do.** Add a `dex-tests.js` assertion per migrated signal type that `SignalSpec[type].dsp` resolves to
a real function name the node's DSP exports (spo2 → `parseCSV`, hrv → the summary parser), so a rename
on either side trips the gate. Fold the `hrv` case in when the HRVDex adapter lands. Zero gate cost.

## 9 · ✅ DONE (2026-06-25) — the Phase-9 DSP-purity allow-list reasons refreshed

**What surfaced.** `oxydex-dsp.js` is a grandfathered-impure positive control whose top-level
file-input wiring is now **guarded** (`if(ua){…}`) so it loads headless — but the purity-gate allow-list
rationale (in `tests/dex-tests.js` / the audit notes) still describes the OLD unguarded state. Same risk
when HRVDex's DOM/`localStorage` wiring gets guarded.

**Do.** Update the DSP-purity allow-list reason strings to reflect the post-Phase-9 guarded state
(oxydex/pulsedex now load headless; the residual impurity is X), so the next auditor doesn't re-flag a
resolved item. Zero gate cost (test-comment / audit-note edit).

---

### Gate posture for this brief
Items 1 & 3 are **test-only** (no app re-bundle → zero provenance-gate cost; just re-run
`Dex-Test-Suite.html` green). Item 2 is a **decision** that, if taken, becomes a large §3 pass
(re-bundle all migrated apps + regenerate BUILD-MANIFEST). Items 4 & 5 are unbundled-tool edits (no
re-bundle). None of these block the HRVDex migration — but **item 1 should ideally land BEFORE HRVDex**,
so the equivalence gate is in place to catch the third node's app-vs-compute drift automatically instead
of by another hand check.
