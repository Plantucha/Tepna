---
bump: minor
type: added
nodes: [PpgDex]
brief: O2RING-RAW-DUAL-WAVELENGTH-2026-08-05-BRIEF.md
---

PpgDex reads the O2Ring's raw dual-wavelength `_PPG2W.txt` (cmd 0x05).

`capture-host` has written this stream since 2026-08-05 and no JS node could read it: 1075 files sit
in the corpus (1066 non-empty, newest 2026-09-05) and PpgDex refused every one of them.

Accepted on a POSITIVE identification of the layout — a `motion` column present AND no ambient — not
on the column count. `ppgColsFromHeader`'s two-column refusal is deliberate ("silently treating it as
a 2-LED sensor would let a shifted/truncated 3-LED file vote with itself"), and that guard still
holds: a 2-column file without motion, and a 2-column file with ambient, are both still refused, each
with its own assertion.

Site comes from PROVENANCE, not from the samples: only the ring's cmd 0x05 writes this format, and
two genuine wavelengths are not replicated — so the existing replication scan would have returned
'wrist', skipped the O2Ring 156-sentinel pass, and stamped a wrist-validated tier on a fingertip
pleth, which is the failure that function's own comment exists to prevent.

Channel identity stays OPEN per the brief: the two are ch0/ch1, no RED/IR claim and no SpO2.

Also: leading `# timebase=…` comment lines are now skipped explicitly (906 of 1066 files carry one,
160 do not), and the row-atomic column validation was generalised from "exactly 3 channels" to "every
companion column this layout claims", so the new layout gets the same all-or-nothing row treatment
rather than silently pushing nothing.
