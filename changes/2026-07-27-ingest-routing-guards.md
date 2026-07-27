<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: DEEP-AUDIT-III-2026-07-26-BRIEF.md
---
Three ingest routing defects at one seam. Every classifier except MotionDex knew only `_MAGN` while the capture host writes `_MAG.txt`, so 688 real magnetometer files were never paired and PpgDex told the user "No *_MAGN.txt for this session" about a file sitting in the drop — the regex is now the one motiondex-dsp.js already had. `ecgKind`/`ppgKind` defaulted any unrecognised name to that node's PRIMARY waveform, which is fail-open: on a real capture-host night 40 of 67 "ECG recordings" were the host's own telemetry, a QC summary and `.archived`, each queued as a recording and dying later inside analyze(); names that announce they are not signal are now set aside while a genuinely bare waveform still defaults through. And a rival chest strap's `_HR.txt` matched the `_HR` companion rule before anything asked whose device it was, so it entered the H10's device-HR lane while SignalAdapters.route() sent the same bytes to `coospo-rr` — the vendor test is now hoisted in `ecgKind` and knows the competing strap makers. Deliberately NOT hoisted in `ppgKind`: the O2Ring's own `Wellue_*_PPG.txt` matches the spo2 vendor pattern and is PpgDex's legitimate finger primary, so that classifier keeps suffix-first ordering.
