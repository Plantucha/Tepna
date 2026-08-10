<!--
  VERITY-OFFLINE-VS-STREAMING-2026-08-09-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living — every number measured on hardware 2026-08-09) · **Created:** 2026-08-09 · **Unit:** Verity Sense `0C301E3F` (sw 3.0.16) on vigil · **Answers open questions in:** `POLAR-ONBOARD-BACKUP-2026-08-01-BRIEF.md` §6 Q2 · `POLAR-VERITY-DEVICE-SURFACE-2026-08-03-BRIEF.md` §Open · **Adds evidence to:** `DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md` §5

# Record PPG to the armband's flash and stream only ACC? — measured, and it cannot cover a night

`POLAR-ONBOARD-BACKUP` §5 floats the "stronger form": **stop streaming Verity PPG and record it
offline as the primary**, streaming only ACC, then pull the waveform in the morning. It is an
attractive shape — the SDK says *"the recording continues even though the BLE connection is lost"* —
and it deletes the whole BLE-dropout class for the armband instead of insuring against it.

**Its §6 Q2 asked the question that decides it and nobody had answered it: how many hours fit?**
The answer is **under two**, and the failure mode when you exceed it is silent.

---

## 1 · The flash budget, measured from recordings this project already made

`polar_mirror` had already pulled 22 `.REC` files off the device (2026-08-02/03, in
`/srv/tepna/captures/device-mirror/U/0/`). Decoding three of the largest with `rec_to_psl.py` gives the
byte cost directly — no estimate, no datasheet:

| file | bytes | samples | fs | duration | **B/sample** |
|---|---|---|---|---|---|
| `20260803/R/130656/PPG.REC` | 84 235 | 15 580 | 55 | 283.3 s | **5.407** |
| `20260803/R/122539/PPG.REC` | 77 434 | 14 320 | 55 | 260.4 s | **5.407** |
| `20260803/R/123842/PPG.REC` | 59 175 | 10 940 | 55 | 198.9 s | **5.409** |

**5.407 B/sample** for 4-channel 22-bit PPG — delta-compressed, and remarkably stable across files.
Against `POLAR-ONBOARD-BACKUP` §"Memory"'s two device-side limits (**Limit 1 ≈ 2 MB**, a new recording
returns `ERROR_DISK_FULL`; **Limit 2, 300 KB–2 MB**, *all active recordings are stopped automatically*):

| offline PPG rate | B/s | 2 MB ceiling | with the 459 KB already resident | if Limit 2 fires at 300 KB |
|---|---|---|---|---|
| 55 Hz | 297 | **1.96 h** | **1.53 h** | 17 min |
| 44 Hz | 238 | 2.45 h | 1.91 h | 22 min |
| 28 Hz (the offline floor) | 151 | 3.85 h | 3.01 h | 34 min |

⚠️ **The 28 Hz row is optimistic and should not be planned against.** Delta compression pays for
sample-to-sample similarity; thinning the grid makes each delta larger, so B/sample rises as the rate
falls. 5.407 is a *55 Hz* measurement. And `PPG-SAMPLE-RATE-AND-PAT` §4 puts the interpolation cliff at
22 Hz and says explicitly **do not sit near it** — the cliff moves *up* with heart rate.

**So the ceiling for a night-length offline PPG recording is roughly two hours, at the rate we
actually use, on an empty flash.** A ~6 h night needs 6.4 MB. There is no configuration of this device
that holds it.

### 1.0 · Polar's own "600 hours of recording" CONFIRMS this budget — it is HR-only

The obvious objection is the datasheet: Polar advertises **up to 600 h** of internal recording, which
is 300× what §1 says. Both are right, and the arithmetic is the proof rather than the conflict:

```
600 h × 3600 s × 1 Hz × 1 B/sample  =  2.16 MB
```

**2.16 MB is the ~2 MB ceiling.** The vendor's headline figure and the SDK's documented Limit 1 are the
same physical flash, described from opposite ends — so 600 h is not evidence that the budget is larger,
it is an independent measurement that the budget is exactly what we assumed. A second consistency
check, from a completely different direction: the claim implies 1 B/s, and PPG measures 297 B/s, a
ratio of **297×**; 600 h ÷ 1.96 h is **306×**. Two numbers derived from unrelated sources agreeing to
3 %.

So **600 h is a 1 Hz heart-rate figure**, and the device says so itself: `0x0E` **`OFFLINE_HR`** is
advertised as its own measurement type, distinct from PPG, answering `ok` with an *empty* settings menu
— no rate to choose, because there is only one (`POLAR-PMD-COMMAND-SURFACE` §3.3). Raw 4-channel
22-bit PPG is ~300× that per second and gets ~1/300th of the hours.

⚠️ **Do not read "600 h" off a spec sheet into a PPG plan.** It is the strongest-looking argument
against §1 and it is actually §1's best corroboration.

### 1.1 · Why the shortfall is worse than the ratio suggests

* **The device never erases.** 459 KB of `.REC` from two days of testing is still on the flash and
  counts against the budget; the run above therefore starts at ~1.5 h, not 2.0.
* **Limit 2 auto-stops without saying so.** The night ends early and the file still parses, still has
  a valid header, still decodes with zero warnings. That is `POLAR-ONBOARD-BACKUP` §0.2's
  fabricated-absence class, and it is the exact shape this repo keeps being bitten by: *the check ran
  and reported success about something it never examined* (CLAUDE.md §👥.4b).
* **PPG cannot be online and offline at once** (`POLAR-ONBOARD-BACKUP` §2). So during the offline
  recording there is **no live PPG**, hence no live stall detection — the one signal that would tell
  you the recording had auto-stopped is the signal you gave up to make the recording.
* **A recording device refuses all file transfer** (`SYSTEM_BUSY`), so the morning pull must stop the
  recording first, and a hung pull is indistinguishable from a hung link.

### 1.2 · One open question closed while measuring this

`POLAR-VERITY-DEVICE-SURFACE` §Open lists *"a possible ~259 s / 77 434 B auto-stop that would sink
night-long backup"* — the hypothesis was raised because **two** recordings came off the flash at
exactly 77 434 bytes. **Falsified:** `130656/PPG.REC` from the same device on the same day is
**84 235 B / 283.3 s**, which exceeds it. There is no cap at 77 434 B. The coincidence was two
manual tests of similar length; the real ceiling is the 2 MB budget in §1, which is 24× further out
and still not far enough.

---

## 2 · Is there a radio problem to solve? Measured: not the one the proposal assumes

The proposal's stated motive is *"avoid possible radio interference"*. That premise is testable on
last night's capture and it does not hold in the form assumed. Per-stream continuity for
`/srv/tepna/captures/2026-08-09`, counting inter-sample gaps > 3× nominal on each stream's own device
clock:

| stream | rows | span | eff. fs | **gaps** | lost time |
|---|---|---|---|---|---|
| Verity PPG | 831 987 | 4.19 h | 55.135 | **0** | 0.0 s |
| Verity GYRO | 779 835 | 4.19 h | 51.682 | **0** | 0.0 s |
| Verity ACC | 779 956 | 4.19 h | 51.682 | **0** | 0.0 s |
| H10 ECG | 1 914 644 | 4.09 h | 130.035 | **0** | 0.0 s |
| O2Ring PPG | 700 184 | 1.55 h | 125.535 | 29 | 12.7 s |

**Zero intra-session loss on every Polar stream, over 4 h, with all four Verity streams and the H10
running concurrently.** The armband is not dropping packets. (The O2Ring does — 24–33 gaps per
session, consistently — but that is a different device with its own documented link problems, and
turning off Verity streams does not help it.)

What *does* break is the **whole session**: both Polars stopped at ~04:45 and re-established. The
journal names the cause and it is not the radio —

```
Aug 09 04:45:01 vigil python[19913]: WARNING cpap: sudo -n wpa_cli … Failed to connect to
                                     non-global ctrl_ifname: wlp1s0
Aug 09 04:45:04 vigil python[47131]: WARNING STARTUP: archive is NOT configured …
```

— the PID changes across those two lines. The daemon restarted. An onboard recording would indeed
have survived that (it survives link loss by design), but so would a shorter restart window, and the
recording could only have covered the first ~1.5 h of the night anyway.

⚠️ **This is one night on one box.** It is enough to refute *"streaming is lossy, therefore record
offline"*, which was the load-bearing claim; it is not enough to conclude the link never loses data.
The measurement is one command (`gapcheck` over a night directory) and should be repeated before any
configuration change is credited with an improvement.

---

## 3 · GYRO is **not** unused — it is the dominant term in PpgDex's motion gate

`DEVICE-RATE-TRUTH` §5 decides **GYRO OFF**, on the rationale *"52 Hz against the 0.1–0.6 Hz effort
band it feeds"*. That rationale is about `motiondex-dsp.js`, and it is right about MotionDex:
`compute()` uses `gyro` for a duration and a row count and **no metric reads it**. But it is not the
whole consumer list, and the other consumer is not cosmetic.

`ppgdex-dsp.js:analyzeMotion` builds the per-0.25 s motion index as
`grid[i] = max( min(1, accDyn/120), min(1, gyroMag/40) )`, and that index gates **per-pulse SQI**,
which becomes the `conf` on every Ganglior beat event. Reproducing that formula exactly against last
night's real Verity ACC + GYRO (4.19 h, 60 366 cells):

| | acc + gyro (shipped) | acc only |
|---|---|---|
| mean motion index | **0.11020** | 0.04426 |
| cells where GYRO is the max | **59 874 (99.18 %)** | — |
| cells ≥ 0.5 (the rejected band) | 638 | 440 |
| Pearson r between the two series | **0.950** | |

**Turning GYRO off is a behavioural change to a shipped metric, not a free byte saving.** It halves
the reported mean motion index and removes 198 cells (≈ 50 s of the night) from the rejected band.

### 3.1 · …and most of what GYRO contributes is a DC noise pedestal, so the change is an IMPROVEMENT

The 99.18 % dominance is not the gyroscope being more sensitive. It is a floor:

| channel | p1 | p50 | p90 | p99 | max | p50 normalised |
|---|---|---|---|---|---|---|
| `accDyn` [mg] | 0.027 | 1.483 | 3.753 | 11.694 | 1969.5 | 0.0124 |
| `gyroMag` [dps] | **3.469** | **3.854** | **3.983** | 12.405 | 353.9 | **0.0963** |

p1 → p90 spans 3.47 → 3.98 dps. The arm is still and the gyro reads ~3.85 dps regardless — a flat
zero-rate pedestal that normalises to **0.096** and therefore wins almost every quiet cell by
construction. (This is the residue of the scale bug `polar_pmd.py` already fixed: a resting arm used
to read 47 dps. 3.85 is correct-and-still-a-floor, not a second bug.)

So the honest statement of the trade is:

> GYRO costs **81.4 MB of the Verity's 254.4 MB night (32 %)** to change **0.33 %** of motion-gate
> decisions, and inflates the reported motion index by a near-constant 0.096 the rest of the time.

Dropping it is right. **But `meanMotionIndex` will move from ~0.11 to ~0.04 on the first night after
the change, and that is expected** — it must not be read as a regression, and any threshold tuned
against the pedestal needs re-checking.

### 3.2 · MAG is genuinely additive-only, and the code says so

`ppgdex-dsp.js` §MAGNETOMETER: mag splits `lateral` into `lateral_L/lateral_R` via a tilt-compensated
heading (labels **relative**, "may be mirrored without a calibration gesture") and raises
`magInterference`, which the source states *"does **not** alter beat SQI / conf here"*. MotionDex reads
it for a row count. So `DEVICE-RATE-TRUTH` §5's **MAG DISABLE** loses one relative L/R lateral label
and one informational flag — 17.0 MB/night, for that. No dispute.

---

## 4 · 176 Hz is not a setting today — it needs SDK-mode entry code that does not exist

Measured Verity PPG rate, first two inter-sample deltas of the largest file per night:

| 08-01 | 08-02 | 08-03 | 08-04 | 08-05 | 08-06 | 08-07 | 08-09 |
|---|---|---|---|---|---|---|---|
| 55 | 55 **+ 176** | 55 **+ 176** | 55 | 55 | 55 | 55 | **55** |

176 Hz ran for two nights and has not run since. `DEVICE-RATE-TRUTH` §6.4 explains the revert (the
settings UI replaced the whole `rates` map and dropped an override it could not render a control for;
fixed) — but there is a second, independent blocker that a config fix does not clear:

* **`grep -rn "sdk_mode\|SDK_MODE" capture-host/*.py`** finds SDK mode only in the **probes**
  (`probe_pmd_surface.py`, `probe_verity_survey.py`, `probe_pmd_opcodes.py`) and in `webmon.py`'s
  filter that stops the three capability flags being offered as streams. **`capture.py` never enters
  SDK mode.**
* Without SDK mode the device's PPG menu is `[55]` — confirmed in the box journal
  (`Polar Verity Sense ppg options: rate_hz=[55]`) — and `polar_pmd.chosen_rate` honours a `prefer`
  **only if the device offers it**, by design, *silently* falling back otherwise. So
  `rates: {ppg: 176}` in `config.yaml` would produce 55 Hz and no error.
* SDK mode is entered with `02 09` and exited with `03 09`, **requires every stream stopped**
  (`ERROR_INVALID_STATE` 12 otherwise), and does not survive a power cycle — so it must be re-entered
  on every reconnect, inside the negotiation loop, before the settings query.

**And the case for doing that work is weak on this repo's own evidence.** `PPG-SAMPLE-RATE-AND-PAT`
measured 176 Hz on the very nights above: no change in rMSSD/SDNN/pNN50 (37.8 ms at both), no change
in per-epoch HR error, PAT `residIQR` 18.68 vs 18.65 ms — **1.5 % of a term an order of magnitude
below the noise it adds to** — for **1.81× the battery** (8.60 vs 4.74 %/h; 11.6 h vs 21.1 h runtime).
`PAT-VERDICT-CONSOLIDATED` then killed the one remaining argument by finding PAT blocked by ~84–99 ms
of scatter downstream of the heart. `DEVICE-RATE-TRUTH` §5 keeps 176 Hz as *"the owner's operational
call, recorded as having no remaining technical rationale"* — this brief adds only that **the call
currently costs an unwritten SDK-mode state machine**, which is a real price the decision was not
priced against.

---

## 5 · The recommendation, in cost order

1. **MAG off, GYRO off.** −98.4 MB/night (39 % of the Verity's bytes and its airtime), one relative
   L/R label and one informational flag lost, and a motion index that stops carrying a 0.096 pedestal.
   Already decided in `DEVICE-RATE-TRUTH` §5; §3 above supplies the consumer analysis that decision
   was missing, and it strengthens rather than weakens it. **Landing this is a field action** — the
   box's `config.yaml` is gitignored and diverges from the checkout (measured again today: the box has
   `ppi` enabled and `mag: 10`, the checkout copy has neither);
   verify from the daemon log, never from the file.
2. **Leave PPG at 55 Hz** unless the owner re-affirms 176 knowing it now also requires §4's SDK-mode
   work. If it is re-affirmed, §1's flash figures are unaffected (offline PPG caps at 55 either way).
3. **Do not build the offline-PPG-as-primary path.** §1 is decisive: under two hours, silent
   auto-stop, and it costs the live stall detection that would catch the auto-stop.
4. **Do build offline recording as a THIN backup, if at all** — start it on the *cheap* stream
   (`POLAR-ONBOARD-BACKUP` §4's default is ACC for exactly this reason), or accept a ~90-minute PPG
   window covering the part of the night you most want (sleep onset), sized deliberately against §1
   rather than run open-ended.
5. **The session-fragmentation cause is worth more than the airtime.** Last night the armband and the
   chest strap both lost their session to a *daemon restart*, not to the radio. A restart that
   preserves the writers, or simply a quieter restart cadence during the night window, recovers more
   continuous signal than any stream configuration on this list.

### 5.1 · Alternatives considered and rejected

| | why not |
|---|---|
| Pull the waveform over **USB** while streaming continues | The pipe answers **one request per USB re-enumeration** and caps that reply at one 64-byte report. See §6. |
| Lower **PPG** to 28 Hz to fit a night on flash | 28 Hz is 6 Hz above `PPG-SAMPLE-RATE-AND-PAT`'s measured cliff, the cliff moves up with heart rate, and §1's B/sample figure is a 55 Hz measurement that will rise as the grid thins. Fits a night only in arithmetic. |
| Second Verity, alternating nights | Doubles the bond/charge burden to solve a loss rate measured at **zero** (§2). |
| Move the armband to the **onboard `.REC` + host ACC** hybrid | This *is* the proposal; §1 kills it on capacity, not on architecture. If Polar ever raises the flash budget it becomes viable unchanged. |

---

## 6 · The USB pipe — re-measured, and it was reporting a truncated listing as a complete one

`probe_polar_usb.py` established in August's first week that PS-FTP rides the dock's HID pipe and
serves one request per re-enumeration. Two corrections from re-running it on 2026-08-09:

**`tepna-usbreset.sh` is deployed now**, so the window is openable in software —
`sudo -n /usr/local/lib/tepna/tepna-usbreset.sh 0da4:0008` → `re-enumerated: 1-1 devnum 12 -> 13`, and
the next GET succeeds. The probe's header said it was not deployed; that was true when written. The
one-request limit is unchanged, so this is still not a pull path — but the measurement is now
repeatable without a human at the dock, which is how the second correction was found.

**The single reply is cut mid-record and the device flags it END anyway.** Raw frame:

```
#1  id=0x11 size=62 flags=1 pktnum=0            <- flags==1 is END
body … 0a0d 0a09 "20260621/" 1000   0a0d 0a09 "20"
                                              ^^ 9-byte name declared, 2 delivered
```

The BLE mirror of the same unit lists **six** entries in `/U/0/`; USB returned four plus that stub.
`20260802/` was decoded into a file named `"20"`, and `20260803/` — the directory holding all 22 `.REC`
recordings §1 is built on — did not appear at all. The tool returned `ok: true`.

**Cause: a Python slice past the end of a buffer returns the short remainder rather than raising.**
`_iter_fields`' `buf[i:i + ln]` therefore decoded a promise of 9 bytes into a 2-byte name with no
signal. The same reader serves the **BLE** walk (`list_dir` → `walk` → `polar_mirror`), so a listing
cut short by a dropped link would have mirrored a subset and written a `MANIFEST.json` asserting it
was complete.

Fixed: `polar_psftp.TruncatedProtobuf` + `_parse_directory_ex` (entries, truncated) + `list_dir_ex`;
`polar_mirror` records a truncated listing as an **error** while still pulling what arrived; the probe
publishes `truncated`/`complete` and leads its verdict with the truncation. Pinned by the real captured
bytes as a known-answer vector, and each guard verified by re-applying the defect.

⚠️ **The listing in this probe's own header was therefore already truncated** — it happened to be cut
on a record boundary, which is why it looked whole. **Never cite a USB listing as the device's
filesystem.** `POLAR-VERITY-DEVICE-SURFACE` §6 is *not* affected and was checked before this was
written: its filesystem tree came from `polar_mirror` over BLE (43 files, 37 dirs) and is complete.
That is the point — the two transports disagreed for a week, in a direction only one of them could be
wrong in, and nothing compared them.

---

## 7 · Method notes and limits

* **Every number here is one night or one device.** §2 especially: refuting *"streaming loses data"*
  needs only one clean night, but establishing a loss rate would need many.
* **§3's decimation-free comparison is exact, not a model.** Both series are computed from the same
  rows by the same formula, differing only in whether `gyCell` participates — so the 0.33 % is a
  count, not an estimate. What it does *not* establish is whether those 198 cells are movements worth
  gating on; at threshold 0.5 a cell needs >20 dps, which is real motion, but nothing here scores
  whether excluding those beats improved anything.
* **The B/sample figure is measured under delta compression at 55 Hz** and does not transfer to other
  rates (§1's warning). Re-measure before planning against a different rate.
* **`gapcheck` counts gaps on the DEVICE clock, per file.** It cannot see a whole session that never
  started, which is exactly the ~04:45 case §2 attributes to the restart — that came from the journal,
  not from the files.
* **Nothing here was run while the armband was off the charger.** `status.json` reports
  `charging — PMD streams unavailable until off the charger`, so no live PMD START, no SDK-mode entry
  and no offline-recording START could be attempted in this session. §1's budget comes from
  recordings already on the flash, which is why it did not need one; §4's SDK-mode claim rests on a
  source search plus the box journal, not on a refused command.

**Owed, in order of value:** the first night after MAG+GYRO go off — record `Tepna_*_LINK.csv`
`battery_pct` (the measurement `DEVICE-RATE-TRUTH` §5.1 wants) **and** re-run §3's comparison to
confirm `meanMotionIndex` lands near 0.044 as predicted. Both are one command, and the prediction is
falsifiable, which is the point of writing it down.
