<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [pat-tools]
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---
`pat-window-oracle`'s catch swallowed refusals — the defect #2047 filed with this tool's owner after
its first H_axis P2 run lost 2026-08-18 (an 8.6 s mid-file clock step breaking piecewise sortedness)
to a bare `continue`: a refusal eaten by a catch, in the tool whose own verdict layer (#2044) exists
to stop verdicts being fabricated. Every skip path is now NAMED and TALLIED:

- `oracleNight` refuses by name (`{ refusal: '<reason>' }`, success shape unchanged): five formerly
  bare-null causes each carry their reason and counts — "too few beats (r=…, f=…)", "no overlap
  between the two trains", "too few R beats in the overlap", "too few beats per half", "no mode".
  The one fixed "⊘ too few beats" line had covered all five.
- The corpus loop's silent `continue`s are gone: unreadable night dir, missing `_ECG.txt`/`_PPG.txt`
  (formerly printed NOTHING — the night vanished from the report), parse/transform exceptions (both
  axis modes now; linear mode had kept the historical silent skip), and the piecewise
  `tMsCorrected=false` exclusion all print `⊘ REFUSED — <reason>` and land in a `REFUSED` tally
  bucket, so the report's line count reconciles with the directory count.
- The catch cannot narrow WHAT another module throws, so it narrows what it may DO: name the night,
  quote the message, count it — never drop it.
- `oracleVerdict` propagates a refusal AS its name (`⊘ REFUSED — …`, tallyKey `REFUSED`); a refusal
  object carries no score fields a caller could mistakenly consume. Both `oracleNight` consumers
  (`pat-drift-attribution`, `pat-residual-structure`) skip explicitly on `.refusal` (truthy object).

Selftest 15 → 19: disjoint trains refuse BY NAME and the name survives to the verdict line; a short
night names its counts; a refusal carries no score fields. Reproduction verified: 2026-08-18 under
`--ecg-axis piecewise` prints `⊘ REFUSED — piecewise-axis exclusion: piecewise ECG axis broke
sortedness at beat 6015`. Full linear corpus run: scored rows byte-identical to the #2044 baseline;
formerly-invisible nights now enumerate.
