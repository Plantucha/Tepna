<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: fixed
nodes: [OverDex, CPAPDex]
brief: EXPORT-PATH-UNREACHABLE-FOLLOWUPS-II-2026-08-01-BRIEF.md
---
Feed OverDex's advertised ResMed-EDF adapter the bytes it documents, and boot the node behind it.

OverDex listed `resmed-edf` in its own adapter table and routed dropped EDFs to it, but read every
file as text — so the adapter's documented `ctx.buffers` hatch was never populated and every ResMed
night died as "unusable frame". With bytes flowing it died again on a realm one script short: the
`__DEX_NAMESPACED__` co-load block carried six DSPs and not cpapdex, while signal-orchestrate already
had cpapHost/emitCpapNodeExport wired and gated on canEmit('cpap'). Bytes are now read alongside text
for `.edf` only; the set is decoded ONCE (one night = one EDF set) and every other file in it is
marked folded rather than left blank.
