<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite, capture-host]
brief: none
---
`trio-batch` fed PpgDex **one fragment** of each night's inertial data and discarded the rest — 99 % of it. Plus a root-owned restart helper, so a deploy can finish itself.

## The data loss

```js
const xyz = (l) => (l && l.length ? PPGDSP.parseSensorXYZ(readFileSync(l[0].full, 'utf8')) : null);
```

`l[0]`. Measured on 2026-07-26:

| stream | fragments | total | used |
|---|---|---|---|
| Verity ACC | 50 | 229.0 MB | **2.2 MB — 1 %** |
| Verity GYRO | 50 | 279.3 MB | **2.7 MB — 1 %** |
| Verity MAG | 41 | 114.3 MB | **1.1 MB — 1 %** |

So PpgDex's `motionIndex`, posture, every magnetometer feature and the new `movement_onset` impulse were all computed from roughly the **first two minutes** of each night. The H10 ACC path had already learned this exact lesson — *"`[0]` was wrong … the earliest session is often a settling fragment"* — and was fixed to a padded uniform grid; this path was never given the same treatment.

**The fix is deliberately NOT the H10's grid.** `accExtras` indexes deviceACC as uniformly sampled, so a plain concat there would time-shift every sample after a gap. PpgDex instead times each row through `relSecOf`, which reads an absolute per-row stamp — so a time-ordered concat is already correctly placed, and silence between fragments is simply absent rather than mis-timed. `relNs` must be cleared, though: it is the DEVICE counter and restarts at 0 in every fragment, so leaving it would fold all 50 sessions onto the first one's window — the same bug by another route.

## What it recovers

`PpgDex/movement_onset` on 2026-07-26: **3 → 25**. And for the first time the clock fit gets genuine cross-device corroboration on that night — `PpgDex/motion_artifact_segment` 38.28 and `PpgDex/movement_onset` 38.28 joining `ECGDex/autonomic_surge` 38.00 and `ECGDex/movement_onset` 38.10, for **38.20 min, sensors agreeing within 17 s**, where before both usable channels came from one device.

Corpus-wide, nights whose offset is **corroborated by ≥2 distinct devices went 2 → 7 of 14**, spanning 37.75–38.45 min with a median inter-sensor agreement of **39 s**. Every corroborated night is in the right band and every wrong night is uncorroborated, so the flag separates them cleanly — consuming only corroborated fits is 7/7 correct.

## The restart helper

`git pull` only puts new code on disk; the daemon keeps serving the old build until something restarts it, and `vigil` cannot call systemctl. On 2026-07-30 the box therefore sat on `63a0703` with the fixes present but **not running**, because the restart wanted a password nobody was awake to type. A capture box that cannot complete its own deploy runs stale code all night.

`capture-host/tepna-restart.sh` + `deploy/enable-restart-control.sh`, following `enable-clock-control.sh` exactly: root-owned 0755 under `/usr/local/lib/tepna`, a `visudo`-validated NOPASSWD grant naming **that file**, in its own `sudoers.d` entry so the clock installer cannot clobber it. Explicitly **not** `NOPASSWD: /usr/bin/systemctl`, which would hand `vigil` every unit on the box including the ability to mask its own constraints — the helper takes a fixed verb and names one unit. It also re-checks `is-active` after restarting and exits non-zero if the unit did not come up, so an automated deploy cannot mistake a failed restart for success.

Needs `sudo bash enable-restart-control.sh` once; after that a deploy is one unattended line.

Gates: suite **4433 passed** / 12 skipped · `build --check` clean (11 owned) · GATE A 9/9 · GATE B 13 reproducible. No bundle touched — `trio-batch` is a tool and the helpers are shell.
