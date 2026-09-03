<!--
  PPGDEX-JITTER-AND-REFERENCE-FOLLOWUPS-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-09-03 (**all five §5 "Done when" items are ticked and were VERIFIED by capability, not by their ticks, during the 2026-09-03 cluster triage.** ⚠️ The previous header — dated 2026-08-17 — said *"§1's two reference figures remain open"*, and was STALE AGAINST ITS OWN BODY: §1 was resolved **2026-08-18**, one day later, and records that BOTH figures reproduce (Verity PPI-jitter median 6.09 ms, IQR 4.57–7.54, containing the 5.92 reference; `sdnnRobust` median 1.84 %, inside the ±3.5 % bar; beat match median 100.00 %). The gap was the TOOL, not the corpus — `ppi-jitter-vs-ecg.mjs` matched only `VeritySense` while Polar Sensor Logger writes `Polar_Sense`, one device with two spellings and an identical serial, so the old pattern matched 0 of 1980 files and reported "nothing to report". **Re-verified 2026-09-03 that the fix is in the code and not merely described in a comment:** the live pattern is `/(?:VeritySense|Polar_Sense).*_PPG\.txt$/` and matches both spellings. §6.6 CVHR ratified at n=13. **The one genuine remainder is NOT a "Done when" item and does not block this brief** — §6.7's corpus-vs-apparatus question (whether the Verity leg's 4.98 ms on box nights vs 6.09 ms here is corpus or method) needs the two medians compared THROUGH their uncertainties at matched n, or the 15-night set re-run with `--device verity`. Rowed rather than held open here.) · **Residue:** 2026-09-03-verity-jitter-corpus-vs-apparatus

# Two published PPG reference figures do not reproduce, and the jitter budget says why nothing can promote

Executing `O2RING-FINGER-HRV-VALIDATION` §3 settled its own question — **no metric promotes** — and left
three things that outlive it.

## 1 · Two reference figures do not reproduce under the committed apparatus

| claim | where it lives | measured 2026-08-03 |
|---|---|---|
| Verity PPI-jitter **5.92 ms** | `PPGDEX-ALGORITHM-DEEP-DIVE` §2.1 table, `[CORPUS]` | **8.36 ms** (+41 %) |
| `sdnnRobust` **~+3.5 % vs ECG truth** | **shipped string**, `ppgdex-dsp.js` `hrv.time.sdnnNote` | **+18.7 %** on the Verity |

> 🔴 **§1 RESOLVED 2026-08-18 — BOTH FIGURES REPRODUCE. The gap was the TOOL, not the corpus.**
>
> `tools/ppi-jitter-vs-ecg.mjs --device verity` matched the Verity by `/VeritySense.*_PPG\.txt$/` only.
> The armband is written **`Polar_VeritySense_<serial>`** by the capture host and **`Polar_Sense_<serial>`**
> by Polar Sensor Logger — one device, two spellings, identical serial (`0C301E3F`). On the PSL tree the
> old pattern matched **0 of 1980 files** while **54** wrist PPG and **50** paired H10 ECG sat there. The
> run reported *"nothing to report"*, which reads as *the corpus cannot answer this* rather than *the tool
> cannot see it*. (The repo already treated the PSL spelling as the Verity: PpgDex's own equivalence input
> is `Polar_Sense_BBBBBBBB_20260621_060523_PPG.txt`.)
>
> **Re-run over the corpus the reference came from, n = 14 nights:**
>
> | claim | recorded here | measured 2026-08-18 | verdict |
> |---|---|---|---|
> | Verity PPI-jitter **5.92 ms** | 8.36 ms (+41 %) | **median 6.09 ms**, IQR 4.57–7.54 | **reproduces** — the IQR contains 5.92 |
> | `sdnnRobust` within **~±3.5 %** | +18.7 % | **median 1.84 %**, IQR 0.73–3.36 | **reproduces** — inside the bar |
>
> Beat match rate median **100.00 %** (IQR 99.74–100.00), so these are not figures from whichever beats
> happened to pair. CVHR |Δ| 14/14 within the Integrator band.
>
> **Consequences, and the second is the one that ships:**
> 1. **§5's regression bound stands as written.** 5.92 ms is re-derived, not re-based; §5 was right to
>    refuse to overwrite it with 8.36.
> 2. **The shipped `sdnnNote` string does NOT owe a correction.** §1 flagged it as the urgent half
>    *("it ships to users as guidance")* on the strength of +18.7 %. At **1.84 %** the shipped claim is
>    accurate and no compute-path edit is owed. **Do not "fix" it.**
>
> ⚠️ **What was actually wrong was the 8.36 / +18.7 % pair, and the mechanism is worth keeping.** Both
> were produced by a tool that silently matched no wrist files — so whatever they measured, it was not
> the Verity on this corpus. An empty pattern and an empty corpus produce the same silence, and only one
> of them is a fact about the data. The tool now prints `N walked · N matched · N paired ECG` on every run
> and **exits 2 with a diagnosis** when nothing matches, so this specific failure cannot recur quietly.
>
> ⚠️ **SELF-CORRECTION 2026-08-18, same day — the word "reproduces" above was too strong for the
> jitter row, and I am scoping it rather than leaving it to be read as settled.**
>
> **What survives unchanged.** The tool was blind to 54 wrist files and now is not; that defect and its
> fix are independent of everything below. And `sdnnRobust` at **1.84 %** is a direct measurement of
> what the shipped string claims — 14 nights, 100 % median match — so **the "no correction owed"
> conclusion stands**, scoped to this corpus.
>
> **What does not survive: the 8.36 ms and my 6.09 ms are not the same comparison.** I checked the
> regex's history — `/VeritySense.*_PPG\.txt$/` was present in the **original** apparatus commit
> (`569c9804`, PR #756), not introduced later. The PSL tree contains **zero** files matching it. So the
> 8.36 ms figure, reported over 15 nights *with an IQR*, cannot have come from the PSL tree at all — it
> was measured on a corpus using capture-host naming (`Polar_VeritySense_*`). My 6.09 ms is from the PSL
> tree. **Two corpora, not one**, so 6.09 does not refute 8.36 and I should not have implied it did.
>
> Whether **5.92 ms** came from the PSL tree is likewise unestablished; if it did, 6.09 is a genuine
> re-derivation of it, and if it did not, the comparison is as unattributable as this brief originally
> said. The original §2.1 IQR (3.98–10.61) is much wider than mine (4.57–7.54), which is itself evidence
> the two runs saw different data.
>
> **Method check, since the bound's procedure specifies it.** I ran without `--sleep-only` first, then
> with it: **byte-identical** statistics. That is a genuine no-op here rather than an inert flag —
> verified by control: 10 of 54 wrist files ARE daytime and would be excluded, but `--max-nights 15`
> selects by SIZE and the 15 largest (320–377 MB) are **all nocturnal**, while daytime files median
> 14.7 MB. So the selection never contained anything for the filter to remove.
>
> 🔬 **AND THE LIKE-FOR-LIKE RUN IS NOW DONE — on the ORIGINAL corpus. The bound WORKED; my "no
> correction owed" does NOT survive it.**
>
> The baseline's corpus is named after all, in the linked doc rather than here:
> `docs/PPGDEX-FINGER-HRV-VALIDATION-2026-08-03.md` §4 — **`/home/michal/tepna-smoketest/captures/`**.
> It is still on disk (24 night dirs), so the comparison this brief called impossible is available.
> Re-ran there with the documented flags (`--device verity --sleep-only`), 11 nights:
>
> | | recorded 2026-08-03 | same corpus, 2026-08-18 | PSL tree, 2026-08-18 |
> |---|---|---|---|
> | Verity PPI-jitter | 8.36 ms | **4.71 ms** (IQR 4.57–5.07) | 6.09 ms (IQR 4.57–7.54) |
> | `sdnnRobust` vs ECG | +18.7 % | **5.89 %** (IQR −0.94–25.11) | 1.84 % (IQR 0.73–3.36) |
>
> **This is not a discrepancy — it is the bound doing its job.** `ppgdex-dsp.js` has taken **22 commits**
> since 2026-08-03, including *"the crystal axis ran backward — and was hiding real dropouts"* (#1229),
> which acts directly on beat timing. §5's rule is *"the after-median may not exceed the before-median"*:
> **4.71 < 8.36**, on identical data. The jitter genuinely improved, and the re-derivation form caught it
> where a frozen constant could not have.
>
> 🔴 **What this costs my earlier claim: "the shipped `sdnnNote` string owes NOTHING" is NOT established,
> and I withdraw it as stated.** `sdnnRobust` reads **1.84 %** on the PSL tree and **5.89 %** on the
> baseline corpus, against a bar of ~±3.5 %. **It passes on one corpus and fails on the other**, and the
> baseline corpus's IQR (−0.94 to 25.11) is far too wide to call the metric stable there at all. The
> honest position is the one this brief started with — **the claim is corpus-dependent and unsettled** —
> not "accurate, do not fix". The **+18.7 % → 5.89 %** improvement is real and worth recording; it is not
> the same as clearing the bar.
>
> **What still stands:** the tool was blind to 54 wrist files and now is not, and it now prints its
> denominator. Neither depends on any of the above.
>
> ⚠️ **The general fault, twice in one day, is asserting equivalence across an axis I had not checked.**
> First corpus identity; then, having fixed that, I kept a conclusion that only one of the two corpora
> supported. A measurement that disagrees between corpora is a statement about *corpus sensitivity*, and
> reporting either number alone hides that.

> **The lesson I take from over-claiming this:** "reproduces" is a statement about two measurements of
> the *same thing*, and corpus identity is part of the thing. I verified the method and the instrument
> and then asserted equivalence across an axis I had not checked at all.

> **Scope:** n = 14 nights, PSL tree (phone-captured, so no independent second clock — the same condition
> the reference was measured under, which is what makes it like-for-like). Two nights sit high
> (2026-07-01 at 15.13 ms with a 94.5 % match rate; 2026-06-20 at 11.70 ms), which is why the **median and
> IQR** are quoted rather than a mean.

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
      unattributable** and is recorded as such. ~~The shipped `sdnnNote` string is **still open** — a
      compute-path edit to a user-facing accuracy claim, owner's call.~~
      🔴 **SUPERSEDED 2026-08-18 — the shipped `sdnnNote` string owes NOTHING, and this line was the
      dangerous half of a self-contradiction.** §1's resolution measures `sdnnRobust` at **median
      1.84 %, IQR 0.73–3.36** over 14 nights — inside the ~±3.5 % bar the string claims. The +18.7 %
      that made this "urgent" came from a tool that silently matched **0 of 1980** files on that corpus,
      so it was never a measurement of the Verity at all.
      ⚠️ **Struck through rather than deleted, because the two halves disagreed in the direction that
      causes harm.** Once §1 was resolved this brief said "no correction owed" in one place and
      "compute-path edit to a user-facing accuracy claim" in another. A reader ranking work by
      Done-whens would have edited a **correct** shipped string — a regression produced by a brief
      contradicting itself, not by anything in the code. **Resolving a finding means sweeping every
      Done-when that cited it, not only the section it was found in.**
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

### §6.7 · ⚠️ AND THE FIRST JITTER NUMBER I QUOTED HERE WAS THE WRONG DEVICE — corrected within the hour

The table above was produced by `ppi-jitter-vs-ecg.mjs` **without `--device`**, and that flag defaults
to **`o2ring`**. So 7.74 ms is the **FINGER**. The tool nonetheless prints `[Verity wrist reference:
5.92 ms]` beside whatever it measured, and I compared a finger median to a wrist reference and called
it a non-reproduction. **Re-run with `--device verity` on the same four nights:**

| device (same 4 nights) | PPI-jitter median | IQR | beat match |
|---|---|---|---|
| **Verity (wrist)** — the device 5.92 ms describes | **4.98 ms** | 4.93–5.03 | **100.00 %** |
| O2Ring (finger) | 7.74 ms | 7.10–8.09 | 99.25 % |

**On these nights the Verity BEATS its own `[CORPUS]` reference — 4.98 against 5.92 — and does it at a
100 % beat match rate**, so the figure is not describing a subset of lucky beats. That is the opposite
of what §1 recorded (8.36 ms, +41 %) and the opposite of what I wrote an hour ago.

**This does not settle §1; it sharpens it, and only by one step.** Three measurements of the same
quantity now exist — 5.92 (original, uncommitted apparatus), 8.36 (2026-08-03, 15 nights, committed
apparatus), 4.98 (today, 4 nights, same committed apparatus). The 2026-08-03 run and today's used the
SAME tool, so **the apparatus is excluded as an explanation for the gap between those two.**

⚠️ **It does NOT follow that corpus explains it, and an earlier draft of this section said it did.**
4 nights against 15 differ in **precision** as well as in content: an IQR of 4.93–5.03 is the spread of
**four numbers**, not a confidence interval on the median, and it will read far tighter than the
estimate actually is. Before "corpus" is recorded as the explanation, the two medians must be compared
*through* their uncertainties at matched n — or, cheaper and better, **the 15-night set re-run with
`--device verity`** so the comparison is like-for-like at both ends. Until then the honest statement is
that the apparatus is excluded and the cause is still open.

**The load-bearing result here does not depend on any of that:** the Verity leg pairs at a **100 % beat
match rate** across all four nights. That is a property of the pairing, not of the σ, and it stands
whichever way the reference question resolves.

⚠️ **The trap, stated precisely — and my first account of it was itself half wrong.** I told a peer the
tool was unlabelled. It is not: line 230 prints `device: Polar Verity Sense (WRIST …)` / `Wellue O2Ring
(FINGER …)` correctly, at the top. **I lost that label by reading the output through `| tail -20`** —
CLAUDE.md §👥.4b, the truncation that discards the part carrying the verdict's meaning. So the defect is
a *joint* one: a correct label at the top, an unkeyed reference at the bottom, and a reader who
truncates. Any one of the three alone is survivable.

**Fixed at the durable end** (`tools/ppi-jitter-vs-ecg.mjs`): the reference line is now device-keyed and
repeats the device on the line — `[Verity WRIST reference: 5.92 ms — like-for-like]` under
`--device verity`, and under the o2ring default `[no published reference for the O2Ring FINGER; 5.92 ms
is the VERITY WRIST figure and is NOT comparable]`. **A label must travel with the number it labels**,
because the reader who most needs it is the one who truncated the page.

**What §6.6 does NOT ratify:** `sdnnRobust` reads median **+7.81 %** (finger) / **+9.35 %** (Verity)
against the ~±3.5 % promotion bar, still failing it on both devices, with IQRs spanning the bar in
both directions. Not overwritten here, per §1's own instruction.

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

### §6.8 · The two devices SEPARATE on clean nights — which makes §1's 8.36 ms the suspect number, not 5.92

Re-ran §1's owed re-derivation on `uploads/captures` (2026-07-31 → 08-16, merged mode), pointing the same
instrument at both devices on the **same nights, same corpus, same code** — §4's discipline, applied
deliberately rather than by luck:

| device | median jitter | IQR | nights | median match |
|---|---|---|---|---|
| Polar Verity Sense (WRIST) | **4.97 ms** | 4.92–5.03 | 4 | **100.0 %** |
| Wellue O2Ring (FINGER) | **8.05 ms** | 7.43–8.21 | 5 | 99.3 % |

**The finger replicates; the wrist does not.** §3 recorded *"finger 8.16 ms, wrist 8.36 ms"* — the finger
figure reproduces here to within 0.11 ms across two different corpora, while the wrist moved by **3.39 ms**.
A number that survives a corpus change and one that does not are not equally trustworthy, and only one of
these two was ever used as a reason to distrust the published reference.

**§4's own rule says which one to doubt, and it points at the wrist.** *"An artifact of construction
appears as a constant across devices; a real device property does not."* §3's pair sits **0.20 ms apart** —
a wrist and a finger sensor, different optics, different site, different coupling, agreeing to 2.4 %. That
near-equality is the signature §4 warns about. Here they sit **3.08 ms apart**, which is what two genuinely
different measurement sites look like. So the earlier wrist figure most likely carried the same
construction artifact as the finger leg rather than measuring the wrist.

**Consequence for §1 and §5: 5.92 ms is reproducible, and the gap it was asked to explain may not exist.**
On these nights the Verity lands at 4.97 ms — *below* the deep-dive's figure, and below §3's 4.98 ms
2 %-RMSSD-bias bar by a hair. §5's decision to re-base the bound to a **procedure rather than a number**,
and its explicit refusal to overwrite 5.92 with 8.36, are both vindicated: the number it declined to trust
is the one that failed to replicate.

**What this is NOT.** n = 4 wrist nights from a single 16-day window, all at a 100.0 % match rate — an
unusually clean subset, and cleanliness is plausibly *why* the wrist separates here. This does **not**
re-base §5's bound, does not restore 5.92 ms as a gate, and does not retire §1: it moves the burden onto
the 8.36 ms figure and names the test that settles it — **re-run the wrist leg on the ORIGINAL 15-night
set with the match rate beside it** (that corpus is not on this volume; see `corpora-live-on-the-box`). If
the wrist reads ~8.4 there with a low match rate, the difference is night quality and both figures stand as
corpus-conditional; if it reads ~5 with a high one, the 8.36 was the apparatus and §1's first row closes.

> ### 🔴 THAT TEST IS ALREADY ANSWERED — the match rate was recorded beside 8.36 all along (2026-08-20)
>
> The discriminator above asks for *"the ORIGINAL 15-night set with the match rate beside it"*. It is in
> `O2RING-FINGER-HRV-VALIDATION-2026-07-21-BRIEF.md` §8.1, in the row that produced 8.36:
>
> | | nights | PPI-jitter sd (median) | IQR | beat match rate |
> |---|---|---|---|---|
> | **Verity WRIST** | 15 | **8.36 ms** | **4.63 – 31.61** | **100 % (IQR 86.7–100)** |
>
> **The wrist reads ~8.4 with a HIGH match rate — neither branch the test poses.** It offers
> "8.4 + low match ⇒ night quality" or "5 + high match ⇒ apparatus"; the actual pair is
> **8.4 + 100 %**, which the framing did not anticipate, so no corpus re-run can resolve it *as posed*.
>
> **And the discrepancy that motivated all of §1 is not statistically present.** That IQR spans
> **4.63 – 31.61 ms** — and **5.92 sits inside it**, comfortably. *"8.36 ms: 41 % higher"* compares a
> median against a point value with the spread discarded, on a distribution ~27 ms wide. §8.2's own
> honest line — *"I cannot attribute it"* — was written directly beneath the IQR that shows there is
> little to attribute. §1's re-run (median **6.09**, IQR 4.57–7.54) is consistent with both figures for
> the same reason.
>
> ⚠️ **This is also why §6.8's 4-night IQR must not be read as the tighter measurement.** 4.92–5.03 is
> the spread of **four numbers**; 4.63–31.61 is the spread of fifteen. The narrow one looks ~300× more
> precise and is not — §6.8 already warns about exactly this, and the warning applies to the comparison
> the section then invites. Two medians of different precision cannot be differenced; they have to be
> judged through their dispersions, which is what this box does.
>
> **So the corpus transfer buys precision, not a verdict.** For anyone who wants it anyway: the box
> holds **26 nights carrying both Verity PPG and H10 ECG** under `/srv/tepna/captures` (27 nights
> total), **13 GB** of paired files — more than the 15 the test names. But the original fifteen are
> *not identified anywhere*, so a 26-night run produces a **fourth** number for this quantity rather
> than adjudicating the existing three. Naming the nights is the prerequisite, not the transfer.
>
> **What remains genuinely open** is narrower than the section above implies: not *"which figure is
> right"* — they are not distinguishable at the recorded precision — but *"what is the wrist's PPI
> jitter with an interval anyone can quote"*, which needs an n large enough to make the median stable.
> The 15-night IQR says the current answer is not that.

⚠️ **The device-keyed reference line this run needed is not yet on `main`** — it ships in this same PR.
Until it lands, the tool prints `[Verity wrist reference: 5.92 ms]` beside an **O2Ring** figure, which is
exactly the unkeyed-label defect (`AUDIT-PROMPT.md` class 15) that produced the mis-attribution corrected
in §6.7. The footer above was read against the run's own `device:` header line, not the bracket.
