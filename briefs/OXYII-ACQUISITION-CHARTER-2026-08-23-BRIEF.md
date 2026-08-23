<!--
  OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-23 · **Created:** 2026-08-23 · **Follows:** `VIGIL-O2RING-AUTOPULL-2026-07-21-BRIEF.md` (the idempotent pull this hardens), `OXYII-PROTOCOL-HARVEST-2026-08-08-BRIEF.md` (protocol capability + lineage), `VIGIL-BLE-ROBUSTNESS-2026-07-19-BRIEF.md` (+FOLLOWUPS — reconnect/watchdog groundwork) · **Sibling:** `CPAP-ACQUISITION-HARDENING-AUDIT-2026-08-23-BRIEF.md` (the CPAP arm, same owner spec family, same lead) · **Affects (charter only — no code in this brief):** `capture-host/oxyii.py`, `capture-host/pull_session.py`, `capture-host/capture.py` (run_oxyii region), `capture-host/viatom.py`, tests

# OxyII acquisition hardening — the lead's charter for the runner

> **Roles (owner-declared 2026-08-23).** The owner handed a 50-section "next-generation OxyII
> acquisition subsystem" spec to an independent **runner** session, which codes from that spec. This
> session (**the acquisition-hardening lead**, codename *Mutator*) supervises: this charter is the
> spec's PHASE-0 audit plus the **binding rulings** the runner's work must satisfy. Where this charter
> and the spec text conflict, **this charter wins** — each ruling below records why. The sibling CPAP
> effort runs in parallel under the same lead; §6 is the shared-seam boundary both arms follow.

## 0 · One-paragraph verdict

The spec reads as greenfield; the tree is not. Roughly **60 % of the spec's requirements are already
built and field-hardened** across `oxyii.py` / `pull_session.py` / `capture.py` and a year of
VIGIL-* briefs — including several the spec presents as novel (bounded frame reassembly, idempotent
pull, backoff-on-data reconnection, per-stream stall watchdogs, RTC read-verify discipline, raw-PPG
preservation with neutral channel naming). The genuine gaps are concentrated in one band: **durable
recording identity + transactional atomic download + restart-safe acquisition state + an explicit
lifecycle journal** (§4, G1–G4). The runner's job is that band, plus planted-control tests — not a
rewrite. The spec's own §1 ("do not rewrite working code") and §44/§45 are the clauses to hold it to.

## 1 · PHASE-0 audit — spec section → tree (KEEP / EXTEND / MISSING)

Verified this session by reading source (`oxyii.py`, `pull_session.py` headers + bodies; `capture.py`
grep context) and the DONE briefs named; items marked *(comment-derived)* rest on in-source comments
rather than a full read and the runner re-verifies them in its own Phase 0.

| Spec § | State in tree | Verdict |
|---|---|---|
| §2 L1–L3 transport/GATT/protocol | `oxyii.py` is an isolated protocol layer (frame codec, CRC-8, XOR auth, parsers); bleak is the transport; `pull_session.py` owns the GATT flow. `run_oxyii` mixes some transport with orchestration | **KEEP** protocol layer; **EXTEND** orchestrator separation only where a gap (§4) forces it |
| §3 state machine + transition journal | States are implicit in `run_oxyii`; no transition record | **MISSING** → G4 |
| §5/§27 restart-safe state | Night files + journals exist; acquisition state (what was synced/verified) is RAM-only | **MISSING** → G3 |
| §6 reconnection | Built and field-tuned: backoff resets only when DATA flows (VIGIL-RECONNECT-BACKOFF), every BLE await bounded, `_bounded_setup`, connect lock, adapter false-wedge fix | **KEEP — do not redesign** |
| §8 recording identity | Identity today = filename timestamp + device-reported size (`_pull_once` skip) | **EXTEND** → G1 (add content hash + trailer finalisation; spec is right that a timestamp alone is weak) |
| §9 idempotent sync | `autopull_poller` (opt-in, off-finger only, FIFO-draining, bounded connect) + size-keyed skip — DONE 2026-07-21 | **EXTEND**, not rebuild → G1 |
| §10/§11 transactional download, atomic commit | `.dat` is written directly; no `.part`→validate→atomic-rename, no PARTIAL/FAILED states, no inventory ledger | **MISSING** → G1/G2. The sibling CPAP WiFi path (`cpap_harvest.EzShare.fetch`) is the in-house reference pattern |
| §12 live ≠ stored | Two distinct paths already (`run_oxyii` live vs `pull_session` stored) | **KEEP** |
| §13/§14 raw PPG first-class, neutral channels | Live ~125 Hz pleth written as neutral `ppg1`, back-timed from host arrival, gap detection, per-unit `ppg_fs` override *(comment-derived)* | **KEEP** |
| §15 duration-not-sequence | Established fact (`o2ring-duration-is-quantized`); never used as a sequence number | **KEEP** — cite, don't re-derive |
| §16 PI/motion separation | Interpretations separate; a dedicated cannot-swap regression test not confirmed | **EXTEND** — one cheap test in G4's PR if absent |
| §17/§43 frame assembly, bounded allocation | `Reassembler` + `MAX_FRAME_LEN = 2048` (deliberately-loose bound, documented), resync, CRC | **KEEP** |
| §18/§19 backpressure, memory bounds | Writers + queues exist; boundedness not re-verified this audit | runner **VERIFIES** in Phase 0, builds only if a gap is demonstrated |
| §20–§23 clock domains, discipline, offset history, arrival time | Clock Contract + `hostAxis`/`stackJitterMs` + ring RTC read-verify (`oxyii_rtc_due`, offset published to STATUS) + ring clock sidecar (#1564, RTC history + battery-reset alarm) + `quality.timingSource` | **KEEP — fully built.** §22's "preserve measurement history" is the sidecar; do not add a second home |
| §24/§25 health, liveness discrimination | `telemetry.py`/`webmon.py`/`nightqc.py`/`link_guard.py`/`link_rssi.py`; per-stream stall watchdog (bytes-reaching-file, unworn-ring exemption) | **KEEP**; G4 adds lifecycle states to the existing surfaces |
| §26 graceful shutdown | SIGTERM path fixed + verified live at 2 s (VIGIL-BLE-ROBUSTNESS-FOLLOWUPS §1) | **KEEP** |
| §28 SQLite | Not present | **DECLINED** — R3 |
| §29 multi-device | Per-device isolation exists in the daemon's own idiom | **DECLINED** as a framework — R5 |
| §30 event bus | Ganglior is the *browser-side* bus; the daemon's journals/STATUS are the acquisition event surface | R4 — do not wire Ganglior into Python |
| §32 retry policy | Centralized-enough: backoff-on-data + bounded awaits + give-up-and-report (`clock_uncorrectable` pattern) | **KEEP**; classify failures where G4's journal needs a reason field, no new policy engine |
| §39–§42 tests, perf | `check.sh` (ruff · shellcheck · pytest 100 % branch) + diff-scoped mutation gate are the gates | R7 — map onto these, no parallel harness |
| §41 hardware plan | Deferred to Phase 8 by the spec | **REORDERED** — R2 pulls link-arbitration measurement forward |

## 2 · The two facts the spec was written without

**F1 · The ring holds ONE BLE link, and live capture vs stored sync already arbitrate it.**
`capture.py` has a handoff event (`_OXYII_PAUSE` region, ~line 304): `pull_oxyii_session` takes the
ring from `run_oxyii` and returns it. `autopull_poller` additionally refuses to pull while the ring is
worn. Any lifecycle model that doesn't represent this handoff as a first-class state is wrong on
arrival — and the spec never mentions it. Add the field constraints: the UB500 adapter goes deaf
(power-cycle recovery exists), reconnect storms reached 178/night before backoff tuning, FILE_LIST
measured at 4.14 s, and a bad night ran −85 dBm with 70 % live coverage — which is *why* autopull
exists as the belt-and-suspenders.

**F2 · The protocol layer has deliberate, documented external lineage.** `oxyii.py`'s header cites
`github.com/nglessner/o2ring-s-protocol` as its reverse-engineered reference ("a faithful port of the
vendor code" for auth), and `OXYII-PROTOCOL-HARVEST-2026-08-08` (DONE) *is* an owner-ratified harvest
of that upstream, byte-proven, with a reverse contribution owed back. The spec's clean-room clause
contradicts the repo's own recorded practice.

## 3 · Binding rulings (where the charter overrides the spec)

- **R1 · Clean-room attestation is SCOPED, never blanket.** The §50K attestation may cover only code
  newly written under this work. The protocol core is grandfathered with its recorded attribution
  (F2); the final report states the lineage plainly and checks `THIRD-PARTY.md` covers the upstream's
  license. A blanket attestation would be a false claim — the exact class this repo's provenance
  discipline abolishes. (Same ruling as the CPAP arm's §3.)
- **R2 · Hardware constraints come first, not Phase 8.** Before the transaction chain's design
  freezes, the runner measures on the real ring: handoff latency (live→pull→live), pull throughput and
  worst-case link occupancy for a full-flash drain, and behaviour when the link drops mid-transfer
  (what the device reports on resume). One recorded evening, not a campaign. §41's full matrix stays
  at the end as validation; the *design inputs* move to the front.
- **R3 · No SQLite.** The inventory ledger and state journal are append-only JSONL in the daemon's
  existing idiom — the surfaces `nightqc`/provenance already read, legible after partial writes, no
  new corruption/backup surface on an unattended box. The spec permits this ("simplest persistent
  mechanism"); take the permission. Corollary (§6): no shared schema with the CPAP arm.
- **R4 · "Event bus" means the daemon's journals/STATUS.** Ganglior is browser-side; Dex integration
  stays at the export boundary. No new bus, no Ganglior-in-Python.
- **R5 · No global scheduler, no multi-device framework, no 16-state machine as-specified.** The
  lifecycle model is derived from what `run_oxyii` + the handoff + autopull *actually do* (connect /
  auth+setup / live / interrupted / paused-for-pull / pulling / idle-unworn …), each transition
  journaled with prev/new/reason/monotonic/wall/device. Spec states with no tree counterpart are
  dropped, not stubbed.
- **R6 · KEEP files are fenced.** A runner PR that rewrites anything §1 marks KEEP is rejected in
  review unless it demonstrates a defect first (test or field evidence). "Cleaner" is not a defect —
  spec §1's own words.
- **R7 · DoD items are planted-control-verified.** Every "impossible/never" claim in the spec's §48/§49
  ships with a control that must fire: kill −9 mid-download → no trusted file + ledger shows PARTIAL;
  corrupt one byte → validation refuses commit; duplicate-callback injection → detected. A checkbox
  without its control is not done (house standard: a passing gate you've never seen fail is not
  evidence). Gates: `capture-host/check.sh` (100 % branch) + the diff-scoped mutation gate; no
  parallel chaos framework.

## 4 · The build (what the runner actually codes) — one PR per work-unit

- **G1 · Transactional stored-recording sync** (spec §8–§11, the core). Extend `pull_session` +
  `autopull_poller`: download to `.part` → validate (device-reported size + `parse_oxy_trailer`
  finalisation sub-magic + parseability) → atomic `os.replace` → ledger record. Recording identity =
  device id + session stamp + size + content hash (the trailer's own stats as a cross-check). States:
  DISCOVERED / PARTIAL / VERIFIED / COMMITTED; a verified file is never overwritten. Reuse the
  `cpap_harvest.EzShare.fetch` shape — it is the in-house reference, already proven.
- **G2 · Inventory ledger** (append-only JSONL beside the night files): what is known, what is
  verified, which pull attempt succeeded. `_pull_once`'s skip logic reads the ledger first, size-check
  second — idempotency survives a renamed/moved file.
- **G3 · Restart-safe acquisition state**: on start, reconcile ledger vs disk; an interrupted transfer
  is re-queued or explicitly restarted, never silently trusted. RAM state is derivable, never
  authoritative.
- **G4 · Lifecycle transition journal** (R5's state set) into the existing journal/STATUS surfaces,
  with a reason taxonomy no wider than the transitions need; §25's liveness discrimination
  (CONNECTED_BUT_IDLE vs DISCONNECTED vs NOT_SEEN vs PROTOCOL_STALLED) expressed as states over the
  *existing* watchdog signals; the §16 PI/motion cannot-swap test if absent.
- **G5 · Hardware design-input measurements** (R2) — first, and recorded in this brief's follow-up.

Sequencing: **G5 → G1+G2 (one work-unit) → G3 → G4.** Each PR announced against §6 before touching
`capture.py`/`writers.py`; `check.sh` green + mutation-gate drained before review; the lead reviews
every PR before merge.

## 5 · Explicitly out of scope (the runner does not build these)

SQLite (R3) · a scheduler or device framework (R5) · Ganglior integration (R4) · rewrites of §1 KEEP
rows (R6) · new detector/DSP work (separate briefs own it) · SET_CONFIG-class device writes beyond the
existing whitelist (`OXYII-PROTOCOL-HARVEST` deliberately excluded them; unchanged) · anything in
`viatom.py` beyond keeping its tests green (legacy path, no hardening investment).

## 6 · Shared-seam boundary with the CPAP arm (agreed with tepna-99, 2026-08-23; PR #1674)

1. **BUS additive only** — lifecycle events go to journals/STATUS, no new BUS semantics either side.
2. **No global scheduler this round** — each arm isolates behind its existing seam (O2Ring: the
   `_OXYII_PAUSE` handoff + autopull gating; CPAP: `cpap_stream.gate()`), leaving a future unifier two
   matching shapes.
3. **No shared persistence schema** — both arms use device-private append-only JSONL; no shared
   DEVICE/CLOCK_MEASUREMENT tables anywhere.
4. **Announce-before-touch** on `capture.py` / `writers.py` / `telemetry.py` / `nightqc.py`; the
   second mover rebases (`tests/` conflicts: restore and re-insert, CLAUDE.md §👥.2c).

## Done when

- [ ] G5 measurements recorded (handoff latency, drain occupancy, mid-transfer drop behaviour).
- [ ] G1+G2 merged: planted controls green (kill mid-download / corrupt byte / re-run downloads
      nothing already verified), `check.sh` 100 %, mutation gate drained.
- [ ] G3 merged: restart reconciliation with its own planted control (kill between download and
      commit → restart re-queues, trusts nothing).
- [ ] G4 merged: transitions journaled on a real night; liveness states visible in STATUS.
- [ ] Final report per spec §50 with the R1-scoped attestation and `THIRD-PARTY.md` checked.
- [ ] Existing suites untouched-green; no §1 KEEP row rewritten.
- [ ] Follow-up brief spawned (or "nothing surfaced" recorded here).
