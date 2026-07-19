<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [cpapdex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
**The ECG co-import could neither place a surge on the right night nor count it honestly.** Both defects had
a correct implementation already sitting in the sibling `oxydex-fusion.js`.

## §6.4 — the surge series landed a day early

`_hmsToMs` built each event's timestamp from the recording's start *date* and then chained forward through
`prevMs`. It never anchored to the recording *start*. Event `t` is a wall-clock string with no date — that is
the export contract — so an overnight study beginning 22:00 whose first surge is at 01:05 produced 01:05 on the
**start** date:

```
recording starts 2026-01-10 22:00
  01:05 → 2026-01-10T01:05   offset −20.92 h
  02:15 → 2026-01-10T02:15   offset −19.75 h     ← inherited via prevMs
  05:40 → 2026-01-10T05:40   offset −16.33 h
```

The whole series sat ~21 h before the study, guaranteeing zero overlap with the apneas — and the co-import
reported that as a confident `corroboratedPct: 0`. **Absence of overlap was rendered as evidence of absence.**

It only fires when the first surge falls past midnight; a study whose first surge is same-evening anchors the
chain correctly, which is why it survived. That is the ordinary overnight case.

`oxydex-fusion.js`'s `_oxyHHMMSStoMs` already carried the missing line. The 1 h slack is kept deliberately: a
surge slightly *before* the anchor is device clock skew, not a next-day event, and must not be thrown forward
24 h. Both directions are gated.

## §6.3 — one surge corroborated a whole cluster

Corroboration was a bare existence test — `ecg.surges.some(...)` — with no consumption. The window is 75 s
wide (`LEAD=15`, `TRAIL=60`), so a **single** surge satisfied it for every apnea inside: five apneas in a 40 s
cluster with one surge reported `matched=3, corroboratedPct=60`. One piece of evidence, counted three times,
presented as independent confirmation.

Now nearest-first with a `usedSurge{}` consumption map — the same discipline `oxydex-fusion.js` uses for
desat↔surge matching. The same case reports **20 %**. Apneas are sorted before assignment so the result does
not depend on event order.

## Gates

11 assertions on the real modules, through the public `normalizeEcg` / `autonomicCorroboration`. Every fix leg
is paired with a control that would red if the fix over-applied:

- a same-evening surge must **not** be rolled forward a day
- a surge just *before* the start (clock skew) must be kept, not pushed 24 h
- three apneas each with their own surge must still read **100 %** — a real full match is not suppressed
- a surge outside the directional window still corroborates nothing

Mutation-verified in both directions: removing the anchor reprints −20.92/−19.75/−16.33 h; over-applying it
(dropping the slack) throws the skew case to +23.67 h; removing the consumption reprints 60 %.

## Provenance

`computeHash` moved (`873bf3b0cbfe` → `add899e6adaf`) — a co-import change is inside the compute closure — so
**export-inertness is not claimed**. All four CPAPDex fixtures reproduce byte-identical (none carries an
ingested peer export, so no committed output exercises either path) and were re-verified against the real
corpus with `tools/verify-fixtures.mjs`. Suite **3320 passing, zero skips**; GATE A 9/9, GATE B 12 reproducible,
all three `--check` surfaces clean.

§6.1 (`pressureChangePoints` records medians against the wrong segment bounds, and its global-MAD penalty drops
real steps) is confirmed-open and lands separately — it is change-point detection, not co-import timing.
