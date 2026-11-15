---
bump: minor
type: added
brief: MUSE-ATHENA-PROTOCOL-2026-11-14-BRIEF.md
---

The native Muse S Athena recorder now feeds a live EEG card on the monitor. The card shows the four identified electrodes at 256 Hz as raw counts, and each push carries the record's own device time. A Muse remembered from the Devices page now gets `protocol: athena`, so it records through the native recorder and not through the child-tool supervisor. The battery chip already came from the 0x88 record. The `run_muse_athena` docstring now names `_CounterGapSidecar`.

The Muse card on the Devices page now has a preset menu. The menu lists only the 18 presets that the headband accepted in the probe (brief §6.7). Beside the menu, the card shows the preset that the headband confirmed in its `ps` reply, or "unknown" when the headband has not replied. A save writes `preset` to the config and asks for a reconnect, because the recorder sends the preset once at connect. The server refuses a preset outside the accepted set, an unknown address, and a device that is not a Muse on the native recorder.
