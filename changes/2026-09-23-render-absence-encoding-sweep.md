---
bump: patch
type: fixed
brief: RESIDUE 2026-09-23-render-overrides-a-published-refusal
---

HRVDex's rMSSD-modifier chart encoded absence two ways on adjacent lines sharing one guard: the
plotted `data` yielded `NaN` (an honest gap) while the per-point `backgroundColor` yielded `0`,
and `0 >= 0` painted that point GREEN — absence reading as improvement. Both now yield `NaN`, and
an absent point is transparent; a genuine 0 % change still reads green, so measured-zero and
not-measured are distinguished rather than both suppressed.

Closes the sweep the residue row asked for: the producer-refuses-then-consumer-overrides shape,
checked across all seven previously unswept render files. 5 candidates, 4 refuted (a sort
comparator where 0 means "equal", a `smoothRange` DOM default, a decimal-places count, and one
unreachable branch in MotionDex where `hasData:true` always sets `track`), 1 in class — the one
fixed here. ECGDex, GlucoDex, PpgDex and PulseDex carry none.
