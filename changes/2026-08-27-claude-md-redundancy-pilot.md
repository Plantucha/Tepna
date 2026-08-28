---
bump: patch
type: changed
brief: CLAUDE-MD-REDUNDANCY-AUDIT-2026-08-27-BRIEF.md
---

`CLAUDE-MD-REDUNDANCY-AUDIT` — pilot executed instead of the full 150–250-item inventory, and the
result is that **the brief's own success band has a hole, and the measurement landed in it.**

The two heaviest plausible candidates were inventoried at sentence level. **The arithmetic gate was
pre-stated before any classification** — with savings extrapolated as `trim(P) + ½·rate·(T−P)`, every
other section assumed to trim at **half** the pilot rate, the pilot had to be **≥ 34.4 %** trimmable
for the full audit to reach the 20 % bar.

| section | bytes | trimmable | rate |
|---|---|---|---|
| §🔒 EXPORT-INERT | 6 062 | 2 177 | 35.9 % |
| §📌 brief lifecycle | 9 409 | 2 574 | 27.4 % |
| **pilot** | **15 471** | **4 751** | **30.7 %** |

Extrapolated generously: **17.8 %** of the file.

🔴 **17.8 % is neither outcome the brief defined.** §2.4 says ≥ 20 % is worthwhile and < 10 % means
recommend not executing — it says nothing between, and the measurement is exactly there. Calling that
a decline would be moving the bar after seeing the data, which is the sin a pre-stated band exists to
prevent. **Routed to the owner**; no trim and no decline is taken here.

Two findings the byte count does not show:

- **The four biggest sections are excluded by the brief's own §1 criteria**, not by preference —
  §7 hostAxis and §5 LANDING are prose-only, §🐍 capture-host *is* the trap it teaches, and §📌 is
  gate-**assisted** (`CLAUDE_ALLOW_STALE_BRIEF` is precisely the plausible escape hatch criterion (a)
  excludes).
- **Savings concentrate in gate DESCRIPTIONS, not rules** — the two largest items are passages
  describing what a gate checks (`docs-ledger`'s coverage list, the GATE-C surface), and those are
  recoverable one hop by construction because the failure names print in the red output. Rules
  themselves compress badly.

⚠️ Error bar stated: the per-item compressed form is a judgment, good to perhaps ±20 % relative —
36.9 % / 21.4 % favourable, 24.6 % / 14.3 % unfavourable. Even the most favourable reading only
*barely* clears the bar, so the honest verdict is **near the bar, not clear of it** — which is itself
the argument for asking rather than deciding.
