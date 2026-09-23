---
bump: patch
type: fixed
brief: none
---
When no counter in an ECG file is usable, `fs` stayed at the H10's nominal **130** — a number with no measurement behind it — and was then spent as the file's timebase: `relSec`, every duration, every epoch edge. An assumed 130 and the measured 129.9866–129.9966 this corpus yields are the same JS number, so nothing downstream could tell them apart. This is family **F2** of `ABSENCE-SURVEY-2026-09-22` — *a rate defaulted, then spent as a timebase*.

The remedy is the one CLAUDE.md §7 already established for the AXIS: publish the provenance rather than the guess. `quality.timingSource` exists for exactly this (*"a device whose axis was DRAWN is not a clock"*) and had no counterpart for the RATE — §7's own warning that *"a refusal guards the RATE, not the AXIS"* running in the other direction. `fsSource` is now `ns-counter` · `ms-step` · `ms-delta` · `caller` · `assumed`.

🔴 **A GATE THAT CLAIMED TO COVER THIS CLASS WAS BLIND TO IT, and the fix proved it.** `ecgdex-dsp · timing-reshape` promised *"whatever the resolver publishes must survive the reshape, so the next omission reds instead of vanishing"* — and compared a HARDCODED LIST against the record, never reading the resolver. Adding `fsSource` upstream and dropping it in the reshape left the group **green**. Its anti-vacuity assertion did not help: it guarded against a SHORT list, not a STALE one. The gate now drives the same scan the parser drives and asks `ecgTimingResolve` what it published; planting the dropped field back reds it (`got ["fsSource"]`).

⚠️ SCOPE, stated: this makes the fabrication VISIBLE; it does not change what a consumer DOES with an assumed rate. Refusing a recording is a policy decision with a far wider blast radius and belongs in its own unit — `fsSource` is what such a refusal would key on, and it did not exist. The node export carries no `fs` at all, so the record is its only home today. `alignFirmwareRR`'s 130 fallback was examined and LEFT ALONE: it documents itself, and is a comparison floor rather than a timebase.
