<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: DEEP-AUDIT-2026-07-11-BRIEF.md
---
Add adversarial equivalence inputs — an MM/DD date order, a dropped-row night, a full-length overnight — so the bug class the deep audit had to find BY HAND is now caught by CI automatically.

Every committed input in this repo — real and synthetic — is a **clean, short, DMY, gapless** recording.
That is not an accident of sampling; it is the shape a maintainer naturally produces. And it meant three
of the audit's worst defects were **structurally invisible** to CI: the gate could not have caught them
no matter how green it ran, because **no committed input expressed the shape that triggers them**.

- **§1** an MM/DD-ordered O2Ring file (the Clock Contract lists BOTH orders for this vendor) flipped date
  order mid-file, ran the clock **backward**, and shipped `durationMin = −254760` with **ODI-4 = 0/h** —
  an apnea night reading as perfectly healthy.
- **§8** `parseCSV` drops the device's `- -` no-reading rows, so a row index stops being a second-offset.
  Two consumers rebuilt event time from the index anyway; a desat landed **476 s** from its true time,
  against a 15 s / 60 s coincidence gate.
- **§9** two surfaced metrics head-sliced to the **first hour** of a 6–10 h night, undisclosed.

`tools/make-synthetic-inputs.mjs` now emits three adversarial twins expressing exactly those shapes, and a
new test group asserts the **invariants** they violate: an MDY file must compute **identically** to its DMY
twin · a dropped-row night must place every event on its **own** parsed stamp · a long night's window
metrics must describe the **whole** night.

**Invariants, not goldens.** A golden pins bytes and catches drift; an invariant catches the **bug class**,
including a regression nobody has thought of yet. So these inputs carry no golden and add no fixture
records — zero ledger surface.

**Each input is proven to bite.** Run against the pre-audit code, the group goes red with the original
numbers: date `2026-12-06` (six months adrift) and `durationMin = −254760` · **476.6 s** event drift ·
`peakCycSec = 20 s` instead of 50. And each assertion has a **control** proving the input is not toothless
(the night really has desaturations to lose; rows really were dropped; the index mapping really is wrong
here). The first cut of the MDY file spanned only days > 12 — so every row was unambiguous, the mid-file
flip never fired, and it passed against the broken code. The red-against-old-code check is what caught
that; the generator now documents why the start date matters.

Deterministic: regenerating reproduces every file byte-for-byte. No bundle, no fixture, no ledger touched.
