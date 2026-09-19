---
bump: patch
type: changed
brief: none
---

Capture-host brief drain: three absence claims were false, and **two of the three were false when they
were written** rather than gone stale since.

Docs-only. Ten briefs; **three stamped, three checked-clean, four handed back unconcluded** rather than
guessed at.

## The three stamps

**BLE-SNIFFER-DUTY-CYCLE — wrong when written, and the remaining box is far smaller than stated.** Its
header said `tepna-sniff.service`/`.timer` are *"NOT in the tree — confirmed absent"*, dated 2026-09-11.
Both landed **2026-09-06 in #2273** at `capture-host/systemd/` — five days *earlier*. Likely a check at
the flat `capture-host/` path. They are also **installed on vigil** (2026-09-12 14:37, no `timers.target.wants` link).

⚠️ **My first remedy was wrong and is corrected in this PR.** I read that as *"installed but disabled,
so the action is an enable — minutes, not a build"*. **There is no sniffer radio.** Both dongles now
report `Zephyr HCI UART anchor np`; the RADIO-CLOCK-SIDECAR flash of 09-07 took them, and the newest
capture is `nightly-20260909-0701.pcap`, **2026-09-09 03:11**. Enabling the timer would schedule a unit
against no hardware — worse than leaving it disabled, because it would run, produce nothing, and read as
a working capability.

So the open item is an **owner decision, not a task**: re-flash one dongle to sniffer firmware (losing
an anchor), or retire the capability. Owner-authorized either way.

**The tree said *installed*; only the box said *and inert*.** Wren reached the hardware fact
independently from the box while I had it from the repo, and the second surface **inverted the remedy**
rather than confirming it. Checking one of two independent surfaces is how a plausible wrong fix gets
into a durable artifact.

**PYTHON-TYPES-AND-FORMAT — a count 61 above the truth for sixteen days.** `Live count: 102` (measured
2026-09-03) against `MYPY_BASELINE=41` today, confirmed by three independent gate runs. Moved by #2244,
#2452, #2606, #2612, #2631. *A count in a done-when is a measurement with no expiry date unless it is
re-taken.*

**CAPTURE-HOST-FOLLOWUPS-II — the hardware gate was already discharged.** V1/V2 said they *need* a
Verity `_GYRO`/`_MAG` and an H10 `_ACC` export. All three exist in the corpus — Verity `_GYRO` ×2,
`_MAGN` ×3, H10 `_ACC` ×1 — dated **June 2026**, before the brief was created (07-16) and before it was
parked (09-02). V1/V2 are repo work now, not "phone + hardware, off the box".

## 🔴 Two method findings, each of which produces a FALSE CLEAN

**1 · A corpus-absence check run in a worktree is false by construction.** `uploads/` is gitignored, so
the mandated per-task worktree (§👥.1) cannot contain it. My first V1/V2 check found nothing and I was
about to record "verified correct" — a **wrong closure** on a true finding. The worktree held 517 files;
the primary checkout holds the corpus and answered immediately. **Corpus checks must run against the
primary checkout or `$DEX_UPLOADS`** (`docs/CORPUS-LOCATIONS.md`). This is fleet-wide: every session is
told to work in a worktree, and the check silently cannot see its subject there.

**2 · A git-log drain cannot see a file added outside the brief's path list.** For BLE-SNIFFER, a log
over its own named surface returns **0** while the header is false — because the landed files were not
in that list and *could not have been*; they did not exist when the brief was written. **An absence
claim about a file must be tested by existence**, and where it concerns box state, by reading the box.

Together with the empty-path-list hazard Osprey caught, that is three distinct ways this drain method
reports clean on a false header.

## Checked clean — stated as what it is

Per Osprey's caveat (`BRIEF-CODE-ANCHOR-CHECK-2026-09-11`), *"an existence check cannot see a behaviour
change, and a behaviour change is precisely what lands"* — so these are **"nothing landed in the surface
I checked"**, not "verified":

- **AS11-SESSION-DETECTOR** — no acting-mode follow-up brief exists (surface: `briefs/`).
- **CPAP-AS11-BLE-WIRE-NOW** — `cpap_spool_decode.py` still absent (surface: `capture-host/as11_*`,
  `cpap_*`). Ten commits landed there since 09-11, four of them mine; **none is the named absence and no
  box is ticked** — whether any advances a done-when is the brief owner's reading of what they cover.
- **OXYII-DAT-AUTO-HARVEST-REFINEMENT** — no T-series ledger on the box (surface: the box itself).

## Handed back unconcluded — not guessed at

`OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS` · `POLAR-ONBOARD-BACKUP-FOLLOWUPS` · `RADIO-CLOCK-SIDECAR` ·
`VIGIL-SELF-SUSTAINED-FOLDING`. Each has landings in a plausible surface, but their claims turn on
identifiers I could only reach by guessing names — and a guessed token is how a true claim gets closed
as resolved. Two partial signals to pass on rather than act on: `webmon.py` has no match for the
RR-acceptance probe under the tokens I tried (**not** evidence it is gone), and POLAR-ONBOARD's
`capture.py:1791` reference has drifted to `capture.py:2278` while the value it cites
(`drop_not_worn_sec` = 180) still holds.

No census figure is quoted here: the open-brief count is disputed (78 vs 57) and unadjudicated.
