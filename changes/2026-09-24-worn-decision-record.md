---
bump: patch
type: added
brief: none
---

**Which vote held "worn" was persisted nowhere.** `worn_verdict` returns `(verdict, why)` and `why` names
the detectors that voted, but it reaches only live STATUS — a snapshot the next write erases. So the state
the drop logic acted on cannot be read back: the **27.5 min of not-worn on 2026-09-23** and the **102 min
on 2026-09-22** are decisions no artifact records. Until that is persisted there is nothing for a validity
band or an offline detector to be compared *against*, and no basis on which the vote could ever
responsibly be changed.

`WORN.csv` is a per-night sidecar beside `LINK.csv`, the same evidence channel as `CLOCKSYNC.csv`, one row
per decision: `Phone timestamp;device;address;worn;why;trigger;votes`.

**It records; it does not decide.** `worn` and `why` are exactly what `worn_verdict` returned, and `votes`
is **the same mapping passed into it** — one dict, used for the decision and for the record, so the two
cannot drift because the record is not a second evaluation. Nothing feeds back into the votes or into
`should_drop_not_worn`, which reads `_WORN_SINCE` exactly as before.

`trigger` is `change` or `cadence`. A change row is the event; a cadence row is the proof the state was
still being **observed** between events — without it, a verdict that legitimately held for four hours and
a daemon that stopped evaluating produce the same file. A change is keyed on `why` as well as the verdict,
because a device going from `worn per contact, hr-beats` to `worn per hr-beats` has **lost a detector
while the published boolean never moves**, and that is exactly the fact this record exists to keep.

**Write cost, measured rather than estimated:** at a 60 s cadence an 8 h device-night is **58 KB**
(480 rows), **175 KB** for three devices, **65 MB** a year — against the gigabytes of samples beside it. A
10 s cadence would be 1.8 MB a night and buy nothing: the quantity is a verdict that changes a handful of
times a night, and the cadence rows exist to prove it was watched, not to sample it. A test asserts the
bound rather than the comment claiming it.

§∅ throughout: an **abstention is a blank cell, never `0`** (`worn_verdict` returns None when no detector
was available or in domain, which is not the claim "not worn"); a `None` vote renders `k=` and never
`k=False`; and a sequence vote renders `k=nN` rather than its contents, because the optical vote is handed
a PPG window and the record is of the decision, not of the signal under it.

⚠️ **`record_worn_decision` is at MODULE level and that is not a style choice.** Inside `run_polar` the
name `writers` is a local dict of open StreamWriters that **shadows the module of the same name**, so a
`writers.append_*` call written there raises `'dict' object has no attribute …`, is swallowed by the
notification handler's own `except Exception`, and takes the rest of that callback with it. Measured while
building this: the PPI file stopped being written entirely and the only symptom was a single `link error`
line. Caught by `test_run_polar_writer_contract.py::test_PPI_and_HR_carry_NO_device_clock_column`, which
is an existing integration test — no new test duplicates it.

The plant is Kestrel's: a motionless strap whose contact bit reads not-worn while `hr-beats` holds it
worn — the real verdict is `(True, "worn per hr-beats")` — and the row carries both the holding vote and
the losing one, so an ACC-derived rule can tell *why* it disagrees rather than only *that* it does.
