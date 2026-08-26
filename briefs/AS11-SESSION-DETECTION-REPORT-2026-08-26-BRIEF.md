<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living — last-verified 2026-08-26) · **Created:** 2026-08-26 · **Follows:** `AS11-SESSION-DETECTION-PROTOCOL-INVESTIGATION-2026-08-24-BRIEF.md` · **Supersedes:** `AS11-SESSION-DETECTION-PROTOCOL-INVESTIGATION-2026-08-24-BRIEF.md`

# AS11 session detection — the §19 report, written AFTER the implementation it was meant to gate

## 0 · What this document is, and the thing it must say first

The charter (`AS11-SESSION-DETECTION-PROTOCOL-INVESTIGATION` §16/§19) required **a 17-part report and
ONE named architecture BEFORE implementation**. That report was never written. The implementation
(`cpap_supervisor.py`, `cpap_detect.py`, `as11_pull.get_items`) shipped and has been running in shadow
mode since 2026-08-25.

**So this report is written after the fact, and it does not pretend otherwise.** Its value is no longer
to *choose* an architecture — one is already running — but to state **which decisions were evidenced
and which were not**, so the difference is visible instead of implied by the existence of working code.

🔴 **Two consequences of the sequence break, both found by writing this rather than by review:**

1. **The charter's load-bearing directive was "SubscribeEvent-first". The shipped detector does not use
   `SubscribeEvent` at all** — `grep -rc SubscribeEvent capture-host/*.py` returns **nothing, anywhere**.
   It **polls** `Get` on a cycle (`cpap_detect.run_cycle`, "drives one poll cycle: read the device
   (injected), classify, journal the decision"). Polling may well be the right choice — but the charter
   named the alternative first, the report that was supposed to justify departing from it did not exist,
   and so **the departure was never argued, only enacted.**
2. **Phase B never ran.** §3 (SubscribeEvent test + latency), §3b (Get candidate table over a real
   session), §7 (spool retrieval), §8 (connection-cost measurement), §10 (minimum-safe debounce from
   several natural mask-offs) all require hardware. **None of their measurements exist.** Parts of the
   17 that depend on them are marked **UNMEASURED** below and are *not* filled with plausible prose —
   inventing them is precisely the fabricated authority this suite forbids.

## 1 · The 17 parts, with an honest evidence class on each

`MEASURED` = observed on hardware · `ESTABLISHED` = read from shipped code or protocol docs ·
`UNMEASURED` = required by the charter, never performed.

| # | part | class | state |
|---|---|---|---|
| 1 | current architecture | ESTABLISHED | supervisor above controller, as §17 requires — see §2 |
| 2 | #1736 findings | ESTABLISHED | carried in the investigation brief's "Standing evidence" |
| 3 | AS11 capabilities | ESTABLISHED | protocol reference brief; **method table only, not exercised** |
| 4 | SubscribeEvent findings | 🔴 **UNMEASURED** | never subscribed; no event log, no latency |
| 5 | Get/DataItem findings | PARTIAL | the fields the detector reads are proven in production; **no candidate table** |
| 6 | AirCANnect behavioural findings | UNMEASURED | clean-room study not performed |
| 7 | AS11 EDF findings | MEASURED | live BRP EDF, 8.7 h, 521×60 s records |
| 8 | stored-data findings | PARTIAL | Summary spool works; **detail/waveform spool type UNKNOWN** |
| 9 | time findings | MEASURED | −21.26 min offset confirmed; **RATE still open** |
| 10 | connection-cost measurements | 🔴 **UNMEASURED** | no per-connect cost figure exists |
| 11 | candidate-architecture comparison | 🔴 **NOT PERFORMED** | one architecture was built, none compared |
| 12 | evidence classification | — | this table |
| 13 | selected architecture | ESTABLISHED | §2 — describes what runs, not what was chosen on evidence |
| 14 | exact state machine | ESTABLISHED | `cpap_supervisor` transitions; UNKNOWN≠stopped honoured |
| 15 | implementation plan | SUPERSEDED | already implemented |
| 16 | 20-case test plan | PARTIAL | unit-tested against fakes; the hardware cases are Phase B |
| 17 | remaining unknowns | — | §3 |

## 2 · The architecture that is actually running

**Poll-based, supervisor-owned, read-only.**

- `CPAPSessionSupervisor` sits **above** `LiveStreamController` and owns
  discovery/connect/observe/start/stop/reconnect — the controller keeps live-stream/drain/raw/EDF/
  finalize. **§17's "no competing lifecycle owners" is satisfied.**
- Detection is a **poll cycle**: connect → `get_items` → `extract_fields` → classify → journal
  transitions. Clock and BLE adapter are injected, so the cycle is unit-testable without hardware.
- **`UNREACHABLE` is NOT therapy-stopped** — an unreadable `Get` leaves an ACTIVE session ACTIVE. This
  honours the charter's `UNKNOWN ≠ stopped` and is the single most important safety property: the
  opposite default silently truncates a live recording.
- **Read-only**: no `Set`, no `Enter*`, no `SetDateTime` anywhere in the new code.

⚠️ **The detector is structurally BLIND during streaming.** The AS11 accepts one connection, so the
supervisor defers for the whole session. Measured 2026-08-26: `SESSIONDETECT.csv` = **125 rows, last
written 22:49:35** (a daemon restart) and **did not grow across an 8.7 h capture.** This is architecture,
not a bug — and it is why the implementation brief's *"one shadow night captured and reviewed"* was
unachievable and has been rewritten to score **session boundaries** instead.

## 3 · Remaining unknowns — the honest list

1. **Is polling right?** Unargued. `SubscribeEvent` (0x3a, application-layer, reachable over BLE per the
   protocol reference) was never tried. Polling costs a connect per cycle on a single-connection device;
   subscription might cost less or might not work at all. **Nobody has measured either.**
2. **Connection cost** — no figure. §8 unperformed.
3. **Debounce** — the shipped value is not derived from observed mask-offs (§10 unperformed).
4. **Detail/waveform spool** — the protocol reference's *"summary/detail spools"* is prose in a Use
   column, not an enumeration. Only `"Summary"` has ever been requested. A single failed name-guess
   would NOT prove absence.
5. **Clock RATE** (fixed vs ppm) — needs one long run; may close from the DC trip, since a hotel night is
   still a long run and rate does not care about geography.

## Done when

- [ ] §4/§10 measured, or the poll-vs-subscribe choice argued explicitly on cost grounds and this report
      updated to say which.
- [ ] §8 connection cost measured on the box.
- [ ] §11 written as a real comparison, or formally waived by the owner with the waiver recorded here —
      a comparison that never happened must not read as one that concluded.
- [ ] The 20-case hardware half of §16 executed.
