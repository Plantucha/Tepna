<!-- SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-16 (owner-directed close; **NO CODE WORK REMAINS** — re-measured 2026-08-04. §1 · §2 · §5 executed and verified on the box; §6 is a record. The two items that outlive this brief are **not code** and are carried forward by `VIGIL-COEXISTENCE-FOLLOWUPS-2026-08-16-BRIEF.md`: §3's field re-measurement, and §4's privilege decision — which is folded into the box privilege-model design that `VIGIL-AUTO-UPDATE-FOLLOWUPS` §2 also feeds, since they are one question. Closing a finished code brief so it stops reading as open work.) · **Superseded-by:** `VIGIL-COEXISTENCE-FOLLOWUPS-2026-08-16-BRIEF.md` · **Originally:** PROPOSED (**NO CODE WORK REMAINS — re-measured 2026-08-04.** §1 EXECUTED; §2's guards are both in place and gate the real call site; §5 RESOLVED on the box (udev rule byte-identical, autosuspend off on both real adapters). What is left is two FIELD re-measurements (§2, §3) and one owner DECISION (§4) — this is owner/hardware-gated, not actionable. Original §1 note: **§1 EXECUTED 2026-08-04** — the sequencing-critical item is done, so §2/§3 can now be re-measured through an instrument that can see warnings; §2·§3·§4·§5 remain) · **Created:** 2026-07-26

> ## Status of every section, measured 2026-08-04 — NO CODE WORK REMAINS
>
> | § | state |
> |---|---|
> | §1 journal severity | ✅ **DONE** — the `<N>` syslog prefix ships (see below) |
> | §2 WiFi/BLE coexistence | ✅ **CODE DONE.** Both halves of the Done-when are enforced: `cpap_harvest.blocking_devices` refuses a harvest while any sensor is actually **streaming** (refined since — `connected` alone was wrong, a docked sensor reports connected while producing nothing), and `due_now(now, at_hour, last_run_date, window_h=2)` confines the run to `[at_hour, at_hour+2)` with `at_hour: 13`. The nocturnal band is therefore excluded **by construction**, which is stronger than a band check. Both gate the real call site (`capture.py:3708`/`:3712`). ⏳ The *re-measurement* clause is a field task |
> | §3 re-acquisition | ⏳ **FIELD ONLY** — its Done-when is a repeat walk-away outside a transfer window. Nothing to build |
> | §4 ladder disarmed | 🧑 **A DECISION, not code** — the brief's own §"Sequencing" says so |
> | §5 udev rules two fixes behind | ✅ **RESOLVED — measured on the box today**, see below |
> | §6 refuted hypotheses | 📝 record only |
>
> **So this brief is no longer "actionable now".** What is left is two field re-measurements and one owner
> decision. It stays PROPOSED because those Done-whens are genuinely unmet — not because work is queued.
>
> ### §5 — resolved. Measured, not assumed.
>
> The brief recorded `/etc/udev/rules.d/99-tepna-btdongle.rules` on the box as **two fixes behind** the
> repo, covering only `2357:0604` and `8087` and missing `0bda`, `1915`, `2fe3` and the class catch-all.
> Today the installed file is **byte-identical to the repo** (`md5 d3de673f…`) and carries all five vendor
> ids. And the defence it exists for is **in force**: resolving each `hci` to its USB parent the way
> `capture.py` does gives `hci0 → 2357:0604 power/control=on` and `hci1 → 8087:0a2b power/control=on` —
> autosuspend disabled on both real adapters.
>
> ⚠️ A naive sweep of `/sys/bus/usb/devices/*/power/control` **does** return `auto` entries — for `usb1`
> and `usb2`, which are the USB **root hubs**, not the dongle. Root hubs default to `auto` and that is
> normal. Reading those as "the defence is off" would be the same wrong-subject error §2 corrects for RSSI:
> a true measurement of the wrong thing. Resolve the adapter first, then read its parent.
>
> ## ✅ §1 executed 2026-08-04 — journal severity is now expressed, not just printed
>
> §"Sequencing" said *"§1 first and alone — until it lands **every other item here is being measured
> through an instrument that cannot see warnings**"*. It had not landed: `capture.py` still called a bare
> `logging.basicConfig(...)` nine days later, so the blocker was real and was blocking the rest of its own
> brief.
>
> **Built exactly as §1 specifies** — the `<N>` syslog prefix, no new dependency, no unit change
> (`SyslogLevelPrefix=yes` is the default). `python3-systemd`'s `JournalHandler` was not taken, for the
> reason §1 gives: it adds a dependency to an appliance whose SOUP list is deliberately empty.
> `_SYSLOG_PRIORITY` + `_PriorityFormatter` + `_install_logging()` in `capture.py`; call site swapped.
>
> **Done-when, item by item:**
> - *"a unit test asserts the formatter maps WARNING→`<4>` and INFO→`<6>`"* — `tests/test_journal_priority.py`
>   asserts the whole scale (2/3/4/6/7) **and** the emitted bytes, not just the map, since the bug being
>   guarded is a severity that is printed but not expressed.
> - *"the prefix does not appear in the interactive console output path"* — honoured, and gated. The
>   discriminator is systemd's own **`JOURNAL_STREAM`**, deliberately **not** `isatty()`: a run redirected
>   to a file is equally not-a-TTY, and prefixing there would corrupt the file with `<6>` markers nothing
>   parses.
> - *"`journalctl -p warning` returns the link-error lines and not the INFO lines"* — **not yet observed on
>   the box**; that needs a deploy. The unit level is proven; the field confirmation is owed.
>
> **Verified by re-applying the defect, not by the tests passing.** Five mutants, all killed: never-prefix
> (the original bug) · `WARNING`→5 (wrong scale) · always-prefix (console leak) · call site reverted to
> `basicConfig` · and `force=True` reintroduced.
>
> ⚠️ **That last mutant is a bug I wrote and the suite caught.** The first version used
> `logging.basicConfig(..., force=True)`, which *removes every existing root handler* — under pytest that
> is `caplog`'s, so four tests driving `main()` and asserting on `caplog.records` saw an empty list while
> the logging itself worked perfectly (`test_shutdown_names_a_task_that_ignores_cancellation` + 3
> siblings). `force=True` reads as harmless tidiness and is not. It is gone, and
> `test_install_logging_does_not_clobber_an_existing_root_handler` now states the property directly rather
> than leaving it to be caught incidentally by unrelated tests.

# Vigil — radio coexistence, range recovery, and a journal that hides its own warnings

*(out-of-suite; `capture-host/` only — no bundle / `manifestHash` / provenance impact)*

Everything here was **measured on the box on 2026-07-26**, most of it by accident: a CPAP bulk
transfer and a deliberate walk-out-of-range happened to overlap an evening of continuous monitoring,
and between them they exposed one observability bug, one quantified radio interaction, and one
recovery behaviour that nothing had ever put a number on.

Nothing in this brief is a regression. Every item is a *gap that was invisible until tonight*.

---

## §1 · `capture.py`'s WARNINGs are filed in the journal at INFO — no standard tool can filter them

**The measurement.** Over one daemon lifetime the journal held **33 application warnings**:

```
11  WARNING Wellue O2Ring-S link error
11  WARNING Polar Verity Sense link error
10  WARNING Polar H10 02849638 link error
 2  WARNING STARTUP: capture has no CAP_NET_ADMIN
```

and `journalctl -u tepna-capture -p warning` returned **nothing** for the same window. Confirmed
directly — `journalctl -o json` on a line whose text begins `WARNING` reports:

```
PRIORITY=6      2026-07-26 18:39:54 WARNING Polar H10 ... link error: BleakError(...)
```

**Why.** `capture.py:3011` is `logging.basicConfig(...)`, so severity lives only in the `%(levelname)s`
**text**. systemd assigns one priority to the whole stream, and every line — INFO, WARNING, ERROR —
lands as priority 6. The severity is printed but not *expressed*.

**Why it matters more than it looks.** `alerts.py` reads `/api/state` and QC, not the journal, so the
product's own alerting is **unaffected** — this is not "alerts are broken", and it should not be
written up as such. What it breaks is every *standard* thing an operator would reach for: `-p warning`,
`-p err`, a journald-based alert rule, a log-shipping severity filter, `systemctl status`'s red-line
extraction. Each silently returns clean. An operator who trusts the tooling concludes the box had a
quiet night; the box had 33 warnings.

**How this was found.** By making exactly that mistake. The overnight watch ran `-p warning` all
evening and logged "zero warnings" five times while the warnings were sitting in the journal.

**Do.** Emit a syslog priority prefix — systemd parses `<N>` on stdout/stderr with
`SyslogLevelPrefix=yes`, which is the **default**, so this needs no unit change and no new dependency:

```python
_SYSLOG = {logging.CRITICAL: 2, logging.ERROR: 3, logging.WARNING: 4, logging.INFO: 6, logging.DEBUG: 7}
class _PriorityFormatter(logging.Formatter):
    def format(self, record):
        return f"<{_SYSLOG.get(record.levelno, 6)}>" + super().format(record)
```

`python3-systemd`'s `JournalHandler` is the other option and is **not** preferred: it adds a
dependency to an appliance whose SOUP list is deliberately empty, and it changes how every line is
framed. The prefix is four characters of behaviour.

**Done when.** `journalctl -u tepna-capture -p warning` returns the link-error lines and *not* the
INFO lines; a unit test asserts the formatter maps WARNING→`<4>` and INFO→`<6>`; the prefix does not
appear in the interactive console output path (or, if it does, that is accepted and stated).

---

## §2 · WiFi bulk transfer and BLE capture cannot share a window — with numbers

**The measurement.** A CPAP harvest (ResMed DATALOG over WiFi, ~120 KB/s sustained) started at
18:27:28 while three BLE sensors were streaming. Reconnect counts, split on that boundary:

| window | Verity | H10 | O2Ring |
|---|---|---|---|
| 18:09:23 → 18:27:28 (18 min, **no** transfer) | 1 | 1 | 1 |
| 18:27:28 → 18:42:53 (15 min, **transfer**) | **9** | **7** | **0** |

The pre-transfer "1"s are each device's initial connect after a daemon restart — i.e. **zero churn in
18 minutes, then 16 reconnects in 15 minutes.** `link_epoch` corroborates independently (H10 4→8,
Verity 7→9 in six minutes), and the evening's first `BleakError('failed to discover services, device
disconnected')` appeared inside the transfer window.

**The methodological correction — this is the part worth carrying forward.** A parallel session
measured the same interaction with **RSSI over a 3-minute window** and concluded: the two chest/finger
sensors lost 5–7 dB, *the Verity did not move*, one reconnect total. Every one of those statements is
defensible for that window and **the attribution is inverted**:

* the **Verity is the worst affected** (9 reconnects) and its RSSI barely moved;
* the **O2Ring is the only unaffected device** (0 reconnects) and its RSSI *improved*, to −57 dBm;
* one reconnect per 3 minutes understates the sustained rate by roughly **16×**.

**RSSI is the wrong instrument for this question.** It measures the strength of packets that arrive;
it cannot see a link that dropped. A device can hold a flat −65 dBm and re-establish its connection
nine times. Any coexistence decision justified on the RSSI table will be justified on the one
measurement that missed the effect. **Use reconnect count / `link_epoch` deltas, and measure over the
whole transfer, not a sample of it.**

**Not the cause.** Load average during the transfer was **0.34** — this is not CPU or I/O starvation,
and any fix that treats it as scheduling pressure will not work. The remaining hypothesis is 2.4 GHz
coexistence, consistent with the O2Ring (closest, strongest link) being untouched while the two
farther Polars churned.

**Do.** Keep the proposed idle-window rule (no bulk transfer while sensors stream / during the
nocturnal band), and record §2's numbers as its justification rather than the RSSI table. Extrapolated
cost of *not* having it: ~16 reconnects per 15 min over a 65–70 min pull ≈ **70 reconnects**, each one
a file split and a few seconds of lost signal. A pull overlapping sleep would shred the night; the
2026-07-26 pull finished before sleep onset **by luck, not by design**.

**Done when.** Bulk transfer is refused (or deferred) while any BLE stream is active or the clock is
inside the nocturnal band; a re-measurement with the transfer running and sensors idle *outside* that
band shows the reconnect delta returning to baseline.

---

## §3 · Out-of-range recovery works; **re-acquisition** is the weak part

**The measurement.** A deliberate walk-out-of-range, 5 s sampling, 183 samples per device:

```
18:44:23   all three drop within ONE 5 s sample     <- one body carrying three sensors, not three range limits
18:55:50   O2Ring back    (11.5 min down)
18:56:28   H10 back       (12.1 min)
18:59:16   Verity back    (14.9 min)
```

| | share of window disconnected | deepest RSSI | epoch |
|---|---|---|---|
| Verity | **90 %** | −100 dBm | 10 → 12 |
| H10 | 78 % | −99 dBm | 8 → 11 |
| O2Ring | 74 % | −91 dBm | 1 → 5 |

**Everything recovered with no intervention** — that is the headline and it is a pass. The daemon
needed no restart, no adapter reset, and the CAP_NET_ADMIN recovery ladder (§4) was never reached.

**The data is honest about the hole.** ECG stops at 18:44:14 and the next file *starts* at 18:57:00 —
a 12.7-minute gap recorded as a **new session file**, nothing interpolated across it. That is correct
behaviour and it is the fragmentation `tools/trio-batch.mjs`'s session merge already stitches.

**What is worth fixing.** After the sensors were **already back in range**, the links flapped for
3–4 minutes — the O2Ring connected and dropped **four times** between 18:56:55 and 19:00:26, the H10
twice. Each bounce costs a file split. This is the target the reconnect-backoff work has lacked:
**zero re-drops within 5 minutes of a recovery, at an RSSI that is already stable.**

**Secondary observation, not yet a finding.** The H10 went **90 % → 80 % battery in ~30 minutes**
across 11 link epochs. Reconnect churn looks expensive, but a single evening with coarse
battery reporting is not evidence — this needs a night with a known epoch count before anyone acts on
it. Recorded so it is not lost, explicitly **not** claimed.

**Done when.** A repeat walk-away *outside* a transfer window (so §2 does not confound it) shows the
same clean recovery with ≤1 re-drop per device in the 5 minutes after return.

---

## §4 · The adapter-recovery ladder is disarmed, by design, and says so only in a warning nobody can filter

`WARNING STARTUP: capture has no CAP_NET_ADMIN — the watchdog's adapter-recovery ladder (hciconfig
reset / USB rebind) cannot run and exits 1.` Logged at every start, twice on 2026-07-26.

This is the known, deliberate P1.2 position (`VIGIL-OVERNIGHT-FINDINGS-2026-07-24`): prevention
(autosuspend-off) is the primary defence and capture stays unprivileged. Nothing new — but it
compounds §1 (the one warning that says the box cannot self-heal is filed at INFO) and §3 (recovery
happened to be unnecessary tonight). **Decide and record:** grant the capability, or state that an
adapter wedge on an unattended night requires a human, and make the startup line visible per §1.

---

## §5 · Immediate, needs a human

`/etc/udev/rules.d/99-tepna-btdongle.rules` on the box is **two fixes behind the repo** — it covers
`2357:0604` and `8087` only, missing `0bda:b850`, `1915`, `2fe3` (the Raytac that is plugged in
*right now*) and the `e0/01/01` class catch-all. Detected by `deploy/check-system-files.sh` (PR #435);
it cannot be installed by an agent because sudo on the box needs a password:

```
ssh vigil@192.168.0.61 'sudo bash /opt/tepna/capture-host/deploy/check-system-files.sh --install'
```

Live risk is confined to **hotplug** — all three adapters currently read `control=on delay=-1` because
the boot service armed them. A replug of the Raytac before this runs leaves it at the kernel default.

---

### 📡 §5 RE-CHECKED ON THE LIVE BOX 2026-08-15 — resolved as written, and DRIFTED AGAIN elsewhere

§5's own text still reads as open while the header records it RESOLVED. Ran the shipped checker on the
box to settle it — `bash /opt/tepna/capture-host/deploy/check-system-files.sh`:

**§5 as written is CLOSED.** `99-tepna-btdongle.rules` reports **`MANAGED ✓ content in sync`**. The
"two fixes behind" state is gone and the header was right.

**But the check now reports `11 managed, 2 drifted, 1 SUPERSEDED`, and one of those matters in the
field:**

| file | state |
|---|---|
| `tepna-restart.sh` | **✗ STALE — /etc differs from the repo** |
| `99-polar-hidraw.rules` | **SUPERSEDED, still present** — replaced by `99-tepna-hidraw.rules` |

#### 🔴 The stale file silently disables a fix that already shipped

Diffed against the repo copy, the installed `/usr/local/lib/tepna/tepna-restart.sh` is missing the
**`deploy` verb** and its `REPO_DIR` constant — the 2026-08-14 fix for the Deploy button, whose own
comment records the bug:

> *"the capture unit sets `ProtectSystem=strict` with `ReadWritePaths=/srv/tepna /opt/tepna/capture-host`
> — so `/opt/tepna/.git` is READ-ONLY to anything the daemon spawns, and `git fetch` dies on
> `.git/FETCH_HEAD: Read-only file system`… SUDO DOES NOT FIX IT: a mount namespace is not escaped by
> privilege."*

`/opt/tepna` **has** the fix; `/usr/local/lib/tepna` does not. **So the Deploy button on the box is still
broken today, by the exact bug that was fixed and merged** — the repo believes the issue closed and the
field does not. That is this brief's §5 failure mode recurring on a different file, and it is the reason
§5 was worth writing rather than a one-off.

#### What it needs

An operator, exactly as §5 says — the installer needs a password-bearing sudo:

```sh
ssh vigil 'sudo bash /opt/tepna/capture-host/deploy/check-system-files.sh --install'
sudo rm /etc/udev/rules.d/99-polar-hidraw.rules      # the checker never deletes
```

⚠️ **The generalisable point, and the reason this is recorded here rather than in a new brief:** a merged
fix to a file under `deploy/` is **not deployed**. `check-system-files.sh` already detects it and nothing
runs it on a schedule, so drift is found only when somebody looks. Every future "fixed and merged" claim
about a `deploy/` file should be read as "fixed in the repo" until this checker says otherwise.

### ✅ RESOLVED ON THE BOX, same day — operator ran the installer, verified from the repo side

The owner ran both commands within the hour:

```
sudo bash /opt/tepna/capture-host/deploy/check-system-files.sh --install
sudo rm /etc/udev/rules.d/99-polar-hidraw.rules
```

Checker now reports **`11 managed, 0 drifted`** with no SUPERSEDED line. **Verified independently rather
than from that summary**, because a green count is exactly the kind of evidence this brief exists to
distrust:

| check | result |
|---|---|
| `deploy)` case present in the installed copy | ✓ |
| `REPO_DIR` constant present | ✓ (3 refs) |
| usage line | `{restart\|status\|radio\|reload\|reboot\|deploy\|stop [minutes]}` |
| `diff /usr/local/lib/tepna/tepna-restart.sh` vs repo | **byte-identical** |
| `99-polar-hidraw.rules` | removed |
| capture service | still **active** — the installer restarted nothing, as it says |

**The Deploy button works in the field again**, and the 2026-08-14 fix is now actually deployed rather
than merely merged.

⚠️ **The standing lesson is unchanged by the fix**, and is the reason this exchange is recorded: the fix
had been merged for a day, CI was green, and the field was still broken. Nothing in the repo could have
told you — `check-system-files.sh` is the only instrument that can, and **nothing runs it on a
schedule**. Until something does, treat "fixed and merged" for any `deploy/` file as "fixed in the repo",
and run the checker before believing otherwise.

### 🔁 THE RECURSION, and how it actually resolves — measured 2026-08-15

`nightqc` is being wired to call this checker once per night (Vigil box's work-unit), so the class closes
rather than this one instance. But it lands with a twist worth stating, because it is this section's own
finding pointed at itself:

**The checker that detects un-deployed fixes is itself subject to being un-deployed.** The `--json` mode
the nightly check parses does not exist on the box yet — verified: `grep -c json` on
`/opt/tepna/capture-host/deploy/check-system-files.sh` returns **0**, and passing `--json` there today is
silently ignored, printing the human report. So the nightly check will return `None` until the box has
the new script.

**But it needs a `git pull`, not an `--install`, and that distinction matters:**

- `check-system-files.sh` is **not a MANAGED file** — it is not in the installed set (the 11 managed
  entries are the udev rules, units, and `/usr/local/lib/tepna` helpers). It runs from the `/opt/tepna`
  checkout.
- The box **does** auto-pull. Verified 2026-08-15: `tepna-update.timer` is `enabled` + `active`,
  `tepna-update.service` last ran **10:38:15 EDT that morning**, and `/opt/tepna` HEAD is a commit dated
  the same day.

**So no operator step is required for this one** — the hourly updater picks it up. That is the opposite
of the `tepna-restart.sh` case above, which *was* a MANAGED file and therefore *did* need a
password-bearing `--install`.

⚠️ **The distinction is the durable part:** a fix to a file under `deploy/` that is **installed** into
`/etc` or `/usr/local/lib` needs an operator; a fix to a script **run from the checkout** does not. The
rule stated earlier in this section — *treat "fixed and merged" as "fixed in the repo"* — applies to the
first class. For the second, the hourly timer is the deployment, and the thing to verify is that the
timer is alive, not that somebody ran a command.

## §6 · Hypotheses that did NOT survive

* **"The CPAP transfer is starving the capture loop."** Load average 0.34 during a 23 MB/min
  transfer. Refuted — see §2. Had this been believed, the fix would have been scheduling priority,
  which addresses nothing.
* **"The product's alerting is blind to warnings."** `alerts.py` sources `/api/state` and QC, not the
  journal. §1 is an *operator-tooling* gap, not an alerting failure, and overstating it would be the
  same error as the RSSI attribution in §2 — a true observation applied to the wrong subject.
* **"The stalled streams during the transfer are a wedge."** Three samples 20 s apart went
  `bad=[ecg,acc_h10,hr_h10,bpm_h10]` → `[ecg,acc_h10]` → `[none]`. Flapping, self-recovering,
  renegotiated within seconds. A stall snapshot is not a wedge; a wedge does not recover.

---

## Sequencing

§1 first and alone — it is four characters of behaviour, and until it lands **every other item here is
being measured through an instrument that cannot see warnings**, including the §2 re-measurement and
the §3 repeat. §5 needs only the operator. §2 and §3 are independent of each other. §4 is a decision,
not code.
