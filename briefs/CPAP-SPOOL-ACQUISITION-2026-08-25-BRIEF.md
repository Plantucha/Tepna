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
3. **The caller** — a scheduled post-therapy pull (morning window, never during live streams; reuse
   the shadow supervisor's defer rule). **Behind its own config flag, default OFF, never inherited**
   (the `pull.on_close` pattern verbatim). The arming line prints its state.
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
5. **Evidence contract:** the pull's provenance lands as an acquisition-evidence envelope
   (duration_check fields per the locked contract shape), and the raw fragment log is kept as the
   primary artifact (INV9: raw first, derived carries provenance).

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
- [ ] Follow-up brief spawned (or "nothing surfaced" noted here) per house pattern.
