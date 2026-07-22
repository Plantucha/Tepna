<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-19 (**§1.1, §1.2, §1.3, §1.5 EXECUTED + gated — re-checked against `main` on 2026-07-19, in code, not from this header.** §1.1: `pairCompanions` over the real 250-file `Ecg nightly/` H10 corpus answered §6's open question — the defect is **not latent**, **147 of 153** companion slots paired to the wrong night, fixed to **153/153**; `fnameStampMs` anchored + numeric-id two-night gate. §1.2: `dex-ingest.js` `deviceKey`/`stampMs` widened for the contiguous capture-host stamp (PR #221). §1.3: `ppgdex-dsp.js` dedupes bit-identical channels before the consensus vote, so a replicated channel reports `ledAgreement: null` instead of a `measured`-tier 100 (PR #225). §1.5: `pat-gate.js` single-sources the promotion gate and publishes `vdCorr` (PR #217). §1.6 is **half closed by another brief** — the Integrator now assigns `summary.respRateBrpm` via `MULTI-SENSOR-DERIVATIONS`, but PpgDex's `lombScargle` still never retains the HF argmax, so the PpgDex link remains open. **§1.8 CLOSED 2026-07-22** — re-verified against `main`: the Gauss→mag/µT fix shipped as `DEEP-AUDIT-II §7.9` (PR #332) with a both-direction gate (`tests/dex-tests.js:19874`); the parse-boundary conversion resolves the finding's "unreachable" note (see §1.8). **Still open: §1.4** (blocked on `PPGDEX-O2RING-FINGER-SITE`), **§1.6 (PpgDex half), §1.7** — not re-verified closed, so not claimed closed. ⚠️ This header previously read "§1.2 … still owed. §1.3–§1.8 untouched" while three of those had landed, and a session acting on it nearly redid them: **verify against the tree, not against a status line.**) · **Created:** 2026-07-18

# Engine-verification findings — what an executed audit of the Vigil↔suite seam actually found

> **For an AI coder.** Read `CLAUDE.md` first (it is law), then this. Every finding below was established by
> **running the engine**, not by reading a comment or a brief. Each carries the command output that proves it.
> §5 lists claims that were investigated and **REFUTED** — do not re-open them; that section exists precisely
> so the next agent does not spend a day re-deriving a bug that was fixed six days ago.
>
> **Provenance of this brief.** It came from a 29-agent verification pass over 14 candidate findings sourced
> from a prior scoping read. **Six of the fourteen did not survive execution.** That ratio is the point: on
> this repo, a code comment describing a defect, a brief marked DONE, and observed behaviour are three
> different things, and only the third is evidence.

---

## 0 · The one rule this brief exists to enforce

**A comment is not a measurement. A brief is not a measurement.** Two of the refuted findings in §5 were
comments describing bugs that had already been fixed — one of them a *post-fix regression note* that reads
exactly like a live defect report. One was an API named only in a FOLLOWUPS brief's future tense and never
written. Before acting on any defect claim in this repo, execute it.

Where a finding below says `read-source-only`, treat it as a lead, not a fact.

---

## 1 · Findings — severity ranked, executed evidence

### 1.1 🔴 HIGH — `fnameStampMs` is unanchored; the numeric device id is parsed as the date

**Live today on the committed corpus. Independent of Vigil.** `signal-orchestrate.js:397-400`:

```js
function fnameStampMs(name) {
  var m = String(name == null ? '' : name).match(/(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}
```

The regex is not anchored, so on a real Polar Sensor Logger name it matches the **8-digit device serial**
first. Executed against genuine corpus filenames:

```
Polar_H10_02849638_20260617_010616_ACC.txt    -> 0292-01-07T20:26:06.000Z
Polar_H10_02849638_20260620_225519_RR.txt     -> 0292-01-07T20:26:06.000Z
Polar_Sense_0C301E3F_20260613_121435_GYRO.txt -> 2026-06-13T12:14:35.000Z
```

Two H10 nights **three days apart collapse to an identical stamp**. `pairCompanions` (Data Unifier + OverDex)
therefore has an inoperative nearest-stamp tiebreak for the H10 and degrades to "first same-device candidate
of that kind" — which can attach a sidecar from a different night. The Verity id happens to contain letters,
so it parses correctly; the bug is device-id-shape-dependent.

**The fix already exists, one file over.** `dex-ingest.js:42-47` is anchored *and carries the comment
explaining why*:

```js
// Floating wall-clock ms (Clock Contract) from the structured stamp …_YYYYMMDD_HHMMSS_<KIND>,
// ANCHORED after the device id so an 8-digit device serial can't be misread as a date. null = none.
function stampMs(name) {
  var m = String(name == null ? '' : name).match(/^POLAR_[A-Z0-9]+_[A-Z0-9]+_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i);
```

The local copy in `signal-orchestrate.js` never received it. `ppgdex-app.js:47` has the same unanchored form
(`Polar_H10_02849638_…` → year 284).

**Fix — EXECUTED 2026-07-18.** `fnameStampMs` now tries the anchored Polar form FIRST and falls back to a
**year-restricted** (`20\d{2}`) general pattern. The fallback matters: `dex-ingest.js:45`'s regex requires
`^POLAR_`, so copying it verbatim would have starved every non-Polar vendor of a stamp. Both branches are
gated.

**Measured on the real corpus** (`Ecg nightly/`, 250 H10 files, 51 ECG primaries × 3 companion slots):

| Scenario | Correct | Wrong-night |
|---|---|---|
| Multi-night drop, shipped code | 6 | **147** |
| Multi-night drop, anchored fix | **153** | **0** |
| Single-night drop (either) | 153 | 0 |

**The collapse is per-MONTH, not global** — the regex consumed `0284|96|38` then took `20|26|06`, i.e. only
the *month* digits of the true date. So the corpus formed exactly two buckets: 34 June primaries all received
the `20260606` sidecars, 17 July primaries all received the `20260701` sidecars. The 6 "correct" pairings were
just the two nights that happen to sort first within their own month — luck, not logic.

**Blast radius is bounded:** the bug needs >1 night in the same entry set, so it fires on OverDex folder-walks
and multi-night Data Unifier drops, **not** on single-night drops and **not** on the ECGDex/PpgDex app path
(`dex-ingest.js` was already anchored). Per-night node-exports in `uploads/trio/` never traverse this path.

**Gate:** a two-night fixture with the **numeric** id `02849638`. Every pre-existing `pairCompanions` test used
a *lettered* id (`X`, `AAAA`, `H10-01`) — which cannot be misread as digits, and is precisely why this survived
so long. Both-direction verified: reverting the regex reds 3 of the 5 new assertions, and the two that still
pass are the month-bucket-first nights — the synthetic fixture reproduces the real corpus's accidental-pass
pattern exactly.

---

### 1.2 🔴 HIGH — capture-host filenames are invisible to `dex-ingest.js`; foreign-device sidecars stop being set aside

`capture-host/writers.py:31-35` emits a **contiguous** 14-digit stamp; `dex-ingest.js:38/45` require the
**underscore-separated** form. Executed:

```
Polar_H10_A1B2C3D4_20260718_223000_ECG.txt -> deviceKey=POLAR_H10_A1B2C3D4  stampMs=1784413800000
Polar_H10_A1B2C3D4_20260718223000_ECG.txt  -> deviceKey=null                stampMs=null
```

`deviceKey` null on the primary ⇒ `hasDev=false` ⇒ `anchor=null` ⇒ the entire step-(5) eligibility block
(`dex-ingest.js:271-282`) is skipped. Executed `planIngest` with the **real config device ids**
(H10 `02849638`, Verity `0C301E3F`):

| Filename form | ACC lane | Skipped |
|---|---|---|
| PSL underscore | `[H10_ACC]` | `[otherdevice: VeritySense_ACC]` |
| Vigil contiguous | `[H10_ACC, VeritySense_ACC]` | `[]` |

Same degradation on the PPG side (`_isDeviceEligible`, `dex-ingest.js:194-199`): with a null anchor every
candidate returns eligible, so a Verity ACC/GYRO becomes a legal motion-gate companion for an O2Ring pleth.

**Which form is correct is settled by the corpus, not by preference.** `find` over `uploads/` and
`Ecg nightly/` shows real Polar Sensor Logger uses the **underscore** form. Therefore:

- **Fix app-side, not host-side.** The parsers must keep reading the genuine PSL corpus regardless, so widen
  `deviceKey`/`stampMs` to accept **both** forms rather than changing `writers.py`.
- Two false assertions to correct while there: `capture-host/writers.py:28`'s parity comment, and
  `capture-host/tests/test_writers.py:10` whose name (`test_capture_filename_matches_polar_sensor_logger`)
  locks in the wrong claim.

**Scope:** no GATE-A/GATE-B fixture and no equiv leg is affected — the committed corpus is underscore-form.

---

### 1.3 🟡 MEDIUM — `ledAgreementPct: 100` is fabricated on a one-photodiode device and reaches five surfaces

`capture-host/capture.py:651` writes the decoded O2Ring pleth as `write_ppg(ph, ns, 0.0, (v, v, v), 0)` — one
8-bit sample replicated across all three PSL channels. `ppgdex-dsp.js consensusBeats` then sees `nCh = 3`, so
the honest `nCh < 2` early return at `:544` never fires, `singleChannel` stays false, and every cluster
resolves `nAgree = 3`.

Executed A/B on real `PPGDSP` (three identical channels vs an honest single channel):

| | replicated `(v,v,v)` | honest single channel |
|---|---|---|
| `ledSingleChannel` | `false` | `true` |
| `ledAgreementPct` | **100** | `null` |
| `ledAgree3of3Pct` | **100** | `null` |
| `ledSeries` | f3 = 1.0 every bin | `null` |
| `rmssd` / `sdnn` / `sdnnRobust` | 26.3 / 56.6 / 56.6 | **identical** |

HRV is byte-identical — so this is a **reporting-integrity defect, not a computation defect**. The damage is
that `ppgdex-registry.js:44-51` grades `ledAgreement` at **`measured`** tier with the citation *"% of kept
beats where ≥2 of 3 photodiode channels place a systolic peak within ±50 ms … direct quality statistic"*, and
the value renders on five surfaces:

| Surface | Location |
|---|---|
| Green "3-LED agree 100%" KPI (`s:'ok'` at ≥90) | `ppgdex-app.js:348-353` |
| Badged q-stat tile | `ppgdex-app.js:370` |
| All-green ribbon, captioned *"The Polar Sense streams 3 optical channels"* | `ppgdex-app.js:373` |
| Node export | `ppgdex-app.js:823` (rich route only) |
| Report row | `ppgdex-app.js:1173` |

Reachable by default: `capture.py:623-624` defaults `dev['streams']` to `['spo2','ppg']`.

**No gate flips** — `integrator-dsp.js:2183` (floor 50) and `ppgdex-dsp.js:1677` (epoch gate ≥67) both treat
`null` and `100` identically. This is a `measured`-tier claim about hardware the device does not have, which
is exactly what §🎫's COVERAGE MANDATE exists to prevent.

**Fix — two options, and they are not equivalent:**
- **(a)** `capture.py` writes one channel. Requires PpgDex to have a single-channel path first (§1.4-ii), else
  `parsePPG`'s ≥6-field requirement rejects the file.
- **(b)** `capture.py` marks the file so `consensusBeats` takes the `nCh < 2` return. Smaller, and honest
  immediately.

Option (a) additionally removes ~2/3 of the pleth's ~191 MB/night, which is decimal text of duplicated values.

---

### 1.4 🟡 MEDIUM — the O2Ring pleth is adapter-ambiguous and has no honest DSP to land in

Executed `SignalAdapters.route()` on the byte-exact capture-host output name + header:

```
best: oxydex-spo2  0.95  [spo2]
runnerUp: polar-sense-ppg  0.85  [ppg]
ambiguous: true
```

Gap 0.10 < the 0.15 threshold (`signal-adapters.js:111`). `adapters/oxydex-spo2.js:37` matches the vendor
token and never inspects the `_PPG` stream suffix.

**Host behaviour is safe, and better than previously assumed:**
- `overdex-app.js:84` returns `klass:'ambiguous'` **before** invoking any adapter.
- `data-unifier-app.js:74-89` branches only on `unknown`, runs the SpO₂ adapter, and **fails loud and honest**
  (`usable:false`, *"no usable SpO₂ rows parsed"*). No fabricated numbers.

The real cost is that the 125.738 Hz finger pleth is **never analyzed as PPG in either host**.

**Two blockers, and (i) must not land without (ii):**
- **(i)** the 0.95/0.85 tie — `adapters/oxydex-spo2.js` must inspect the stream suffix, or `polar-sense-ppg.js`
  must claim `_PPG` more strongly.
- **(ii)** `PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md` is **PROPOSED** — PpgDex has no single-channel and
  no finger-site path. Fixing (i) alone routes the file into a DSP with no honest model for it, which is worse
  than the current honest failure.

---

### 1.5 🟢 LOW — the PAT tool decides its verdict on *uncorrected* drift, and has an undocumented fourth gate

Two divergences between the prose gate and the code, neither in any brief. Both verified in
`pat-feasibility-worker.js`:

**(a) A fourth condition exists** — `:244`:
```js
var physical = cp.med >= 60 && cp.med <= 700,
```
A night meeting all three published bars (drift ≤ 60 ms, coupling ≥ 55 %, beat IQR ≤ 60 ms) but whose median
lag falls outside 60–700 ms returns `WEAK COUPLING`.

**(b) The ACC-corrected drift is computed, rendered, and never re-gated.** `verdict(ov, cp, sc)` is called
once at `:432` on the **raw** `cp`. The ACC-sync stage computes `cpCorr` at `:465-474`, exposes it at `:474`
and `:493` — and it never re-enters `verdict`. **A night whose ACC-corrected drift cleared 60 ms would still
report `DRIFT-DOMINATED`.**

This matters because `INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md` Phase 0 is a **go/no-go on exactly this
tool**. Fix (b) before running Phase 0, or a single-host night risks a false negative.

Also: the three thresholds live once in `verdict()` and are duplicated as literals in five renderer
comparisons with no shared constant, and **`pat-feasibility`'s math is never executed by the suite** —
`verdict` had to be hand-extracted via `vm` to test it.

---

### 1.6 🟢 LOW — PpgDex `respRate` needs three fixes, not one

`ppgdex-dsp.js:1491` assigns `respRate: null` among computed siblings. `lombScargle` (`:927`) accumulates band
power and never retains the argmax; its return literal (`:998-1006`) has no frequency-valued field.

Executed on synthetic 135 Hz PPG with RSA planted at 0.25 Hz: `respRate` null on all 3 epochs, but
hf = 5758 / 5729 / 5657 ms². **The modulation is captured as power; only frequency extraction is absent.**

`MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18-BRIEF §2` asserts *"the fuser is n-agnostic so fixing the DSP
needs no Integrator change."* **That is false** — verified, three links are missing:

1. `lombScargle` must retain the argmax frequency.
2. The export's `hrv.frequency` block (`ppgdex-dsp.js:2279`) has no `respRate` key at any level.
3. The Integrator's `PulseDex|HRVDex|PpgDex` ingest branch (`integrator-dsp.js:395-500`) never assigns
   `summary.respRateBrpm`.

`fuseRespirationRate` itself *is* n-agnostic and null-safe (verified: adding a PpgDex record without the field
leaves output byte-identical). Correct that brief's §2 claim when this lands.

---

### 1.7 🟢 LOW — three nodes emit no crossnight envelope

`ls -1 *-cross.js` → exactly 5 (oxydex, cpapdex, ppgdex, ecgdex, pulsedex). Zero `crossNight` hits in
hrvdex/glucodex/motiondex. Executed: an HRVDex-shaped node-export ingests as `{"count":0}`; a real envelope as
`{"count":1, nodes:["OxyDex"], rows:2}` (gate at `integrator-longitudinal.js:167`).

The generic longitudinal consumer presupposes the producer. HRVDex and GlucoDex retain native intra-file
multi-day trending, so they are degraded, not blind. **MotionDex is the unmitigated case** — no longitudinal
read anywhere.

Two stale prose items to fix in the same pass: `integrator-longitudinal.js:7` says *"envelopes that every node
now emits"* (5 of 9), and `docs/CROSSNIGHT-ENVELOPE-SPEC.md §7` omits CPAPDex, which does emit.

---

### 1.8 🟢 LOW/LATENT — MotionDex misclassifies the Gauss magnetometer header — ✅ CLOSED 2026-07-22

**✅ CLOSED — the prescribed fix landed as `DEEP-AUDIT-II §7.9` (PR #332), re-verified against `main`
2026-07-22 in code, not this section.** `streamKindFromHeader` now routes a capital-`[G]` (Gauss) header to
`{kind:'mag', unit:'G'}` (`motiondex-dsp.js:100`, case is the discriminator — lowercase `[g]` stays
acc/gravity), and `parseSensorXYZ` normalizes the parsed Gauss stream to SI µT at the parse boundary
(×100, `1 G = 100 µT`, `motiondex-dsp.js:178-179`), so a `[G]` file can never be read as gravity-g by `toG`.
Both-direction gated (`tests/dex-tests.js:19874`, group `motiondex-dsp · parse · units`): `[G]`→mag /
`[g]`→acc discrimination, `[mG]`→milli-g (the case-insensitive 1000× sibling defect), and the conversion
value itself (`0.12 G → 12 µT`). The **"Unreachable today"** note below is *resolved*: the conversion is
applied at the PARSE boundary, not gated on `slotFor` routing, and a `*_MAGN.txt` file routes to the mag
slot by filename anyway — so a real corpus MAGN capture ends up an honest µT stream end-to-end. (`_kind`
remains informational metadata; a `slotFor` header-fallback for a mag file *misnamed* without `MAGN` stays
a genuine LATENT non-issue — writers.py names them faithfully — and is NOT this finding's prescribed fix.)

Executed on the exact `writers.py:60` header: `streamKindFromHeader` returns `{"kind":"acc","unit":"G"}`.
`toG()` (`motiondex-dsp.js:147`) would then read Gauss as gravity-g — a ~1000× scale error against the `mg`
path.

**Unreachable today**: routing is by filename (`motiondex-app.js:22-29` `slotFor()` uses
`streamKindFromName` only, no header fallback), and `_kind` is written at `:134` and read nowhere.

**Correct attribution matters here.** A real PSL export in the corpus
(`Polar_Sense_0C301E3F_20260610_211540_MAGN.txt`) has header `X [G];Y [G];Z [G]` — **PSL itself writes
Gauss.** `writers.py` is PSL-faithful and `ppgdex-dsp.js:1198` agrees. **MotionDex is the odd one out**: its
`:83` comment and `:95` `/ut/i`-only branch assume microtesla. Fix MotionDex, not the capture host.

Per `CLAUDE.md §📏` the canonical unit is SI — convert Gauss → µT at the parse boundary (1 G = 100 µT), do not
change what the vendor writes.

---

## 2 · Phases (each atomic, each independently gateable)

**Phase 1 — filename identity (§1.1 + §1.2). ~~§1.1 DONE~~ — §1.2 still owed.** ✅ `fnameStampMs` anchored + gated (see §1.1). ⬜ Still to do: widen `dex-ingest.js` `deviceKey`/`stampMs` to accept the contiguous capture-host stamp, and correct `writers.py:28` + the `test_writers.py:10` name. Original text: anchor `fnameStampMs` in `signal-orchestrate.js:398` and
`ppgdex-app.js:47` after the device id. Widen `dex-ingest.js` `deviceKey`/`stampMs` to accept both the
underscore and contiguous stamp forms. Correct `writers.py:28`'s comment and rename
`test_writers.py:10`. Add a known-answer test asserting both forms resolve, and that two H10 nights three days
apart yield **different** stamps.

**Phase 2 — pleth honesty (§1.3).** Take option (b): mark the O2Ring capture so `consensusBeats` takes the
`nCh < 2` path, making `ledAgreementPct` honestly `null`. Assert in the suite that a replicated-channel input
does **not** yield `ledAgreementPct === 100`.

**Phase 3 — PAT tool correctness (§1.5).** Re-gate on `cpCorr` when it exists (or state in the UI that the
tier reflects uncorrected drift), lift the three thresholds + the `physical` window into named constants, and
add the first executed test of `verdict()`. **Do this before `INTEGRATOR-PAT-VASCULAR` Phase 0.**

**Phase 4 — respiration chain (§1.6)** and **Phase 5 — crossnight + mag unit (§1.7, §1.8)** are independent
and can land in any order.

**Not in scope here:** the O2Ring adapter tie (§1.4). It belongs to
`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md` and must not ship before that brief's single-channel path.

---

## 3 · Gates

Standard sequence per `CLAUDE.md` §🧪 / §🔏:

- `node tests/run-tests.mjs` after any `*-dsp.js` / `*-app.js` change.
- `Dex-Test-Suite.html?full` — wait for the group count to stop climbing, read the `#summary` pill; check
  `sameOriginStatus().bootSkips` is `[]`.
- `node tools/build.mjs --app <App>` for every bundle whose inlined source changed, then
  `node tools/build.mjs --check`. **Phase 1 touches `dex-ingest.js` and `signal-orchestrate.js`, both inlined
  into multiple bundles — this is a multi-bundle re-stamp; say so before starting (§👥.3).**
- `verify-provenance.html` → `window.__provenanceOK`.
- `capture-host/`: `pytest` for the `writers.py` test rename.

**On export-inertness — do not assert it.** Per §🔒, compute it: `manifestHash` will move for every rebuilt
bundle; whether `computeHash` moves decides whether re-verification is owed. Phase 2 touches the app/render
layer and *may* be compute-stable, but `signal-orchestrate.js` and `dex-ingest.js` are inside the compute
closure, so Phase 1 almost certainly is not. If a corpus-backed fixture's `computeHash` moves, re-verify with
`DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`. Never write "export-inert" as prose.

**Changeset:** drop a `changes/*.md` as the last action of each phase (`bump: patch` for all of these — no
published contract shape changes).

**⚠️ Shared-tree note:** at the time of writing, `capture-host/capture.py`, `monitor.html`, `polar_pmd.py` and
`webmon.py` carry **uncommitted changes from another session**. Phase 2 touches `capture.py`. Work in a
worktree (`git worktree add ../wt-<task> -b claude/<task> origin/main`), stage by explicit path, and do not
sweep those files.

---

## 4 · Done when

Every phase's fix is landed with a test that **fails without it**, both gate lanes are green, the affected
bundles are rebuilt via `tools/build.mjs` with `computeHash` movement *computed and reported* (not asserted),
and the three stale prose items (§1.2 writers comment + test name, §1.6 FOLLOWUPS §2 claim, §1.7
`integrator-longitudinal.js:7` + `CROSSNIGHT-ENVELOPE-SPEC §7`) are corrected. Then flip this header to
`DONE — <date>` and spawn `-FOLLOWUPS` for anything that surfaced.

---

## 5 · What NOT to chase — investigated and REFUTED by execution

These were each pursued, executed, and found false. **Do not re-open them.**

| Claim | Why it is false |
|---|---|
| *"OxyDex hardcodes 1 Hz and misplaces desat events by 400–850 s on a lossy night."* | Executed with a 300 s dropout: row index shifts −300, **emitted wall-clock is byte-identical** in both `desat.events` and the export. `_stampEvent` (`oxydex-dsp.js:3163-3172`) stamps from `rows[idx].tMs`; `parseCSV` `continue`s unparsable rows so the `t0+idx*dt` fallbacks are unreachable. **The 422/849 s figures are a post-fix regression note written by the commit that fixed it.** |
| *"The CPAP ventilation lane is dropped and never reaches the bus."* | Fixed by `2c83127` (CPAP-REAL-CORPUS §F1, DONE 2026-07-12). All five keys carry real values in every committed export (`cpapdex-2026-06-12`: 16.2 / 0.36 / 5.75 / 0.84 / 6832). GATE-B fixtures with a live equiv leg. The historical mechanism was also mis-stated — the fields were always computed at session level; the gap was `_pool` plumbing. |
| *"`integrator-tch.js` provides `nCorneredHat` / supports N≥4."* | It does not exist in any `.js`/`.mjs`/`.html`. The shipped API is a single fixed-arity `threeCorneredHat(A,B,C,opts)`. Three prose hits, all future-conditional, all in FOLLOWUPS briefs. **The N≥4 blocker is a hardware/corpus gap — no ≥4-sensor co-recording exists — not a coding task.** |
| *"GYRO and MAG contribute to no computed metric."* | Refuted **as literally stated** — gyro is not *output*-dead: `motiondex-dsp.js:427` folds it into `durSec`, feeding bodyPosition/actigraphy. Executed: acc-only 120 s vs acc+gyro 300 s moves `position.dwellFrac.prone` 1 → 0.4 and `activity.epochs` 4 → 10. Only **mag** is metric-dead (`:423`, `:441` only). ⚠️ **The measured effect is a DEFECT, not a contribution — see the mechanism note below. Do not cite this row as evidence that `durSec` is well-formed.** |
| *"MotionDex `UNIT_RE` rejects `[G]`."* | `g\|G` is present in the regex. The defect is misclassification (§1.8), not rejection. |
| *"MotionDex is unreachable from OverDex; typing needs a 4-step manual hand-load."* | `overdex-app.js:104-119` JSON-parses any unmatched file, hands it to `D.normalizeFile`, classes it `klass:'export'` and fuses it. The Integrator fully registers MotionDex (`KNOWN_NODES:877`, normalize branch `:507-531`). Dropping a `MotionDex_*_ganglior.json` folder **does** run `typeApneaByEffort`. `OverDex.src.html:164` documents export-only fusion as the sanctioned steady state for a pre-adapter node. Cost is one manual conversion step. |
| *"`ledAgreementPct: 100` has no observable downstream effect."* | False — five surfaces (§1.3). Gates are null-safe, but render and export are not. |
| *"PpgDex assumes 176 Hz."* | `fs` is derived from the median sensor-ns delta; a 55 Hz input yields `fs = 55` exactly, and even with unparsable ns the phone-clock span lands on 55. The 176 literal survives only for a file with broken ns **and** a broken phone clock, at 10–21 rows (<0.4 s, no beats). |
| *"`fuseApneaTyping`"* | No such identifier. The function is `typeApneaByEffort` (`integrator-dsp.js:1104`). |
| *"EEGDex has only a generated registry, and `EEGDSP → undefined` is a defect."* | Five eeg files exist; `codegen/generated/eegdex-reference.html` is live test input (`tests/run-tests.mjs:791`). `signal-spec.js:95-96` documents `EEGDSP` **and** `SPIRODSP` as deliberate placeholders; `codegen/manifests/eegdex.manifest.json` declares `"status":"planned"`. EEGDex being unbuilt is a roadmap state, not a bug. |

One live residue found while refuting the first row, **not user-visible**: `oxydex-dsp.js:4569-4570`
(`spo2NadirFrac`, `spo2NadirMinFromStart`) are genuine index-as-seconds derivations that do move on a gapped
night. Repo-wide grep finds **no consumer**. Fix opportunistically; do not treat as urgent.

### ⚠️ Mechanism note on the gyro row — added 2026-07-18 by the `DEEP-AUDIT-II` cross-check

The gyro row's *evidence* is sound and reproduces; its *interpretation* credits a defect as a feature, and
the row is easy to misread as "`durSec` is fine". Verified at `motiondex-dsp.js:427-430`:

```js
var durSec = Math.max(durationOf(acc, t0Ms), durationOf(chest, t0Ms), durationOf(gyro, t0Ms));
var position = bodyPosition(posSrc, t0Ms, durSec, posUnit);   // posSrc = chest || acc — NEVER gyro
```

`bodyPosition` receives `posSrc`, so **gyro supplies no positional sample whatsoever**. The only thing the
gyro stream changed in that A/B is `durSec`, which sets `nE = Math.ceil(durSec / epoch)`. Adding a 300 s gyro
file to a 120 s acc file created 180 s of **sample-less epochs**, counted as `dwell.unknown` (`:203`) and
divided by `nE` (`:213`) — which is precisely why `dwellFrac.prone` fell 1.0 → 0.4.

So the experiment did not show gyro contributing information. It showed **a duration-normalised metric being
diluted by the length of an unrelated stream** — `DEEP-AUDIT-II` §7.3 (respRate over the longest stream) and
§7.4 (`supineFrac` denominator counts non-recording epochs). Note `actigraphy` was given exactly this fix in
`3e9792f` (`seen`/`covered`, `:242-276`) while `bodyPosition` never was.

**Consequence for this brief's other claims:** none — the gyro row's narrow conclusion (gyro ≠ metric-dead,
mag = metric-dead) still stands, and `MOTIONDEX-BUILD-FOLLOWUPS §3` is still correctly refuted for gyro.
Only the framing changes: gyro reaches the output through a **bug**, and fixing §7.3/§7.4 will make gyro
output-dead again, at which point `MOTIONDEX-BUILD-FOLLOWUPS §3` becomes true for both channels.

---

## 6 · Open questions — and the one experiment that settles each

| Unknown | Settling experiment |
|---|---|
| Does PpgDex emit plausible-but-wrong HRV on a real triplicated pleth? | Capture one real O2Ring night with `streams:[spo2,ppg]`, run `planIngestPpg` + full `PPGDSP.compute` with the Verity ACC as companion, diff HRV/morphology against the H10 raw-ECG Pan–Tompkins leg for the same night |
| Does ACC-corrected PAT drift on a single-host night clear 60 ms? | One Vigil night through `PAT Feasibility.html`; record **both** `cp.driftRange` and `cpCorr.driftRange` — after §1.5(b) is fixed |
| Is the `ledAgreementPct` export leak reachable in normal use? | Drop an O2Ring PPG into Data Unifier and OverDex; inspect the emitted export for `quality.ledAgreementPct` (it appears under `opts.rich`, not the default light path) |
| ~~Has wrong-night pairing actually occurred on the corpus?~~ **ANSWERED 2026-07-18** | **Yes — 147/153 wrong-night pairings** on the real corpus, per-month collapse; fixed to 153/153 and gated. Bounded to multi-night drops. See §1.1. |
| Would a real ≥4-sensor co-recording change the TCH answer? | **No code-side substitute** — requires acquiring a genuine 4-sensor simultaneous HR co-recording |

---

## Cross-references
- `CLAUDE.md` §🔒 Clock Contract · §🎫 evidence badges (COVERAGE MANDATE) · §🧪/§🔏 the two gates · §👥 shared tree · §📏 units.
- [`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md`](PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md) — owns §1.4; the single-channel PpgDex path.
- [`O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`](O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md) — the capture side of §1.3 (Phase 2 shipped; header still PROPOSED).
- [`INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md`](INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md) — §1.5 gates its Phase 0.
- [`MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18-BRIEF.md`](MULTI-SENSOR-DERIVATIONS-FOLLOWUPS-2026-07-18-BRIEF.md) — §2's "no Integrator change" claim is corrected by §1.6.
- [`INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-IV-2026-07-13-BRIEF.md`](INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-IV-2026-07-13-BRIEF.md) — where the N≥4 prose lives (§5 row 3).
- [`CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md`](CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md) — the Vigil capture side.
- Code: `signal-orchestrate.js:398` · `dex-ingest.js:37-47` · `ppgdex-app.js:47,348-373` · `ppgdex-dsp.js:544,927,1491` · `pat-feasibility-worker.js:238-248,432,465-474` · `motiondex-dsp.js:88-95,147,427` · `capture-host/writers.py:28-35` · `capture-host/capture.py:651`.
