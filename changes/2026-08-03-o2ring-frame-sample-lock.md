<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [OxyDex]
brief: O2RING-FRAME-SAMPLE-LOCK-2026-08-03-BRIEF.md
---
Build `O2RING-FRAME-SAMPLE-LOCK` §4(a) — countable O2Ring PPG sample loss — and correct that brief's §1 twice in the process.

Every `0x04` reply declares the PPG sample count in `[24:26]` and the session second in `[0:4]`. `parse_ppg` read the first only to slice with it; `parse_live` read the second only to spot restarts. Both are now surfaced (`oxyii.ppg_sample_count`), accumulated per session (`capture.O2PpgFrameLedger`, beside `O2PpgGrid` — never instead of it), recorded per frame in the OXYFRAME sidecar (`ppg_n;ppg_dur_step;ppg_expected`, **appended** after `flag`), and reported at session end beside the existing grid line.

**The 126 lock is an AVERAGE, not a per-frame constant (§7.1).** The ring does not emit "exactly 126 samples per frame": the steady state is **124–128** — the poll interval jitters 0.989–1.007 s and the ring hands back whatever accumulated — and the connect frame carries **250**. What is constant is **126.037 samples per DEVICE-second** (60 clean sessions / 60.9 h). That is a **count on the ring's clock, not a rate**: its second runs **−3446 ppm** against the NTP-disciplined box (33 490 device-seconds vs 33 605.8 host-seconds), so 126/device-second is 125.80/host-second. **`O2PPG_FS_DEFAULT` is untouched** and a test asserts it, per `O2RING-PROTOCOL`'s standing warning and `O2RING-SYNTHESISED-AXIS` §6.

**`Δduration` is a ±1 s quantized counter (§7.2).** The two numbers disagree 50× on a real 9.3 h night — 159 duration steps of `+2` (~20 000 samples if read as loss) against **9** honest gaps totalling **3.2 s / 397 samples**.

**The inferred number is right, and there was never a missing frame.** Frame boundaries are recoverable from the reference night (each frame's last PPG sample is stamped at its host arrival), and grouped by duration step they read:

| step | n | host arrival interval | samples in the next frame |
|---|---|---|---|
| `+0` | 180 | 1.000 s | 125 |
| `+1` | 33 172 | 1.005 s | 126 |
| `+2` | **159** | **1.005 s** | **127** |

A missing frame would show a ~2.0 s interval; a recovered backlog ~252 samples. Both read one second's worth. The ring's second is 1.00346 host-seconds against a 1.0028 s poll — two nearly-equal periods, so the counter occasionally ticks twice or not at all, and the 159 and the 180 nearly cancel. A weighted regression over the 60 clean sessions agrees: `126.04 − 6.9 × steps_ahead_frac − 128.9 × inferred_gap_frac`, where a signal costing its samples must read −126.04. So `O2PpgGrid`'s arrival-timing inference measures real loss 1:1 and stays.

Nothing is retired. The counters are named `steps_ahead` / `steps_flat` / `steps_anomalous` — for what they are, not what they resemble — because **this is the third misreading of that field**: `frame_gap()` read it as a sequence counter and emitted phantom loss for weeks, and this brief's own first draft made the third. A counter shipped as `missing_frames` would have claimed ~20 000 lost samples on this night against the 397 the grid actually found, and would have read as authoritative precisely because it was arithmetic rather than a threshold. `ppg_dur_step` therefore records the **raw** step, so a wrong interpretation can be re-asked from the file — which is exactly how this one was caught.

Gated by 21 new capture-host assertions; the load-bearing one pins that a `+2` step costs no samples, and the session-end log's *wording* is asserted too, since that line is the only place a reader meets these counters. A JS-lane guard asserts `oxydex-dsp.parseCSV` ingests the 13-column OXYFRAME byte-identically to the 10-column form: it resolves columns by name so this was already safe, but "already safe" was a property nothing checked, and the fixture is a hand-written string that would have passed forever while every newly captured night carried a layout no test had parsed.

The parent brief is `REFERENCE (living)`, so the corrections land in it as §7 rather than as a note; the residue is `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03-BRIEF.md`.
