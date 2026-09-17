<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-09-17 (closed by §5 path **(b)** — §1.1 deferred with a reason, 1.2–1.7 each executed or promoted; see the ⏸️ and §1.2 notes at the end of this header. **§1.5 + §1.6 counters and §1.7 adapter-lease recording EXECUTED 2026-09-16** — `capture-host/blestats.py`, wired at the two chokepoints `_connect` and `_retry_sleep`, published as `status.json` `ble`. §1.5's done-when is MET; **§1.6's is NOT** — *"the retry rate is a reported series"* needs something to draw the series, and nothing does yet, so that half is tracked as residue rather than claimed. **§1.7 MET** — a failover onto a reserved adapter now records `preemption` + the `reserved_adapters` in force on the radio-failover event, so no code path uses a leased adapter without recording a preemption. The brief's two honest options are refuse or preempt-and-record; **preempt** was taken, because refusing is a data-loss trade this unit is not the place to make, so behaviour is deliberately UNCHANGED and only the evidence moves. **§1.3 item 3 MET** (#2549); **§1.3's per-unit capability RECORD IS BUILT** (#2561, `capture-host/devcaps.py` — keyed by address, persisted across restarts, an unmeasured capability reads `null` and never `false`), so do NOT build a second one; this line read "unbuilt" for the few hours between the triage and the build, which is exactly how a rebuild gets commissioned. **Item 2 holds** — an absent record is PROBED, because the flags byte is read on every packet. **Item 1 does NOT**: no capability BRANCH consumes the record, since the only per-unit capability in the daemon is a SESSION fact and seeding it would coerce `null` to `false`. Residue `2026-09-16-devcaps-has-no-branch-consumer` carries the branch inventory and why `needs_pmd`/`optional` are CONFIG and must not be swept in. **§1.4 PROMOTED 2026-09-16** to `BLE-TIMEBASE-AT-THE-EDGE-2026-09-16-BRIEF.md`, which is what §5 asks for — it closes when 1.2–1.7 are each executed OR promoted. That brief states the problem and the measured evidence and deliberately decides nothing, because where the stamp lives and whether consumers are FORCED to see a seam are owner-shaped calls. **§1.2 PROMOTED 2026-09-17** to `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` — it was the one item this header never mentioned, and a reader completing the list from 1.3–1.7 would have assumed it done. It is not: the sidecar (#2317) is §1.2 *retrofitted*, and the envelope is the same idea made unavoidable. That brief leads with a contradiction this one did not notice — §1.2 says the transport emits an envelope, while **§∅ prescribes the OPPOSITE mechanism for the same problem** (validity out-of-band in a sidecar, because a span list is orders of magnitude smaller than the data). They reconcile only once "transport" is split into STORAGE (settled, sidecar, non-negotiable) and CONSUMPTION (a type property, which is what §1.2's done-when actually asks for). **§5's condition (b) is therefore now MET: 1.2–1.7 are each executed or promoted.** ⏸️ **§1.1 DEFERRED 2026-09-17, with the reason §5 requires, and REVERSIBLE by the owner.** Three parts: it is explicitly *(owner decision)* and its own text says *"Cost. Real. This is the only item that is not incremental"*; the operational symptom is CLOSED, not merely quiet — #2373 landed `_settle_gatt_chars` so the remedy travels with the repo rather than living in one machine's `main.conf` as §1.1 states, and the box measurement was zero failures in ~264 polls against a 10.9 %/poll baseline (p ≈ 10⁻¹¹, residue closed `fixed #2376`); so nothing is bleeding while it waits. What §1.1 still buys is the ARCHITECTURAL remedy — owning a `{uuid → handle}` map keyed on the Database Hash instead of reading a foreign D-Bus mirror — and that is a real change to the box's BLE stack, which is why it is the owner's and not mine to take. **So this brief is DONE by §5 path (b), and §1.1 is an open OWNER item that outlives it**) · **Residue:** 2026-09-16-ble-counters-not-drawn, 2026-09-16-devcaps-has-no-branch-consumer · **Created:** 2026-09-10

# The BLE transport, designed from what we now know

## §0 The thesis, and why it is one sentence

**BLE was built here as a device-driver problem. It is a distributed-systems problem.** A driver
returns what the device said. What BlueZ hands us is an **eventually-consistent replica** of the
peripheral's attribute table, maintained by a daemon we do not control, with no transaction boundary
and no ordering guarantee against the call that told us it was ready.

Almost every BLE defect this suite has recorded is a corollary of that one mismatch. They have been
fixed one at a time, correctly, as if they were unrelated. They are not. This brief states what a
from-scratch transport would do differently and what evidence each change is bought by — so that the
next person to touch this layer inherits the model rather than re-deriving it from seven separate
post-mortems.

⚠️ **This is a DESIGN brief, not a work order.** §1's items are individually executable, but item 1.1
is an architectural commitment (we would own more of the GATT layer than we do today) and is an
**owner decision**, not a pickup. Nothing here authorises a rewrite. The cheapest items — 1.5, 1.6,
1.7 — are worth doing on the current stack regardless of whether 1.1 is ever taken.

## §1 The seven changes

### 1.1 Never address a characteristic through someone else's object mirror *(owner decision)*

**Today.** connect → BlueZ sets `ServicesResolved=true` → bleak snapshots the D-Bus object tree →
we look up a UUID in that snapshot. Three surfaces stacked, and the middle one is a cache we do not
own. bleak reads the `Connect` reply on a **per-connect** `MessageBus` and the `InterfacesAdded`
signals on its **global** one (`bleak/backends/bluezdbus/client.py:156-166`), so nothing orders the
two: *"ready"* is not a fact about the tree.

**Evidence.** #2170, open for days, ~98 events a night. #2372's instrument finally read the snapshot
at the moment of failure: **seven events on 2026-09-09, six byte-identical**, holding
`00001801-…[]` — the Generic Attribute service ALONE, lowest handles and therefore first on the
wire, carrying no characteristics, with the vendor service absent entirely; the seventh had advanced
by exactly one object. bleak was not missing the tail of the tree. It snapshotted while nearly all of
it was still in flight.

**Instead.** Discover the attribute table ONCE per device; persist our own `{uuid → handle}` map
keyed on the peripheral's **Database Hash**; thereafter address characteristics **by handle**. The
hash is exactly the staleness signal this needs, and it is the mechanism BlueZ itself takes on the
bonded path that has never failed here. No snapshot, no lookup into a foreign mirror, no window.

**And it decouples two concerns that must not be fused.** BlueZ gates its GATT cache on
`gatt_cache_is_enabled()` = `device_is_paired()`. That spends a **security** property as a
**consistency** property — which is the entire reason the unbonded adapter raced while the bonded one
did not, and why the remedy that worked (`Cache = always`) is a line in one machine's
`/etc/bluetooth/main.conf` that travels nowhere.

**Cost.** Real. This is the only item that is not incremental.
**Done when.** A device's handle map survives a disconnect; a forced Database-Hash change
re-discovers; a planted mid-publish object tree cannot produce a wrong handle (it produces a refusal).

### 1.2 Make absence representable in the TYPE, not in a rule people remember

> ⏩ **PROMOTED 2026-09-17 → `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md`.** Read that brief before
> acting on this section: it leads with a contradiction stated here and not noticed here — "the transport
> emits an envelope" is the OPPOSITE mechanism to §∅'s sidecar, which is non-negotiable and carries the
> cost argument. The two reconcile only by splitting STORAGE (sidecar, settled) from CONSUMPTION (a type
> property, which is what the Done-when below actually asks for).

**Today.** `∅ ABSENCE IS NULL` is a convention. It held for two thousand commits everywhere someone
had written it down — the Clock Contract §2.6 stamps, `parse_live`'s scalar ranges — and failed in
the one path where nobody had: the raw waveform bytes.

**Evidence.** The O2Ring's `_PPG.txt`, 2026-09-05: **3048 samples of exact `0` in 149 runs, 105 of
them ≥ 10 consecutive, the longest 78 samples (0.62 s)**, against a modal baseline of 114–119, inside
complete 127-sample frames. In-band blanking, not a delivery gap. Every fixture reproduced it
faithfully because that is what was on disk, so **every gate was green**. The bytes are honest —
`oxyii.py:838` returns the payload untransformed and `capture.py:4293` writes it straight through —
the missing thing was an interpretation layer, because the wire format is bytes and the type system
had nowhere to put *"not measured"*.

**Instead.** The transport emits an **envelope, not a scalar**:
`{value, validity, device_seq, host_monotonic, host_wall}`. A consumer cannot obtain a number without
also obtaining its validity, because no other shape exists to read. The sidecar shipped in #2317 is
this idea retrofitted; the envelope is the same idea made unavoidable.

**Done when.** No consumer can reach a sample value without its validity; a planted blanking run
propagates to a `null` metric or a coverage-annotated one, and to nothing else.

### 1.3 Capability is a per-UNIT runtime fact, discovered and recorded — never asserted per model

**Evidence.** The clean miniature, logged 2026-09-10 as
`2026-09-10-h10-comment-denies-its-contact-bit`: the SIG HR parser's docstring states *"Measured
2026-07-19 on an H10 (which does NOT report contact)"*, and the H10 on the capture box reports it —
`worn_why = "not worn per hr-contact-bit"`. One unit, measured once, became a claim about a **model**,
in prose, one layer from code that already treats contact support as per-device (`_has_contact_bit`
is raised dynamically from the flags byte). The code was right; the sentence a reader trusts was not.

**Instead.** A capability probe runs once per **physical device**, writes a per-unit record, and code
reads the record. Then no comment gets to make that claim, because no comment is where the answer
lives.

**Done when.** Every capability branch reads a per-unit record; a device whose record is absent is
probed, never assumed; no source comment states a capability as a property of a model name.

### 1.4 Establish the timebase at the transport edge, once

> ⏩ **PROMOTED 2026-09-16 → `BLE-TIMEBASE-AT-THE-EDGE-2026-09-16-BRIEF.md`**, whose NODE-side half is
> executed (#2600: PpgDex re-anchors at a seam; a planted step went from a 7.66-year span to 249 s). The
> TRANSPORT-EDGE stamp this section proposes is still NOT built — its §4 questions stand, two of them the
> owner's. Residue `2026-09-17-ble-timebase-edge-stamp-undecided`.

**Today.** Each node reconstructs time from whatever survived to it, and the seams show.

**Evidence.** Measured 2026-09-02 with the true F1 magnitude planted into a `_PPG.txt`: `hostAxis`
refuses at ±50,000 ppm exactly as designed, **and `relSec` still spans 2.416e8 s** — a 7.66-year
night through every duration, epoch grid and export window downstream, while the rate guard reads
green. A refusal about one quantity was read as protection of another.

**Instead.** Every inbound packet is stamped at the earliest possible point with all three clocks,
and they travel together for the rest of the pipeline. **Resync seams are first-class events on the
stream**, emitted by the layer that caused them — not a discontinuity each DSP is separately expected
to detect, which is a job most of them are not doing and have not shown they don't need to
(Clock Contract §7, "a node that detects no steps has not shown its stream has none").

**Done when.** A planted counter step produces a seam event, not a silently spanned `relSec`; a node
consuming the stream cannot construct a duration across a seam without seeing it.

### 1.5 Instrument the DENOMINATOR, not the failures *(cheap, do it anyway)*

**Evidence.** Establishing #2170's rate required recovering the denominator from a startup line that
happened to state `poll 30.0s`, because the shadow poll logs **only failures**. A failure log without
a denominator is not a rate, and the entire question was a rate. Same shape when the fix landed: after
`Cache = always`, "zero failures" was initially meaningless — zero over an unknown number of attempts
— until the poll interval supplied the divisor and made p ≈ 0.008 computable.

**Instead.** Structured counters for attempts, successes and each failure class. Then *"is this
getting worse?"* is a query, not archaeology.

**Done when.** Every BLE operation increments an attempt counter before it can fail; no rate in a
report or alert is derived from a log line count.

### 1.6 A retry is an event with a cause, never a silent absorption *(cheap, do it anyway)*

**Evidence.** #2365's retry absorbed **97 of 98** failures. Excellent for the capture, and it is
precisely what let the underlying fault run ~98×/night behind a warning nobody had to read. The
failover code one function over already contains the correct sentence — *"a silent recovery is how a
degrading radio stays invisible until it fails completely"* — and it was applied to only one of the
two places that needed it.

**Instead.** Retries increment a counter, name their cause, and a **rising retry rate is itself the
alert**. Recovery that hides its own frequency is a defect with a success message attached.

**Done when.** No recovery path exists whose frequency is unobservable; the retry rate is a reported
series.

### 1.7 Adapter assignment is a LEASE, not a hint *(cheap, do it anyway)*

**Evidence.** `config.example.yaml` reserves a radio as *"the FREE radio — never the one the wearables
capture on"*, and a CPAP discovery failover overrides that and **logs a warning**. Measured per night:
**60 · 67 · 65** reserved-radio overrides on 2026-09-05/06/07. A reservation the code can override by
writing a sentence is not a reservation.

**Instead.** A device holds a lease on an adapter. A failover onto a leased adapter either refuses or
**preempts explicitly**, with the decision recorded as a decision.

⚠️ **Refusing is a data-loss trade** — the existing code says so and is right to say so. The point is
not that refusal is correct; it is that "override and log" is not one of the two honest options.

**Done when.** No code path can use a leased adapter without either holding the lease or recording a
preemption.

## §2 Not architecture, but it has now cost twice: the doubles

> ✅ **ALREADY REMEDIATED — verified against the tree 2026-09-16 (Kestrel), no work owed.** This
> section reads as open and is not. `_FakeBleak.disconnect()` in `capture-host/tests/test_cpap_stream.py`
> sets `self._backend.services = None`, mirroring bleak's `_cleanup_all`, and its class docstring carries
> the 🔴 *"do not simplify it away"* warning with the 98-of-98 incident written out. The `_FakeBackend`
> above it models the republish (`services is None` → `_publish()`), which is the state machine §2 asks
> for rather than a call recorder.
>
> The contract is also GATE-BACKED, not just commented: `test_the_snapshot_and_link_state_are_read_BEFORE_the_leak_guard_closes_the_link` pins the #2365 defect and states it *"REDS against the old
> ordering rather than passing on a stub that kept its state"*.
>
> ⚠️ **Recorded because the section invites the rebuild it warns about.** A session reading §2 cold
> finds a vivid description of a defect and no indication it was fixed, and the natural next step is to
> go build the state machine that already exists — which is what this note prevents, and what nearly
> happened on 2026-09-16.

**Test doubles must model the STATE the library keeps, not the CALLS it receives.** Both failures were
in the same file:

- #2365's snapshot probe shipped green over a `_FakeBleak` that held its collection across
  `disconnect()`. Real bleak's `disconnect()` ends with `assert self.services is None`, so the probe
  could only ever report the teardown it had just performed — **98 of 98 events byte-identical** on
  the box, an output with no spread, which is evidence about the instrument and not about the link.
- #2373's settle would have passed against a fake whose tree never grows, rescued by the retry, with
  the entire fix deletable and everything still green.

Both stubs encoded the shape and not the contract. From scratch the fake is a **state machine
mirroring the real one from day one** — cheaper then than as a retrofit, and the only thing standing
between a suite and being green about nothing.

## §3 What this brief REFUSES, so it is not re-proposed

- **`HCI_CHANNEL_USER` is disqualified.** Taking the controller away from BlueZ entirely was
  considered and ruled out; do not reopen it as the route to §1.1. §1.1 keeps BlueZ as the transport
  and stops trusting its **object model** — a much smaller claim.
- **No rewrite.** Items 1.5–1.7 are independently valuable on today's stack, and 1.2/1.3 are additive.
  Nothing here proposes replacing working capture code.
- **Not a criticism of starting on BlueZ/bleak.** It was the right way to reach working captures
  quickly, and items 1.1–1.7 are mostly things that can only be **known** once a corpus and a year of
  failures exist. Recording that explicitly so this brief is not read as hindsight indicting a
  decision that was correct at the time.
- **`Cache = always` is not the fix, it is a mitigation with a boundary.** It closed #2170 on vigil
  (measured 2026-09-09/10: ~264 polls, zero failures, p ≈ 10⁻¹¹ against the 10.9 %-per-poll baseline)
  and it lives in one machine's config. A fresh clone inherits the race. That asymmetry is §1.1's
  whole argument in one line.

## §4 Sequencing, and who decides

| item | cost | decides |
|---|---|---|
| 1.5 denominators · 1.6 retry visibility · 1.7 adapter leases | small, additive | pickup |
| 1.3 per-unit capability records | small | pickup |
| 1.2 sample envelope | medium — touches every writer and consumer | pickup, after the §∅ mechanism review lands |
| 1.4 timebase at the edge | medium — Clock Contract adjacent, so serialised | pickup, brief of its own |
| **1.1 own the handle map** | **large — architectural** | **owner** |

## §5 Done when

This brief is DONE when either (a) the owner rules on 1.1 and that ruling is recorded in this header,
or (b) 1.1 is deferred with a reason and items 1.2–1.7 have each been executed or promoted to their
own briefs. Residue from any item goes to `briefs/RESIDUE.md` as a row, per §📌.

The brief has already produced one row before execution —
`2026-09-10-h10-comment-denies-its-contact-bit` (§1.3's evidence) — which is the intended shape: the
model earns its keep by making defects legible, not by being executed all at once.
