<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: changed
nodes: [PpgDex, capture-host]
brief: O2RING-ADAPTIVE-TIMEBASE-2026-08-08-BRIEF.md
---
O2Ring timebase — Stage 3b: PpgDex defaults a finger recording to device-crystal, and the capture host
embeds its per-capture decision so a stratum-1 night is analysed host-disciplined.

**The default-flip (PpgDex).** `parsePPG`/`compute` now analyse an O2Ring **finger** recording on the
125.000 Hz device-crystal axis BY DEFAULT (the "default 125"), instead of the host-disciplined ~125.7 Hz
row rate Stage 2 kept as the default. Precedence: an explicit `opts.timebase` > an embedded `# timebase=…`
> the crystal default. host-disciplined stays reachable as the opt-out. Finger-only — a Verity is
untouched (no timebase, path is a no-op), so **every committed Verity golden is byte-identical**.

**The embed (capture-host).** `StreamWriter` stamps the host-clock's per-capture decision
(`host_clock.timebase_decision`, Stage 3a) into the O2Ring finger file (`ppg1`) as a `# timebase=…`
header comment — the same header-comment shape `LinkLogWriter` uses. It travels WITH the data, so PpgDex
reads it (a pre-scan; a `#` line is inert to every consumer's row filter) with no sidecar. So a stratum-1
capture writes `# timebase=host-disciplined` and is analysed on the host; anything less writes
device-crystal (or nothing ⇒ PpgDex defaults to the crystal floor). Absent ⇒ crystal.

**The committed golden.** The crystal default now SHIPS for finger recordings, so it gets a committed
golden: the O2Ring finger twin's RICH export (`synthetic_ppgdex_o2ring_finger_golden.node-export.json`,
`compute` with no timebase opt) pins `quality.timebase:'device-crystal'`, fs 125.000 and the marker-
deflated axis — CI re-runs it (GATE B + a new equiv leg). Every prior PpgDex golden is a Verity, so the
crystal path had no committed leg until now.

ECG-arbitrated in Stage 2 (crystal ≈ host ≈ H10 chest ECG on good-host nights). Re-bundled PpgDex + Data
Unifier + OverDex; analysis tree rebuilt. Full node suite + capture-host 100 % floor + GATE A/B green.
The bad-host (travel/stratum-3) ECG acceptance is owed until such a night is captured (the local corpus
is home/stratum-1); the design is safe by construction regardless — each branch uses the trustworthy clock.
