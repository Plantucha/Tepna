<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: CPAPDEX-STR-SUMMARY-INGEST-2026-08-21-BRIEF.md
---

The CPAP acquisition envelope now carries the acquisition's START, so it can be JOINED to a night.

Every production CPAP envelope previously had `start_time_ms: null` — `_emit_acq_evidence` never
passed it and `RawRecordSink.acq_facts()` exposed no device time. That made the envelope joinable to
nothing: a CPAP night is built from SD EDFs, whose filenames carry no host session id, so the OxyDex
join (by filename, #1752) does not transfer. The CPAP join has to be by DAY — the rule
`attachStrSummary` already uses — and a day needs a time.

The raw record already HELD the start: the first batch's `device_start`, recorded verbatim per
INV3/INV4. It simply was not surfaced. `RawRecordSink` now keeps the FIRST batch's stamp (later
batches must not overwrite it, or the reported start would drift later as the night ran), `acq_facts`
exposes it verbatim, and the conversion happens at the envelope boundary rather than in the sink.

`cpap_edf_writer.device_stamp_to_tms` is the conversion, made PUBLIC rather than duplicated: the Clock
Contract allows one parser per node (§2), so it delegates to the existing `_start_components` instead
of re-deriving the regex. The components come back already resolved to LOCAL CIVIL time, which IS the
floating basis §1 defines, so there is no second timezone step.

Refusals are pinned, because a fabricated start would join an envelope to the WRONG night — worse than
joining to none: an unparseable stamp, an absent one, a calendar-invalid one (`2026-02-30`, which date
arithmetic would silently roll onto March), and an out-of-range hour all yield `None`, never now.
A zoned stamp is asserted to differ from its verbatim-components reading, since taking `…Z` components
literally mis-dates by the UTC offset.

Two wiring witnesses, both verified to fail when the wiring is cut: the sink keeps the FIRST stamp
rather than the last, and the pump actually FORWARDS the converted start (converting without
forwarding would leave every envelope unjoinable while every assembler test stayed green — the
unpinned-wiring shape from #1784).
