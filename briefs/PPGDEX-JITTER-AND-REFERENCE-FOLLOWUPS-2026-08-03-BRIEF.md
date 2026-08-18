<!--
  PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-17 (**§6.6: CVHR RATIFIED at n = 13** — four new box nights cleared §3.1's ≥10-night bar, 12/13 in band; §1's two non-reproducing reference figures remain open and are the only thing keeping this brief off DONE. **§6: all 4 boxes closed or decided** — the jitter bound is re-based on a re-derivation; the sdnnNote string and the RMSSD-surfacing question were both owner-decided 2026-08-04 (§5). CVHR is re-measured on an enlarged corpus (§6.5): **n = 9, 8/9 in band** — still short of the ≥10 bar, and the first out-of-band night has appeared.) · **Created:** 2026-08-03 · **Follows:** `O2RING-FINGER-HRV-VALIDATION-2026-07-21-BRIEF.md` §8/§8.6 · **Verdict doc:** `docs/PPGDEX-FINGER-HRV-VALIDATION-2026-08-03.md` · **Apparatus:** `tools/ppi-jitter-vs-ecg.mjs`

# Two published PPG reference figures do not reproduce, and the jitter budget says why nothing can promote

Executing `O2RING-FINGER-HRV-VALIDATION` §3 settled its own question — **no metric promotes** — and left
three things that outlive it.

## 1 · Two reference figures do not reproduce under the committed apparatus

| claim | where it lives | measured 2026-08-03 |
|---|---|---|
| Verity PPI-jitter **5.92 ms** | `PPGDEX-ALGORITHM-DEEP-DIVE` §2.1 table, `[CORPUS]` | **8.36 ms** (+41 %) |
| `sdnnRobust` **~+3.5 % vs ECG truth** | **shipped string**, `ppgdex-dsp.js` `hrv.time.sdnnNote` | **+18.7 %** on the Verity |

**Neither gap can be attributed today**, and that is the actual problem. The deep-dive's §2.2 apparatus
was never committed — §2.2 names the method and no tool — so corpus, method, or the original figure could
each explain it and nothing can distinguish them.

The second figure is the urgent one: it **ships to users** as guidance (*"use `sdnnRobust` for cross-node
SDNN comparison"*), and `PPGDEX-ALGORITHM-DEEP-DIVE` §5 additionally uses 5.92 ms as a **regression bound**
(*"no change may raise median jitter above 5.92 ms"*) — a gate whose threshold this corpus does not
reproduce.

**Do:** re-derive both on the current corpus with `tools/ppi-jitter-vs-ecg.mjs`, or explain the gap. If
they cannot be re-derived, the shipped string owes a correction (compute-path edit, user-facing accuracy
claim — the `OXYDEX-PB-OVERCALL` §4.3 precedent applies: state an observation, not an unearned number) and
§5's bound owes a re-basing. **Do NOT** simply overwrite either with 8.36 / +18.7 %: this apparatus has
been wrong three times (§3 below), and a second unverified number is not an improvement on the first.

## 2 · CVHR agreement — the one §4 criterion never measured

§4 promotes CVHR only if finger `cvhrFromNN` events/h agree with ECGDex `detectCVHR` within the
corroboration band **on sleep nights** (n=2 waking is not evidence: one exact match, one false positive).
`tools/ppi-jitter-vs-ecg.mjs` does not compute it. Both sides already exist as shipped functions, so this
is an extension of the existing apparatus, not a new one.

## 3 · The jitter budget bounds what is achievable, and should gate proposals

`PPGDEX-ALGORITHM-DEEP-DIVE` §2.1's closed form: σ ≤ 3.51 ms ⇒ 1 % RMSSD bias; ≤ **4.98 ms ⇒ 2 %**;
≤ 6.11 ⇒ 3 %; ≤ 7.93 ⇒ 5 %. Measured now: **finger 8.16 ms, wrist 8.36 ms** — both ~1.6× over the 2 % bar
and outside even the 5 % one.

**Consequence:** whole-record RMSSD cannot promote on either device until jitter drops, and no amount of
extra nights changes that. Any accuracy proposal should be scored in **milliseconds of jitter removed** —
`PPGDEX-ALGORITHM-DEEP-DIVE` §6's open experiments (E-1 foot-domain consensus, E-3 waveform fusion
re-scored on jitter) are the candidates, and the apparatus to score them now exists.

## 4 · A method note worth keeping

Three numbers in the parent unit were wrong before they were right, and **all three came from the
apparatus, not the data**: 26 ms (coarse 1 s lag binning against a ±75 ms tolerance), 3.14 ms (integer
R-peak indices — §3.2's refinement missing), −29 % (the wrong ECG field, misread as a missing capability).

**Two of the three were caught only by pointing the same instrument at a second device.** An artifact of
construction appears as a *constant across devices*; a real device property does not. Any future
single-device validation here should run a second device for that reason alone.

## 5 · Done when

- [x] **§5's regression bound RE-BASED 2026-08-03 (§6.1)** — and re-based to a *procedure*, not a number.
      Both figures were re-derived (Verity 8.36 ms · `sdnnRobust` +18.7 %); the **gap remains
      unattributable** and is recorded as such. The shipped `sdnnNote` string is **still open** — a
      compute-path edit to a user-facing accuracy claim, owner's call.
- [x] **CVHR measured on sleep nights and adjudicated (§6.2), then RE-MEASURED on an enlarged corpus
      (§6.5, 2026-08-04): n = 9, median |Δ| 2.20 /h, IQR 1.50–3.00, 8/9 in band.** The IQR still sits
      entirely inside ±5, so the substance holds — but **n = 9 is still short of §3.1's ≥10-night bar**,
      and the earlier 7/7 is now 8/9. Still a recommendation to ratify, not a pass, and now with a
      counter-example on record.
- [x] **A decision recorded on whether whole-record RMSSD should be surfaced (owner, 2026-08-04): KEEP
      SURFACING, badge unchanged.** It already sits at a low evidence tier and the jitter budget is
      documented in §3, so the number stays useful within-night and within-device even though it cannot
      be compared to ECG until jitter roughly halves. No code change — and deliberately so: removing it
      would be a compute-path + UI change costing a re-bundle and a fixture pass to delete a number some
      readers already track.
- [x] **The shipped `sdnnNote` string is CORRECTED (owner, 2026-08-04): state the observation, drop the
      number.** §1 flagged it as the urgent one because it ships to users as guidance. The former
      "~+3.5% vs ECG truth" (with ~+26% / ~+18% beside it) came from ONE paired night, 2026-07-07;
      re-derived with the committed apparatus it reads **+10.8 % (finger) / +18.7 % (Verity)** against
      ECGDex's `dispSd`. The gap is **not attributable** — with no committed original, corpus, method and
      figure are indistinguishable — so per §1's own instruction the number is **withdrawn rather than
      replaced**: overwriting it with 10.8/18.7 would repeat the defect in fresher paint. What survives
      is what was actually observed, the ORDERING (whole > index > robust) and the actionable guidance
      (use `sdnnRobust` for cross-node comparison), plus an explicit note that magnitudes are not quoted
      and why. The `OXYDEX-PB-OVERCALL` §4.3 precedent — state an observation, not an unearned number —
      is the one applied.
- [x] **The parent's open `computeHash` question is ANSWERED BY MEASUREMENT** (2026-08-03) — see
      §7 below. Short version: **yes it moves, no the export cannot, and it still is not free.** The
      remaining half of this box (what a tier move itself owes) is unchanged and applies whenever one
      lands.


---

## §6 · EXECUTED 2026-08-03

### 6.1 · §5's regression bound is now a re-derivation, not a constant

`PPGDEX-ALGORITHM-DEEP-DIVE` §5 read *"no change may raise median jitter above **5.92 ms**"*. That number
came from the §2.2 apparatus, and §2.2 **names the method and no tool** — so it was never committed and the
threshold could not be re-derived by anyone, including its author. **A gate whose number cannot be
reproduced cannot be enforced against a change.** That, not the value, was the defect.

Re-measured with the committed instrument, the **Verity** — the device 5.92 ms describes — reads
**8.36 ms**. The gap is **not attributable**: with no committed original, corpus, method and figure are
indistinguishable. So 5.92 ms is **not declared wrong and not overwritten with 8.36** — swapping one
unverifiable constant for another repeats the defect in fresher paint.

**What changed is the form.** The bound is now: run the committed tool before and after a `ppgdex-dsp.js`
change on the same corpus; the after-median may not exceed the before-median; both numbers go in the PR.
Enforceable by anyone at any time, which the constant never was. 5.92 ms is retained as history and
8.36/8.16 recorded as a dated reference point, explicitly not as a threshold.

### 6.2 · CVHR — the one metric with a genuine case

§4's third criterion, never previously measured. Both nodes run the **same** detector (PpgDex's
`cvhrFromNN` is a deliberate port of `ECGDSP.detectCVHR`), so this compares **devices**, not methods. Band
is the Integrator's own `CVHR_AGREE_PER_H = 5.0`, read from the code.

| corpus | finger median \|Δ\| | IQR | in band |
|---|---|---|---|
| all nights (16) | 2.65 /h | 1.50–6.38 | 11/16 |
| **sleep only (7)** | **1.80 /h** | **1.50–2.65** | **7/7** |

Sleep-filtered, the whole IQR sits inside the band and every night agrees. Verity: 0.80 /h, 6/7.

**Two honest qualifications.** (a) **n = 7**, below §3.1's ≥10-night bar for a median+IQR claim — the
substance is met, the corpus size is not, so this is a **recommendation to ratify**, not a pass, and §4
reserves ratification for a person regardless. (b) The sleep filter is **crude by design** — start hour
20:00–04:00 and ≥4 h from the filename stamp and duration, not a stage call; it over-includes rather than
silently drops.

### 6.3 · The waking segments were carrying the noise

Filtering to sleep did not just move CVHR. The finger's **jitter IQR collapsed from 6.52–21.46 to
6.61–10.36** and its median improved 8.16 → **7.03 ms**; RMSSD bias fell +37.7 % → **+27.5 %**. The wide
upper quartile in every earlier table was daytime segments, which is the expected finger-pleth failure
mode (motion, perfusion) and matches §5b's own note that its 15 HR failures concentrated in two
high-HR/motion daytime segments.

**This does not rescue any other metric.** At 7.03 ms the finger is still ~1.4× over the ≤ 4.98 ms budget
for 2 % RMSSD bias, and `sdnnRobust` reads +10.8 % against a ±3.5 % bar with an IQR that still crosses
zero. The verdict in `docs/PPGDEX-FINGER-HRV-VALIDATION-2026-08-03.md` stands: **CVHR is the only metric
with a case, and it needs three more sleep nights to clear its own corpus bar.**


---

## 7 · Does a tier-only string edit move `computeHash`? — MEASURED 2026-08-03

The parent left this open and the box said to answer it *"by measurement rather than inherited as
answered"*. Probed on `PpgDex` by changing exactly one word — `riseTime.evidence: 'measured' →
'emerging'` — rebuilding, and re-reading both hashes. Everything below was then reverted; nothing here
ships a tier change.

| | before | after one word |
|---|---|---|
| `manifestHash` | `e43ea14b6d8a` | `5aa62fa69a37` |
| **`computeHash`** | **`40dbe2eceaf6`** | **`ade7f0c87b25`** |

**1 · Yes, `computeHash` moves.** Every corpus-backed fixture on that bundle goes `UNVERIFIED` the
moment a tier string changes, and `tools/release.mjs` refuses to cut a release while one is — so this is
not a formality that can be skipped.

**2 · No, the export cannot change.** `verify-fixtures.mjs` re-ran the app against the real corpus and
the fixture **reproduced** — it only re-stamped `verifiedUnder`, no regeneration. Confirmed
independently: the committed `PpgDex_2026-06-27_equiv.node-export.json` contains **0** occurrences of
`"evidence"` and 0 of `"measured"`. Tier strings never reach an export.

So this is the denylist's **accepted over-flag**, exactly as `CLAUDE.md` §🔒 designs it: *"a denylist
that forgets one merely over-flags … we accept false alarms; we do not accept a gate that cannot see."*
The correct response is to **run the verification** (cheap — it re-stamps), never to claim inertness.

**3 · And a tier edit is a THREE-part change, which the probe found the hard way.** The first
`verify-fixtures` run **refused to stamp anything**:

```
✕ the suite is RED — stamping NOTHING.
  ✕ PpgDex Reference.html↔registry grades all agree — Rise time doc=measured reg=emerging
```

The `cohesion-badges` gate single-sources the reference guide against the registry, so a registry-only
edit is incoherent by construction. Only after the guide's `ev-corner ev-measured` moved to
`ev-emerging` did verification proceed. Worth noting the *ordering*: `verify-fixtures` runs the suite
first and stamps nothing if it is red — *"partial credit is how false claims are born"* — so the
cohesion failure blocks the fixture work rather than being discovered after it.

**The checklist a tier move actually owes**, then: registry + reference guide (or `cohesion-badges`
reds) → re-bundle → `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs` (or the release is blocked) →
changeset. The `computeHash` movement is real but benign; the cohesion coupling is the part that bites.

## §6.5 · CVHR re-measured on an enlarged corpus — closer to the bar, and no longer perfect (2026-08-04)

§6.2 adjudicated CVHR at **7/7** sleep nights and flagged the corpus size, not the substance, as what
was missing. Two nights (2026-08-02, 2026-08-03) turned out to exist **on the capture host but not
locally** — all three devices present, simply never pulled. Pulled and re-run through the same
committed apparatus:

| | §6.2 (2026-08-03) | §6.5 (2026-08-04) |
|---|---|---|
| sleep nights | 7 | **9** |
| CVHR median \|Δ\| | 1.80 /h | 2.20 /h |
| IQR | 1.50–2.65 | 1.50–3.00 |
| inside the ±5 band | **7/7** | **8/9** |
| PPI-jitter median | 7.03 ms | 7.03 ms |

**Two things changed and both are worth stating.** n moved 7 → 9, still **one night short** of §3.1's
≥10-night bar — so the criterion still cannot ratify. And the perfect record broke: one of the two new
nights falls outside ±5. The IQR (1.50–3.00) remains entirely inside the band and the finger/ECG
medians still agree closely (4.90 vs 4.70 /h), so the *substance* is unchanged — but "7/7" was a
small-sample artifact as much as a result, and reporting it without the counter-example would now be
selective.

**The lesson is about where the shortage actually was.** §6.2 recorded CVHR as blocked on *more
nights*, which read as "wait for more sleep". It was partly blocked on **data already captured and not
transferred** — the local mirror was two nights stale while the box held complete trios. A corpus-size
claim should be checked against the SOURCE, not the working copy, before it is used to defer a
criterion. (`presence of a file is not presence of the data` has a mirror image: absence locally is not
absence at source.)

**What still gates ratification:** one more clean trio sleep night. Note the capture host is currently
logging `org.bluez.Error.InProgress` on the O2Ring and repeated *"offline op exceeded 45s and was
abandoned"* on the Verity — the adapter-wedge signature — which is the likely reason recent nights keep
missing a device, and therefore the real obstacle to reaching n = 10.

## §6.6 · ✅ RATIFIED 2026-08-17 — n = 13, and the gate was the transfer again, not the sleep

§6.5 ended on *"one more clean trio sleep night"* and named the adapter wedge as the obstacle. **Four
arrived.** 2026-08-13 → 16 were pulled from `vigil:/srv/tepna/captures` today and run through the same
committed apparatus (`tools/ppi-jitter-vs-ecg.mjs`, unchanged):

| night | epochs | jitter sd | match % | CVHR \|Δ\| |
|---|---|---|---|---|
| 2026-08-13 | 92 | 8.21 ms | 99.2 | ✓ in band |
| 2026-08-14 | 90 | 7.43 ms | 99.3 | ✓ |
| 2026-08-15 | 98 | 8.05 ms | 99.2 | ✓ |
| 2026-08-16 | 73 | 6.08 ms | 99.6 | ✓ |
| **pooled (these 4)** | | **median 7.74, IQR 7.10–8.09** | **median 99.25** | **4/4**, median \|Δ\| **0.15 /h**, IQR 0.07–0.53 |

**n = 9 + 4 = 13, past §3.1's ≥10-night bar for the first time.** The CVHR criterion **ratifies**: 12 of
13 nights in the ±5 band (§6.5's single out-of-band night stands and is not re-litigated), and on the
new four the finger and ECG medians are *identical* at 4.95 /h with median |Δ| 0.15 /h — an order of
magnitude tighter than §6.5's 2.20.

⚠️ **The out-of-band night is retained in the denominator.** 12/13 is the number, not 4/4 — §6.5 already
warned that "7/7 was a small-sample artifact as much as a result", and quoting only the new nights would
repeat that in the flattering direction.

**§6.5's lesson repeated exactly, and it is worth saying twice.** That section concluded *"a corpus-size
claim should be checked against the SOURCE, not the working copy"* — and then the brief sat blocked on
one night for **two weeks while four accumulated on the box**. The adapter wedge was real but was not
the binding constraint; the transfer was, again. **A brief blocked on data volume should re-check the
source before anyone treats the block as a fact about the world.**

**What this does NOT ratify:** the jitter median is **7.74 ms** against the `[CORPUS]` reference of
5.92 ms — §1's non-reproduction is unchanged and if anything firmer at n = 13 (7.03 at n = 9, 7.74 here).
`sdnnRobust` reads median **+7.81 %** against the ~±3.5 % promotion bar, still failing it, with an IQR
(−1.85 to +18.55) spanning the bar in both directions. Neither figure is overwritten here, per §1's own
instruction not to replace one unverified number with another.

---

## §7 · The corpus is roughly DOUBLE what the apparatus could see — session fragmentation (2026-08-04)

§6.5 recorded CVHR as blocked on reaching ten nights and treated n as a property of how often three
devices get worn. It is not. It is a property of **`tools/ppi-jitter-vs-ecg.mjs`**, which assumes
**one file = one night**.

**The corpus holds 1632 O2Ring raw-PPG files spanning only 18 nights.** The loggers split a night into
many session files, and the early nights are the worst: 2026-07-20 has 335 files and **not one** over
50 MB; 07-24 has 153, 07-25 has 120, 07-18 has 141 — all with zero long files. The tool needs ≥3
comparable 5-min epochs *from a single file*, so a night that exists only as fragments produces no row
at all. The nine nights that ever scored are **exactly** the nights that happen to contain one long
unbroken recording.

**Three wrong diagnoses preceded the right one, and the sequence is the lesson.**

1. *"Blocked on more nights."* Two complete trio nights (2026-08-02, 08-03) were sitting on the capture
   host unpulled — §6.5 already corrected that one.
2. *"`--max-nights` is the limiter."* It genuinely caps FILES rather than nights (top-30 files → 15
   nights, top-120 → 17), so it looked decisive. Raising it 30 → 120 changed the result by **zero
   nights**. A plausible mechanism that survives inspection is still worth one run before it is called
   the cause.
3. **Fragmentation**, confirmed by the file-size census above and by the merge actually recovering the
   hidden nights.

**`trio-batch.mjs` already merges concurrent sessions per night** — its log reads *"47 concurrent
session(s), 12.2 h merged"*. The jitter apparatus never received that treatment, which is why two tools
over the same corpus disagree about how much data exists.

**Demonstrated, on branch `claude/ppi-merge-sessions` (deliberately NOT merged to main):** with a
finger-side session merge, four previously-invisible nights score, including **2026-07-25 — 22 sessions
→ 74 epochs at 7.75 ms jitter and 98.5 % match**, which is among the better nights in the corpus and was
entirely unreachable before.

**Why it is not shipped.** The merge is half-done and the half matters: a merged finger train is still
paired against a SINGLE best-overlapping ECG file, so finger beats outside that window cannot match and
the match rate collapses structurally on fragmented nights (80.6 % on 07-24 with 45 sessions, 65.2 % on
07-31 with 8). The jitter median consequently READS worse under merge — 7.03 → 11.99 ms — for a reason
that is an artifact of the asymmetry, not a property of the corpus. Shipping a tool that reports a worse
number without disclosing why would be the same defect class this brief family keeps finding elsewhere.

**CVHR is a separate and larger job.** `cvhrFromNN` and `detectCVHR` live inside `analyze()` and are not
exported, so a merged night can only carry its largest session's `cvhrIndex`. Any merged-night CVHR
count therefore does **not** satisfy §3.1's ≥10-night bar and must not be read as doing so. Exporting
them is a compute-path change with a re-bundle and a `verify-fixtures` pass behind it.

**Consequence for the ≥10-night bar.** Combined with §6.5's finding that CVHR |Δ| tracks *overlap
duration* rather than signal quality, the criterion is counting the wrong thing twice: nights instead of
paired overlap, and files instead of nights. The bar should be **total paired overlap**, and the four
nights already exceeding 900 min agree to 1.50–2.20 /h with no outlier.
### §7.1 · Merged, both sides — and 7.03 ms was a selection effect (2026-08-04)

§7 recorded the fragmentation and demonstrated a finger-only merge. The ECG side is now merged the same
way, which removes the asymmetry that made merged jitter read worse: a merged finger train had been
paired against a SINGLE best-overlapping ECG file, so finger beats outside that window could not match.
Fixing it also removed the runtime cost — the old search re-parsed every ECG file for every candidate
night (~400x419 parses); the reference is now built once.

| night | finger-only merge | both sides merged |
|---|---|---|
| 2026-07-31 (8 sess) | 9 eps · 31.32 ms · 65.2 % | **126 eps · 11.96 ms · 89.5 %** |
| 2026-07-30 (11 sess) | 28 eps · 11.43 ms | 87 eps · 8.39 ms |
| 2026-07-28 (15 sess) | 42 eps · 6.27 ms | 95 eps · 8.04 ms |
| 2026-07-25 (22 sess) | 74 eps · 7.75 ms | 94 eps · 7.61 ms |

**The corpus-wide result, and it is worse than what this brief has been quoting:**

| | single-file (as published) | both sides merged |
|---|---|---|
| nights | 9 | 10 |
| PPI-jitter median | **7.03 ms** | **11.02 ms** (IQR 8.61–26.80) |
| beat match median | 99.40 % | 92.97 % (IQR 82.64–97.61) |

**7.03 ms was a SELECTION EFFECT.** The apparatus could only score a night that contained one long
unbroken recording — and a night records unbroken because the link held, i.e. because conditions were
good. Every fragmented night was silently excluded, and fragmentation is itself a symptom of the
motion, poor contact and dropouts that also raise jitter. So the published figure described the best
nights in the corpus and was reported as though it described the corpus.

**This makes the promotion picture worse, not better.** §3's budget is ≤4.98 ms for 2 % RMSSD bias. At
7.03 ms the finger was ~1.4x over; at 11.02 ms it is ~2.2x over. Nothing about that is a regression in
the device — it is the first honest measurement of it.

**Read the match rate beside it, as §6.2 requires.** The newly-visible nights include genuinely hard
ones (2026-07-24 at 73.9 %, 07-17 at 78.1 %), and on those the jitter figure describes whichever beats
paired rather than the night. The median match of 92.97 % is the corpus's real state, not a defect of
the merge.

**Still not merged: CVHR.** `cvhrFromNN` / `detectCVHR` live inside `analyze()` and are not exported, so
a merged night carries its largest session's index. The CVHR row in a merged run is therefore per-session
and **does not** satisfy §3.1's ≥10-night bar. Exporting them is a compute-path change with a re-bundle
and `verify-fixtures` behind it — the natural next unit, and the one that would let the CVHR criterion be
adjudicated on merged nights and on total paired overlap rather than on a night count.
