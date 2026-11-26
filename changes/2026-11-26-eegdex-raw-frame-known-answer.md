---
bump: patch
type: added
brief: none
---

Hold EEGDex's raw-frame ingest with a committed known answer that carries two clocks.

EEGDex has two ingests and only one of them had a committed input. The EDF road reaches
one clock. The raw-frame road carries a device tick that folds every 2^28 ns and a host
stamp column beside it, so it is the only road that reaches the frame tokeniser, the
14-bit unpack, the tick unwrap, the host axis over the row anchors, and the epoch
placement that spends it. None of that ran on committed bytes in any gate.

`tools/make-synthetic-raw-frames.mjs` writes the input. The signal is a declared sum of
sines plus a seeded LCG, packed into genuine frame bytes through the frame reader's own
unpack, so the packer cannot drift away from the reader. The device axis is deliberately
not uniform: the tick folds on a non-integer tick count and the notification batch size
varies, which is the realistic device axis `clock.js` asks a `deviceDrawn` adopter to
re-cut its fixtures to. The host column carries delivery jitter and the measured rate
offset for this device.

The committed output pins the placement: epoch 1 lands 2 ms off its device-index time.
It pins no rate, because the jitter over a 60 s span is larger than the drift, and it
pins nothing clinical, because the stage model asks for a whole night and this file is
two epochs.
