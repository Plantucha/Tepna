<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Record the two un-triaged sweep sets found on disk, and close the corpus question — it was a path with a space in it, not an unmounted volume.

Searching the DISK rather than the repo turned up two machine-readable result sets, both gitignored
by design (a sweep is a measurement of a moment) and therefore invisible to anyone reading the repo:

  · `.mutation-crawl/` — FULL sweeps of `hrvdex-dsp.js` (tested 489, killed 191, 298 survivors,
    canary PASSED → 39.1 %) and `motiondex-dsp.js` (466, 171, 287, 8 invalid, canary NONE → 37.3 %),
    each carrying its complete survivor list in exactly the shape `probe-equivalence` reads. Both
    figures are measured, not arithmetic, and `killed + survivors + invalid == tested` on both.
  · `/home/michal/tepna-mutation-audit-2026-08-02/` — 19 capture-host modules' survivor IDs + stats.

hrvdex is therefore the fleet's FIRST canary-guarded full DSP sweep, and it CONFIRMS #1030's 39.1 %
rather than correcting it — which is the honest outcome of a re-measurement prompted by two sweeps'
worth of tooling fixes. §7.2/§7.3 are discharged for hrvdex and the probing order is revised to start
there: 298 survivors, 1 s tag, nothing to wait for.

`probed: 0, findings: []` on both. `mutation-crawl` was built to run the measurement unattended and
leave the judgement to a person; it did its half, and 585 survivors have been classified-as-nothing
since 05:04 the same morning.

The corpus question `CAPTURE-HOST-MUTATION-FLEET` §7 left open is also answered. It recorded that
`/EcgNightly` "is not present locally (an unmounted `data` volume, `sdb1`, is the likely home)". The
directory is `Ecg nightly` — WITH A SPACE — 19 GB, 71 O2Ring `.dat`, 50 H10 `_ECG.txt`, 54 Verity
`_PPG.txt`. A path check for the concatenated name misses it, and an unmounted-volume theory is a
plausible thing to write next: the same family as every other failure in §8, where the check ran and
reported about something it never examined. The `oxyii.parse_live` and `polar_pmd.decode_frame`
passes are unblocked; the hermetic-suite constraint is unchanged.
