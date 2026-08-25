<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: CPAPDEX-LIVE-SD-COMPARATOR-FOLLOWUPS-2026-08-24-BRIEF.md
---

Live-vs-SD comparator **v1.1 — the delivered-pressure channel** (§4 of the follow-ups triage).

The comparator core was channel-agnostic from v1: `cpapCompare` unions the labels of both sets,
`compareChannel` has no per-channel logic, and `comparatorPanel` already renders a card per channel.
What was missing was that the app only ever *built* a flow set. Both a device SD `BRP.edf` and the
capture-host `EdfSink` live file carry `Flow.40ms` **and** `Press.40ms` (`_BRP_SPECS`, verbatim from
the AirSense 11 format), so this needed no capture-host work — the channel was in both files all along.

Verified unit-safe rather than assumed: every threshold in `compareChannel` is either dimensionless
(`slope`, the 0.15 identity band, the 0.05 stability band) or derived from the data itself
(`1.96·SD-of-diffs`), so nothing was tuned to flow units.

The set-building is a new pure `CPAPCross.buildCompareSets` rather than an app closure, so the WIRING
is gate-backed: an app that silently stopped handing over pressure would otherwise leave every
comparator assertion green while the panel quietly lost a card.

A channel is included only when BOTH files carry it, so a flow-only pair yields exactly the v1
single-channel result — asserted, because the committed twin EDFs are flow-only.

**PLD is deliberately NOT included, and that is pinned by a test.** The triage called this the
"PLD-pressure" channel, but the live path emits `_BRP.edf` only (`cpap_edf.build_pld` exists and is
wired to nothing), so a PLD comparison would have no live side at all. PLD joins when the live EDF set
completes; BRP `Press.40ms` is available today and is the higher-rate, therapy-relevant channel.
