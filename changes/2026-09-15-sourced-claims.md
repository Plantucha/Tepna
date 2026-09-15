---
bump: minor
type: added
brief: none
---

`CLAIM <name> = <value> FROM <path>#<pointer>` — a published number that names the committed artifact
it came from, checked by the existing `CLAUDE.md claims match the tree` gate, now scanning **briefs/**
as well as CLAUDE.md (510 files).

The three pre-existing CLAIMs each needed a **bespoke resolver hand-written into the gate**, which is
why there were three and not thirty. A sourced claim carries its own resolver, so one generic checker
covers any number a tool can be made to emit into a committed artifact.

**Why a marker rather than a prose scanner — measured, not assumed.** A statcheck-style scan for a
ratio beside its percentage over `briefs/ audits/ docs/` found **213 candidates and flagged 45**, and
every one of the four sampled was a **false positive**: a threshold (`28 of 28 fail the 80 % floor`), a
sequence (`nf = 219/220/221 — a 16 % swing`), a transition (`61/319 → 118/319 = 36 %`, where the
percentage belongs to the second pair), and an adjacent table column supplying a different denominator
(15/179 = 8.4 %, not 15/164). Tightened until those die: **14 candidates, zero disagreements** —
precise and empty. statcheck's precision comes from NHST's rigid reporting *convention*, not from its
checking; Tepna's briefs have no such convention, so a marker that **creates** one is not the cheaper
option, it is the only one that works.

Motivation is `PUBLISHED-NUMBER-DECAY-SWEEP-2026-09-03`: of 259 substantial published tables, **at most
5 are attributable to a producing tool**, and of those re-run, most had already drifted — for three
distinct reasons, none of them "wrong when published". The uncheckable 254 are not better, merely
unmeasured.

**Refusal is loud.** An unresolvable source reds and never skips: a claim whose artifact vanished is
exactly the stale number this exists to catch, and a checker that fell silent there would report health
about something it never examined.

First claim planted on a real published number — CLAUDE.md's trio corpus `20 eligible nights`, now
resolved against `analysis/tri_device_nights.json#count`.

Mutation-verified across all three failure modes rather than one: a wrong stated value reds, a dead
pointer reds, and — the case the decay sweep actually measured — **the committed artifact moving while
the prose does not** reds. Plus two anti-vacuity assertions: the scan must reach past CLAUDE.md, and at
least one sourced claim must exist, since a generic checker with nothing to check is not a gate.
