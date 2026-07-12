<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-12 (**§A EXECUTED** — the blind spot is closed, *and this brief's own prescription for it was wrong*; see §A. §B–§E open) · **Created:** 2026-07-12 · **Supersedes:** — · **Parent:** `DEEP-AUDIT-2026-07-11-BRIEF.md` (DONE 2026-07-12, all 21 findings executed)

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
- The other adversarial shapes this audit hand-built (a two-session CPAP night; a PPG worker realm) have
  no committed synthetic twin yet. Same recipe applies.

---

## §B · Fail-open layers still open (defence-in-depth, no known wrong number)

### B1 · PulseDex accepts any column that *looks* like an interval — the two layers under §2
The §2 fix vetoes a foreign Polar-Sensor-Logger stream **at the adapter**, which closes the reachable
production path (the H10 `*_ACC.txt` now reports `UNKNOWN → set aside`). The two deeper layers still
fail open:
- `pulsedex-dsp.js:289 _pdIntervalColByRange` accepts **any** column whose median lands in 300–2000, with
  no unit or header check.
- the `usable` gate checks value *range* but never *interval-likeness* — the accelerometer's gravity rail
  produced **SDNN 9.5 ms over 3 h**, a physiologically impossible number that nothing questioned.

**Why it was not done:** rejecting a near-constant series needs a judgement call on genuinely
low-variability recordings (a metronomic paced-breathing session is real data). It needs a threshold
argued from the corpus, not guessed. **Do:** derive the floor from the real trio corpus, then reject
`[mg]`/`[G]`/`[dps]` headers *and* near-constant series at the DSP layer too.

### B2 · `_envToSeed` still seeds an absent objective column to `0`
`hrvdex-dsp.js` `_envToSeed`'s `n()` maps absence → `0`. The §3 presence gates make this harmless
*today* (a real band power is never exactly 0, so `> 0` distinguishes them), but `null` is the honest
seed and the current safety rests on a coincidence of physiology. **Do:** seed `null`, and let the
presence gates read presence rather than magnitude.

### B3 · The `||0` siblings of the HRV Score
§21 fixed `_hrv` — the *surfaced hero*. Its five siblings in the same block still coerce an absent
vendor column to a real-looking `0`:
`hrvdex-dsp.js` `_energy` · `_focus` · `_sns` · `_psns` · `_coherence`.
None is a hero number today, so none was proven to mis-state a surfaced value — which is exactly why
they were left rather than changed blind. **Do:** trace each to its render site; any that reaches a user's
eye gets `numOrNull`, the rest get it anyway for consistency.

### B4 · `spo2HrDecouplingPct` keeps the shape §18 removed from coupling
`oxydex-dsp.js:1316` — `dcTotal > 0 ? … : 0`. Same 0-for-undefined shape §18 fixed for `couplingScore`,
but no valid windows is a different (and rarer) condition than no nadirs, and it was **not** proven to
move a surfaced number. **Do:** confirm the render path, then make absence `null` like its sibling.

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

### D2 · HRVDex joins the HRV consensus, but on a labelled window
§14's fix reads HRVDex's `measurements[]` (median) so the HRV node is no longer silently dropped — and
labels the window `measurementMedian`, **not** `wholeRecord`, because a month of Welltory spot readings
is not an overnight whole-record value. The exclusion is now *reasoned and visible* rather than a silent
null, but the deeper question stands: **should** a spot-reading median be compared against an overnight
whole-record value at all? R8's like-window guard currently prevents it. **Do:** decide deliberately, and
write the decision into `EVENT-LEXICON.md`.

---

## §E · Provenance / process

### E1 · A long-standing fixture assertion was itself wrong
§6 discovered that the committed `lingo-glucose-data-2026-MAY-23.csv` **always railed at 54 mg/dL** — the
old clip detector simply could not see it — while the test suite asserted it was a *"clean, unclamped
file"*. The assertion now encodes the truth. **The lesson is the item:** an assertion that describes a
fixture's *content* is a claim like any other, and this one had never been checked against the bytes.
**Do:** sweep the remaining fixture-describing assertions for other unverified claims about what a
committed file contains.

### E2 · Version-into-bundle stamping is still deferred
Unchanged by this audit; noted so it is not lost. Rides the next behavioral re-bundle (§📦).

---

## Done when
- §A ships a long, lossy, real night in the equiv set, and §1/§8/§9 red through it.
- Every §B item is either fixed or **argued closed** with the corpus evidence that justifies the threshold.
- §C1 is proven or refuted across the 39 nights; §C2 is reconciled before any REM work starts.
- §D1/§D2 are written into `EVENT-LEXICON.md` as decisions, not left as code facts.
- Gates: `Dex-Test-Suite.html?full` all-green · `verify-provenance.html` clean · `build.mjs --check` clean.
