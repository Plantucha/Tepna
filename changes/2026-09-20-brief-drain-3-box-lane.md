<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: O2RING-POWER-AWARE-BLE-LIFECYCLE-2026-09-05-BRIEF.md
---
Brief drain, round 3, box lane — four briefs re-triaged on the box's own record (2026-09-20, Wren),
each header stamped with what was measured, not what was assumed. Three outcomes kept apart: BUILT ·
owner-blocked · not checkable from code.

- `O2RING-POWER-AWARE-BLE-LIFECYCLE`: the engine has run 15 unattended nights (`OXYLIFE.csv`
  `axis=power`, 37–259 rows/night): `illegal_skipped` 0 on 15/15, harvests 1–5/night on 13/15, typed
  backoff, no connect-fail loop. **§3's passive scan has never run on vigil** — bleak refuses
  `scanning_mode="passive"` without `or_patterns`, 174 downgrades to active since 09-05 — so the
  radio-duty saving the brief was designed around is not being taken and §4's `btmon` measurement is
  unreachable → residue `2026-09-20-o2ring-passive-scan-needs-or-patterns` (a code change: supply an
  `or_patterns` list; one attended night to confirm the ring is still sighted). Live counters are
  per-process (reset at daemon restart): §22's budget must be read from the journal, not `/state`.
- `DEVICE-RATE-TRUTH`: the "field" remainder is mostly done — the `RtPpg` (`ppg2w`, cmd 0x05) night
  happened on the brief's own day and every night since (530 files; 194.96 Hz over 7.20 h last night,
  host-stamped, no device clock in that stream); MAG + GYRO off since 09-04. Two §5 rows the box
  decided the other way: Verity PPG **55 Hz** (not 176), H10 ACC **200 Hz** (not 50) — the owner's
  later config, stated so the table is not read as current. The H10 recorded 67 min and died at 10 %.
- `KNOWN-CLOCK-ADVERSARIAL-CAPTURE`: no campaign night recorded 09-02 → 09-20 (no frame marks on the
  box; the only pre-registration in the window is a different experiment). Still owner-scheduled; a
  perturbed night needs a charged H10 and someone wearing the kit — 09-18 nothing was worn.
- `SPORT-CAPTURE-ANDROID`: unchanged — no greenlight, no toolchain, no tree, no commit.
