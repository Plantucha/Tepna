---
bump: patch
type: fix
brief: briefs/ABSENCE-SURVEY-2026-09-22-BRIEF.md
---

Each GlucoDex surface that reads the nullable cadence chain now names the node's own token.

The node publishes `cadence: null` beside a named reason when no inter-sample delta of an export
falls in (0, 240) min, and it nulls `activeMin` and `durDays` from it. The readers of that reason
numbered zero. The surface read the three nulls unguarded: a day count threw inside the context
banner, a null minute total printed as a fabricated `0h` on the quality tile, in the hero line and
in the readiness badge, and a null rate printed as the string `null-min` in three places. The
viewport read the measurement where it needed the grid step, so its day window silently became the
whole record.

Five helpers in the render module decide what a refused rate looks like, in three states. A measured
value prints the number and nothing extra. A refusal prints the node's own token. A null with no
reason prints UNKNOWN, because that is a different claim. The scope measures its step from the grid, where the cells sit one step apart.
