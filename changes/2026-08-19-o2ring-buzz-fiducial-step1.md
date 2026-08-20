---
bump: minor
type: added
brief: O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md
---

**The buzz-fiducial brief lands in the repo with its step 1 DONE on hardware, plus the probe that did it.**

`briefs/O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md` (held un-committed since creation by a hook
false-positive, archived meanwhile) enters the tree as IN-PROGRESS: the commanded 0x83 buzz as a
self-written timing fiducial — ring host-axis validation (2a) and the ring↔H10 cross-device marker
(2b), now extended with a **Verity leg**: one buzz against both pods = a three-way common fiducial,
every pairwise clock offset over-determined by the third.

Step 1 (artifact shape) is DONE, measured 2026-08-19 with `capture-host/probe_buzz_fiducial.py`
(ships here): empty-payload 0x83 drives a ~1.1 s vibration; the MOTION channel carries it unambiguously
(0 → peak 22 against a still baseline of exactly 0) while optical σ is direction-inconsistent — motion
is the detector. Onset ~419 ms but buffer-limited ±0.5 s (the raw 0x05 stream back-times from ~1 s
arrivals), so step 2's latency distribution needs many fires or the 125 Hz pleth path; #1544's
`ring_config.py --set motor` is the intensity knob for finding the weakest detectable buzz.

The probe streams the raw dual-wavelength+motion, fires exactly ONE whitelisted 0x83 at a known host
instant (optionally 0xC0-syncing the RTC first so the onboard .dat carries synced time), writes the
capture in the daemon's PPG2W column format, and judges the artifact with an explicit
detected/not/inconclusive verdict. 100% branch coverage (16 tests incl. the flat-motion discriminator
control and a whole-session write-surface whitelist assertion). DOCS-INDEX row added; docs-ledger 38/38.
