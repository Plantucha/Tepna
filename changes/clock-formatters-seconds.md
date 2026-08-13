---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

Clock Contract §5: the display-formatter gate only reached nodes exposing `fmtClock`, and only the
three methods named there — so every SECOND-bearing formatter and OxyDex's DD/MM/YYYY formatter sat
outside the contract. `hrvdex._hrvClockS` survived `getUTCHours → getHours`, a §5 violation that
renders a New-York night as a London morning. Now covered under the same forced-zone regime, with a
single-digit stamp so the zero-pad branch is exercised too. Verified by re-applying 16 mutants
across the eight formatters: 16/16 killed.
