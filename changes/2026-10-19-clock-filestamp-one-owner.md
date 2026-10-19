---
bump: patch
type: fixed
brief: RESIDUE.md
---

# The filename stamp gets one owner: `DexClock.fileStamp`

RESIDUE `2026-10-12-filename-stamp-consumers-split-twelve-convert-four-identify` enumerated 12 call
sites that turn a capture filename's `YYYYMMDDHHMMSS` into a time, and said the remedy is the anchored
helper rather than a new regex. The Clock Contract names the filename as anchor source (2) and nothing
owned it, so six readers across five files had each grown their own. Four of the six built the instant
with a bare `Date.UTC` over digit slices, which §2.7 forbids: `20261332999999` rolls to 2027-02-01 and
fourteen nines to 10007-06-07, a date read off a filename with nothing flagged. All six searched the
name left to right, so a 14-digit device id beats the session stamp beside it.

`clock.js` now carries `fileStamp`, which scans from the right, bounds each candidate at a whole token,
validates through `parseTimestamp`, and refuses a year outside 1990-2099. It reads both layouts — the
capture-host writer's joined digits and Polar Sensor Logger's split pair. `oxydex-dsp.js` drops the
round-trip check it had written for itself, and the four analysis tools delegate; one of them kept
`DexClock` on hand with a comment saying a sibling must never hand-roll a stamp regex, beside the
sibling that did.

The hazard is LATENT, not measured: 0 of 23843 capture filenames carry two 14-digit runs or a longer
one. The witness is a known-answer group on the two names the fleet wrote down, one in the capture
writer's own docstring.
