<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-25 · **Follows:** `CPAP-BLE-CAPTURE-2026-08-21-BRIEF.md` (the pure spool machinery, DONE) · **Relates:** `CPAP-ACQ-P1-RAW-RECORD-2026-08-23-BRIEF.md` §11 (live/spool convergence), `ACQ-EVIDENCE-CONTRACT-2026-08-24-BRIEF.md` Phase B (the assembler, tested-not-witnessed)

# CPAP spool acquisition — the caller, the first witnessed pull, and the §11 convergence

**Owner-assigned 2026-08-25 ("assign CPAP spool brief to coder").** Everything below the caller
exists and is gated; nothing above it does. The gap in one sentence: `as11_link.py` can build
`StartSpool`/`PullSpoolFragments` and `acq_evidence_cpap.py` can assemble the result — but **no
production path invokes either, the assembler has never met a real device spool, and the P1 §11
requirement (live and spool CONVERGE on one canonical record) has never been exercised.**

## What already exists — do NOT rebuild (verified in-tree 2026-08-25)
- `as11_link.py`: `establish` (4-step reconnect handshake) + `pull_spool` (StartSpool →
  PullSpoolFragments loop, `seq` reassembly, Base64, `nextSpoolAddress` continuation, terminal-status
  handling) — pure, injected `write`/`recv_frame`, read-only RPCs, 100 % coverage.
- `acq_evidence_cpap.py` (Phase B): the spool assembler — **honestly recorded "tested-not-witnessed"**.
- The AS11 permission table (protocol reference §3): `StartSpool`/`PullSpoolFragments` are
  `application`-access — no privileged pairing needed.
- The shadow supervisor's defer-during-streams discipline and the MAC-pinned CPAP adapter (#1797).

## Do
1. **First WITNESSED pull (attended; the owner is present by arrangement — say when).** Short
   connect on the pinned adapter, pull the **Summary spool** for a small bounded range (one day),
   `max_spool_size` conservative. Record verbatim: fragment count, sizes, `seq` gaps, continuation
   behaviour, terminal status, wall time. This converts the assembler from tested to witnessed — log
   every deviation between real fragments and the fixtures it was built against as a numbered finding.
2. **Feed the assembler the real fragments** and emit its evidence envelope. UNKNOWN stays UNKNOWN;
   no field is defaulted to pass. If the assembler needs changes, they ship with planted-control
   tests per the round-2 discipline (every fix verified by re-applying the defect).
3. **The caller** — ✅ **DONE 2026-08-26.** `cpap_spool_caller.py` (the pure decision half) +
   `capture._maybe_start_cpap_spool_pull` / `_cpap_spool_loop` (the daemon touch this brief and
   CPAP-ACQ-P4 §7 both announced). `cpap.spool_pull.enabled`, default OFF, never inherited — the
   `pull.on_close` reasoning verbatim, and it applies harder here because Do-1 is still owed: the
   caller ships DISABLED so the first radio-touching run stays the attended event this brief specifies.
   The arming line prints either way, armed or not. Window defaults to 10:00-12:00.
   Deferral reuses `cpap_harvest.blocking_devices` and adds the AS11's one-socket rule
   (`cpap_ctl._running`) and `_RECOVER`; a deferral does NOT consume the day.
   **One rule was ADDED that the brief did not ask for, because building it made the gap visible:**
   the spool window must not overlap `cpap.at_hour`'s Wi-Fi harvest window, and the daemon REFUSES to
   arm if it does, naming the hour. Both are 2.4 GHz on one box and neither job's interlock can see
   the other's traffic — so an overlap is invisible at runtime by construction, which is exactly why
   it is checked at arming, from config alone, where it is knowable. This is the one place a runtime
   interlock structurally cannot help.
   ⚠️ **FOLLOW-UP FOUND WHILE WIRING (not introduced by it):** the caller is reached only from
   inside `if web.enabled`, because `_cpap_ctl` — whose `_running` is the one-socket interlock —
   is constructed there. So on a box with the monitor disabled, an operator who arms
   `cpap.spool_pull` gets no pull **and no line saying why** — which is exactly what the arming
   line exists to prevent. `_maybe_start_as11_shadow` sits in the same block and has always
   inherited this identically, so it is pre-existing, not new. Unpicking it means moving the
   controller's construction out of the web block: a separate work-unit, recorded here rather
   than silently inherited.
   ⚠️ **SECOND FOLLOW-UP — a FALSE CLAIM in a comment, caught while copying it.**
   `_maybe_start_as11_shadow` justifies reading its flag without a literal `.get` fallback by
   saying it *"stays out of `settings_schema`'s shared-leaf default check"*. **There is no such
   check.** `settings_schema.SETTINGS` is an explicit dotted-key allowlist and `describe()` takes
   defaults from that table, so how a key is read in `capture.py` has no bearing on it. Grepping
   the phrase finds it in exactly two places: that comment, and the copy I had just pasted into
   `cpap_spool_caller.py`. Mine now states the real reason (it preserves ABSENT vs explicit
   `False`, which the arming line reports) and records the correction; the shadow's original is
   still wrong and is left for whoever owns that unit.
   This is the repo's own failure class reproduced in miniature — a mechanism asserted in prose,
   never checked, and spreading by copy. It cost one grep to falsify.
4. **§11 CONVERGENCE (the point of the whole lane):** for one night held three ways — live BLE
   capture, SD card (the 13:00 harvest works; verified against its destination 2026-08-25), and the
   spool pull — show the three agree or characterise exactly where they don't.
   **AMENDED 2026-08-25 (pre-session, tepna-99's catch): which comparison this is depends on what
   the spool CARRIES, and that is checkable before spending owner time.** The documented Summary
   spool holds session STATISTICS (the device's own AHI/indices — protocol reference §3, session
   investigation brief), which structurally cannot feed the v1.1 sample-pair comparator. Two
   branches, decided by the box's answer on whether a detail/WAVEFORM spool type exists:
   - **(a) waveform spool exists** → pull it for this item (Summary still pulled for item 2); the
     v1.1 comparator applies as originally written, waveform bands (identity 0.15, 1.96·SD LoA).
   - **(b) Summary is all there is** → item 4 is a **summary-vs-summary** convergence: spool
     summary vs SD summary vs live-derived metrics, on the existing #1781 `attachStrSummary`/
     `csrPbCrossCheck` path, with EVENT-RATE bands (events/hour, asymmetric, per #1781's pattern).
   Pre-state BOTH band sets before the session; the hardware answer selects which applies. The
   original "extend v1.1 with a spool leg" wording assumed branch (a) unverified — kept here struck
   as a record of the assumption: ~~add the spool leg to the same comparison~~.
   **Box's answer (2026-08-25 late): UNKNOWN, and the distinction is load-bearing** — `"Summary"` is
   the only spool type our client has EVER ASKED FOR (free-form string, no enumeration anywhere),
   which is evidence about our client, not the device; and the protocol reference's "summary/detail
   spools" line is prose in a Use column, not an enumeration — no `spoolAddress` key may be inferred
   from it. Therefore:
   - **The branch selector is a POSITIVE hit only** — a returned spool id for a detail-type request.
     A `-32602` on a guessed name refutes only that string (the same error answers malformed
     addresses), and **must not collapse the brief to branch (b)** — that would be absence of
     evidence read as evidence of absence, silently, behind a plausible-looking error.
   - **Probe protocol (morning idle window only — the AS11 holds ONE connection; never during
     streaming, never colliding with the 13:00 harvest):** PAIRED requests, identical `fromDateTime`
     + `maxSpoolSize` — `"Summary"` as the known-good positive control, then the candidate. Only
     Summary-succeeds + candidate-fails isolates the type name as the variable. An enumeration
     source beats name-guessing: `Get` (0x43, reads named data items) is the likelier candidate;
     `GetVersion` lists methods, not spool keys.
   - Until a positive detail hit exists, the SESSION pulls Summary (items 1/2 proceed regardless)
     and item 4 runs branch (b); branch (a) stays open, never refuted by a failed guess.
5. **Evidence contract:** the pull's provenance lands as an acquisition-evidence envelope
   (duration_check fields per the locked contract shape), and the raw fragment log is kept as the
   primary artifact (INV9: raw first, derived carries provenance).

## §11 agreement bands — PRE-STATED 2026-08-25, before any spool has been pulled

Both sets are written down **before** the hardware session, so the spool-type answer **selects** a set
rather than shaping one. Neither may be edited once data exists. If a field turns up that is not covered
here, its band is stated before it is compared, not after.

### Which set applies — and why a failed guess cannot decide it

🔴 **The selector is a POSITIVE HIT ONLY: a returned spool id for a detail request.** A `-32602` on a
guessed type name refutes **one string**, never the branch — the same error answers a malformed address,
so failed guesses are not evidence of absence. Branch (a) stays open until positively hit, and no number
of refused names closes it. (This is the suite's standing "an empty result is not a negative" rule in a
new costume: without it written down, three plausible names get refused and someone records "no detail
spool exists" as a finding.)

### Set B — SUMMARY legs · **PRIMARY** (branch (b), the session's working assumption)

Not the waveform comparator: summary statistics have no paired samples, so `compareChannel` refuses at
*"a channel is absent in one file"*. Runs on the `attachStrSummary` / `csrPbCrossCheck` path (#1781) —
the device's own scored summary against CPAPDex's computed metrics.

| quantity | AGREE | DISCREPANCY | symmetry |
|---|---|---|---|
| AHI (events/h) | \|Δ\| ≤ **max(0.5 /h, 10 % of the larger)** | above it | **SYMMETRIC** |
| CSR / periodic breathing (pp) | the shipped #1781 band: **max(2 pp, 0.5 × larger)** | above it | **ASYMMETRIC** |
| usage / session duration | \|Δ\| ≤ **1 min** | above it | symmetric |

**Why the AHI row is SYMMETRIC while #1781's CSR row stays ASYMMETRIC** — item 4 above says "asymmetric,
per #1781's pattern", and that is right for the CSR row and wrong for the AHI row, so the distinction is
resolved here rather than silently: #1781's band is asymmetric **because CSR ⊂ PB** — they are different
quantities, so one exceeding the other is not the same finding as the reverse. **AHI-vs-AHI is the SAME
quantity from two scorers**, where over-detection and under-detection are both findings and neither
direction is privileged; an asymmetric band there would encode a preference that does not exist.
Inheriting the asymmetry by analogy would be exactly the reasoning-by-class this lane keeps punishing.

Magnitudes, derived not picked: CPAPDex already matches the device's own STR.edf scoring to **0.05 /h**,
so a 0.5 /h floor is ~10× the observed agreement — loose enough to absorb rounding and session-boundary
edges, tight enough that a real scoring divergence cannot hide inside it. The 10 % relative arm exists
because an absolute floor alone is too strict on a high-AHI night.

### Set A — WAVEFORM legs · **CONDITIONAL** (branch (a), only on a positive detail-spool hit)

Extends the v1.1 comparator (`compareChannel`) with the spool as a third leg. **Three bands, not two** —
a binary is either trivially passed or trivially failed, and the middle case is the one worth recording.

| quantity | AGREE | CHARACTERISE | DISCREPANCY |
|---|---|---|---|
| `scale.a` (slope, dimensionless) | \|slope−1\| ≤ **0.02** | 0.02 – 0.15 | > **0.15** (the shipped `scaleFarFromUnity` alarm) |
| `divergence.excursionFrac` | ≤ **0.10** | 0.10 – 0.25 | > 0.25 |
| `scaleStable` | **true** (windows within 0.05) | — | false ⇒ drift; report the span |
| `clockOffsetSec` | \|Δ\| ≤ **60 s** | — | larger ⇒ a CLOCK finding, not a disagreement |

Magnitudes, derived not picked: the two shipped n=1 pins are **0.9977** and **0.99798** — within 0.3 % of
unity — so 0.02 is ~7× the observed deviation and still ~7× tighter than the alarm band.
`excursionFrac` sits ~5 % outside the LoA **by construction** for a consistent pair (the LoA *is*
bias ± 1.96·SD-of-diffs), so 0.10 is twice that structural floor rather than a round number.

⚠️ **A zero-fragment or empty-summary result is a QUESTION before it is a finding** (§Constraints): it
asks whether the requested range holds data at all. It is scored against neither set.

## The spool as an INVENTORY ORACLE — built 2026-08-28 (owner-ratified, pure half)

Every other CPAP surface answers *"what did we get"*. None can answer *"what was there"*, because a
night we never captured leaves nothing behind to count. **The Summary spool can**: the device keeps its
own session list, so it knows a session existed even when we captured nothing.

`capture-host/cpap_inventory.py` reconciles three inventories — **spool** (what the device lists),
**envelopes** (what we captured live), **card** (DATALOG nights) — and returns one record per
discrepancy. Pure: no transport, no async, no BLE, no polling, modelled on `cpap_acq.py`.

### 🔴 PRESENCE IS EVIDENCE; ABSENCE IS EVIDENCE ONLY FROM A SOURCE THAT WAS ACTUALLY CONSULTED

This is the module's spine and it was nearly missed. **Measured by Vigil box, 2026-08-28: the spool is
a once-daily Summary-only transaction**, so fired at therapy end an empty spool result is the
*expected* case on the second and later sessions of a day. A reconciliation reading that emptiness as
*"the device lists no sessions"* would mark every such night `SPOOL-SILENT` — **a manufactured
discrepancy per night, forever, from a source nobody read.**

So each inventory carries a `consulted` flag. An unconsulted source contributes its **presences** and
none of its **absences**; a night whose classification would rest on an unconsulted absence returns
`NOT-DIAGNOSABLE`, naming the unread source.

⚠️ **On the card side I had this BACKWARDS at first, and the correction is instructive.** I wrote
`barren` as `card_consulted=False`. It is **True** — `barren` means the walk RAN and the card
**answered** holding nothing, which is a real absence and therefore evidence. The unread case is the
harvest's two **early exits**: Wi-Fi never came up, or the listing threw, the latter being the exit an
**absent** card takes. I was deriving *"was the instrument pointed at the subject"* from what the
instrument RETURNED — the exact inference this flag exists to forbid, made while building the flag.
The transport now reports `consulted` explicitly, and this module reads it rather than inferring.

### The seven states, enumerated because they have OPPOSITE remedies

| (spool, envelope, card) | state | what to do |
|---|---|---|
| `T F F` | `MISSED-BOTH` | it happened and nothing of ours recorded it |
| `T F T` | `MISSED-LIVE` | data recoverable by harvest; the realtime waveform is not |
| `T T F` | `NOT-ON-CARD` | harvest is behind, or the card rotated it away |
| `F T T` | `SPOOL-SILENT` | our data is fine and our **inventory** is not |
| `F F T` | `UNSPOOLED-CARD-NIGHT` | outside the spool's window — absence proves nothing |
| `F T F` | `ENVELOPE-ONLY` | impugns **our** record: a clock mismatch, or an empty session |
| `T T T` | `COMPLETE` | not a discrepancy, but counted so that zero records is legible |

Folding these into a count would produce a number nobody can act on. *"Missing from somewhere"* is not
an actionable sentence.

### Refusals

**All three empty is `ok: false`, never "no discrepancies"** — the two produce the same empty list and
mean opposite things. The refusal is carried through to the QC field (`discrepancies: null`, not `0`)
and produces **one** journal line, because zero lines is what a healthy night produces.

Unparseable entries are **returned**, never dropped: silently discarding one shrinks an inventory
without saying so, which is how a reconciliation reports an agreement it never had.

### ⚠️ The join key is the NIGHT, and that is a deliberate loss

Only the night is common to all three sources, so a night with two sessions reconciles as one unit and
a session crossing midnight is attributed to its start night. A per-session join needs a device-side
session id that Summary does not expose. This oracle answers *"was this night accounted for"*.

### Not yet wired — deliberately

The call site is **Vigil box's**: a no-op-by-default `on_harvest_complete(result)` hook at
`_cpap_loop`'s terminal `_st(...)`, so either half can land first. ⚠️ **Mutator's original framing —
that the therapy-end trigger fires harvest *and* spool — is wrong**: it fires harvest only, and the
spool has its own site with a config-time refusal when its window overlaps harvest's, because both are
2.4 GHz on one box. Whether the spool should follow therapy-end is **deferred into the §2 BLE
coexistence matrix**; a deliberate coexistence rule moves on that matrix's numbers or not at all. The
consulted-flag design makes the oracle timing-agnostic, so nothing here blocks on that decision.

**23 tests, 100 % statement + branch on the module**, both directions of the consulted asymmetry
planted on identical inputs.

## Constraints (inherited, non-negotiable)
- Read-only RPCs only; no writes to the device, ever.
- No connection held during live streaming; defer and retry.
- Radio by MAC, never by hciN name.
- A refusal (unreachable, mid-therapy, fragment gap) returns a stated reason, never a silent zero —
  and a zero-fragment result is a QUESTION (does the range hold data?) before it is a finding.

## Done when
- [ ] One real spool pulled end-to-end with the fragment log committed as evidence (attended, dated).
- [ ] Assembler witnessed: envelope emitted from real fragments; deviations from fixtures enumerated
      (or "none", stated).
- [ ] Caller shipped behind default-OFF flag; arming line shows it; gates green.
- [ ] §11 three-way convergence measured on ≥1 night and written down — agreement bands pre-stated
      before the comparison runs.
      **Bands PRE-STATED 2026-08-25 (§11 agreement bands, above) — that half is discharged; the
      measurement itself still waits on the attended pull.** The box stays open until a night is measured.
- [ ] Follow-up brief spawned (or "nothing surfaced" noted here) per house pattern.
