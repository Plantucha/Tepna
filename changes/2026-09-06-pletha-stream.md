---
bump: minor
type: added
nodes: [capture-host]
brief: O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS-2026-08-05-BRIEF.md
---

capture-host: the O2Ring's `cmd 0x03` lossless single-channel pleth is captured as an opt-in `pletha`
stream (`Wellue_O2Ring-S_<id>_<stamp>_PLETHA.txt`), off by default and offered in the monitor's
`supported` list so a settings save cannot delete it from `config.yaml`.

Decoded against measured bytes: a 6-byte header and 8-bit samples (1188 replies, two worn runs);
125.058 Hz over 119.7 s, i.e. the 125.000 ADC to 0.05 % — §7.4's 112.9 Hz came from a 403 s fragment
and does not reproduce. `156` markers are flagged in their own column, never stripped: on this stream
they arrive at 0.534/s against 62 bpm and 6 % are not isolated, so a value strip would delete signal.

Also fixed on the way: the pleth bus card registered only when `ppg2w` was ALSO enabled (the `if
plethawr:` sat inside `if ppg2wr:`), and the never-executed registration call passed `unit` both
positionally and by keyword — a `TypeError` dead code never raised. Plus a writer-close gate in the
S1 flush family (AST over `capture.py`: every `StreamWriter(` binding must reach a close) and the
ring's offer set derived from `capture.py` instead of three hand-kept copies.

Enabling it is a box config change (`pletha` in the ring's `streams`), not part of this change.
