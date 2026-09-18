---
bump: minor
type: fixed
brief: GATT-HANDLE-MAP-2026-09-17-BRIEF.md
---

The GATT table recorder now runs on the WEARABLE rails, not only on CPAP. Measured by Wren on vigil
2026-09-18: `_gatt_record_table` had exactly one caller, inside `_cpap_ble_connect`, and the wearable
connect paths held zero gattmap references — so the map's silence on H10 / Verity / O2Ring was a fact
about the wiring, not the devices, and a worn night would have produced the same silence (proven live:
Verity worn twice, `gattmap.json` unchanged, no record line). Wired into `run_polar`, `run_viatom` and
`run_oxyii` AFTER a successful `start_notify` rather than at connect, because that is where the tree is
proven usable and because the partial-snapshot race is ~365x rarer on these rails than on CPAP
(six-week journal: CPAP 1092 `CharacteristicNotFound`, H10 3, Verity 0) — recording at connect would
write a short table ~monthly per Polar and then report "changed" on a device that never changed. The
Verity charger question is left to `record()` to measure rather than decided by a rule: `source` is not
keyed on the contact bit, which lies. Reachability is gated by an AST test over each rail's body, so a
rail added later without a record call reds.
