<!--
  VIGIL-WEAR-GATE-AND-ACC-CAP-2026-07-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-20 · **Created:** 2026-07-20

_Executes E4 of `VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md` (nothing gates capture on wear state)._

# Stop the Verity writing gigabytes to disk while it sits on a desk

**Out-of-suite (`capture-host/`, Python).** VIGIL-OBSERVED-ERRORS E4 measured the Verity Sense streaming
**453 MB in 4.16 h while unworn on a desk** (RSSI −32) — 71 % of it ACC at 416 Hz. The asymmetry that makes
it invisible: the O2Ring and the H10 report a contact bit, but **the Verity reports `worn: null`** — the one
device that cannot self-report is also the heaviest writer, and nothing gated its capture on wear. This
brief adds the two levers E4 named. Test-first; capture-host pytest stays at **100 %** on `capture.py`,
**862 tests**; `ruff --select E9,F` clean.

## 1 · ACC rate cap — the safe, immediate win (config)

`rates: {acc: 52}` on the Verity, was the negotiated 416 Hz. **Confirmed free**, not assumed: MotionDex
reads its sample rate *from the data* (`motiondex-dsp.js sampleHz(rows)`, never a nominal constant) and its
widest analysis band is respiratory **0.1–0.6 Hz**, so 52 Hz is ~85× the bandwidth it uses. This is an **8×
cut on the dominant stream** at no cost to any downstream metric — the same argument `capture.py` already
makes in-line for H10 ACC (capped at 50). GYRO is left as-is (it already negotiates ~52 Hz, per E7).

Deploy config, applied to the running box. No code change.

## 2 · Motion wear-gate for a contactless IMU (code, opt-in, OFF by default)

Because the Verity has no contact bit, wear is **inferred from motion**, which is uncertain — so the action
is deliberately the *benign* one. When a gate-eligible device (a PMD device with an ACC stream and **no** hr
stream — i.e. it cannot report contact) shows `|acc|` standard deviation below `motion_still_mg` for a
continuous `motion_still_sec`, its **writers pause**. The BLE link, the decode, and the live monitor push
all keep running, so:

- the disk stops filling while the device is off-body;
- the monitor still shows the device is alive (`worn: false`, "motion-gated, writing paused");
- **re-wear resumes writing on the very next moving frame** — same session, no reconnect, no fragmentation.

**Why pause-writes and not drop-link (the design decision).** The strap's existing power-drop is affordable
because a contact bit makes "not worn" near-certain; its false positive costs a whole recheck cycle. On the
Verity there is no such certainty, so a false "not worn" during genuinely still sleep must cost ~nothing —
and with write-pause it does (resume on the next frame). Dropping the link instead would risk the E3-style
reconnect churn that is already the box's largest source of lost night. The measured harm in E4 was **disk**
(the Verity was on charge), and write-pause fixes exactly that.

### Interaction with the stall watchdog (VIGIL-BLE-ROBUSTNESS)

A paused stream has **frozen row counters by design**. The stall watchdog watches row growth, so without
care it would mistake a deliberate pause for a dead stream and tear the session down — manufacturing the
churn we are avoiding. The hold loop now treats "motion-paused" as alive (re-baselines the silence clock),
so the two features compose instead of fighting. This is covered by a dedicated test.

### Config (deliberately OUT of `settings_schema` — deploy config, like the other guardrails)
```yaml
power:
  motion_wear_gate: false     # OFF by default — opt-in
  motion_still_mg: 12         # |acc| std (milli-g) below this = motionless
  motion_still_sec: 300       # continuous stillness before writes pause (5 min)
  motion_window_sec: 20       # window the std is measured over
```

## Honest limitation — the threshold is UNVALIDATED against real worn nights

A desk sits at the few-mg sensor-noise floor; a worn armband carries respiration + cardioballistic motion.
An illustrative simulation separates them (desk ~2.8 mg vs a 0.25 Hz-breathing body ~13 mg at a 12 mg
line) — **but that margin is thin and the worn model is a guess.** The real test is the tri-device corpus's
worn-Verity nights. Until `motion_still_mg` is validated to **never** cross a real sleeping night, the gate
stays **off by default**, and the benign write-pause failure mode (not a link-drop) is the safety net if it
ever does. **Do not enable `motion_wear_gate` on the live box before that validation.**

## Done when — all met
- [x] Verity ACC capped to 52 Hz; verified free against MotionDex's data-derived `fs` + 0.1–0.6 Hz band.
- [x] Motion wear-gate pauses WRITES (link/decode/push held) when off-body; resumes on re-wear.
- [x] A moving device is **never** paused (counter-test); the stall watchdog never tears down a paused stream.
- [x] Opt-in, off by default; `power.motion_*` read from config.
- [x] capture-host pytest **100 %** on `capture.py`, **862 tests**; ruff clean.

## Not in scope
- **Validating `motion_still_mg` against the real corpus** — the gate cannot be *enabled* until this is done;
  it wants a sweep over the worn-Verity nights confirming the trigger never fires during real sleep.
- **H10 wear-gating** — the H10 also lacks a usable contact bit, but its harm is different (electrode noise,
  not bytes) and the ECG is obviously junk when off-body; a separate concern.
- The remaining E-items (E3 reconnect storm · E5 LINK under-sampling · E6 retention/offload) are tracked in
  their own briefs.
