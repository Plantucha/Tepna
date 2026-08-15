---
bump: patch
type: fixed
brief: O2RING-ADAPTIVE-TIMEBASE-FOLLOWUPS-2026-08-09-BRIEF.md
---

The O2Ring's raw dual-wavelength stream (`ppg2w`, cmd 0x05) never carried the `# timebase=` stamp its
sibling `ppg1` has carried since the adaptive-timebase feature shipped.

Found while discharging that brief's one remaining item — confirm a real capture carries the stamp.
It does, and listing the ring's files to check showed it writes **two** optical streams with only one
stamped. Measured on the box 2026-08-15:

| stream | files | carrying `# timebase=` |
|---|---|---|
| `_PPG.txt` (`ppg1`) | 216 | **20** — every one post-deploy |
| `_PPG2W.txt` (`ppg2w`) | 40 | **0** |

Not a deploy lag: `…_20260815052731_PPG2W.txt` is unstamped while `…_20260815052731_PPG.txt` — the same
capture session, same device, same host clock — is stamped.

**The cause is one line, and the reasoning behind it was sound but too narrow.** `capture.py` builds
`ppg1` with `timebase=_tb` and, five lines below, builds `ppg2w` without it; `writers.py` gates on
`stream == "ppg1"`. Its comment justifies the exclusion as *"meaningless for a Verity `ppg` or an ECG
stream"* — true, and it does not cover `ppg2w`. **The decision is per DEVICE — the O2Ring's
crystal-vs-host rate — and `ppg2w` is the same ring.** Reading the rule as "the finger file" rather than
"the ring's files" is how the stream was missed. The gate is now by device, and the comment says so.

⚠️ **Latent, not live — which is the argument for fixing it now rather than filing it.** Nothing in the
JS lane parses `ppg2w` yet (zero readers, checked). So nothing currently misreads an axis. But the
recordings accumulate, and **a timebase that was never written cannot be recovered afterwards**, whereas
a parser can be written whenever. The 40 existing files are unrecoverable; every future one is not.

The writer test asserts both directions on `ppg2w` — stamped when a timebase exists, no comment when it
does not — beside the existing `ppg1` cases and the Verity negative that pins the by-device boundary.

Capture-host only: no bundle, no JS lane, no fixture.
