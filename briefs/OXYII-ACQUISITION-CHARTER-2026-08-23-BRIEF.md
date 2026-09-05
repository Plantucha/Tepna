<!--
  OXYII-ACQUISITION-CHARTER-2026-08-23-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — a living CHARTER whose build arms have largely landed: G1 f4f9be0e (#1702) + 60501cec (#1733), G3 45f6354c (#1689), G4 code 8451d3af (#1709) + 8d551fad (#1714). Two things keep it open and neither is code: **G5** (handoff latency, drain occupancy, mid-transfer drop) needs the ring WORN during a live pull; and the **§50 final report** needs the R1-scoped clean-room attestation, which is an OWNER authorization, not an authoring task. ✅ **G4's real-night half is VERIFIED (2026-09-05, Heron, box read-only)** — `OXYLIFE.csv` exists for every one of the **13 nights 2026-08-24 → 09-05**, both axes journalled (link: connecting/connected/live/idle_unworn/interrupted/disconnected/shutting_down; rec: recording/end_candidate/rec_unknown), and the read found the two defects the done-when could not see from the dict: (a) the runner's stall guard re-asserted LIVE on every frame regardless of contact, so an unworn connected ring oscillated `idle_unworn↔live` at the poll rate — **08-28: 17,688 episodes, ~32k rows each way, median dwell 1.0 s** — and (b) `oxy_lifecycle`/`oxy_recording` were written to STATUS and forwarded by NOBODY: webmon's `_remembered()` allowlist omitted both, so `/api/state` on the live daemon carried neither key and "liveness states visible in STATUS" was true of the dict and false of every reader. Both fixed in one PR (the LIVE re-assert now yields to an IDLE_UNWORN hold; both keys forwarded and drawn as chips on the monitor; the flap reproduced through the production loop by a planted test). ✅ **G1's mutation residue is TRIAGED (2026-09-04, #2196)** — and the 28 was stale: a re-run under `--no-reuse` leaves **12**, tests landed since 2026-08-23 having killed 16 (`make_row` 14→1, `append_row` 6→3). `mutate_triage.py` classes them 8 UNOBSERVABLE · 4 REACHABLE, and all four reachable are ONE defect: `encoding="utf-8"` dropped from the ledger's two `open()` calls. On a UTF-8 box the bytes are identical, which is why they outlived 245 kills; the property is only observable with interpreter flags set at startup, so the kill is a subprocess witness under `-X warn_default_encoding`. ⚠ It kills both shapes when invoked directly and mutmut STILL reports them surviving — a subprocess probe is invisible to coverage-directed test selection — so they are recorded `untestable-by-design` in `mutate-equivalence.json` WITH the probe named, per this section's own instruction. Two earlier drafts of that test reported 0 survivors they had not earned (one errored in the scratch tree, one scanned a file containing every variant); both are written up in the test's comment. **Owner:** Heron (arms) / owner (R1 attestation) · **Next step:** G5 — the ring worn during a live stored-session pull, an attended box night (no code until it is measured)) · **Created:** 2026-08-23

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
  **device id + session stamp only** — size and content hash are VERIFICATION fields, never key
  material (they change mid-transfer, so keying on them would make a partial download key differently
  from its own completion; runner-ruled at G2 review, #1681). ⚠️ `reconcile()`'s `repull` verdict is a
  **classification, not an overwrite instruction** — the unknown bytes on disk may be the only copy of
  something, so acting on `repull` goes through `.part` → validate → `os.replace`, never a blind
  overwrite (G2-review rider). States:
  DISCOVERED / PARTIAL / VERIFIED / COMMITTED; a verified file is never overwritten. Reuse the
  `cpap_harvest.EzShare.fetch` shape — it is the in-house reference, already proven.
- **G2 · Inventory ledger** (append-only JSONL beside the night files) — a **STANDALONE module**
  (`oxy_inventory.py` + tests, pure logic, no `capture.py`/`pull_session.py` touch, no hardware
  dependency): what is known, what is verified, which pull attempt succeeded; record states
  DISCOVERED / PARTIAL / VERIFIED / COMMITTED; a pure `reconcile(ledger_rows, disk_listing)` that G3
  consumes. In-flight precedent: the CPAP arm's `cpap_acq.py` (#1679). The **wiring** — `_pull_once`
  reading the ledger first, size-check second, so idempotency survives a renamed/moved file — is
  **G1's**, not G2's.
- **G3 · Restart-safe acquisition state**: on start, reconcile ledger vs disk; an interrupted transfer
  is re-queued or explicitly restarted, never silently trusted. RAM state is derivable, never
  authoritative.
- **G4 · Lifecycle transition journal** (R5's state set) into the existing journal/STATUS surfaces,
  with a reason taxonomy no wider than the transitions need; §25's liveness discrimination
  (CONNECTED_BUT_IDLE vs DISCONNECTED vs NOT_SEEN vs PROTOCOL_STALLED) expressed as states over the
  *existing* watchdog signals; the §16 PI/motion cannot-swap test if absent.
- **G5 · Hardware design-input measurements** (R2) — first, and recorded in this brief's follow-up.

Sequencing: **G2 (standalone, starts immediately — no G5 dependency) ∥ G5-evidence → G1 (wiring;
needs G2 merged + G5's numbers) → G3 → G4.** *(Amended 2026-08-23 — this line originally read
"G5 → G1+G2 (one work-unit) → G3 → G4"; the runner caught the charter contradicting the lead's actual
kickoff order, which had split G2 out to start immediately. The split is the better plan — G2 needs
nothing from hardware — and the charter must describe what is actually being executed.)* **G3 may be
pulled ahead of G1 if G5 stays hardware-blocked** (the ring needs a physical wake): G3's restart
reconciliation consumes only the pure `reconcile()` from G2 and tests against synthetic ledger/disk
pairs — it is the one remaining unit with no device dependency, so the lane never stalls on hardware.
Each PR announced against §6 before touching
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

- [~] G2 merged (standalone module + tests, `check.sh` 100 %, mutation gate drained).
      **MERGED #1681; `check.sh` 100 % (module and lane, statement + branch). The mutation gate is
      NOT drained, and this box says so rather than rounding merged up to verified.**

      ⚠️ **It merged UNVERIFIED, not clean.** Its `mutation (diff-scoped)` check was red because the
      gate CRASHED before reporting — `KeyError: 'key'` on a keyless equivalence entry, tolerated by
      `classify`'s `.get` and fatal in the reporter (fixed #1687). A gate that crashes reports
      nothing at all, so "red" carried no information about survivors either way.

      **Re-run under the fixed gate, 2026-08-23, `mutate.py oxy_inventory --no-reuse`** — `--no-reuse`
      deliberately, because scratch reuse is the unisolated mechanism that reports already-killed
      mutants as surviving (`MUTATION-SUITE-FOLLOWUPS` §3e), and this is the one run that must not be
      subject to it:

      | | |
      |---|---|
      | killed | **245** |
      | survived | **28** |
      | kill rate | **89.7 %** |

      Survivors by function: `make_row` 14 · `append_row` 6 · `classify` 5 · `load_rows` 3.
      Concentrated in `make_row`, which builds a dict — most are field-level edits no assertion reads,
      which is a coverage-shaped gap rather than a logic one, but that is a hypothesis until triaged.

      **Owed, and deliberately not done in the same breath as measuring it:** triage the 28 into
      real-gap / no-distinguishing-input / untestable-by-design, kill the first class, and record the
      rest in `mutate-equivalence.json` WITH PROBES. That is its own work-unit; asserting a
      classification here without running the inputs would be exactly the unevidenced equivalence
      claim that file exists to abolish.
- [ ] G5 measurements recorded (handoff latency, drain occupancy, mid-transfer drop behaviour) —
      assigned to the Vigil box session (hardware at its elbow), evidence lands in the follow-up.
- [ ] G1 merged (the wiring + `.part`→validate→atomic-commit): planted controls green (kill
      mid-download / corrupt byte / re-run downloads nothing already verified), `check.sh` 100 %,
      mutation gate drained.
- [ ] G3 merged: restart reconciliation with its own planted control (kill between download and
      commit → restart re-queues, trusts nothing).
- [x] G4 merged: transitions journaled on a real night (13 nights of `OXYLIFE.csv` on the box, 2026-08-24 → 09-05); liveness states visible in STATUS — and, since 2026-09-05, in `/api/state` and on the monitor, which "in STATUS" had not implied (see the header).
- [ ] Final report per spec §50 with the R1-scoped attestation and `THIRD-PARTY.md` checked.
- [ ] Existing suites untouched-green; no §1 KEEP row rewritten.
- [ ] Follow-up brief spawned (or "nothing surfaced" recorded here).
