<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-09-17 · **Promoted-from:** `BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md` §1.2 (whose §5 closes when 1.2–1.7 are each executed **or promoted**; this is the promotion, and §1.4's was the precedent) · **Owner:** unassigned · **Relates:** CLAUDE.md §∅ ABSENCE IS NULL (non-negotiable, owner-reinforced 2026-09-06), `signal-frame.js`, the sidecar shipped in #2317

> **Read §1 before sizing this.** The parent states the goal as *"the transport emits an envelope, not
> a scalar"*. Taken literally at the wire that **contradicts §∅**, which prescribes the opposite
> mechanism for the same problem and gives a cost reason. Reconciling the two is this brief's first
> task and probably most of its value; building anything before that is building the wrong thing.

---

## 1 · The contradiction to resolve FIRST

Two house rules answer one question, and they disagree about *where*:

| | says | mechanism |
|---|---|---|
| **CLAUDE.md §∅** | *"Validity must travel **OUT-OF-BAND** … records where the signal was absent in a **sidecar** (a span list is orders of magnitude smaller than the data), and consumers read the sidecar"* | sidecar beside immutable bytes |
| **parent §1.2** | *"The transport emits an **envelope, not a scalar**: `{value, validity, device_seq, host_monotonic, host_wall}`. A consumer cannot obtain a number without also obtaining its validity, because no other shape exists to read"* | per-sample envelope |

**They are not actually in conflict, and the resolution is the design.** They answer different
questions that the word "transport" fuses:

- **Storage** is settled and must not be re-litigated. §∅ is non-negotiable, owner-reinforced, and its
  cost argument is decisive: a per-sample envelope on disk multiplies a 127-sample frame by the size of
  a struct, for a stream whose absence is 149 runs in 3048 samples. **Captured bytes are immutable
  evidence.** The sidecar stays.
- **Consumption** is what §1.2's Done-when actually asks for — *"no consumer can reach a sample value
  without its validity"* — and that is a **TYPE** property, not a storage format. It is satisfiable
  with the sidecar underneath.

So the working hypothesis to verify, not to assume: **sidecar on disk → validity view in the frame →
no DSP reads a raw sample array again.** If that composition holds, this unit is a boundary change,
not a format change, and the parent's *"cost: real"* framing belongs to §1.1, not here.

⚠️ **Verify that hypothesis against the code before designing on it.** `signal-frame.js` today carries
`sqi`, `usable` and `reason` **per FRAME**; the sidecar carries validity **per SPAN**; §1.2 wants it
**per SAMPLE**. Three granularities, and nobody has checked that the middle one can serve the other
two without a per-sample allocation the frame currently avoids. That check is §3's first step.

---

## 2 · The evidence, already measured — do not re-derive it

From the parent, and from the 2026-09-06 all-hands:

- O2Ring `_PPG.txt`, 2026-09-05: **3048 samples of exact `0` in 149 runs**, 105 of them ≥ 10
  consecutive, longest 78 samples (0.62 s), against a modal baseline of 114–119 — **in-band blanking
  inside complete 127-sample frames**, not a delivery gap.
- **Every fixture reproduced it faithfully, so every gate was green.** That is the shape of the defect:
  the bytes are honest (`oxyii.py:838` returns the payload untransformed, `capture.py:4293` writes it
  through), and what was missing was an interpretation layer.
- `∅ ABSENCE IS NULL` held for two thousand commits **everywhere someone had written it down** — Clock
  Contract §2.6's stamps, `parse_live`'s scalar ranges — and failed in the one path where nobody had.
  **That is the argument for a type over a convention**, and it is the whole case for this unit.

---

## 3 · The work, in the order that stops it being the wrong work

1. **Reconcile the three granularities** (§1's ⚠️). Read `signal-frame.js`, the #2317 sidecar writer,
   and one real consumer end to end. Produce a one-page answer to: *can a per-span sidecar present a
   per-sample validity view without allocating per sample?* A negative answer is a fine result and
   changes the unit; publish it either way.
2. **Enumerate the consumers, do not guess them.** *"No consumer can reach a sample value"* is a claim
   over a set nobody has listed. `trace-to-the-consumer`: a mechanism's consumers are the deliverable,
   not the site you wrote. Every `frame.samples` / `rec.ch` / `relSec` read is a candidate.
3. **Make the unsafe read impossible, not merely discouraged.** A guard a consumer may bypass is a
   convention again, which is the thing that failed. Whatever the shape, the acceptance test is that a
   reviewer cannot write the old code by accident.
4. **A planted blanking run propagates to a `null` metric or a coverage-annotated one, and to nothing
   else** (the parent's Done-when, kept verbatim).

---

## 4 · What this brief deliberately does NOT decide

- **Whether the wire format changes.** §1's resolution says it should not; that resolution is a
  hypothesis until step 1 checks it.
- **Whether a consumer REFUSES or annotates.** A refusal that stops a night is the data-loss trade
  §1.7 declined to make, and the same question is open in
  `BLE-TIMEBASE-AT-THE-EDGE` §4 for seams. **These two should be answered together or the fleet gets
  two different answers to one question** — that is the strongest argument for sequencing this after,
  or with, that residue.
- **Migration cost.** A change at the DSP read boundary moves `computeHash` on every node that adopts
  it, so every fixture re-verifies. Stage per node; OxyDex first, as the roadmap does.

---

## 5 · Sequencing

**Not concurrent with `BLE-TIMEBASE-AT-THE-EDGE`'s residue** (they share the refuse-or-annotate
question) and **not concurrent with the measurement-instance contract**
(`MEASUREMENT-INSTANCE-CONTRACT-2026-09-17-BRIEF.md`), which adds a `quality` block to the export and
would collide on the same semantics. This is a THIRD statement of one idea — validity travelling with
a value — at a third granularity; whoever picks up the second should read the other two first.

## Done when

- [ ] §3.1's reconciliation is written and checkable, with the negative answer published if that is
      the answer.
- [ ] The consumer set is ENUMERATED, not asserted.
- [ ] A planted blanking run reaches a `null` or coverage-annotated metric and nothing else.
- [ ] No consumer can reach a sample value without its validity — demonstrated by a test that fails
      when the old read is reintroduced, not by inspection.
- [ ] The parent's §5 is re-read and its §1.2 line updated to record this promotion.

## Cross-references
- Parent: `BLE-TRANSPORT-REDESIGN-2026-09-10-BRIEF.md` §1.2 · sibling promotion: `BLE-TIMEBASE-AT-THE-EDGE-2026-09-16-BRIEF.md` (§1.4).
- Doctrine: `CLAUDE.md` §∅ — non-negotiable, and the source of §1's cost argument.
- Shipped retrofit: the sidecar (#2317) + the end-of-night back-check (#2315).
- Adjacent contract: `MEASUREMENT-INSTANCE-CONTRACT-2026-09-17-BRIEF.md` (validity at the MEASUREMENT granularity).
