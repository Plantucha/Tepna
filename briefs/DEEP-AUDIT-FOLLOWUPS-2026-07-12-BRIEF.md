<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-12 (**§A + §B EXECUTED** — and in BOTH cases this brief's own prescription was wrong; the corrections are recorded in place. **§D1 · §D2 · §E1 EXECUTED 2026-07-13** — EVENT-LEXICON §7 records the CPAPDex-annotation + HRVDex-window decisions, and the fixture content-claims are swept-clean + byte-locked as a new gate. **Still open:** §C1/§C2/§C3 (need the gitignored real corpus / are research) + §E2 (version-into-bundle, deferred)) · **Created:** 2026-07-12 · **Supersedes:** — · **Parent:** `DEEP-AUDIT-2026-07-11-BRIEF.md` (DONE 2026-07-12, all 21 findings executed)

# Deep-audit follow-ups — the residue, and the blind spot that hid it

The parent audit found 21 reproducible defects and fixed all of them. This brief carries what
*execution* surfaced: the fixes that were deliberately scoped short, the sibling bugs found while
fixing their brothers, and — the item that matters most — **the structural reason the gates missed
eleven wrong numbers while staying green.**

Nothing here is a known-wrong surfaced number. Everything here is either a *latent* fail-open, a
*half*-closed discipline, or a *gate* that cannot see the thing it is supposed to guard.

---

## §A · THE BLIND SPOT — ✅ **EXECUTED 2026-07-12** (and this brief's own prescription for it was WRONG)

**The problem, as first stated.** Every `env.equiv.*` fixture was a clean, ~6-minute clip of a
well-behaved recording. Three Tier-1 findings (§1 clock lock, §8 event clock, §9 whole-night windows)
were **structurally invisible** to the gate: they only appear on a night that is *long*, *lossy*, or
*differently configured*. The gates proved reproducibility the whole time —
`compute(committed input) ≡ committed export` — and both sides were wrong together. The fix is not
another assertion; it is a **fixture with the failure modes in it**. That much was right.

### ⚠️ The prescription was wrong, and the reason is the whole lesson

This brief originally said: *"add a long, lossy, **real** night to the equiv set … from the real
39-night O2Ring corpus."* **That would not have closed the blind spot.** Real recordings live in
`uploads/`, which `.gitignore` excludes as personal data — which is *precisely why* the equivalence
(GATE-C) legs **skip in CI and in every fresh clone**. `tools/release.mjs --dry-run` says it in as many
words: *"uploads/ raw recordings are gitignored, so a fresh clone (CI, or a worktree) cannot run them —
including the real-recording equivalence legs (the GATE-C surface). This run is NOT the full gate."*

So a *real* adversarial night would have been gitignored too. It would have made the gate green on the
maintainer's machine and left CI exactly as blind as before — a fixture nobody's PR would ever run. The
blind spot would have been *moved*, not closed.

**The correct shape is a COMMITTED SYNTHETIC night**: deterministic, generated, carrying no personal
data, therefore whitelistable in `.gitignore` and present in every clone. Same failure modes, but the
gate actually runs where merges are decided.

### What shipped

`tools/make-synthetic-inputs.mjs` now emits four adversarial twins, all **git-tracked and
`.gitignore`-whitelisted** (`uploads/synthetic_oxydex_o2ring_{dmy,mdy,lossy,longnight}.csv`), wired into
`env.equiv` via `pairCommitted()` and asserted by the **`Adversarial equiv inputs — MDY order · dropped
rows · a full-length night`** group (16 asserts).

They are gated as **INVARIANTS, not goldens** — a golden pins bytes and catches drift; an invariant
catches the *bug class*, including a regression nobody has thought of yet:
- **§1** metamorphic — the same night in DMY vs MDY must compute identically (date, `durationMin`,
  `startEpochMs`, ODI-4 count), with a control that the night *has* desaturations to lose.
- **§8** every exported `tMs` equals its own row's parsed stamp, with a control proving the old
  index→time mapping really is wrong on that input (**off by 477 s**, against a 60 s coincidence gate).
- **§9** the FFT cycle length describes the whole night (**50 s**), with a control that a first-hour
  head-slice would report **~20 s**.

**Verified to run and to bite where it matters.** Confirmed the four inputs are present in a *fresh
clone* (a `git clone` with no private corpus — exactly what CI gets), that all 16 asserts pass there,
and that **re-introducing the §9 head-slice reds the gate in that clone** (cycle length 50 s → 20 s).
That is the property the original prescription could never have had.

### Residue
- The **real-corpus** equivalence legs still skip in CI by design (personal data). That is now a
  *known, stated* limitation rather than an invisible one — but it means the six
  `compute() ≡ committed export` legs against real recordings are only ever exercised locally, with
  `DEX_UPLOADS=<corpus>`. Worth a line in `CONTRIBUTING.md` so the next person knows a green CI is not
  the full gate.
- ~~The other adversarial shapes this audit hand-built (a two-session CPAP night; a PPG worker realm) have
  no committed synthetic twin yet.~~ **BOTH CLOSED — 2026-07-14.**
  - **PPG worker realm — closed 2026-07-12 by `d9ffdcd`** ("gate the worker realms"), the SAME DAY this
    residue was written, but the line was never struck. The PPG detection blob now EXECUTES in the headless
    CI gates (`PpgDex worker blob EXECUTES and ≡ the serial path`, `tests/dex-tests.js`) and the browser lane
    drives the live pool (`ppgWorkerPoolGroup`, `Dex-Test-Suite.html`). **A committed *input* twin cannot add
    worker coverage here:** `compute()`/`analyze()` are serial-by-design (the gated numeric truth), so a
    committed file flows through the serial path and never spawns a worker — the worker is correctly tested
    where it actually runs (an executed empty realm + the live browser pool), not through a fixture. Building
    a "PPG worker twin" would be decoration that falsely implies fixture-level worker coverage.
  - **CPAP two-session night — closed 2026-07-14** (`CPAPDex adversarial two-session night` group). The gap
    was real but narrow: the POOLING math was tested on hand-built session objects (§20) and the two-session
    *pipeline* only on the GITIGNORED real `cpapdex-2026-06-12` EDFs (skips in CI). The new group drives TWO
    synthetic `_synthEdfSet` sessions — B truncated to a short nap, shifted by a 3 h off-mask gap — through
    the full `buildSessionFromEdf → buildNight → cpapBuildExport` pipeline, in CI, no corpus. Arithmetic
    control: A(10 min,1 desat)=6/h + B(5 min,1 desat)=12/h → POOLED 8/h ≠ unweighted-mean 9/h; a regression to
    rate-averaging reports 9 (verified RED), a regression that splits the night reports nSessions 1. Plus a
    single-session control so it cannot pass vacuously.
- **⚠️ GlucoDex had no adversarial twin — and that exact hole shipped a wrong number to real users two days
  later. CLOSED 2026-07-14.** This residue line was not a nice-to-have: `DEEP-AUDIT-2026-07-14 §1` rerouted
  every GlucoDex distribution metric through a new `FLAG.GAP_LONG` predicate, came back **byte-identical on
  the clean synthetic Lingo** (which trips no long gap), was declared **EXPORT-INERT** on that evidence, and
  shipped — while the **real** Lingo night's export had in fact moved. Its fixture went stale, and the
  **served GlucoDex ran the pre-fix DSP against real users' CGM data** until it was caught by hand. The leg
  that would have caught it is one of the six real-corpus legs named in the bullet above: it **skipped in
  CI, and on the machine of the session that landed the change.** Exactly the failure this §A exists to
  prevent — the recipe was right, it just never reached GlucoDex.
  **Now shipped:** `uploads/synthetic_glucodex_lingo_gap.csv` (git-tracked, `.gitignore`-whitelisted) — the
  same 3-day curve as the clean twin with a **14 h sensor-change gap** (168 drawn cells, 143→100 mg/dL).
  Gated **both** ways, because each catches what the other cannot: a **golden** (`_gap` equiv leg — catches
  an export that moves by accident) *and* **invariants** (the `GlucoDex adversarial gap twin` group — catches
  the bug class even if a future session regenerates the golden blindly). The control is arithmetic, not a
  mock: clean daypart n = 864, gapped = 697, and **pre-§1 code reported 864 for both**. Verified: reverting
  `_ana` reds five assertions **in a corpus-less tree** — `9bdb9be` would have failed CI on its own PR.

---

## §B · Fail-open layers — ✅ **EXECUTED 2026-07-12** (all four; one of them was a *surfaced* wrong number after all)

### B1 · PulseDex accepted any column that *looked* like an interval — ✅ **and the brief's proposed test was wrong**
§2 vetoed the foreign stream **at the adapter**, closing the reachable production path. Underneath,
`_pdIntervalColByRange` still accepted **any** column whose median landed in 300–2000 — the H10
accelerometer's gravity rail (~973 mg) reads as 973 ms beats — and the `usable` gate asked whether the
values were beat-*sized*, never whether they behaved like *intervals*.

**⚠️ The prescribed test would not have worked.** This brief said to reject *near-constant series*,
citing the rail's **SDNN 9.5 ms** as "physiologically impossible". Measured against the real corpus, that
framing fails **twice**:
- The **Verity** accelerometer's SDNN is **69.5 ms** — sitting comfortably *inside* the genuine RR range
  (24.4–162.7 ms across 19 real recordings). A variability floor tuned to catch the H10 rail would have
  **let the Verity rail straight through**.
- And a floor high enough to catch both would risk rejecting **real pathology** — a genuinely flat RR
  series is real data, which is exactly why the brief flinched from picking a number.

**What shipped instead is a conservation law, not a threshold.** RR intervals are the gaps *between*
beats, so they must **sum to the time they span**. Measured: **19/19** genuine RR/PPI recordings conserve
time to within 1 % (ratio **1.00–1.01**); the H10 accelerometer read as RR claims **24.6×** the elapsed
time, the Verity **15.6×**. The cut is at **2.0** — ~8× above the worst genuine file, ~8× below the
nearest offender — and it can only ever fire on the *impossible* side, because dropped beats and paused
recordings make the sum **smaller** than the span, never larger. A gappy-but-genuine file cannot trip it,
and neither can a flat one. Gated with a control proving a **pathologically flat** RR series (SDNN ≈ 1 ms)
still passes.
Plus a deterministic first line: a column whose header *declares* a foreign unit (`[mg]`/`[dps]`/`[uV]`…)
is never an interval column, whatever its values do.

### B2 · `_envToSeed` seeded absence to `0` — ✅ now `null`
The exact coercion that collapsed §3's n.u. denominator (`_totalPow − _vlf` → `0 − 0` → the `|| 0.001`
epsilon → **HF n.u. = 125,000,000 %**). The §3 presence gates made it harmless *only because a real band
power is never exactly 0* — safety resting on a coincidence of physiology rather than on the code being
right. `null > 0` is false, so every gate reads identically; absence is now simply stored as absence.

### B3 · The `||0` siblings — ✅ and **this one was surfaced**, contrary to the brief
The brief said *"none is a hero number today, so none was proven to mis-state a surfaced value."* That
was wrong: **`_stress` is rendered as a readiness subscore** (`hrvdex-render.js`), so a Welltory file with
no Stress column displayed a fabricated **"0 · ok"** — green, reassuring, and invented. Exactly §21's bug
class, one card over. All six now parse absent → `null`, and the renderer omits the subscore.

**A gated decision had to be reversed to do it.** An existing assertion *required* `|| 0`, on the stated
grounds that *"the `_hasSubj` presence gate depends on it."* **That rationale was false** — `_hasSubj`
reads `r._stress > 0`, and `null > 0` is false exactly as `0 > 0` is. Verified: every `_hasSubj`-gated
composite (`d_se_div`, `d_ans_load`, `d_coh_energy`, `d_pti`) is still `NaN` with `null`. The gate never
depended on the zero — it was merely *protecting* it. Both assertions were updated deliberately, with the
reasoning recorded in place. A genuine vendor `0` still reads `0`: absence ≠ zero, in both directions.

### B4 · `spo2HrDecouplingPct` — ✅ `null`, like its coupling sibling
`0/0` is undefined, not "0 % decoupled, a perfectly coupled night". It ships in the node-export, where a
consumer reading `0` would take it for a measurement.

**Gated:** a 14-assert `§B` group, **verified to red on the original code** (the accelerometer parsed as
`usable = true, nUsable = 4000`; `_stress = 0`; seeds `0`; decoupling `0`), with controls proving each
input bites and that the honest paths are untouched. Export-inert: **no fixture output moved.**

---

## §C · Half-closed disciplines

### C1 · The OxyDex tail-slice family
§9 fixed the **head**-slice (`computeSpO2FFT` / `computeDFA` analysed only the first hour of a 6–10 h
night). The **tail**-slice family is untouched and equally undisclosed:
`computeSpO2Autocorr` · `computeHRFreqBands` · `computeRespRateProxy` · `computeSpO2HRLag` all use
`rows.slice(-USE)` — the last 30–60 minutes only. Same class; **not** proven to move a surfaced number,
which is the only reason it is here and not in the parent. **Do:** prove or refute movement across the 39
real nights (the same method that proved §9: recompute per-night with and without the cap), then either
decimate whole-record or **disclose the window** in the export and on the card.

### C2 · `remProxyPct` and `remFraction` denominate on different clocks
OxyDex's `remProxyPct` denominates on **recording** time; ECGDex's `remFraction` denominates on **sleep**
time; `fuseStagingConsensus` compares them directly. Moot *today* — §7 suppresses the implausible proxy,
so the comparison no longer runs on it — but the mismatch is still in the code and **must** be reconciled
before the REM estimator is ever re-derived. **Do:** one denominator, named in the export.

### C3 · The REM estimator itself was never re-derived
§7 made the node **refuse to assert an impossible number as a healthy finding** (all 39 real nights now
self-report `plausible:false`; 0 render "good", previously 39/39 did). It did **not** fix the estimator:
"still + HR SD < 3 + HR within ±5 bpm of the night mean" still describes quiet sleep, not REM (REM shows
*increased* HR variability). That is research, not an audit fix. **Do:** re-derive against a staged
reference, or demote the metric out of the surfaced set entirely.

---

## §D · Contract debt

### D1 · CPAPDex's `apnea`/`hypopnea` events feed no fusion rule
Found while fixing §15 (the desat pool is now keyed by **impulse**, not by node label). CPAPDex emits
`apnea` and `hypopnea`; no fusion rule consumes them, and `hypopnea`/`rera` are **absent from
`EVENT-LEXICON.md`** altogether. **Do:** add them to the lexicon, then decide whether the apnea rule
should corroborate a device-scored event against a desat (it is the same shape as the rule §15 fixed).

> **EXECUTED 2026-07-13.** Corrected + recorded in `docs/EVENT-LEXICON.md` §7.1: `apnea`/`hypopnea`/`rera`
> are CPAPDex **device-scored EDF annotation classes** (`classifyAnnotation`), consumed internally (AHI/ODI +
> demo desat placement) — NOT emitted as `ganglior_events[].impulse` (CPAPDex emits `desat_event`/`large_leak`/
> `periodic_breathing`). The apnea-corroboration rule is a **deferred, recorded decision** (it needs CPAPDex to
> emit a first-class impulse → a node-export shape change + Integrator re-bundle + a fusion test).

### D2 · HRVDex joins the HRV consensus, but on a labelled window
§14's fix reads HRVDex's `measurements[]` (median) so the HRV node is no longer silently dropped — and
labels the window `measurementMedian`, **not** `wholeRecord`, because a month of Welltory spot readings
is not an overnight whole-record value. The exclusion is now *reasoned and visible* rather than a silent
null, but the deeper question stands: **should** a spot-reading median be compared against an overnight
whole-record value at all? R8's like-window guard currently prevents it. **Do:** decide deliberately, and
write the decision into `EVENT-LEXICON.md`.

> **EXECUTED 2026-07-13.** Decision recorded in `docs/EVENT-LEXICON.md` §7.2: a spot-reading median and an
> overnight whole-record SDNN are **different windows and NOT consensus-comparable** — R8's like-window guard
> deliberately keeps `measurementMedian` off the `wholeRecord` axis. Do not feed one into the other.

---

## §E · Provenance / process

### E1 · A long-standing fixture assertion was itself wrong
§6 discovered that the committed `lingo-glucose-data-2026-MAY-23.csv` **always railed at 54 mg/dL** — the
old clip detector simply could not see it — while the test suite asserted it was a *"clean, unclamped
file"*. The assertion now encodes the truth. **The lesson is the item:** an assertion that describes a
fixture's *content* is a claim like any other, and this one had never been checked against the bytes.
**Do:** sweep the remaining fixture-describing assertions for other unverified claims about what a
committed file contains.

> **EXECUTED 2026-07-13.** Swept every committed fixture's content-claim against the raw bytes (Node
> inspection of the committed synthetic inputs + node-exports): the §6 lingo case was the only wrong one —
> the rest hold (lossy carries its 1200-row "- -" gap, dmy/mdy are byte-metamorphic, longnight is a full 7 h,
> the synthetic-Lingo golden is genuinely clean at min 89). Locked as a regression gate — the new
> **`Fixture content-claims — verified against the committed bytes (§E1)`** group re-checks each claim
> **directly against the bytes** (no compute in the path), incl. byte-locking the §6 rail against the committed
> node-export, so a derived assertion can never again mask a false file-claim. 6/6 green, fresh-clone safe.

### E2 · Version-into-bundle stamping is still deferred
Unchanged by this audit; noted so it is not lost. Rides the next behavioral re-bundle (§📦).

---

## Done when
- §A ships a long, lossy, real night in the equiv set, and §1/§8/§9 red through it.
- Every §B item is either fixed or **argued closed** with the corpus evidence that justifies the threshold.
- §C1 is proven or refuted across the 39 nights; §C2 is reconciled before any REM work starts.
- §D1/§D2 are written into `EVENT-LEXICON.md` as decisions, not left as code facts.
- Gates: `Dex-Test-Suite.html?full` all-green · `verify-provenance.html` clean · `build.mjs --check` clean.
