<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# BADGE-PLACEMENT-SWEEP — FOLLOWUPS

**Status:** DONE — 2026-06-24 · **Created:** 2026-06-24 · **Owner brand:** Tepna
**Follow-up:** `DEX-PILL-UNIFY-2026-06-24-BRIEF.md` (carries §4 optional pill-class unification).
**Execution note (2026-06-24):** §1 + §2 executed. §1 — added GlucoDex registry entries
(`warmup`/`sessionSpread`/`sessionDrift`, all `measured`) + aliases so `Warm-up suppressed`,
`Between-session spread`, `Largest drift`, `Active time`→`duration`, `Compression lows`→`compression`
resolve; `'sessions'`/`'nights'`→`_META_DENY` so the structural session COUNT stays bare (the decided
option, matching ECG/Pulse count convention); `Sensor active`/`Stability Score` already resolved
correctly (`measured`/`experimental`, no change). PulseDex — added ANS-bar aliases `sns`→`ansSns`,
`psns`→`ansPsns` (`experimental`, set deliberately per node science), `lf`→`lf`; `HF`/`Total Power`
already `validated`. ECGDex audited — every q-stat quality tile already resolves to `measured`, no
change. §2 — PpgDex `Limb position` readout BADGED `heuristic` (new `posture` registry entry +
aliases; mirrors the PpgDex-Reference `Posture` card); CPAPDex cross-node corroboration tiles
(ECG-owned, `xn-tag` source chip) and GlucoDex/PulseDex event-stream rows ratified EXEMPT. §3 is a
watch-note (no action); §4 spun out to the follow-up above. Re-bundled GlucoDex/PulseDex/PpgDex
(external-JS edits → `manifestHash` moved, runtime `buildHash` unchanged); `BUILD-MANIFEST.json`
updated. Gates GREEN: verify-provenance GATE A PASS 8/8 + GATE B clean; Dex-Test-Suite
`cohesion-badges` all-green (only red rows are the cross-origin render-coverage/worker groups —
environment artifact, fail identically on untouched OxyDex). No fixtures changed (display-only grade
fixes; node-export content unchanged).
**Supersedes-context:** spawned by `BADGE-PLACEMENT-SWEEP-2026-06-24-BRIEF.md` (DONE 2026-06-24).
**Related:** `BADGE-COVERAGE-AUDIT-FOLLOWUPS-2026-06-23-BRIEF.md` (the coverage-side companion).

> What surfaced while executing the placement sweep across the 7 non-OxyDex nodes. Nothing here
> blocked the sweep's acceptance (all gates green: verify-provenance GATE A 8/8 + GATE B clean;
> Dex-Test-Suite contract groups incl. `cohesion-badges` all pass — the only red rows are the
> browser-only render-coverage/worker group, which is cross-origin-blocked in the sandbox and fails
> identically on the *untouched* OxyDex bundle, i.e. an environment artifact, not a regression).
> These items are resolver-alias gaps + deliberate scope calls worth a deliberate follow-up pass.

---

## §1 — Resolver-alias gaps → unowned labels fall back to hollow EXPERIMENTAL
Several **real** measurement labels don't resolve through their node's `idForLabel`/`*_LABEL_ALIAS`,
so `badgeForLabel(label, /*fallback*/true)` gives them the cohesion "no entry ⇒ visible experimental"
hollow disc. The disc is *present* (coverage mandate satisfied) but the **grade is wrong** — these are
data-quality/measured facts, not experimental. Fix = add registry aliases (or real registry entries),
NOT a hardcoded badge. Found during live spot-check:

- **GlucoDex** — sensor-session + data-quality tiles read `experimental` (should be `measured`/quality):
  `Between-session spread`, `Largest drift`, `Sensor active`, `Active time`, `Warm-up suppressed`,
  `Compression lows`, `Sessions` (the last is a count — decide: alias to a `measured` data-quality
  entry, or add `'sessions'`/`'nights'` to GlucoDex `_META_DENY` so counts stay bare like ECG/Pulse
  do for `session`). The `Stability Score` hero KPI also reads `experimental` via fallback — confirm
  whether the registry should carry it as the composite it is (it has a real formula).
- **PulseDex** — ANS-bar labels `SNS` / `PSNS` / `HF` / `LF` / `Total Power` were newly badged; confirm
  each resolves to its intended HRV-spectral grade rather than fallback (spectral HF/LF are
  `validated`; SNS/PSNS split is `emerging`/`experimental` per node science — set deliberately).
- **ECGDex / PpgDex** — q-stat quality tiles (`Analyzable`, `Beat coverage`, `Clean pulses`,
  `Correction rate`, `Mean SQI`, `Motion-rejected`, `ACC Hz`, `GYRO Hz`, etc.) — audit which resolve
  vs. fall back; SQI/coverage are `measured` data-quality, not `experimental`.

**Action:** one alias-table pass per node registry; re-run the reference-guide grade-equivalence check
(`cohesion-badges` only gates labels the node's OWN resolver maps, so a fallback label is invisible to
it — these gaps are exactly what that group can't see). Registry-only edits → re-bundle + bump
`manifestHash` in `BUILD-MANIFEST.json` for each touched node.

## §2 — Deliberately-left-unbadged surfaces (decide: badge or document as exempt)
Left bare on purpose during the sweep; flag here so a reviewer ratifies rather than "re-discovers":

- **CPAPDex · Cross-Node Corroboration** card (`#crossNodeCard`, render `m-label` tiles: `CVHR Index`,
  `ECG est. AHI`, `Resp-rate SD`, `RMSSD`, `Coupling drop`) — these are **ECG-owned** peer-export
  metrics, source-attributed with an `xn-tag "ECG"` chip and explicitly "not re-emitted". Badging them
  with CPAP's registry would mis-grade ECG metrics (or fallback-experimental them). The Integrator's
  pattern (grade-mirror of the producing node) is the correct model if we badge cross-node tiles at
  all. **Decision needed:** mirror the source node's grade, or treat the `xn-tag` source chip as
  sufficient provenance for borrowed metrics and exempt them from the disc mandate.
- **GlucoDex / PulseDex event-stream lists** (`gang-ev` / excursion / nocturnal-hypo rows) — these are
  emitted **events**, not measurement cards; left bare like the Ganglior stream rows. Confirm exempt.
- **PpgDex · "Limb position"** mini-h (ACC-gravity + MAGN heading readout) — a positional/heuristic
  chart, left bare. If kept, it'd take a `heuristic` disc.

## §3 — `buildHash` moved on 6 of 7 (expected) — watch the legacy fixture fallback
The Defect-C gap rules live in each node's `.src.html` `<style>`, so this sweep moved **both** hashes
on HRVDex/PulseDex/ECGDex/PpgDex/GlucoDex/CPAPDex (Integrator's shell was untouched — its badge markup
+ CSS are in `integrator-render.js`, so only its `manifestHash` moved). No fixture flipped because the
only provenance-stamped fixtures are OxyDex (code-gated, untouched) and the two Integrator fixtures
(legacy buildHash check, and Integrator's buildHash is unchanged). **But** the moment any of those 6
nodes gains a provenance-stamped `uploads/*.json` fixture that uses the *legacy* buildHash fallback,
this style edit would have flipped it red. Prefer adding new fixtures to `FIXTURE-PROVENANCE.json`
(code-gated on `manifestHash`) rather than relying on the coarse buildHash path — see CLAUDE.md
"Provenance gate".

## §4 — Optional polish noted in the parent brief §2 (not done this pass)
Status pills (`proj-badge`, `readiness-zone-chip`, `gang-pill`, severity pills) remain styled
per-card in several nodes; the parent brief offered unifying them onto one `.dex-pill` class as
optional polish. Not undertaken (out of placement scope) — capture as its own small brief if desired.
The disc-vs-pill distinction itself is correct everywhere (no status pill stands in for a missing
evidence disc — the VO₂max/Apnea-Bench class of bug was not reintroduced).
