<!--
  ECG-INGEST-FOLLOWUPS-2026-06-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-28 · **Created:** 2026-06-28 · **Executed:** §1–§6 all landed — NEW shared `dex-ingest.js` (DexIngest classifiers, consumed by both apps + gate-backed by the new `Ingest routing table` group), `signal-orchestrate.pairCompanions` device-id filter + foreign reject (§1), PpgDex ingest mirror (§2), ECGDex `RESULT.deviceKey` cross-drop awareness (§4) + `_RR`-over-`_PPI` determinism & companion-group de-dupe (§5), `verify-provenance.html` hard-fail-on-parse + `Manifest JSON well-formed` group (§6). External-JS-only re-bundle: ECGDex `70fc04de6387→65e5eaaa152c`, PpgDex `b6155e9b3cdb→71e712b0b87c` (runtime buildHash UNCHANGED both — confirmed live; equiv fixtures EXPORT-INERT, re-recorded not regenerated). Residue → `ECG-INGEST-FOLLOWUPS-II-2026-06-28-BRIEF.md`. · **Follows:** the executed ingest-hardening fix recorded in `BUILD-MANIFEST.json` `_note_ecg_ingest_magn_skip` (ECGDex `manifestHash c8eb64808061→b8a195a082e1`, `buildHash 146ac9c8b1bd` unchanged; both gates green — Dex-Test-Suite all-green 1188/77, verify-provenance GATE A 8/8 + GATE B reproducible) · **Sibling-of:** `PPGDEX-FOLLOWUPS-2026-06-27-BRIEF.md` (§2 below mirrors into PpgDex) · **⚠ Coordinate-with / Up-references:** `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF.md` ("Vendor sniffing is buried in nodes / no shared vendor registry" — §3 below is the concrete instance)

# ECGDex ingest follow-ups — residue from the two-report ingest-hardening pass

> **Read `CLAUDE.md` first** (the two gates, the Clock Contract, frozen `Ganglior`/`fascia`, the
> edit-`*.js`/`*.src.html`-then-re-bundle rule). Nothing here is shipped-broken — the executed fix
> closed both user reports and both gates are green. Every item below is a **discovered-not-fixed**
> residue or a latent bug in an adjacent layer that the fix exposed by analogy.

## What was executed (context for this brief)

Two user reports, one ingest-hardening pass in **`ecgdex-app.js`** (`loadFiles` / `classifyECG`
and new helpers `sniffEcgKind` / `ecgDeviceKey` / `ecgStampMs` / `foreignKindFromName` /
`reportSkipped` / `_deviceName`). All app-side file-ingest ROUTING — `compute()`/`analyze()`/
`ecgBuildNodeExport` were **untouched** (so the `ECGDex_2026-06-27_equiv` fixture is export-inert,
`env.equiv.ecgdex` green; only the producing-bundle `manifestHash` was re-recorded).

- **Report 1** — a dropped Polar **Verity-Sense** session (no `*_ECG.txt`, only `_PPG/_MAGN/_GYRO/_ACC`)
  was analyzed as ECG because `classifyECG` defaulted **every** unrecognised name to `'ecg'` → a
  **magnetometer** file hit the QRS pipeline. Fix: `_MAGN/_GYRO/_PPG/…` + `MARKER_*` route to a
  `'skip'` lane; a first-line **header content-sniff** rejects a misnamed/suffix-less sensor file
  (`channel/ambient`=PPG, `[dps]`=GYRO, `[G]`=MAGN, `[mg]`=ACC) while a bare-numeric/header-less
  first line still passes as ECG.
- **Report 2** — dropping a **Verity-Sense session TOGETHER WITH an H10 session** (plus an **O2Ring
  SpO₂ CSV** and a **duplicated `*_ECG` file**) made ECGDex "process it all". Fix: (a) O2Ring/Wellue
  SpO₂ + Libre/CGM names & headers → `'skip'` (SpO₂→OxyDex, CGM→GlucoDex); (b) **device-id companion
  pairing** — when the drop carries ECG from an identifiable Polar device (`ecgDeviceKey` =
  `POLAR_<model>_<id>`), only **same-device** `_RR/_HR/_ACC` attach, foreign-device companions are
  set aside; (c) **de-dupe** ECG groups by device id + structured `YYYYMMDD_HHMMSS` stamp
  (`ecgStampMs`, anchored AFTER the 8-digit serial so the serial isn't misread as a date); (d)
  `reportSkipped` gives a clear "Loaded N ECG · ignored M …(breakdown)…" / "no ECG → use PulseDex /
  OxyDex" message (a no-ECG drop used to be a silent no-op).

Also repaired **in passing**: a **pre-existing** stray-quote JSON corruption in
`FIXTURE-PROVENANCE.json`'s `GlucoDex_2026-06-27_equiv` note (a premature `"` split one string →
invalid JSON → GATE B could not `JSON.parse` the sidecar). Truncated the stale duplicated tail;
GlucoDex's `manifestHash`/fields untouched. See §6.

---

## §1 (🔴 correctness — latent bug in an ADJACENT shipped layer) — `signal-orchestrate.pairCompanions` is DEVICE-AGNOSTIC

The same mistake the app fix corrected lives in the **shared orchestrate layer** that the Data
Unifier + OverDex call (`signal-orchestrate.js` — loose `<script src>`, not bundled).
`pairCompanions(signalType, primaryName, entries)` (≈ line 319) pairs each companion **kind** to the
primary by **NEAREST filename stamp only** (`fnameStampMs`, ≈ line 312; `streamKind`, ≈ line 300) —
**no device-id check**. So a folder-walk that contains BOTH a Verity-Sense session and an H10 session
can pair a **Sense `_ACC`** to an **H10 `_ECG`** (or an H10 `_ACC` to a Sense `_PPG`) whenever the
wrong-device sidecar's stamp is the nearer one. The host then hands that mismatched companion TEXT to
`compute()` via `ctx.companions` → wrong-device posture/RR on the Integrator's rich path.

**Do.** Lift the app's `ecgDeviceKey` filter into `pairCompanions`: a candidate sidecar must share
the **primary's device id** (parse `POLAR_<model>_<id>` from both names) when BOTH names carry one;
fall back to nearest-stamp only when a device id is absent (non-Polar / bare). Also reject
non-companion **foreign-signal** files from the candidate set (an O2Ring SpO₂ CSV is never an ECG/PPG
sidecar). This is the cross-host analogue of the app fix and keeps the two ingest paths in agreement
(the suite already asserts app↔Unifier export parity elsewhere; a device mismatch silently breaks it).

**Done when.** New Dex-Test-Suite case under the existing **'Companion-bundle ingest'** group: a
mixed Sense+H10 `entries[]` pairs each primary to its OWN-device sidecars (assert the H10 `_ECG`
gets the H10 `_ACC`, never the nearer-stamp Sense `_ACC`); a no-same-device-sidecar primary pairs
nothing rather than grabbing a foreign one. **Loose tool JS → no re-bundle**; runs in both runners
(add to `tests/dex-tests.js`, exercised by `run-tests.mjs` + `Dex-Test-Suite.html`).

## §2 (⚠ high — SAME bug class in PpgDex) — mirror the ingest hardening into `ppgdex-app.js`

`ppgdex-app.js loadFiles` (≈ line 53) has the identical shape: it pairs companions by `nearest(kind)`
**stamp only** (no device filter) and does **not** reject foreign-signal files. It already skips
`*_HR.txt` with a friendly note and errors on "no PPG", but a drop of **a Verity-Sense PPG session +
an H10 session** (or an O2Ring SpO₂ CSV) will cross-pair an H10 `_ACC`/`_MAGN`/`_GYRO` onto the Sense
PPG by nearest stamp, and a stray ECG/SpO₂ file is not positively rejected. PpgDex is **multi-file by
design** (PPG + `_ACC/_GYRO/_MAGN/_PPI`), so it needs the same three guards:

- **device-id companion filter** (only same-`POLAR_<model>_<id>` sidecars attach to a given `_PPG`);
- **foreign-signal rejection** by name+header (O2Ring/Wellue SpO₂ → OxyDex, raw `*_ECG.txt` →
  ECGDex, Libre/CGM → GlucoDex) — PpgDex's `classify()` + a header sniff;
- **same-session de-dupe** of duplicate `_PPG` files (device id + structured stamp).

**Note the asymmetry to preserve:** PpgDex's companion kinds are `acc/gyro/magn/ppi` (per
`signal-orchestrate._COMPANION_KINDS.ppg`), NOT ECG's `rr/hr/acc` — keep the kind sets node-specific;
only the **device-id + foreign-signal** logic is shared. **Decision to make:** factor the shared
helpers into one place (see §3) vs. copy-mirror into `ppgdex-app.js` (faster, but deepens the
duplication §3 calls out). **NODE change → re-bundle PpgDex + GATE A/B**; the PpgDex equiv fixture is
produced by `compute({text})` and is **ingest-inert** → re-record its `manifestHash`, do NOT
regenerate (confirm via `env.equiv.ppgdex`).

## §3 (⚠ high — testability + architecture) — the app ingest classifier is UNTESTED and the vendor regexes are DUPLICATED per node

`classifyECG` / `sniffEcgKind` / `ecgDeviceKey` / `ecgStampMs` / `foreignKindFromName` and the
de-dupe live **only in `ecgdex-app.js`**, are **not exported**, and are **not** in `tests/dex-tests.js`
— so a regex regression (e.g. an `_ECG`-vs-`_ECG2` boundary slip, or an O2Ring header rename) would
sail past **both** gates (the equiv gate exercises `compute({text})`, never the drop path; the
render-coverage rig drives `genSynthetic`, never a multi-file drop). This pass also **added MORE
per-node vendor regexes** (O2Ring/Wellue/Libre names + SpO₂/glucose headers) to one app file —
deepening exactly the debt `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF` flagged: *"Vendor sniffing
is buried in nodes … each node has its own `classify*()` + its own format regexes. There is no shared
vendor registry."*

**Do (two options, decide).**
- **(a) minimum-teeth:** promote the pure helpers to a **testable surface** (e.g. `ECGDSP`-exported
  `ingestKind(name)` + `deviceKey(name)` + `stampMs(name)`, or a small `dex-ingest.js` both the app
  and the suite load) and add a `tests/dex-tests.js` group asserting the routing table — incl. the
  exact bug cases (`*_MAGN.txt`→skip, O2Ring CSV→skip, H10-vs-Sense device split, `_ECG (2)`→dup,
  bare `.dat`→ecg, header sniff verdicts). This makes the contract gate-backed.
- **(b) durable:** a **shared device/stream/vendor registry** (one table of `{ namePattern,
  headerPattern, signalType, device, companionOf }`) that BOTH the apps' `loadFiles` AND
  `signal-orchestrate.streamKind`/`pairCompanions` consult — the long-standing AND-FRONTIER ask.
  Larger; sequence after §1+§2 so there's a second consumer to design against.

If **(a)** lands as an `ECGDSP` export it is a **NODE change → re-bundle + GATE A/B** (export-inert;
re-record hash). A standalone `dex-ingest.js` consumed by the app is also a re-bundle. A test-only
assertion against functions the app already exposes is zero-cost but requires exposing them first.

## §4 (medium) — cross-DROP device awareness

The device filter only engages **within a single drop that already contains an ECG** (`ecgDevices`
is computed from `realEcg` in that call). If the user drops the **H10 ECG first**, then **later drops
a Verity-Sense `_ACC` alone**, the second drop has no ECG anchor → it loads **globally** and pollutes
the *current* H10 recording (the pre-existing "companions-only → applied to current/next ECG"
path: `if(!ecgGroups.length) return;`). **Do:** stash the active recording's device key on the
result (`RESULT.deviceKey = ecgDeviceKey(primaryName)`), and in a companions-only drop filter the
incoming `_RR/_HR/_ACC` against it (drop + report a foreign-device companion, or prompt "this
sidecar is from <Verity Sense>, not the loaded <H10> recording — attach anyway?"). Cheap; app-only
re-bundle + GATE A/B (ingest-inert).

## §5 (low-med) — `_RR` vs `_PPI` last-wins in the rr lane

`classifyECG` maps **both** `_RR` and `_PPI` to `'rr'`, and `loadFiles` calls `loadDeviceRR` once per
file → with both present (a Polar H10 session ships both) the **second clobbers** `DEVICE_RR` by
**file order**, non-deterministically picking firmware RR vs peak-to-peak PPI for the self-RR↔device
Malik validation. **Do:** prefer the firmware `*_RR.txt` over `*_PPI.txt` deterministically (route
PPI to a distinct lane, or pick `_RR` when both exist for the same device+session). Same latent
last-wins for duplicate `_HR`. Small, app-only.

## §6 (low — process/gate hardening) — an invalid manifest JSON was committed and NOT caught

The `FIXTURE-PROVENANCE.json` GlucoDex-note corruption (repaired this pass) means the sidecar was at
some point committed as **invalid JSON** — which makes `verify-provenance.html` **GATE B** unable to
`JSON.parse` the file at all. That it persisted implies either the gate wasn't re-run after that edit
or a parse failure degrades **silently** instead of going red. **Do:** make `verify-provenance.html`
**hard-fail visibly** if `BUILD-MANIFEST.json` **or** `FIXTURE-PROVENANCE.json` fails to parse (a
distinct red verdict, not an empty/▢ audit), and/or add a trivial structural assertion in
`tests/dex-tests.js` that both manifests `JSON.parse` (cheap, runs in Node CI too). This is the
"close the false-clean gap" reflex CLAUDE.md already applies to GATE A's missing-manifest case.

## §7 — Known-by-design (DOCUMENT; do NOT "fix" back)

- **De-dupe + device-filter only engage for Polar Sensor Logger structured names.** `ecgDeviceKey`
  and `ecgStampMs` return `null` for non-Polar / bare names → such a drop falls back to the **prior
  global-companion behaviour** (and is never de-duped). Intentional: we only disambiguate when we can
  identify device+session. A future non-Polar ECG vendor needs its own name/structure (or §3's
  registry).
- **A foreign-device ACC is dropped even when it is the ONLY ACC in the drop** → the recording gets
  **no posture** rather than **wrong-device** (arm) posture for a chest ECG. Deliberate.
- **De-dupe is PRE-parse.** It runs on `ecgGroups` *before* `_loadQueue`/the worker, so a 188 MB
  duplicate `*_ECG` is set aside **without** being parsed twice. By design — keep it before the queue.
- **O2Ring/SpO₂ detection is name-OR-header.** `^O2RING`/`WELLUE`/… by name, or `spo2`/`oxygen
  level`/`pulse rate` by first-line header. A renamed O2Ring with a non-matching/foreign-language
  header could still fall through to the ECG default (then the content-sniff's numeric-first-line
  fallback accepts it). Acceptable; the durable fix is §3's shared registry, not more node regexes.

---

## Acceptance / "Done when" (per item, only what you execute)

- **§1** new 'Companion-bundle ingest' device-mismatch case green in **both** runners; mixed
  Sense+H10 `entries[]` pair own-device only. No re-bundle (loose JS).
- **§2** PpgDex mirrors device-filter + foreign-signal reject + de-dupe; **re-bundle PpgDex**,
  GATE A updated, `env.equiv.ppgdex` byte-identical (fixture re-recorded, NOT regenerated),
  Dex-Test-Suite all-green.
- **§3** chosen option lands with a gate-backed routing-table test; if it exposes a helper as
  `ECGDSP`/shared JS, **re-bundle the affected app(s)** + GATE A/B (export-inert).
- **§4/§5** app-only `ecgdex-app.js` change, **re-bundle ECGDex** + GATE A/B (ingest-inert →
  re-record hash, equiv fixture byte-identical).
- **§6** parse-failure hard-fail visible in `verify-provenance.html` and/or a manifest-parse
  assertion in `tests/dex-tests.js`.

## Gate ritual (every re-bundle — from CLAUDE.md)

Edit the `*.js`/`*.src.html`, **never** the bundled `*.html`; re-bundle via the inliner. After any
DSP/app change run **`Dex-Test-Suite.html`** → `#summary` must read **all green** (let it settle —
the render-coverage iframes boot sequentially). After re-bundling, read the new **`manifestHash`**
off **`verify-provenance.html`**, hand-update that bundle's entry in **`BUILD-MANIFEST.json`**
(GATE A has teeth only if you do), and re-record the producing-bundle `manifestHash` for any of that
node's fixtures in **`FIXTURE-PROVENANCE.json`** (GATE B) — regenerate a fixture **only** if the
export CONTENT moved (an ingest-routing change does not move `compute({text})` output). `buildHash`
moves **only** on an inline-`<script>`/`<style>` edit in the `.src.html` shell, so these external-JS
edits leave it unchanged — don't expect it to move.

## After executing this brief

Flip this header to `Status: DONE — <date>` **in place** (never rename the file), sync the
`DOCS-INDEX.md` row, and spawn `ECG-INGEST-FOLLOWUPS-II-2026-06-28-BRIEF.md` if execution surfaces new
residue (or note "no residue" in this header if not).
