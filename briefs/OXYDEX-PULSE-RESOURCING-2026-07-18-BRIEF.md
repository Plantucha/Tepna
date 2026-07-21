<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-20 (**Phase 1 EXECUTED + gated; §3.1 owner decision recorded (option b).** OxyDex now reads the O2Ring **perfusion index** from the Health-Box `*_OXYFRAME.txt` sidecar — a `;`-delimited superset of the ViHealth CSV (`parseCSV` gained delimiter detection + a `pi_pct` column; SpO₂/HR byte-identical from either file). `meanPi` surfaces at **measured** with a badge, rendered only when present; the ring's `pi_pct=0` no-perfusion sentinel is treated as absent, and a ViHealth CSV (no PI column) yields `meanPi: null` — never a fabricated 0. Verified on a real capture: `meanPi ≈ 2.15 %`, null on the same night's CSV. Ingest already routes the OXYFRAME to OxyDex via `^WELLUE` (no dex-ingest change). 12-assertion both-direction gate; OxyDex + orchestrators re-bundled; all three OxyDex goldens regenerated (each gained `meanPi: null, piFrames: 0` — additive); GATE A/B + both equiv legs green with the real inputs. ⚠️ Release-time `verifiedUnder` re-stamp is owed (needs the curated corpus — `release.mjs` blocks until then). **Phase 2 EXECUTED + gated 2026-07-20:** the Integrator now cross-checks the ring's finger WAVEFORM pulse against its own smoothed 1 Hz field (`fusePulseCrossCheck`, read-only, disagreement published never averaged; PpgDex exports `recording.site`, attach-only-when-both-present keeps fusion fixtures byte-identical; 22-assertion gate, all four gates green). **Still open:** Phase 3 (re-source `rmssd`/`hrVarSd` + re-tier), Phase 4 (CVHR, on the recorded §3.1 basis).) · **Created:** 2026-07-18

# The O2Ring's 1 Hz pulse is a smoothed vendor summary — demote it to a reference leg

> **What this is.** A scoping-and-execution brief for re-sourcing OxyDex's **pulse-derived** metrics from
> the 125.738 Hz finger pleth instead of the ring's 1 Hz firmware pulse — and for using the 1 Hz value the
> way ECGDex already uses the H10's firmware RR: as a **cross-check**, not a source.
>
> **This is the third application of a rule the suite already states twice.** `CLAUDE.md` §🎙️: the H10's
> device `_HR.txt` is *"smoothed (it under-states σ via a quiet-order artifact)"* so the honest leg is
> raw-ECG Pan–Tompkins; the Verity's `_HR.txt` is all-zero so its HR *"MUST be derived from the raw
> `_PPG.txt`"*. **The O2Ring is the same situation and the rule has not been applied to it** — only because
> until 2026-07-18 there was no waveform to derive from.
>
> **⚠️ SpO₂ IS NOT IN SCOPE AND CANNOT BE.** See §1. This brief touches the **pulse** half only.

---

## 0 · Blocked on

**`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md` must ship first.** There is no waveform-derived finger
PPI to compare against until it does. Do not start this brief before that one is DONE.

---

## 1 · The hard limit — SpO₂ cannot be re-sourced (read before scoping anything)

SpO₂ is computed from the **ratio-of-ratios** of red (~660 nm) to infrared (~940 nm) absorption. The
captured pleth gives **one channel**, and its **DC is already removed** by the ring's on-device
conditioning (measured: pulse occupies ~36 % of full scale, centred, drift ~12.9 LSB/10 s — see
`PPGDEX-O2RING-FINGER-SITE` §2). **Both halves of the required computation are unavailable.**

⇒ **ODI, desaturation burden, hypoxic burden, `desatProfile`, the whole ODI/AHI lane stay exactly as they
are, sourced from the 1 Hz stream.** Nothing in this brief touches them. Anyone who reads "re-source
OxyDex" as "derive SpO₂ from the waveform" has misread it — say so in the code comment.

**Perfusion index is the one bonus** (PR #212): live-header byte **`[7] ÷ 10` IS the PI** — non-zero in
99.9 % of frames over a real 5288-row night, mean **1.36 %**. That is a genuine physiological signal the
ViHealth CSV layout has no column for, and it is available **without** any waveform work.

---

## 2 · What is actually mis-sourced (the registry already confesses it)

`oxydex-registry.js` documents the limitation in its own citations — these are the re-source candidates:

| Metric | Tier | Its own citation |
|---|---|---|
| `rmssd` | experimental | *"**1 Hz pulse-rate RMSSD proxy — not RR-interval HRV**"* |
| `hrVarSd` | experimental | *"SD of 1 Hz pulse rate — **variability proxy (not RR SDNN)**"* |
| `meanHr` · `minHr` · `maxHr` | measured | *"direct pulse reading"* |
| `hrFloor` · `hrSlope` · `nocDip` | emerging / experimental | 1 Hz pulse statistics |
| `cvhrIndex` · `ahiEst` | emerging | CVHR from the 1 Hz pulse (Hayano) |
| `hrSpikes` | emerging | autonomic-arousal surrogate from HR rises |

**~8 of ~50 metrics.** The parenthetical apologies exist *precisely because* a 1 Hz series cannot resolve
beat-to-beat intervals. A waveform-derived PPI removes that constraint — `rmssd`/`hrVarSd` stop being
proxies and become real HRV, and CVHR gets a cleaner pulse series to work from.

**This is a re-source, not a rewrite.** Saying "OxyDex should be rewritten" overstates it by ~6×.

---

## 3 · The architectural fork — decide this FIRST, do not default

`ORIENTATION.md` is firm: *"A node analyzes exactly one signal and never imports another node."* The pleth
is a PPG signal. So there are three routes and they are **not** equivalent:

| Route | How | Verdict |
|---|---|---|
| **A** — OxyDex ingests the pleth directly | add PPG DSP to `oxydex-dsp.js` | ❌ **Duplicates the detector.** Two copies of beat detection drift apart — the exact trap `§1-II` closed by folding `deviceKey` onto one registry. |
| **B** — Integrator does the comparison + publishes upgraded metrics | PpgDex emits finger PPI; Integrator fuses | ✅ **Recommended.** Cross-node work already lives there; both nodes stay single-signal. |
| **C** — OxyDex ingests PpgDex's *derived* PPI series as a companion | node reads another node's export | ❌ **Breaks the no-node-imports invariant.** |

**Route B is recommended, but §3.1 is a genuine open question the owner should settle.**

### 3.1 · The awkward case — `cvhrIndex` / `ahiEst`

These are computed **inside** OxyDex from its pulse series, and `ahiEst` is a headline clinical-adjacent
number. Under Route B they would either (a) move to the Integrator, splitting OxyDex's apnea story across
two nodes, or (b) stay in OxyDex on the 1 Hz pulse and be *shadowed* by an Integrator-side waveform version,
which risks two AHI estimates disagreeing in public.

**✅ OWNER DECISION (2026-07-20): option (b), the recommendation.** Keep OxyDex's `ahiEst` as-is (the single-signal node's honest output from its own signal); the Integrator publishes a **corroborated** CVHR that names its source, and only ONE AHI is ever published. Phase 4 proceeds on this basis.

**Recommendation: (b), with only ONE published.** Keep OxyDex's `ahiEst` as-is (it is the single-signal
node's honest output from its own signal), and have the Integrator publish a **corroborated** CVHR that
names its source — the same pattern `typeApneaByEffort` already uses (it returns `null` rather than
competing when MotionDex is absent). **Never surface two AHI numbers without a stated precedence.**

---

## 4 · Phases

**Phase 1 — perfusion index (independent, ship first).** Surface PI from header `[7]÷10`. Needs no waveform
and no fork resolution. Tier: **measured** (direct device reading), same standing as `meanHr`. Add to
`oxydex-registry.js` + the ViHealth sidecar. Smallest useful increment.

**Phase 2 — the reference comparison. ✅ EXECUTED 2026-07-20.** With PpgDex emitting finger PPI, the
Integrator compares waveform-derived pulse against the ring's 1 Hz pulse — mirroring `ecgdex-dsp.js:2235
validateRR(selfNN, deviceRR)`. **Publish the disagreement**, do not average it away
(`integrator-dsp.js:2854` precedent: *"and the SPREAD — a disagreement is reported, never averaged
away"*). This phase is **read-only** — it adds a comparison, changes no existing metric. *Shipped:*
`fusePulseCrossCheck` fires only when a night carries BOTH a `site:'finger'` PpgDex (the honest,
waveform-derived HR) and an OxyDex (the ring's 1 Hz `stats.meanHr`); it reports `biasBpm =
deviceHr − waveformHr`, `pctOfWaveform`, and an `agree` flag (±3 bpm), with the waveform as `reference`
and the note *"the disagreement is reported, never averaged."* PpgDex now exports `recording.site`; the
Integrator's generic node-export normalizer surfaces `pulseHr1Hz` (the legacy `_summary.json` adapter
sets the same field). Attached to the fusion export ONLY when both legs are present → nights without a
paired finger capture stay byte-identical. 22-assertion both-direction gate (unit + real-export
end-to-end + source-structural); PpgDex/Integrator/Data Unifier/OverDex + 8 analysis tools + docs
re-bundled; the synthetic PpgDex golden gained `recording.site: "wrist"` (additive, re-recorded); all
four gates green (`build --check`, GATE A/B, biome, suite 3468).

**Phase 3 — re-source the HRV proxies.** Replace `rmssd`/`hrVarSd`'s 1 Hz derivation with waveform PPI.
**Re-tier deliberately**: they were `experimental` *because* of the 1 Hz limitation; on real PPI they earn
`validated` **only** if they reproduce the audited PulseDex HRV path — otherwise `emerging`. Do **not**
inherit PulseDex's grades on "same algorithm" (`CLAUDE.md` §🎫, `LITERATURE-USE-POLICY`).

**Phase 4 — CVHR**, only after §3.1 is settled by the owner.

---

## 5 · What NOT to do

- **Do NOT derive SpO₂ from the waveform.** §1. One channel, no DC.
- **Do NOT put PPG DSP in OxyDex** (Route A) or import PpgDex from OxyDex (Route C).
- **Do NOT quietly replace `ahiEst`.** Two AHI numbers without stated precedence is worse than one honest one.
- **Do NOT keep the `experimental` tier "to be safe" after re-sourcing.** An honest re-grade in *either*
  direction is required — a stale tier is as wrong as an inflated one.
- **Do NOT treat the 1 Hz pulse as ground truth in the comparison.** It is the *smoothed* leg; the waveform
  is the honest one. This is the whole point — the same reason `CLAUDE.md` §🎙️ bars the H10's `_HR.txt`.

---

## 6 · Gates

- Phase 1 is OxyDex-only: `node tests/run-tests.mjs` + `Dex-Test-Suite.html?full`;
  `node tools/build.mjs --app OxyDex` + `--check`; `verify-provenance.html` GATE A/B.
- **Phases 3–4 are NOT export-inert** — they move OxyDex metric values ⇒ move the export. `computeHash`
  **will** move. Per `CLAUDE.md` §🔒 that must be **computed and reported, never asserted**: regenerate the
  OxyDex fixtures by re-running the app and re-exporting, then re-verify with
  `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`. Note OxyDex has **two** committed summaries and only
  `_1056` has an equiv leg — **regenerate both** (they share code; `CLAUDE.md` §🔏 says so explicitly).
- New gates, both-direction verified (a gate that does not fail without its fix is hollow —
  `TEST-AUDIT-FINDINGS`): (1) PI surfaces and is absent-safe when the header byte is 0; (2) the reference
  comparison reports disagreement rather than averaging; (3) re-sourced `rmssd` on a known-HRV synthetic
  matches the PulseDex path within tolerance.

## 7 · Done when

§3.1 is settled by the owner and recorded here; PI ships at `measured`; the Integrator publishes a
waveform-vs-device pulse comparison that reports disagreement; the HRV proxies are re-sourced and
**re-tiered on evidence**; SpO₂-derived metrics are provably untouched (byte-identical in the diff); both
lanes green; fixtures regenerated with `computeHash` movement computed; changeset dropped. Then flip this
header to `DONE — <date>` and spawn `-FOLLOWUPS`.

**Record on execution:** the measured agreement between the ring's 1 Hz pulse and the waveform-derived
pulse. If they agree within the night-to-night spread, **say so** — that would mean the vendor's smoothing
costs less than assumed, and it is a legitimate negative result (`papers/dead-ends.html` precedent), not a
failed brief.

---

## Cross-references
- [`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md`](PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md) — **hard prerequisite** (§0); produces the finger PPI this consumes.
- [`O2RING-PROTOCOL-2026-07-17-BRIEF.md`](O2RING-PROTOCOL-2026-07-17-BRIEF.md) — §3 header (`[7]` = PI, `[11]` = motion) · §3b waveform layout.
- [`O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`](O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md) — captures the waveform.
- [`PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md`](PPGDEX-MULTICHANNEL-FUSION-2026-07-18-BRIEF.md) — sibling channel-handling work.
- [`INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md`](INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md) — the other consumer of the finger foot-stream.
- `CLAUDE.md` §🎙️ (derive HR from the raw waveform, never the smoothed device file) · §🎫 (no grade inheritance) · §🔒 (export-inertness is computed) · §📦 (changesets).
- Code: `oxydex-registry.js` · `oxydex-dsp.js` · `ecgdex-dsp.js:2235` (`validateRR` — the pattern) · `integrator-dsp.js:2854` (report the spread) · `capture-host/oxyii.py` (`parse_live` `[7]`/`[11]`).
