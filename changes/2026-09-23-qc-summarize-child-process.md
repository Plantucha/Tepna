---
bump: patch
type: fixed
brief: none
---

capture-host: the night-QC scan runs in a spawned child process, not a thread — nightqc.summarize is 51 s of pure-Python CPU per poll by dawn and shared the interpreter lock with every capture task, stalling the event loop 1.1–4.8 s at every 10-minute poll (24 warnings a night on vigil, every live stream's host stamps gapping in lockstep, the monitor's fragments column rising for three nodes at once); a worker that dies drops the pool for rebuild and the error still propagates, and STATUS.qc_isolation names the path taken.
