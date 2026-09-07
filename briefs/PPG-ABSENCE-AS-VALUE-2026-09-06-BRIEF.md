<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS (live writer BUILT — `stuck` + hold classification; `pinned` back-check is WU-6/WU-7, not this unit) · **Created:** 2026-09-06 · **Residue:** 2026-09-06-warmup-verdict-goes-stale, 2026-09-06-t-stuck-validated-on-ring-only

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

## 5 · Comment-line grammar (pinned; the file reproduces itself)

```
# stream=<s> rule=stuck min_run=<n> t_stuck=<n> held_warmup=<n> held_top2_share=<f> unit=unknown
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
