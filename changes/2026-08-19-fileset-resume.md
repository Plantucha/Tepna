---
bump: minor
type: added
---

**`CAPTURE-FILESET-RESUME` §2 — the Polar runner now resumes a file-set across a short reconnect instead of
minting a new one.** Measured driver: **2,154 sets across 76 device-nights (28.3×)**, dominated by the
`drop_not_worn` duty cycle (drop 180 s → recheck 90 s → a fresh set per recheck). The recheck cadence sits
inside the default 300 s window, so resume collapses exactly the churn that machinery generates.

**One decision at one chokepoint.** `run_polar` consults `writers.resumable_stamp()` — newest matching set
by **mtime**, not stamp (a set that started hours ago but wrote seconds ago is exactly the one to resume) —
and on a hit adopts the previous stamp, so every `capture_filename()` regenerates identical names and every
writer opens in append mode. A true outage (≥ window) still fragments, deliberately: that fragmentation is
information. `write.resume_window_sec` overrides; 0 disables; `_RESUME_WINDOW_S` follows the
`_DROP_NOT_WORN_SEC` module-constant pattern.

**The invariants from the brief, each a test:**

- **No second header** — a resumed `StreamWriter` appends; the `# timebase` comment and header are written
  once, by the first open. The HR writer's `_RR` sibling appends too.
- **Torn tail healed before append** (§3.5) — a crash mid-write leaves no trailing newline; appending after
  it would fuse two rows. The tail is truncated to the last complete line first. Same treatment in
  `PmdArrivalLogWriter`.
- **No re-anchor** (§3.2) — a resumed ECG file recovers `_first_ns` from its own first data row, so the
  relative `timestamp [ms]` column continues instead of resetting to 0.0 (ECGDex infers fs from that
  column's step; a reset fabricates a step the size of the recording). The scan steps over comments and
  junk rows, and gives up to lazy-init rather than crash.
- **`link_epoch` untouched** — resume changes where samples land, never what the LINK sidecar records.
- **Unhappy paths refuse, never raise** — a file deleted between listdir and getmtime is skipped; a token
  matching the stamp regex but not a real date (month 13) returns None.

**Scoped to the Polar runner** (H10 + Verity = 1,778 of the 2,154 sets). The O2Ring path has its own writer
family and follows separately; the brief stays IN-PROGRESS until its box-measured Done-when (a real Verity
duty-cycle night captured as ~1 set).

Gate: `pytest --cov --cov-branch --cov-fail-under=100`, ruff clean.
