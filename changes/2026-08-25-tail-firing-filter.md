---
bump: patch
type: fixed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Correct §6a: not every on_doff firing brackets the awake tail. Only firings that reach the air carry
information — a not-advertising failure bounds the tail above, a success bounds it below, and a
BleakDBusError says nothing because the adapter was busy. Day one produced three firings and zero
usable points. The collection rule is to filter on failure class, never on firing count.
