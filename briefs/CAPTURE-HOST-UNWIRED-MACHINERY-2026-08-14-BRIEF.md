<!--
  CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-14

# Machinery that exists, is tested, and is connected to nothing

> Audit of `capture-host/` against `origin/main` @ `d154c48a`, 2026-08-14. Every finding is a *logical*
> gap — not coverage, not style. All five survived re-verification; one tempting sixth did not, and is
> recorded in §7 so nobody "fixes" it.

## 0 · Why these are one finding, not five

The suite's own recurring failure class — `AUDIT-PROMPT`'s and `ui-export-paths-broken`'s — is **a check
that reports success about something it never examined**. This audit found its sibling: **a check that
examines something correctly and reports to nobody.**

It happened three times on 2026-08-14 alone, outside this audit:

| | |
|---|---|
| the charging veto (#1245) | correct, gated by 24 passing assertions, **unreachable** from the live path |
| the Deploy button (#1244 → #1249) | green 12-minute gate, failed on the **first real press** |
| `reload` (#1239) | the box carried a stale `NeedDaemonReload` since 2026-08-06 with nothing able to clear it |

Each was found by *using* the thing. Nothing in CI can see this class, because every one of these has
passing tests — the tests call the function directly, which is exactly the wiring that production lacks.

**§6 proposes the detector**, because five instances is a pattern, not a coincidence.

## 1 · `clock_uncorrectable` — a verdict computed, set, cleared, tested, and read by nobody

- **set** `capture.py:3757` — `_set(name, clock_uncorrectable=True, clock_synced=None)` when the clock
  watchdog exhausts its give-up budget.
- **retracted** `capture.py:1360` — a fresh sync clears it, deliberately (`_CLOCK_FRESHLY_SYNCED` exists
  solely to carry that retraction across tasks, per the comment at `:711`).
- **tested** 7 references across `test_clock_resync_on_reconnect.py` and `test_capture_runners.py`.
- **consumed by** — nothing. Not `alerts.py`, not `webmon.py`, not `nightqc.py`, not `monitor.html`.

For a suite whose entire Clock Contract rests on device time being trustworthy, *"this device's clock
could not be corrected"* is a first-order data-quality fact. It currently reaches no operator, no alert,
and no nightly QC report. A night captured under an uncorrectable clock is indistinguishable, downstream,
from a good one.

- [ ] Surface it. Cheapest honest option: `webmon`'s device projection + a monitor pill, since `worn_why`
      already establishes the "verdict plus its reason" pattern.
- [ ] Decide whether `nightqc` should carry it per night — that is the artefact an analysis actually
      reads months later, and the one place the fact still matters after the session ends.

## 2 · `alerts.arrival_canary` — an alert nothing invokes

`alerts.py:268`. Called from `tests/test_pmd_arrival_writer.py` five times and from **no production
caller**. Its own docstring states the stakes:

> What remains is the failure nothing else can see: **DEAD** — the device is connected and writing
> samples, but its sidecar row count is not advancing.

and, of its predecessor:

> without this both surface weeks later inside an analysis — which is exactly how the back-timed stamps
> this replaces went unnoticed for the whole corpus.

The docstring also records that its *other* arm (`smeared`) was correctly retired after firing on every
stream on 2026-08-11. That retirement was right; it left the surviving arm wired to nothing.

- [ ] Call it from `alert_loop`, where the other per-tick predicates already run.
- [ ] ⚠️ Before wiring: run it against real QC output for a few nights. The retired arm fired on **every
      stream on the first real night** because its premise (a 5 ms floor) was never reachable. Wiring the
      DEAD arm without that check risks repeating the same mistake, one arm over.

## 3 · `helper_path.grant_warning` never warns, and its condition is reachable

`helper_path.py:47` returns a one-line warning when a privileged helper would be `sudo`-run from a
location the granted user can rewrite. Nothing calls it. Nor `is_safely_owned`, which it wraps.

The condition is **not hypothetical**:

- `resolve()` falls back to the in-repo copy when no system copy exists (`helper_path.py:26-32`);
- on the box that copy is `-rwxrwxr-x vigil` — writable by the granted user;
- `daemon_control.build_cmd` prefixes `sudo -n` to whatever `resolve()` returns;
- `capture.py` calls `resolve()` at `:3433`, `:3457`, `:3514` and checks safety at none of them.

It degrades legibly today only by accident: sudoers is scoped to `/usr/local/lib/tepna/*`, so a repo-path
invocation is *refused* rather than escalated, and `daemon_control.run` has a hint naming it a deploy gap.
That is a second line of defence doing the first line's job.

**Compounding it — `SYSTEM_DIRS` is mislabelled.** `helper_path.py:20-22` comments both entries as
"Root-owned deploy targets", but the second is `/opt/tepna/capture-host`, the checkout, which is
vigil-owned **by design** — `tepna-update.sh` must be able to write it. A constant that describes its
second element incorrectly is how the fallback looks safe at the call site.

- [ ] Call `grant_warning` once at boot for every helper the daemon can invoke, and log it at WARNING.
      The boot self-test is the established place (`VIGIL-OVERNIGHT-FINDINGS` P1.4 added two checks there
      after finding the third missing).
- [ ] Correct the `SYSTEM_DIRS` comment: entry 1 is a root-owned deploy target, entry 2 is a
      **fallback for development** and is not safe to hold a grant.

## 4 · The same gate written two ways, and only one of them checks `charging`

| | |
|---|---|
| `cpap_harvest.blocking_devices:305` | checks `charging` **first**, then `worn is False` — and its docstring records the 2026-07-26 incident where every sensor was docked and the pull still refused |
| `capture.py:4689` | `if st.get("connected") and st.get("worn") is True: continue` — no `charging` check |

`capture.py:4689` gates the O2Ring auto-pull ("only while it is off the finger"). Today the ring reports
`worn=False` on the dock honestly, so the gap is **latent, not live**. It is listed because the two gates
encode the same rule — *a charging device cannot be on a body* — and only one of them says so.

- [ ] Add the `charging` check, or route both through one predicate. `blocking_devices` already is one.

## 5 · Minor: defined, never used

- [ ] `last_sample` — published at `capture.py:1939` and `:2896`, read by nothing. It is a per-stream
      freshness stamp, which is what §2's DEAD detector wants; wire it or drop it.
- [ ] `oxyii.oxy_is_finalized:596` — tests only.
- [ ] `offline_lock.busy_with` — tests only.
- [ ] `cpap_harvest._WPA_DIR:609` — comments itself as "module default for CLI/test use"; nothing uses it,
      so even that is stale.

## 6 · The detector, because five instances is a pattern

Every finding above was produced by two mechanical scans that took seconds and could run in CI:

1. **Orphan status keys** — collect every `key=` published through `_set(name, …)` in `capture.py`;
   subtract everything referenced in `webmon.py`/`alerts.py`/`nightqc.py`/`timeline.py`/`monitor.html`.
2. **Orphan functions** — public `def`s whose only references outside their own module are in `tests/`.

⚠️ **Both scans need care, and the first draft of each was WRONG in a way that matters:**

- a name-plus-`(` pattern **misses callback references** — `to_thread(diskguard.prune_old_nights, …)` made
  retention and archiving look dead when both are wired. Match the bare name.
- `timespec` and `tool` were false positives: the first is `isoformat`'s kwarg caught by a loose regex,
  the second is consumed under a quoting form the filter missed.

So the detector must be **advisory with a curated allowlist**, not a hard gate — the same posture as
`mutation (diff-scoped)`. A hard gate here would fail on every legitimately declarative constant
(`PMD_SERVICE`, `OXYII_SERVICE`) and every CLI-only entry point.

- [ ] Build it as a `tools/` script first, run it, curate the allowlist, and only then decide whether it
      earns a CI job.

## 7 · What this audit checked and REJECTED — do not "fix" it

**The O2Ring writes `worn` directly, bypassing `worn_verdict`, exactly as the Polar path did before
#1245 — and that is CORRECT.**

- `capture.py:2896` publishes `worn=True` in the branch where vitals are flowing;
- `capture.py:2904` publishes `worn=live["worn"]` in the branch where they are not.

The Polar's HR contact bit **asserts skin contact in a charging dock and on a desk** (measured: 3 h 24 m
into a charger on 2026-08-14; 496 MB into a desk before that), which is why it may not own the verdict
alone. The ring's flag is honest on the dock — `cpap_harvest.blocking_devices`' docstring says so
explicitly, and the branch at `:2901` documents that only the vitals stop when it is docked.

**Same code shape, opposite verdict, because the sensors differ.** Routing the ring through the combiner
would add a veto it does not need and a dependency on `charging` inference where a direct measurement
already exists. Recorded here because reasoning by analogy from #1245 would produce exactly that change.

## 8 · Done when

- [ ] §1, §2, §3 are wired or explicitly declined in writing — they are one work-unit, all three being
      "a correct answer with no consumer".
- [ ] §4 is unified or its divergence is justified in a comment.
- [ ] §6's script exists and has been run once, with its allowlist curated.
- [ ] §7 is still true — re-check before any change to the O2Ring worn path.
