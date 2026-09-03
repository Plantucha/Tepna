<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-18 (all eight findings closed: §1.1/§1.2/§1.4/§1.6/§1.7/§1.8 were already executed+gated in place; §1.3 was fixed at both ends by PPGDEX-O2RING-FINGER-SITE + the site-by-replication guard and gated in both directions, closed here with the evidence; §1.5 closed as MOOT — its "fix before PAT-VASCULAR Phase 0" purpose ended when Phase 0 ran with the coupler fixed as pat-align.js and the PAT question closed terminally. §4 Done-when audited item by item, including the three cross-brief prose corrections. NO follow-up brief spawned: the 2026-08-18 verification pass surfaced nothing new — every remaining item was closed by later, already-gated work, and this close only records where) · **Created:** 2026-07-18 · **Residue:** 2026-09-02-pat-detailcorr-unread

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

### 1.3 ✅ CLOSED 2026-08-18 — fixed at BOTH ends by later briefs; verified in tree and gates, then marked

> Never closed here, but closed in fact, twice over — this note records the evidence rather than
> re-doing the work:
> - **Producer:** `capture-host/capture.py` no longer writes the replicated `(v, v, v)` — the O2Ring
>   pleth goes through the 1-column `write_ppg((v,))` branch (see the comment at capture.py:351,
>   citing `PPGDEX-O2RING-FINGER-SITE` §3/§7).
> - **Consumer:** legacy replicated 3-column files are detected by DATA, not header —
>   `deriveSiteFromLayout` (`ppgdex-dsp.js:~761`, PR "site by replication": 100 % identical across
>   526 O2Ring files vs 0 % across 261 Verity files, perfect separation) routes them to the finger
>   single-channel lane where `ledAgreementPct` is null.
> - **Gated in BOTH directions** (`tests/dex-tests.js:13999,14003,14328`): replicated → null, never a
>   fabricated 100; three independent channels → still reported — so hard-coding null cannot pass.
>
> ~~🟡 MEDIUM~~ original finding kept below for the record.

### 1.3 (original) — `ledAgreementPct: 100` is fabricated on a one-photodiode device and reaches five surfaces

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

### 1.4 EXECUTED 2026-08-01 — blocker (ii) was STALE, and (i) exposed a third defect

**(ii) no longer holds, and had not for six weeks.** `PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md` is
**DONE — 2026-07-20**, verified on real hardware. Checked in the code rather than off the status line, per
this brief's own §0: `parsePPG` derives `site` from the column layout (1 channel *or* replicated → `finger`),
`detectBeats` has a single-channel lane (`singleChannel: true`), and the O2Ring sentinel pass is site-gated.
The condition (i) was waiting on had already been met; the item sat blocked on a blocker that was gone.

**(i) fixed by two symmetric DECLINES, not by out-bidding.** New `adapters/o2ring-ppg.js` (vendor
Wellue/Viatom, `signalType: 'ppg'`) claims vendor-token + `_PPG` at **0.97** and REFERENCES `PpgDex.parsePPG`
— no second parser. Then `oxydex-spo2` declines a `_PPG` waveform stream (it parses 1 Hz CSV rows; the vendor
token alone was over-broad), and `polar-sense-ppg` declines a *foreign vendor's* `_PPG`. That second decline
is the one worth arguing: simply letting `polar-sense-ppg` win the tie — which this section listed as an
option — would route a Wellue waveform through an adapter whose provenance reads *"Polar Verity Sense / OH1"*,
a **false vendor stamp on the export**, which is worse than the ambiguity it replaces. An unknown-vendor
`_PPG` still takes the 0.85 PSL default, which is what that default is for.

**A THIRD defect, latent, that (i) would have activated — and it is what (ii) was really protecting against.**
`site` is spent as an evidence-tier decision: it selects the morphology tier (dicrotic notch, augmentation
index, reflection index, Takazawa b/a — every one graded against WRIST-validated literature) and gates three
Integrator fusion paths. The layout→site rule lived **only inside `parsePPG`**, so `compute()`'s SignalFrame
branch rebuilt a rec carrying **no `site`** and the export fell through to `rec.site || 'wrist'`. Nothing
caught it, because the only adapter that could produce a ppg frame was `polar-sense-ppg` — whose recordings
really are 3-LED, so the default agreed with the truth *for the wrong reason*. Routing a finger layout through
that branch would have stamped a wrist-validated tier onto a fingertip pleth. `deriveSiteFromLayout` is now
single-sourced and both ingest paths call it. So blocker (ii) was **right in substance while wrong in its
stated reason**: the danger was not that PpgDex lacked a finger model — it had one — but that the *adapter
boundary* discarded the field that model depends on.

**Measured end-to-end on the real corpus, not asserted.** A 7.4 h
`Wellue_O2Ring-S_S8AW2100_20260729215137_PPG.txt` routes `o2ring-ppg` 0.97 (unambiguous) and exports
`site:"finger"`, `siteSource:"device-default"`, 8 ganglior events. Under the previous code the same file
routed `ambiguous`; forced through the frame branch it exported `site:"wrist"`. A Verity file is unchanged
(`polar-sense-ppg` 0.97, `site:"wrist"`).

Gated by two new groups (`adapters · o2ring-ppg · routing` and `ppgdex-dsp · adapters · site · known-answer`),
each mutation-verified by reverting the corresponding production change — and each mutation *confirmed
applied* before its run, because a first attempt at those substitutions silently no-op'd and the resulting
"no failures" meant nothing. `computeHash` moved `c7a8e6dea17d → 2acf0985e625`, so this is **not** export-inert;
`tools/verify-fixtures.mjs` was re-run against the real corpus and re-stamped the PpgDex equiv fixture. 13
bundles rebuilt.

---

### 1.5 ✅ CLOSED 2026-08-18 AS MOOT — its purpose was "fix before PAT-VASCULAR Phase 0", and that story is over

> Phase 0 ran (2026-07-29, twice) with the coupler defect this finding pointed at extracted and fixed
> as `pat-align.js coupleRtoFoot` — 16 gated assertions, including the slip case (`tests/dex-tests.js`
> "PAT coupler: a missing foot contributes nothing, never the next beat"). The verdict question this
> tool's `cpCorr` handling could have distorted is now settled TERMINALLY by
> `PAT-VERDICT-CONSOLIDATED` (every analysis-side candidate eliminated; the ~96 ms floor moves only
> with a tighter foot or a longer transit path) and `INTEGRATOR-PAT-VASCULAR` is DONE
> (executed-and-refuted, 2026-08-18). Re-instrumenting a feasibility tool whose feasibility question
> has a final answer would be work with no consumer.
>
> ~~🟢 LOW~~ original finding kept below for the record.

### 1.5 (original) — the PAT tool decides its verdict on *uncorrected* drift, and has an undocumented fourth gate

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

**✅ §1.6 CLOSED 2026-08-01 — two of the three links were real; the third was already there.**

| link | verdict |
|---|---|
| (i) `lombScargle` must retain the argmax | **REAL, fixed** — HF-branch argmax on the raw periodogram bin |
| (ii) export `hrv.frequency` has no `respRate` | **REAL, fixed** — whole-record `respRate` + `respRateMethod`, and the epoch `respRate: null` that sat among computed siblings now carries the value |
| (iii) the Integrator never assigns `summary.respRateBrpm` | **NOT MISSING** — `integrator-dsp` assigns it from `_hf.respRate`; it had nothing to read |

So this section's own correction to `MULTI-SENSOR-DERIVATIONS-FOLLOWUPS` §2 overshot: the fuser *is*
n-agnostic and PpgDex folded in with **no Integrator change**. What was false in the original claim was
only that "the DSP fix" is one fix rather than two. Both briefs now say so.

**Known-answer gated** (`ppgdex-dsp · spectral · known-answer`): RSA planted at 0.25 / 0.20 / 0.30 Hz
recovers **15.06 / 12.06 / 18.06** breaths·min⁻¹ — a truth test, not a regression pin — with three distinct
plants so a constant cannot pass, plus controls that the HF power and the Task-Force identity are undisturbed.

⚠️ **One existing guard had to be amended, carefully.** `SYNTH-TEXTURE-FOLLOWUPS-II §2` pinned that PpgDex's
`lombScargle` "exposes NO respRate/peak path", having audited and DECLINED porting PulseDex's peak fields.
Read closely, what §2 declined is the **global peak + `peakBelowHF`**, whose sub-HF blindness is the defect
it was guarding against — and the same note calls ECGDex's **HF-branch-only** peak intentional. This change
adds the HF-only form, so the two briefs are reconcilable once the distinction is named. The guard now
asserts the HF-only shape **and still forbids the global/`peakBelowHF` path §2 refused**, so that decision
survives intact rather than being steamrolled.

---

### 1.7 🟢 LOW — three nodes emit no crossnight envelope

> **✅ The PROSE half of §1.7 is closed and now GATE-BACKED (2026-08-04); the producer half is not.**
>
> Both stale statements §1.7 named are fixed: `integrator-longitudinal.js`'s header now reads *"FIVE of
> the eight nodes emit"* and names them, and SPEC §7 is a full adoption table marking the three
> non-emitters. Verified in the files, not from this header.
>
> Two things were still wrong and are corrected here:
> - §7's headline said **"5 of 9 nodes emit"**. There are **eight** nodes — the `Integrator` row in that
>   table is a *consumer*, and counting it inflated the denominator. Now "5 of the 8 nodes emit".
> - §7 still carried a note warning that `integrator-longitudinal.js:7` *"still says every node"* and
>   leaving it "for whoever next re-bundles". That code was fixed; the warning had outlived it.
>
> **`docs-ledger` check3e now derives both statements from `ls *-cross.js`** rather than trusting prose:
> the §7 rows claiming to emit must equal the nodes that actually have a `*-cross.js`, the "N of M"
> headline must match the filesystem and the node count, and the Integrator header must not reassert
> "every node". **Mutation-verified against the two real historical drifts** — removing CPAPDex's emit
> claim (the original 2026-07-18 defect) and restoring "5 of 9" each red two assertions.
>
> **Still open, unchanged:** HRVDex, GlucoDex and MotionDex emit no envelope. HRVDex/GlucoDex are
> DEGRADED (native intra-file trending); **MotionDex remains the unmitigated case** — no longitudinal
> read anywhere. Building those producers is the remaining work.

`ls -1 *-cross.js` → exactly 5 (oxydex, cpapdex, ppgdex, ecgdex, pulsedex). Zero `crossNight` hits in
hrvdex/glucodex/motiondex. Executed: an HRVDex-shaped node-export ingests as `{"count":0}`; a real envelope as
`{"count":1, nodes:["OxyDex"], rows:2}` (gate at `integrator-longitudinal.js:167`).

The generic longitudinal consumer presupposes the producer. HRVDex and GlucoDex retain native intra-file
multi-day trending, so they are degraded, not blind. **MotionDex is the unmitigated case** — no longitudinal
read anywhere.

Two stale prose items to fix in the same pass: `integrator-longitudinal.js:7` says *"envelopes that every node
now emits"* (5 of 9), and `docs/CROSSNIGHT-ENVELOPE-SPEC.md §7` omits CPAPDex, which does emit.

**✅ §1.7 RE-VERIFIED AND CLOSED 2026-08-01 — in the tree, not from this section.** All three claims checked:

| claim | verdict |
|---|---|
| exactly 5 `*-cross.js`; hrvdex/glucodex/motiondex emit none | **CONFIRMED** — 5 files; 0 `crossNight` refs in all three |
| `integrator-longitudinal.js` says *"every node now emits"* | **CONFIRMED STALE** — and now corrected |
| `CROSSNIGHT-ENVELOPE-SPEC §7` omits CPAPDex | **REFUTED — already fixed.** §7 now carries a full 8-node adoption table with CPAPDex marked emitting, the three non-producers marked ✗, and MotionDex named "the unmitigated case" |

So the finding itself stands (5 of 8 emit; MotionDex is blind) and **one** of the two prose items was owed,
not both. Note the count in this section's own text is wrong too: it says "5 of 9" — there are **eight**
nodes.

The corrected header now names the producer set explicitly and says which non-producers are *degraded*
(HRVDex, GlucoDex retain native intra-file trending) versus *blind* (MotionDex).

**And it is gated, because prose is exactly what rots unnoticed.** `integrator-longitudinal · docs ·
source-scan` (5 legs) bans the specific false phrase in any casing, requires an explicit producer count,
requires the three non-producers to stay named, and carries a non-vacuity floor on the loaded `*-cross.js`
set. Mutation-verified: restoring "every node now emits" reds it. This is the same rot §1.2's status line
suffered — a claim true when written, with nothing to notice when it stopped being true.

⚠️ Recorded for the next reader: a **comment-only** edit to `integrator-longitudinal.js` still moves
`computeHash` (`15de362e159d → 9d217398e024`), because the compute closure is a DENYLIST — an unknown
asset counts as compute. That is the documented design (over-flag rather than go blind), so the fixture
was re-verified via `verify-fixtures`, not asserted inert.

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

> **⚠ 2026-08-01 — THIS SECTION WAS STALE, AND IT COST A SESSION.** Phases 1–3 below read as *owed* while
> the header above records §1.1, §1.2, §1.3 and §1.5 as **EXECUTED + gated**, re-verified against `main`.
> A session on 2026-08-01 read this block, went to the tree to check §1.2, and found `dex-ingest.js`
> `deviceKey`/`stampMs` already widened — with four gate legs already asserting it (`§1.2 PSL underscore
> stamp → deviceKey`, `§1.2 capture-host CONTIGUOUS stamp → same deviceKey (was null)`, `§1.2 both shapes
> resolve to the SAME instant`, and the anchoring guard). That is the SECOND time this brief's status text
> sent someone to redo landed work; the header's own warning records the first. Reconciled below against
> the code, with the evidence that settles each.

**Phase 1 — filename identity (§1.1 + §1.2). ✅ DONE.** `fnameStampMs` anchored after the device id; both
the PSL underscore and contiguous capture-host stamp shapes resolve via `dex-ingest.js` `deviceKey`
(`(?:\d{8}_\d{6}|\d{14})`) and `stampMs` (optional separator). Gated by four legs, including the one that
keeps the widening honest — *"a 14-digit DEVICE ID is not read as the date"*. The prose items are corrected
too: `capture-host/writers.py` carries the PSL-vs-contiguous explanation, and the test is named
`test_capture_filename_is_contiguous_stamp_not_psl_shape`.

**Phase 2 — pleth honesty (§1.3). ✅ DONE** (PR #225). `ppgdex-dsp.js` dedupes bit-identical channels before
the consensus vote, so a replicated single sensor reports `ledAgreementPct: null` rather than a
`measured`-tier 100. Gated both directions — the suite carries an explicit leg noting that hard-coding
`null` would pass the first assertion alone.

**Phase 3 — PAT tool correctness (§1.5). ✅ DONE** (PR #217). `pat-gate.js` single-sources the promotion
gate, evaluates it on the drift-corrected `cpCorr` and publishes `vdCorr`; the thresholds are named
constants, and `verdict()` has its first executed test (`§1.5 published bar met ⇒ FEASIBLE`, plus the
below-`COUPLING_MIN` negative).

> ⚠️ **Amended 2026-09-02 (Osprey) — this sentence is TRUE and it is not the whole chain.** "Publishes
> `vdCorr`" was accurate at the worker and stayed accurate; what nothing said is that **no consumer ever
> read it**. `pat-feasibility.js` rendered `m.vd` and never `m.vdCorr`, so the second verdict was
> computed, carried across the worker boundary, and dropped at the last step — for the whole period this
> phase read ✅ DONE. Phase 3's own claim is not withdrawn: the gate IS single-sourced and `vdCorr` IS
> published, which is why this is an amendment and not a correction. **The lesson is the one this brief
> exists to teach, one layer out: "publishes X" and "X reaches a surface" are different assertions, and
> a phase can be honestly DONE on the first while the second was never checked.** Fixed by surfacing the
> corrected verdict in the renderer, tagged by `driftSource`; the tier is untouched, since promoting on
> corrected drift remains the owner's call.

**Phase 4 — respiration chain (§1.6). ◐ HALF.** The Integrator half is closed by
`MULTI-SENSOR-DERIVATIONS` (`summary.respRateBrpm`). **The PpgDex half is open**: `lombScargle` still never
retains the HF argmax. ⚠️ `ppgdex-dsp.js` is heavily contended — check open PRs before touching it.

**Phase 5 — crossnight + mag unit (§1.7, §1.8). ◐ HALF.** **§1.8 CLOSED 2026-07-22** — the Gauss→µT fix
shipped as `DEEP-AUDIT-II §7.9` (PR #332) with a both-direction gate. **§1.7 RE-VERIFIED AND CLOSED 2026-08-01** — the finding stands (5 of 8 emit), one of its two prose items
was already fixed, the other is corrected and now gated. See §1.7.

**§1.4 CLOSED 2026-08-01** — see §1.4's execution note. This block previously listed §1.4 as unresolved and
said it "must not ship before that brief's single-channel path", while `PPGDEX-O2RING-FINGER-SITE` had been
**DONE since 2026-07-20**. That is the third time this file's prose has outlived the tree, and the reason its
own header carries the warning. It is now gated: `docs-ledger` check3c fails a brief that marks a section
resolved while another line still lists it as outstanding, and it caught this block.

*(Recorded scope note: check3c is a string matcher, so it cannot tell a QUOTED historical claim from a live
one — an earlier draft of this very paragraph quoted the old sentence verbatim and tripped the gate. Describe
a superseded claim rather than reproducing its wording. That is a real limitation of the check, not a reason
to loosen it: the alternative is a matcher that reasons about quotation, which is exactly the judgement
`DOCS-LEDGER-CHECK3B-BLIND-ROW` §4a ruled out.)*

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
