<!--
  VIGIL-AUTO-UPDATE-FOLLOWUPS-2026-08-14-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — §2a's design is delivered and option (C)'s *make the drift loud* half is SHIPPED (`nightqc.system_file_drift`, `monitor.html:2301-2313`, `tests/test_system_file_drift.py`). What is missing is the **owner's A/B/C pick on the box's privilege model** — no decision is recorded anywhere, and nothing else in this brief can move until it is. §4's restart-at-next-idle is likewise an owner call; the 68.6 % number it needed is already measured. ⚠ **Residue, unblocked and unassigned:** §5's consecutive-failure counter is plain desk work — nothing implements it (no counter in `daemon_control.py`/`telemetry.py`/`alerts.py`), and it is what distinguishes *failed once, recovered* from *failing every tick since Tuesday*. Box-side today: `tepna-update.timer` is healthy, last fired 12:41, next 13:45. **Owner:** owner (privilege model) / Heron (§5 counter) · **Next step:** the §5 counter, which needs nobody's permission) · **Created:** 2026-08-14

> Spawned by closing `VIGIL-AUTO-UPDATE-2026-08-04-BRIEF.md` (DONE 2026-08-14, §6 met with 41 observed
> unattended restarts). Everything here was found by *running* the machinery that brief built, mostly on
> 2026-08-14 while wiring the monitor's daemon-control card.

# The deploy finishes itself — except for the one file class that needed a person, which is still the one that needs a person

## 1 · The residual gap, stated exactly

`tepna-update.sh` closed the **pull** and the **restart**. It does not close the **root-owned helpers**,
and the reason is a distinction that is easy to state and was still got wrong out loud on 2026-08-14:

> the `NOPASSWD` wildcard grants **EXECUTE** on `/usr/local/lib/tepna/*`. It never grants **WRITE** to
> that directory.

So updating `tepna-restart.sh` — or adding a verb to it, which happened four times in one day — needs
`sudo bash deploy/enable-restart-control.sh` typed by a human. That is exactly the failure class §1 of
the parent brief tabulates: **#914's root helpers sat eight days behind the checkout, unnoticed.** The
parent brief *reports* that drift (`check-system-files.sh` runs every tick) and deliberately does not
fix it. It is still unfixed.

**Measured 2026-08-14:** the box auto-pulled a `reload` verb into the checkout within 30 min, and the
installed helper stayed four verbs behind until a password was typed. The API answered
`unknown verb 'reload'` the whole time, from code that was sitting on disk.

## 2 · Why the obvious fix is a root hole, and what shape a real one has

Granting `NOPASSWD` on `enable-restart-control.sh` would close it in one line and must not be done.
That installer copies **from `/opt/tepna`**, which `vigil` can write, so a compromise of the capture
user becomes root in two granted commands: write a malicious `tepna-restart.sh` into the checkout, have
root install it, execute it via the wildcard. `tepna-update.sh`'s own header already makes this
argument; it is correct and it rules out *installing from the checkout*, not installing at all.

A defensible shape, **not yet built** (a first attempt on 2026-08-14 was blocked pending owner sign-off,
which is the right outcome for a change to a box's privilege model):

- a root-owned installer that clones the **canonical remote** into a root-only `0700` temp dir and
  installs from THAT — never from `/opt/tepna`, never `git remote get-url` (that config is
  vigil-writable);
- an explicit **filename allowlist**, so a new file in the repo does not become root-executable by
  merely existing;
- **`/etc` untouched** — sudoers stays a human act;
- clone → verify → install, so a fetch failure leaves helpers unchanged rather than half-written.

Net: the trust anchor becomes `origin/main`, which is *already* the trust anchor for every line the box
runs. The honest residual is that it converts "root writes there when the owner types a password" into
"root writes there whenever `vigil` asks, from GitHub". **That is an owner decision, not an engineering
one.**

### 2a · DESIGN, brought back for sign-off (owner-directed 2026-08-16) — three options, and I recommend (C)

**Scope narrowed first.** This was going to cover the adapter-recovery ladder too. It does not:
`CAP_NET_ADMIN` is **already granted** (`AmbientCapabilities=CAP_NET_ADMIN` on `tepna-capture.service`,
`CapEff` bit 12 on the live process, zero "has no CAP_NET_ADMIN" warnings in three days, watchdog
actively managing wedges). See `VIGIL-COEXISTENCE-FOLLOWUPS-2026-08-16` §2's retraction. What remains
is **only** the update/restart path, which is root *code execution* rather than a network capability.

**The two in-repo precedents any option must respect**, because the shape is not novel:

| precedent | the rule it encodes |
|---|---|
| `capture-host/link_rssi.py` | privilege via `AmbientCapabilities` inherited across exec; sudo only as a dev-workstation fallback, since `NoNewPrivileges=true` forbids setuid sudo on the appliance |
| `capture-host/webmon.py` | the privileged surface takes **no caller-controlled input** — a rebind's USB port comes from server config, never the request body, because *"an argument the caller chooses is still an argument the caller chooses"* |

And the rule `enable-restart-control.sh` already states in its own header: **a NOPASSWD grant must name
a file the granted user CANNOT rewrite.** That is exactly why the *installer* cannot be granted — it
copies from `/opt/tepna`, which `vigil` owns.

---

**Option A — automate the install from the canonical remote** (the shape §2 sketches above).
Root-owned installer clones `origin/main` into a root-only `0700` temp dir, installs from there against
a filename allowlist, never touches `/etc`, clone→verify→install so a fetch failure leaves helpers
unchanged. The remote URL must be **hardcoded in the root-owned script**, never `git remote get-url`
(that config is vigil-writable) — webmon's rule applied.
*Cost:* it genuinely converts "root writes when the owner types a password" into "root writes whenever
`vigil` asks, from GitHub". A compromised GitHub token or a bad merge reaches root on the box without a
human in the loop. **This is the option that needs your signature, and I am not proposing it.**

**Option B — make the privileged surface STABLE so installing it is rare.**
The staleness that motivated all this (#914's helpers eight days behind) only hurts if the root-owned
helpers change often. Make `tepna-restart.sh` a thin, stable shim that reads nothing from the checkout,
so its content changes maybe twice a year and a human install is not a recurring cost.
*Cost:* does not fix drift, only makes it rarer; and "rare" is exactly when nobody notices.

**Option C — 🟢 RECOMMENDED. Do not automate the privileged step. Make its drift LOUD.**
`deploy/check-system-files.sh` already **detects** the drift (PR #435) — the failure was never detection,
it was that nobody read it for eight days. Surface that detector's result where it is already looked at:
the QC summary and the monitor page, as a first-class red rather than a line in a log.
*Why this one:* it preserves the privilege boundary completely — no new grant, no root-executes-fetched-code
path, `/etc` untouched, sudoers stays a human act — and it attacks the actual measured failure, which was
**observability, not privilege**. Three of three staleness events were noticed late, not blocked.
It is also the same trade this session made under a live incident: *detection you can perform beats
remediation you cannot.* A watcher with no write permission is still a real safety layer.

**What I have NOT done:** nothing is applied to the box, no sudoers file is written, no unit is edited.
This is a design for sign-off, as directed.

**Done when:** the owner picks A, B or C — or states that manual deploys are acceptable and closes the
item, which is also a legitimate answer and cheaper than all three.

## 3 · `ProtectSystem=strict` means the daemon cannot run the updater in-process

Found by pressing the Deploy button for the first time (#1244, fixed #1249):

```
error: cannot open '.git/FETCH_HEAD': Read-only file system
```

The capture unit sets `ReadWritePaths=/srv/tepna /opt/tepna/capture-host`, so `/opt/tepna/.git` is
read-only to anything the daemon spawns. **Sudo does not fix it** — a mount namespace is not escaped by
privilege. `systemd-run --uid=vigil` does, because PID 1 starts the new unit outside the namespace, and
PID 1 *is* reachable from inside (the `reload` verb's `daemon-reload` proves it).

- [x] **AUDITED 2026-08-15 — and this box's own premise was half wrong.** Each installed helper was read
      for what it actually writes, rather than assumed:

      | helper | writes | why it works |
      |---|---|---|
      | `tepna-rssi.sh` | **nothing** — `hcitool` read → stdout | cannot fail this way at all |
      | `tepna-clock.sh` | `/etc/chrony/sources.d/…`, `/etc/systemd/timesyncd.conf.d/…` | **by having been listed** |
      | `tepna-btreset.sh` | `/sys/bus/usb/drivers/usb`, `/sys/bus/usb/devices` | by `ProtectSystem=strict`'s carve-out |
      | `tepna-usbreset.sh` | `/sys/bus/usb/devices` | by the same carve-out |
      | `tepna-restart.sh` | `/opt/tepna/.git` — **outside the list** | it FAILED; fixed by `systemd-run` |

      **Correction to this brief:** it says *"`tepna-clock.sh` and `tepna-rssi.sh` … write to `/etc/chrony`
      / `/run/chrony`"*. `tepna-rssi.sh` writes nothing — it reads RSSI over HCI and echoes a number. The
      two were lumped, and only the clock helper is exposed.

      **So the writable set is TWO things, and only one is maintained by anyone:** `ReadWritePaths`, and
      `ProtectSystem=strict`'s own `/dev` `/proc` `/sys` carve-out. Exactly **one** of five helpers depends
      on the list — narrower than the brief assumed, but it is also the one nobody would notice breaking,
      because chrony keeps working from its existing config.
- [x] **DOCUMENTED 2026-08-15** in `check-system-files.sh`'s header — both lists, the per-helper table,
      and the instruction to check a new helper's writes against them before the box does.

> ### ⚠ THE CLASS HAS ALREADY BITTEN A SECOND SUBSYSTEM — found while running this audit
>
> The journal carries **95 `Read-only file system` lines from the CPAP Wi-Fi path** —
> `/run/wpa_supplicant`, `/run/tepna-wpa`, `/tmp/tepna-wpa-1000`, all outside the writable set — dated
> **2026-07-26 → 07-29 and none since**, while `ReadWritePaths` was never changed. The harvest still runs
> daily (849 journal lines since 08-08, most recent today), so it was fixed in code or that leg is no
> longer reached. **Which of the two is not established here**, and saying so is the point: the
> prediction §3 makes — *"any new helper that writes outside that list will fail the same way, and the
> failure looks like a permissions bug rather than a sandbox one"* — had already come true in a
> different subsystem before the brief was written.
>
> **✅ RESOLVED 2026-08-18 — it was FIXED IN CODE, and the leg is still reached.** The note above left the
> two possibilities open and said so; both are now settled. A four-commit chain lands exactly when the
> errors stop: `76fa742c` *"probe for a writable wpa control dir — /tmp is read-only in the unit"* (07-28),
> `3d62a4b6` (07-28), `cb63b31a` (07-28), `aa1ed645` *"wpa_cli could not reach the supplicant from inside
> the sandbox"* (07-29). The errors ran 07-26 → 07-29 and stopped there.
>
> **And the leg is not merely quiet:** the box logged **358 harvest/wpa lines in the last 7 days with ZERO
> `Read-only file system` errors** — so this is a fix, not an unreached branch. Both halves were measured,
> because *"it stopped erroring"* and *"it stopped running"* are indistinguishable from an error count alone.

## 4 · The interlock ratio is real data, and nobody is looking at it

47 deferrals against 41 restarts over the box's history. That is not a curiosity: it means **the box
spends a large fraction of its life running code that is on disk but not loaded**, bounded only by when
the subject stops wearing a sensor.

- [ ] Decide whether that is acceptable, or whether a deploy should be able to say "restart at the next
      idle moment" rather than waiting for the next 30-minute tick to re-check. The `--force-restart`
      mode added 2026-08-14 covers the impatient case but not the patient one.
      **📊 MEASURED 2026-08-18 — the decision now has its number, and "a large fraction" is 68.6 %.**
      A deferral *streak* (consecutive `deferred` ticks ending at a `restarted`) is the interval during
      which the box runs code that is on disk but not loaded. From `journalctl -u tepna-update`, a 13-day
      window, **17 closed streaks**:

      | | hours running unloaded code |
      |---|---|
      | median | **8.27 h** |
      | mean | 12.72 h |
      | max | **70.09 h** (08-05 22:12 → 08-08 20:18, 5 deferrals) |
      | total | 216.2 h of a 13-day window = **68.6 %** |
      | streaks ≥ 4 h | **16 of 17** |

      The ratio has also grown since the brief was written: **88 deferrals against 66 restarts** in 30 days,
      versus the 47/41 recorded above. Two things follow that prose did not make visible. First, this is the
      **normal** case, not a tail — 16 of 17 streaks exceed four hours, so the 70 h outlier is not what makes
      it a problem. Second, the second box below hypothesises *"deferring the same commit for 9 hours"*; the
      measured **median is 8.27 h**, so that is the typical night, not a bad one.
      **Recommendation (the decision remains the owner's):** the patient case is worth building — a deploy
      that can say *"restart at the next idle moment"* would collapse the median from ~8 h to minutes, and
      it is the 16-of-17 that it fixes, not the outlier. Left unticked deliberately: this supplies the
      number the box asked for, it does not make the call.
- [ ] `deferred` is currently INFO-level prose in a journal. If a deploy matters, nothing surfaces "this
      box has been deferring the same commit for 9 hours".

## 5 · Transient network failure is handled, and is worth a counter

One cycle died on `fatal: unable to access github.com … Connection timed out after 300039 ms`; the unit
went `failed` and the next tick recovered. §5 of the parent brief argues a nonzero exit is precisely
what makes drift visible, so this is working — but a *single* transient failure and a *persistent* one
look identical in `systemctl status`.

- [ ] Distinguish "failed once, recovered" from "failing every tick since Tuesday". A consecutive-failure
      count in the report, or a `RESTART-OWED`-style marker, would do it.
      **📊 MEASURED 2026-08-18 — "failing every tick since Tuesday" is not hypothetical. It happened.**
      Classifying 30 days of `journalctl -u tepna-update`: **38 failure events against 300 success/defer**,
      with consecutive-failure runs of **[30, 5, 3]**.

      | | |
      |---|---|
      | longest streak | **30 consecutive failure events** |
      | from → to | 2026-08-04 22:00:37 → 2026-08-05 07:20:44 |
      | **wall-clock span** | **9.3 hours** |

      For 9.3 hours the box could not update and — exactly as this section predicts — `systemctl status`
      showed what a single transient failure shows. **Nobody noticed.** A streak of 3 also occurred, so it
      is not one freak event.
      ⚠ Caveat: these are failure *events* in the journal, not ticks, so 30 is a lower bound on ticks
      affected and **9.3 h is the reliable figure**. The counter this box asks for is justified — it would
      have fired three times in 30 days, once for most of a night.

## 6 · Done when

- [ ] The helper-install gap is either closed by §2's design **or** explicitly accepted by the owner and
      recorded here, so it stops being rediscovered.
- [x] §3's audit is run and its answer written down. **Stale-unchecked — §3's own two boxes are both closed with the per-helper writes table; verified 2026-09-02.**
- [ ] §4 and §5 are decided, not merely noted.
