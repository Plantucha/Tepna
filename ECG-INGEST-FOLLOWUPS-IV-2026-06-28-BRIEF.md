<!--
  ECG-INGEST-FOLLOWUPS-IV-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **Created:** 2026-06-28 · **Follows:** `ECG-INGEST-FOLLOWUPS-III-2026-06-28-BRIEF.md` (DONE 2026-06-28) · **Up-references:** `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md` (shared vendor/ingest registry)

# ECGDex ingest follow-ups IV — gate the PPG companion *pick*, de-duplicate the planner primitives

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, the edit-`*.js`/re-bundle rule).
> Nothing here is shipped-broken — FOLLOWUPS-III landed §1 (the PPG drop-plan `DexIngest.planIngestPpg`)
> with both gates green (PpgDex `bc53eeaf74ff→cae7574289af`, buildHash `fff8fe8b1b68` unchanged). This
> is the residue a post-execution re-audit of that pass surfaced — two items the -III header initially
> under-weighted, plus the carried-forward known-by-design notes.

## What FOLLOWUPS-III executed (context)

-III added `DexIngest.planIngestPpg(items, opts)` — the PpgDex sibling of `planIngest` — and rewired
`ppgdex-app.js loadFiles` to CONSUME it. The planner owns the NAME-based plan: classify (`ppgKind`) →
foreign/skip set-aside (`foreignKind` + the caller's `opts.sniffedForeign` header-sniff verdicts) →
duplicate-session de-dupe (device id + structured stamp signature) → **per-primary device-ELIGIBILITY**
(only same-device sidecars are candidates for a given `_PPG`). It returns
`{ ppgPrimaries, eligibleByPrimary: { name → { acc, gyro, magn, ppi, marker } }, hr, skipped }`. A new
Dex-Test-Suite group (`'Ingest planning — DexIngest.planIngestPpg (PPG drop path)'`, both runners)
gates the mixed Sense+H10 split, the duplicate-`_PPG` set-aside, the device-`_HR` lane, sniff-foreign,
the per-primary split, and a source-mirror. **The brief deliberately KEPT the final nearest-companion
pick app-side** — it needs the PARSED `rec.t0Ms` (from `DSP.parsePPG`), which a NAME-only planner can't
see — so `loadFiles` still does `nearest(kind)` = pick the candidate whose `stampMs` is closest to
`rec.t0Ms || pf.stampMs` over `plan.eligibleByPrimary[pf.name][kind]`.

---

## §1 (⚠ — highest, the real gap) — the per-primary nearest-`t0Ms` companion PICK is now the SOLE un-gated link in PPG companion association

`planIngestPpg` device-FILTERS the candidates per primary; the **PICK** of which one attaches still
lives inline in `loadFiles` (`ppgdex-app.js`, the `nearest = (kind)=>{ … Math.abs((c.stampMs||0)-(ref||0)) … }`
closure). This is the **only** part of PPG companion association NOT gate-backed after -III, and it is
**PPG-UNIQUE** (ECG's `planIngest` loads EVERY deduped companion per lane — there is no "pick one
nearest" step to mirror, so -III's ECG group never exercised this logic class).

**Why it bites (the concrete failure).** Drop two SAME-device Verity-Sense sessions together, each with
its own `_ACC`:
```
Polar_VS_BBBB_20260617_010001_PPG.txt   Polar_VS_BBBB_20260617_010001_ACC.txt   (session 1, ~01:00)
Polar_VS_BBBB_20260618_233000_PPG.txt   Polar_VS_BBBB_20260618_233000_ACC.txt   (session 2, ~23:30 next day)
```
Both ACCs are SAME-device → BOTH are eligible for BOTH primaries (eligibility is device-based, by
design). **Only the nearest-`t0Ms` pick assigns each ACC to its own session.** A regression in that one
line — wrong `ref` (e.g. dropping the `rec.t0Ms || pf.stampMs` fallback), a flipped `Math.abs`, a
`<`/`<=` slip, or a `||0` that turns a missing stamp into epoch-0 and yanks every pick to the oldest
candidate — silently cross-pairs the wrong ACC onto a session, corrupting its motion gate / posture /
PI lane. Nothing red-flags it: the equiv gate drives `compute({text})` (single recording, no drop),
render-coverage drives `genSynthetic` (single session), and -III's NAME-only group stops at eligibility.

**Do (medium).** Make the pick a pure, headless, gate-backed surface:
- **Option (a) — extract a shared primitive.** Add `DexIngest.pickNearestByStamp(candidates, refMs)`
  (candidates carry `.stampMs`; returns the nearest, ties → first, `null` on empty) and have
  `loadFiles`'s `nearest` call it. `DexIngest` is already headless + in both runners, so the gate is a
  few `T.eq`s. **Caveat:** `dex-ingest.js` is bundled into BOTH ECGDex.html + PpgDex.html → this
  re-bundles TWO apps + GATE A/B for both (ingest-inert: `compute`/`*BuildNodeExport` untouched →
  fixtures byte-identical, re-record both manifestHashes, don't regenerate).
- **Option (b) — drive a crafted multi-file drop through the render-coverage rig.** Add a PpgDex
  render-coverage step that injects the two-session FileList above and asserts
  `allSessions[k].companions.acc` is the OWN-session ACC for each. No app code moves (no re-bundle), but
  it's browser-only (Node CI can't see it) and heavier to author.
- Prefer **(a)** — it gives Node-CI coverage and a reusable primitive; fold the 2-app re-bundle in with
  §2 (which also touches `dex-ingest.js`) so the fleet is re-bundled ONCE for both.

**Done when.** A both-runners assertion proves: two same-device sessions each pair their OWN nearest
companion (not the other's); the `rec.t0Ms || pf.stampMs` fallback is covered (a primary with a parsed
`t0Ms` AND one with only a filename stamp both pick correctly); an empty candidate set → `null` (no
attach). If the pick is extracted into bundled code, **re-bundle PpgDex (+ ECGDex if `dex-ingest.js`
changes) + GATE A/B**, ingest-inert (do NOT regenerate `*_equiv`; confirm `env.equiv.ppgdex`/`ecgdex`
byte-identical).

## §2 (⚠) — option (a) left the name-based primitives DUPLICATED across `planIngest` ↔ `planIngestPpg`

-III chose the whole-plan PPG sibling (option (a)) over factoring the shared primitives (the brief's
option (b)). Consequence: the **dedupe-by-device-session signature loop** (`dk = deviceKey`, `st = stampMs`,
`sig = dk+'@'+st`, keep-first) and the **device-eligibility filter** (`!cd || cd === pfDev`) now exist as
TWO copies — one inside `planIngest` (steps 5 + 8) and one inside `planIngestPpg` (steps 2 + 3). This is
the exact two-copy drift trap `dex-ingest.js` was created to close at the classifier layer (`ecgKind`/
`ppgKind`), reopened one layer up: a future fix to the signature rule (e.g. handling a vendor whose
stamp needs different anchoring) could land in one planner and silently skip the other.

**Do (LOW, structural — no behavior change).** Factor two shared internals on `DexIngest`:
- `_dedupeBySession(items) → { kept, dropped }` (the device-id + structured-stamp signature dedupe), and
- `_eligibleByDevice(primaryName, candidates) → candidates` (the `!cd || cd === pfDev` filter),

and have BOTH planners call them. Add a gate that the factored primitives produce the SAME result both
planners relied on inline (or a source-mirror that neither planner re-implements the `sig =`/`cd===`
logic inline). **Weigh the re-bundle cost:** `dex-ingest.js` is bundled into ECGDex.html + PpgDex.html,
so this re-bundles BOTH (flips both manifestHashes → re-record both GATE-A/B entries) for a PURELY
non-behavioral refactor. Per CLAUDE.md ("re-bundle only when runtime behavior changes; don't churn
fixtures for inert edits"), **batch §2 with §1** (which also edits `dex-ingest.js`) so the two apps are
re-bundled ONCE, OR defer §2 until `dex-ingest.js` is next touched for a behavior reason. Do NOT
re-bundle two apps for §2 alone.

## §3 (LOW — standing debt, DOCUMENT, do not re-open) — live mixed-drop end-to-end + Node-CI

- **Live mixed-drop UI verification.** -III gate-backed the drop path at the NAME level (and §1 above
  closes the pick), but the FULL end-to-end mixed Sense+H10 drop through the running `PpgDex.html` UI —
  `planIngestPpg` → app pick → `parsePPG` → `analyze` → render + the "Ignored N foreign/duplicate"
  banner — is still only unit-gated (render-coverage drives `genSynthetic`, a single session). A manual
  real-file drop is owed; this is the standing "live-UI drop" debt that recurs across the ECG-INGEST
  chain, now unblocked (the hosts emit; ingest is gated). Discharge opportunistically; don't spawn a
  brief for it alone.
- **Node-CI.** The literal `node tests/run-tests.mjs` run (+ the `env.equiv` byte-identity it would
  re-confirm) stays the standing debt tracked at `SIGNAL-ADAPTER-FOLLOWUPS-XII §3` — no Node host this
  session; discharged-by-equivalence (the browser `Dex-Test-Suite.html` runs the identical
  `tests/dex-tests.js` superset all-green). Do NOT open a third tracker.

## §4 (note — known-by-design, do not re-investigate) — `eligibleByPrimary` is keyed by primary NAME

Carried from -III: `eligibleByPrimary` keys on `pf.name`, so two DISTINCT same-named `_PPG` primaries in
one drop would share one map entry. This is **safe by construction**: a shared name ⇒ same `deviceKey`
⇒ identical device-eligibility set anyway, and the app reads `plan.eligibleByPrimary[pf.name] || {}` (a
miss degrades to "no companions attached", never a mis-attach). Polar Sensor Logger names are unique
(device id + structured stamp). **No fix** unless a non-Polar vendor with colliding names is added — at
which point key `eligibleByPrimary` by index/ref instead of name.

---

## Gate ritual (every re-bundle — from CLAUDE.md)

Edit the `*.js`/`*.src.html`, **never** the bundled `*.html`; re-bundle via the inliner. Run
`Dex-Test-Suite.html` → `#summary` ✓ all-green (wait for the render-coverage count to STABILISE before
trusting it); read the new `manifestHash` off `verify-provenance.html`, hand-update `BUILD-MANIFEST.json`
(GATE A) + the affected fixture(s) in `FIXTURE-PROVENANCE.json` (GATE B) — regenerate a fixture only if
`compute()` output moved (an ingest/pick change does not). `buildHash` moves only on an inline-`<script>`
/`<style>` edit in the `.src.html` shell (none here → expect it unchanged). If §1/§2 touch `dex-ingest.js`,
**both** ECGDex.html + PpgDex.html re-bundle → update both GATE-A entries + both `*_equiv` GATE-B
manifestHashes.

## After executing this brief — DONE 2026-06-28

**§1 + §2 executed; §3/§4 carried as documented.** §1 — extracted the per-primary nearest-`t0Ms` PICK
into `DexIngest.pickNearestByStamp(candidates, refMs)` (byte-faithful to the old inline closure: ties →
first, `null` on empty, `ref = refMs||0`); `ppgdex-app.js loadFiles`'s `nearest` now delegates to it.
§2 — factored the device-session dedupe + the device-eligibility predicate into shared
`_dedupeBySession(units, nameOf) → { kept, dropped }` + `_isDeviceEligible(name, anchor)` (anchor = a
device-key STRING for PPG's single primary, the device SET for ECG's multi-device drop, or null); BOTH
`planIngest` (steps 5/8 + the `_dedupeGroups` companion wrapper) and `planIngestPpg` (steps 2/3) now
call them — behavior-preserving (the ECG + PPG `planIngest` test groups stayed green). New Dex-Test-Suite
groups (both runners): **'Companion pick — DexIngest.pickNearestByStamp'** (two same-device sessions each
pick their OWN companion · `t0Ms||stampMs` fallback · empty→null · ties→first · source-mirror: the app
consults it + the inline distance-pick copy is gone) and **'Ingest planner primitives — shared dedupe +
eligibility'** (each primitive defined ONCE, called by both planners, the `seen[sig]` keep-first loop in
ONE place). `dex-ingest.js` bundles into BOTH ECGDex + PpgDex, so BOTH re-bundled in ONE pass: ECGDex
`7b9e7d25c3d7→6b7045bce040`, PpgDex `cae7574289af→2f9a7af7ca52` (both buildHash UNCHANGED —
external-JS-only). Ingest-INERT: `compute`/`*BuildNodeExport` untouched → neither `*_equiv` regenerated,
`env.equiv.ecgdex`+`ppgdex` byte-identical; both manifestHashes re-recorded in BUILD-MANIFEST (GATE A) +
FIXTURE-PROVENANCE (GATE B). **Both gates green (LIVE, same-origin):** Dex-Test-Suite ✓ all-green 1325/83
(incl. the 2 new groups + the equivalence gate + render-coverage on BOTH new bundles); verify-provenance
GATE A 8/8 (ECGDex `6b7045bce040`, PpgDex `2f9a7af7ca52`, buildHashes unchanged) + GATE B both equiv
fixtures `reproducible ✓ (code-gated)` + §6 parse-OK.

**§3 (live mixed-drop UI + Node-CI) + §4 (`eligibleByPrimary` name-key)** carried as documented /
known-by-design (no action this pass). **Residue → no `-V`.** The §2 source-mirror is structural, but the
two primitives' BEHAVIOR is functionally gated through the public `planIngest`/`planIngestPpg` groups
(which exercise both the SET- and STRING-anchor eligibility paths + the dedupe), so a drift would red one
of them. Standing Node-CI `env.equiv` literal `node` run remains tracked at
`SIGNAL-ADAPTER-FOLLOWUPS-XII §3` (discharged-by-equivalence; no Node host this pass).
