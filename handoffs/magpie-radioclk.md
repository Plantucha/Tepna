<!-- SPDX-License-Identifier: Apache-2.0 -->
# radioclk — RADIO-CLOCK-SIDECAR §4, the sidecar consumer

**state:** DONE
**unit:** Build the DSP reader for the radio-clock sidecar, measure the anchor-vs-ACL spread, and stamp the brief.
**bird:** magpie
**branch:** claude/radioclk-mg
**worktree:** ../wt-radioclk-mg
**doc-search:** radio clock sidecar consumer reader timingSource radio band controller anchor
**stopping-point:** `radio-clock.js:1` built and gated; PR open as a draft.
**next-step:** Read §4.1 of the brief for the measured bands before touching any node ingest.
**done-when:** `radio-clock.js` mints `timingSource:'radio'` only inside the brief's band table, and the brief header carries the measured spread.

## What the measurement said

Six deployed sidecars, 938 176 rows, 142 device streams: 0 radio · 4 jitter-aid · 138 rejected. The
best stream is the H10 accelerometer at 12.43 ms, so the under-2 ms tier is reachable in code and
unreached on this corpus. The O2Ring's p95 anchor step reads 500.0 and 487.5 ms, not the 300 ms the
order expected. §5 (b) and (c) hold: `anchor_us` is monotonic in all rows and `acl_rx_ns` is present in
all rows, while `vs_rx_ns` is blank in every one.

## Open questions

- The negotiated connection interval still needs a box-side `btmon` read. The collector logs only
  data-carrying events, so the delta grid (30 / 40 / 50 / 20 ms) is a floor, not the negotiated value.
- `DEVICE-TIME-HANDLING-2026-10-29` U6 is Wren's and asks for this spread measured ON THE BOX. This
  unit measured it on sidecars pulled to the rig, so U6 keeps its NOT_RUN stamp.
- Four residue rows are open from this unit. The node ingest, the Integrator's `timed` vocabulary and
  the committed twin fixtures each move a DSP and own their own unit.
