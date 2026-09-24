---
bump: minor
type: added
brief: SOLID-NIGHT-2026-09-23-BRIEF.md
---

`capture-host/solid_night.py` — the composition core of the SOLID-NIGHT verdict, the one `tepna.verdict/1`
per night that scores the capture-quality phase. It takes band decisions that are already made and
applies the brief's §3.1: precedence (`not settled` UNKNOWN › FAIL › UNKNOWN › NOT_APPLICABLE › PASS),
the population equality, the settle trigger and the consecutive count toward the fourteen-solid-night
exit ("S solid of N nights over D days"). A device judged on nothing, or whose applicability is unstated,
is UNKNOWN, never PASS. A FAIL on one device is not hidden behind another device's UNKNOWN. A no-wear
night skips the count, and a settled UNKNOWN resets it. Not yet wired to its band suppliers; registered
PENDING in `find_unwired.py` with the consumer named.
