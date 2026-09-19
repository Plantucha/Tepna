<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS (live writer BUILT — `stuck` + hold classification; `pinned` back-check is WU-6/WU-7, not this unit · **D1 (owner ruling 2026-09-19, BUILT the same day, Wren):** the sidecar names two SPAN KINDS — `absence` (the O2Ring reads exactly 100 with no finger: finger-off capture 2026-09-19, six independent stretches, 100.0 %; `docs/O2RING-FINGER-OFF-2026-09-19.md`) and `in-wear-rail` (0 / 199 occur ONLY while worn — zero is NOT idle; a statement about observation, not mechanism). Ninth column `kind` + a `kinds=` header token (`writers.RUN_KIND_BY_STREAM`, per stream, `unknown` wherever unmeasured — the Verity rail, the ring's 99/124). Emission is UNCHANGED: kind labels rows the run-length rule already chose, so `min_run` remains a rails-only question. NOT done here, deliberately: no refold, no consumer reads the kind yet (`ppgdex-dsp.js` parses the 9-column row and ignores it — asserted), and the sidecars on vigil keep their 8-column shape until the next deploy writes new ones) · **Created:** 2026-09-06 · **Residue:** 2026-09-06-warmup-verdict-goes-stale, 2026-09-06-t-stuck-validated-on-ring-only

# PPG ABSENCE-AS-VALUE — recording the spans where the wave stopped being a measurement

A run of identical consecutive samples on an optical channel is the shape a held or dropped link
leaves in the wave: the value is not a fresh measurement, it is the last one repeated. Capture cannot
tell a held link from a genuinely flat signal, so it does not judge — it **records the span** and
leaves the verdict to analysis. The alternative is re-deriving the absence months later from bytes
that no longer say which they were.

## 1 · What the live writer does (BUILT, this unit)

`writers._RunSidecar`, one per optical `StreamWriter`, writing `<base>RUNS.txt` beside the stream.
**The captured bytes are untouched — the sidecar is the only new file.**

| | |
|---|---|
| rule | `stuck` — a constant run of **≥ `T_STUCK` = 200** samples |
| streams | `ppg1` (O2Ring 1-col) · `ppg` (Verity 3-LED, same `write_ppg`) · `ppg2w` · `acc` · `accraw` |
| classification | per **channel**: `held` \| `variable` \| `undecided` |
| seam | `emit_run(stream, value, first_index, n, dur_ms, closed, rule, stamp)` |
| cost | O(1) per sample — no window, no median |

Row: `Phone timestamp;stream;value;first_index;n_samples;dur_ms;closed;rule`. `rule` is **free text,
not an enum**, so a back-check detector's vocabulary can move without a format change.

## 2 · Why `T_STUCK` is 200 and not 5 (measured, not chosen)

A low run-length threshold is not viable **at any value**, and this was measured on the real 04:53
O2Ring file (843,032 samples) rather than argued:

- Legitimate non-sentinel runs ≥ 5 are **7.331 %** of all non-sentinel runs (30,309 / 413,416).
- Non-sentinel run-length percentiles: p50 = 1, p90 = 4, p99 = 14, p99.9 = 31, **p99.99 = 48**.
- The damaging band on the severity curve is **10–40 samples**, which sits *between* p99 and p99.9 of
  legitimate plateaus. **The distributions overlap; no threshold admits the damage and rejects the
  plateaus.**

200 is 4× p99.99. Validated over **3.16 M real samples across two files**: non-sentinel runs ≥ 200 =
**1 per file** (12,411 at value 100; 5,828 at value 100), **legitimate runs ≥ 200 = zero**. Nothing
sits between 48 and 12,411.

⚠️ **Both hits are the LAST run in their file** — the recording ends stuck. This mode emits with
`closed=0` **by construction**, so the EOF flush is load-bearing rather than an edge case, and a
detector that reports on run-*break* cannot see it at all (the first query run against this question
did exactly that and would have returned a clean "0 runs ≥ 200").

## 3 · Why `clip` and `collapse` are NOT on the live path

Both need the whole night or a window, and the live writer sits on the BLE notification path where
the failure mode is **dropped notifications — losing the recording in order to describe it**.

- **`clip`** — "at the stream's range extreme" is a whole-night property. The ring's 199-clip is not
  an encoding extreme, and the observed range of the 04:53 file is **[0, 200]**, so a live rule
  hardcoded to 199 would have been keyed one off all night *and still read as working*. A running max
  moves under rows already written.
- **`collapse`** — a running median over ~600 samples is O(window) per sample, per live stream. The
  rule as originally specified also **failed its own acceptance at every k** (k=4: 92.6 % recovery
  but 6.46 % of samples flagged; k=10: 0.24 % flagged but 22.1 % recovery), because on an 8-bit pleth
  the typical 15-sample max−min is **7 LSB** against a pulse modulation of ~8 LSB: level- and
  variance-based discriminators lack the dynamic range. That is a property of the stream, not of the
  thresholds.

Both are owned by the end-of-night back-check (WU-6/WU-7), which has the whole recording, no
deadline and no P0 exposure. The successor rule there is **`pinned`** (at either range extreme —
blanking at 0 is clipping at the bottom), which passed all four pre-stated criteria.

## 4 · Two bugs this unit's own tests found

1. **A channel with < 64 runs never left the warm-up window and its rows were dropped at close.**
   That is the quiet night with a single long stuck run — the case the sidecar exists for. Rows are
   now released and marked `class=undecided`: on weak evidence, **emit and say so, never withhold**.
2. **Hold classification pooled all channels.** The Verity's one noisy channel classified the whole
   file `held` and suppressed two genuinely stuck channels. A hold is a property of a signal path.
3. (found by a peer's EOF measurement, not by a test) **A `held` channel suppressed its own ≥ 200
   run.** The ring's ACC repeats each sample 6–7× *by design*; 200 identical samples is 20 s of one
   triplet — the failure, not the cadence. A run ≥ `T_STUCK` is now written **unconditionally**,
   ahead of every class check.

## 4b · WU-6/7 — the two witnesses DISAGREE BY PREDICATE, not by threshold (measured 2026-09-18)

The owner's 2026-09-13 ruling on P5 said to read `_PPGRUNS.txt` **and** cross-check the in-JS
derivation, because a disagreement is itself a finding — and to decide the precedence rule **when the
data shows what disagreement actually looks like**, rather than guessing it up front. Here is what it
looks like, measured on 2026-09-17.

| | live writer (`*RUNS.txt`) | end-of-night back-check (`nightqc`) |
|---|---|---|
| predicate | `stuck` — a constant value ANYWHERE | `clip` — a value AT A RAIL |
| minimum run | **200** | **5** (`_CLIP_MIN_RUN`) |
| ECG that night | **no `_ECGRUNS.txt` is written at all** | 16 spans, 6–570 samples (median 13), rails −18200 / 18197 — only **1** would clear 200 |
| PPG that night | 4 spans, `value=100`, `rule=stuck` | **79 spans** at rails **0 / 199**, 5–85 samples (median 22) — **none** would clear 200 |
| PPG2W | 0 | 0 |

**THE PRECEDENCE QUESTION AS POSED DOES NOT ARISE, and that is the result.** These are not two
measurements of one quantity that can be ranked; they answer different questions. One keys on
CONSTANCY, the other on RAIL MEMBERSHIP. Tonight's live spans sit at value 100 — constant but not
railed, so the back-check correctly does not flag them; the back-check's 79 PPG spans sit at 0 and 199
— railed but short, so the live writer correctly does not flag them. Neither is wrong and neither
supersedes the other. A precedence rule between them would be a category error.

**For `pinned` specifically the back-check is the witness that matters**, and by a wide margin: the
rule this brief names — *"at either range extreme; blanking at 0 is clipping at the bottom"* — is
exactly what `nightqc.clip_regions` computes, and **zero** of its 79 PPG rail spans would be visible
to the live writer at `min_run=200`. Reading `_PPGRUNS.txt` alone for pinned coverage would find
nothing and report it as absence of absence.

### Prevalence — measured 2026-09-18, and the denominator is the finding

The owner's item 3 asks how many of the trio nights move. **It cannot be answered from existing
artifacts, and that is worth knowing before anyone sizes the work.**

| | count |
|---|---|
| nights on the box with a `QC-SUMMARY.json` | 56 |
| …whose `class_b` key is **ABSENT** — the detector never ran | **44** |
| …present, zero spans (a real zero) | 1 (2026-09-14) |
| …present, ≥1 rail span | **11** |

**So prevalence is 11 of 12 MEASURED nights — 92 % — not 11 of 56 (20 %).** The 56 denominator counts
44 nights the instrument never examined, which is this repo's most-repeated defect wearing a new
costume: a floor that cannot distinguish *measured zero* from *not measured*. Every night the
back-check actually ran on, bar one, carries rail spans.

Magnitude on those 11: **96–576 spans per night, 2,827–18,241 samples**, on `ecg` and `ppg`.

⚠️ **AND OF 119 LOCAL TRIO NIGHTS, EXACTLY 3 ARE ASSESSABLE** — 2026-09-10, 2026-09-15, 2026-09-17 —
because the rest predate the detector. **All three carry rail spans** (372 / 250 / 96). The remaining
116 need `nightqc` re-run over their stored raw captures, so item 3 is a RE-RUN over a corpus whose
raw data may be partly aged out, not a lookup over summaries. That is the honest size of the task, and
it is larger than the ruling could have known when it was written.

⚠️ **ONE NIGHT ESTABLISHES THE STRUCTURE, NOT THE PREVALENCE.** What is settled is the SHAPE of the
disagreement (different predicates, not a threshold gap), which is what the precedence question
needed. How many of the 41 trio nights carry rail spans, and how much coverage they remove, is the
owner's item 3 and is still owed — it is the measurement that sizes the change, and it must be taken
as part of shipping rather than assumed.

⚠️ And it interacts with `SAMPLE-VALIDITY-ENVELOPE` §3.1, answered the same day: a validity view built
from the LIVE sidecar can only claim *"valid unless a long blanking run was detected"*. These 79 spans
are precisely the blanking that claim excludes, so an envelope fed only by the live writer would call
all 79 valid.

## 4c · Run-length BASELINE for the three un-named streams — measured 2026-09-19, the tripwire's reference

§∅ requires the run-length signature to run on every device and stand as a tripwire. It had run on the ring's
`ppg1` only. This table is the baseline for the other three (`ppg2w` was settled separately: zero constant runs
≥ 5 at any threshold over 56 nights, values in the ~10⁶ range never repeat). It is a RECORD, deliberately not a
tool plus a gate plus an artifact (owner's 2026-09-19 filter, question 5): a first run ≥ `T_STUCK` (200) on any of
these channels is new information against these numbers, and if anyone later wants that enforced, this is what
they enforce against.

**Population:** 7 nights, 2026-09-10 → 09-17 (a SUBSET of the 56-night corpus — pure-Python RLE on the capture box
makes the full set a multi-hour job), every run on every channel, no rail assumed, values kept for runs ≥ 50.
Read-only over `/srv/tepna/captures`. Measured by Wren.

| stream / channel | files | samples per ch | mean run | top-2 lengths (share) | sample-weighted p99 / p99.9 | MAX | runs ≥ 50 |
|---|---|---|---|---|---|---|---|
| `acc` H10 · X / Y / Z | 16 | 45,767,016 | 1.22 / 1.20 / 1.14 | 1, 2 (0.96 / 0.97 / 0.98) | 6/11 · 4/7 · 4/5 | 40 · 18 · 12 | 0 · 0 · 0 |
| `acc` Verity · X / Y / Z | 13 | 10,451,254 | 1.15 / 1.14 / 1.14 | 1, 2 (0.98) | 4/5 · 3/5 · 3/5 | 9 · 11 · 10 | 0 · 0 · 0 |
| `ppg` Verity · ch 0 / 1 / 2 | 13 | 11,449,786 | 1.00 / 1.00 / 1.00 | 1, 2 (1.000) | 1/2 · 1/2 · 1/2 | 41 · 41 · 42 | 0 · 0 · 0 |
| `accraw` O2Ring · X / Y / Z | 20 | 2,055,985 | 6.92 / 6.96 / 6.98 | 6, 7 (0.92) | 19/26 · 19/26 · 19/26 | 39 · 39 · 45 | 0 · 0 · 0 |

**Reading, keyed on run length against each stream's own distribution — no kinds proposed, because there is
nothing to name:**
- `acc` (both Polars): variable to the last decimal; an axis resting at 0 mG does not appear as a run population.
- `ppg` (Verity): essentially never repeats; the 41–42 maxima are the ADC-ceiling rail (the 56-night census placed
  every Verity pinned sample at 2,096,921, max run 72) — an observation about the top of the range, not a mechanism,
  and at 41–72 samples it never reaches `T_STUCK`. Saturation is not absence.
- `accraw` (O2Ring): the zero-order hold exactly as the classifier models it — 92 % of runs are 6 or 7 (the
  1.5625 Hz sample written at 10 Hz), the next mode is 13 (two held frames), the max of 45 is a small multiple of
  that cadence. Fully explicable by design; `held` is the right class and a value-keyed rule would have convicted
  the whole stream.

So on these three the sidecar is inert **by data, not by construction** — they can carry a long run and have not —
which is what makes a future one a finding. `RUN_KIND_BY_STREAM` stays `ppg1`-only; `unknown` on the other four is
evidenced, not defaulted.

## 5 · Comment-line grammar (pinned; the file reproduces itself)

```
# stream=<s> rule=stuck min_run=<n> t_stuck=<n> held_warmup=<n> held_top2_share=<f> unit=unknown kinds=<absence=100,in-wear-rail=0|199 | unknown>
# stream=<s> channel=<c> class=held|variable ratio=<f> top2=<a>,<b> share=<f> decided_at=<n>runs
# stream=<s> channel=<c> class=undecided decided_at=<n>runs reason=too-few-runs
# final channel=<c> total_runs=<n> mean_run=<f> class=<k>
# runs=<n> errors=<n>
```

The parameters that produced the rows travel **with** the rows, so a later default change cannot
silently rewrite history. `errors` nonzero ⇒ the file is an **incomplete census** and must not be
read as a complete one.

## Done when

- [x] Sidecar written for every optical stream; captured bytes unchanged.
- [x] `stuck` at a threshold above the measured plateau distribution, validated on real files.
- [x] Per-channel hold classification, computed from run-length shape — never a stream-name exclusion.
- [x] EOF flush emits open runs with `closed=0`, unconditionally for runs ≥ `T_STUCK`.
- [x] Sidecar failure isolated from the sample stream **and counted** (`errors`).
- [x] Sidecar in `paths()` so a pruned session cannot orphan it (§C8).
- [x] `capture-host/check.sh` green.
- [ ] Byte-level parity fixture against the JS recompute path — blocked on WU-6 shipping its plant.
