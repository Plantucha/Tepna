<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# SYNTH-TEXTURE FOLLOW-UPS IV — fixture regen residue (profile-coupling, stale sibling, input drift)

**Status:** DONE — 2026-06-24 · **Created:** 2026-06-24 · **Supersedes:** none · **Parent:** `SYNTH-TEXTURE-FOLLOWUPS-III-2026-06-24-BRIEF.md` (DONE 2026-06-24)

> **Execution note (2026-06-24):** All three pieces of residue resolved; doc/sidecar/fixture-move only —
> **no app re-bundle** (no `*-dsp.js`/`*-app.js`/`*.src.html`/module change), so `BUILD-MANIFEST.json` and
> `Dex-Test-Suite.html` are untouched. `verify-provenance.html` re-run after the changes: **GATE A PASS (8/8)**,
> `OxyDex_2026-06-13_1056` still `reproducible ✓ (code-gated)`, **zero reds** (the 4 warns are expected pre-R1
> fixtures), and the retired fixture no longer appears in the audit.
> - **§1 — DECIDED option (b):** `newMetrics.vo2est` + `newMetrics.karv` are profile-coupled (HRmax/HRrest =
>   f(age,sex); the profile is NOT in `provenance.inputs`, which fingerprints only the CSV). Rather than commit a
>   `*.profile.json` the app must read, they are **documented + strip-listed**: added to the GATE-C strip list in
>   `verify-provenance.html` (with the WHY) and to a new `_profileCoupledStripList` block in `FIXTURE-PROVENANCE.json`.
>   No re-bundle (sidecar/doc only); GATE A/B stay clean. (Mirrors how FOLLOWUPS-III held them at canonical for 1056.)
> - **§2 — RETIRED, not regenerated.** `OxyDex_2026-06-17_2042_summary.json` moved `uploads/` →
>   `docs-archive/retired-fixtures/` (+ a README rationale). A faithful re-run+re-export was **not achievable**: it is a
>   multi-generation relic (pre-FOLLOWUPS-III head-slice entropy **and** a full `ansAge` block the code dropped
>   2026-06-21), its original profile (incl. `elevation`/`cpap`, which move SpO₂ thresholds + apnea framing) was never
>   recorded, and the live bundle runs on the operator's REAL `localStorage` profile — so a re-export could neither
>   reproduce the committed non-entropy fields nor proceed without risking the operator's stored health data. The 1056
>   fixture already gives current sidecar-gated OxyDex coverage, so no gated coverage is lost. Its sole reference
>   (`integrator_fusion_2026-06-16.json` `inputs[]`) is an **immutable historical fusion snapshot** (CLAUDE.md /
>   §3 rule), left intact as a record of what was fused on 2026-06-16; documented in `_retired`.
> - **§3 — CONFIRMED benign + LEFT as historical.** The 3-byte delta on `O2Ring S 2100_20260612230016.csv` is a
>   prepended UTF-8 **BOM** (`EF BB BF`); `.text()` decoding consumes it and it sits before the header line, touching
>   no data row (first data row `23:00:16 12/06/2026,98,59,0` intact) — sample-inert, left as-is. The stale
>   `bytes: 30188` for the 1056 fixture in `integrator_fusion_2026-06-11.json` `inputs[]` is **left as a historical
>   snapshot** (integrator input fingerprints are historical records, not a live gate — GATE B is manifestHash-based).
> - **Follow-up:** none spawned — residue is cosmetic/by-design (a deliberately-left historical reference, a benign
>   BOM); nothing material surfaced that needs its own brief.

> Three pieces of residue surfaced while executing FOLLOWUPS-III Item 1 (the OxyDex entropy head-slice→decimation
> switch + fixture regen). None is a regression; none gates anything. They are about the *fixture-regeneration
> machinery* the switch exercised, not the entropy metric itself (which is done & gated green).

---

## 1 · OxyDex fixture `vo2est`/`karv` are USER-PROFILE-coupled → fixture regen is non-deterministic — *decide & pin*
Regenerating `OxyDex_2026-06-13_1056_summary.json` by re-running the re-bundled bundle on its committed O2Ring
input (the brief-sanctioned "re-run + re-export" path) reproduced every metric **except** `newMetrics.vo2est` and
`newMetrics.karv`, which moved purely because the ad-hoc run used the **default user profile** (age → `hrMax` 156)
whereas the committed fixture was made with a different profile (`hrMax` 130). FOLLOWUPS-III correctly held those
fields at the fixture's canonical values (they are profile-derived, not affected by the entropy code change), but
this exposes a latent fragility: **`vo2est`/`karv` depend on a user-profile input that provenance does NOT capture**
(it is not the committed CSV, and `provenance.inputs` only fingerprints the CSV). So a naive full re-export silently
moves them, and a future **GATE C** (full regenerate-and-diff, sketched in `verify-provenance.html` §3) would flag
them as volatile false-positives.

- **Decide:** either (a) pin the canonical profile used for fixture generation (commit it next to the fixture, e.g.
  a `*.profile.json` sidecar or a documented age/sex/weight in `FIXTURE-PROVENANCE.json`), so "re-run + re-export"
  is fully deterministic; or (b) add `newMetrics.vo2est`/`newMetrics.karv` (and any other profile-derived field) to
  the GATE-C **volatile-strip list** alongside `provenance.generated`, documenting that they are profile-coupled and
  excluded from byte-diff. Pick one; record which.
- **Done when:** the OxyDex fixture can be regenerated deterministically (profile pinned) OR the profile-coupled
  fields are explicitly documented + strip-listed; `verify-provenance.html` still GATE-A/B clean (no re-bundle —
  this is sidecar/doc only unless you choose to add a committed profile the app must read).

## 2 · The 2nd OxyDex fixture `OxyDex_2026-06-17_2042_summary.json` still carries HEAD-slice entropy — *regen or retire*
That fixture is **absent from `FIXTURE-PROVENANCE.json`** (legacy buildHash-only audit), so no gate flagged it, but
it still holds the OLD head-slice values (`research.hrEnt.sampEn` 0.1369 / `Low (regular)`, `research.spo2Ent.spo2SampEn`
0.0738 / `Low(periodic)`) produced by code that no longer exists after FOLLOWUPS-III. It is now an internally
inconsistent artifact (its entropy fields disagree with the shipped DSP).

- **Do:** either regenerate it the same way (re-run the re-bundled bundle on its input — find its source CSV from the
  `file`/`provenance.inputs` field — and re-export, then ADD it to `FIXTURE-PROVENANCE.json` so it gains code-gated
  teeth), or deliberately RETIRE it (delete / move to `docs-archive/`) if it is a stale duplicate no longer referenced.
  Check references first (`grep "OxyDex_2026-06-17_2042"`), incl. `integrator_fusion_*` inputs.
- **Done when:** no committed OxyDex fixture carries pre-FOLLOWUPS-III head-slice entropy; either it is regenerated +
  sidecar-listed (code-gated ✓) or retired with references updated.

## 3 · Committed corpus CSV drifted 3 bytes vs the fixture's recorded input fingerprint — *note / reconcile*
The fixture's pre-regen `provenance.inputs[0]` recorded `bytes 758732` / `sha256 eea708ad840dd456`, but the
**currently committed** `uploads/O2Ring S 2100_20260612230016.csv` is `bytes 758735` / `sha256 0a6b982a3ea41cf9`
(read off the live regen). i.e. the input file was modified by ~3 bytes (likely trailing-newline/editor touch)
*after* the fixture was last generated — the regen honestly re-stamped the current values. Separately,
`integrator_fusion_2026-06-11.json` still references the OxyDex fixture with a stale `bytes: 30188` (the fixture is
now larger after the full-expansion re-serialise). Neither breaks a gate (GATE B is manifestHash-based, not
byte-based), but it means input/byte fingerprints across fixtures are drifting silently.

- **Do:** confirm the 3-byte CSV delta is benign (diff the file tail; it must not change any parsed sample — the
  Clock Contract round-trip + metric parity already held, so almost certainly trailing whitespace). If benign, just
  note it. Optionally refresh the stale `bytes` in `integrator_fusion_2026-06-11.json`'s OxyDex input record, OR
  leave it (integrator input fingerprints are historical snapshots, not a live gate).
- **Done when:** the CSV delta is confirmed sample-inert (or fixed), and the integrator stale-byte reference is
  either refreshed or explicitly left as a historical snapshot with a one-line rationale.

### Note
Items here are housekeeping around the regen machinery, not physiology. If a maintainer judges #3 purely cosmetic
and #1 acceptable-as-strip-list, this brief can close quickly — but #2 (a shipped fixture disagreeing with shipped
code) should be resolved deliberately, not left.
