---
bump: patch
type: added
brief: VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05-BRIEF.md
---

**The air is now a monitored surface: `tepna-sniff.timer` captures a bounded window every night and
`ble_sniff.py` audits it (VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT D3).**

The box owns an nRF Sniffer that nothing scheduled. D1's *"no foreign initiator has connected to our
devices"* was measured once, by hand, over 126 minutes of one night — a single sample presented as a
property of the box. This turns it into a standing check: a 10-minute all-advertising capture into
`/srv/tepna/captures/sniffer/` at 03:00 ±10 min, judged on the spot and reported as one line to
`journalctl -t tepna-sniff`, with the full report beside the pcap.

**It asks the two questions the box cannot answer about itself.** (1) *Did the capture cover the
window?* — `ble_sniff.audit` compares the packet span against the requested seconds (≥ 0.8, which
accommodates the firmware handshake and the SIGINT teardown); this is exactly the F2 shape, where a
capture died 2 h into a 7.4 h night and the file's mtime still spanned the night. (2) *Did anyone
else connect to us?* — a CONNECT_IND whose advertiser is one of **our** configured devices and whose
initiator is not one of **our** adapters. A stranger connecting to a neighbour's device is the
neighbour's business and is not reported.

⚠️ **The verdict reads the bytes, never an exit code, and that is the load-bearing decision.**
Measured against the real extcap on vigil: Nordic's `nrf_sniffer_ble.py` exits **0** on a
`LockedException` (something else holds the serial port), having written a 24-byte header-only pcap;
`timeout` exits **124** on the *normal* end of a capture. Either number, believed, reports a clean
night for a capture that never happened. Both are logged for the operator and neither reaches the
audit — the locked-port shape is a gate test, and it fails.

**"Could not attribute" reads as a finding.** The adapter list comes from `bluetoothctl list`; when
it comes back empty — bluetoothd down, or `bluetoothctl` not installed — every connect to our devices
is reported foreign rather than quietly attributed. Both arms are tested, the absent-binary one
through a sealed PATH, because a stub that answers nothing exercises a different branch from a binary
that is not there.

A failed audit exits **3**, so the oneshot lands in `systemctl --failed` rather than logging a
failure nobody reads. The unit runs `Nice=19`: the extcap's capture loop is a literal `while True:
pass` and must yield to `tepna-capture` for the whole window.

**Inert until deployed** — the timer exists on vigil only after the owner runs the deploy; nothing
here touches the box. capture-host only: no bundle, no provenance, no suite surface.
