<!--
  OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — the code arms are DONE: the RECORDING state machine f127d88c (#1751)/d9c66a91 (#1760), the T3 `VERIFYING` emit 954720bc (#1761), and the arming diagnostics with both-direction controls (`test_on_close_NEVER_INHERITS_unlike_on_doff`, `test_presence_wire.py:368`). What remains: **§24's real-ring tests** need a worn advertising/recording ring, and the **T-series ledger has never been written in production** — verify at the next auto-pull from `inventory.jsonl` on the box. 🔴 **RESIDUE CORRECTED 2026-09-03 — my 2026-09-02 note was WRONG and this brief carried it for a day.** It read: *"§22's restart matrix is 5 of 8; the 3 missing cases are the recording-axis ones and their dependency cleared when #1751 landed — three tests, nobody assigned."* **Do not write those three tests.** #1751 landed the recording STATE MACHINE; §10's cases 2, 3 and 7 need DURABILITY — something that survives a host restart. The two share a vocabulary and nothing else, and I called the capability present because the identifier had landed. Verified 2026-09-03: `oxy_lifecycle` has no load/restore path, nothing reads `OXYLIFE.csv` back, `oxy_restart.plan` reconciles ledger-vs-disk for downloaded `.dat` FILES rather than in-progress state, and there is no boot-time recovery for the ring. **The recording axis is write-only across a restart**, so §10's three cases are exactly as blocked as §10 already said.
  ✅ **And the worked example exists one lane over:** the CPAP path already does this — `_cpap_autostart_boot` walks the journal back at boot to reconstruct session state. So the real residue is not three tests but **"the ring's recording axis has no boot-time recovery, and CPAP is the pattern to copy"** — a design unit with a reference implementation, not a test-writing chore. **Owner:** unassigned · **Next step:** decide whether the ring needs boot recovery at all before anyone writes a line. **Owner:** Heron · **Next step:** the 3 restart-matrix tests) · **Created:** 2026-08-24

# O2Ring `.dat` auto-harvest — and the event path that has never armed

The spec asks for event-driven harvest on recording-end, with the poller demoted to a reconciliation
safety net. **The §1 architecture map found that decision already made, already shipped, already
deployed — and never once executed.**

---

## 1 · §1 ARCHITECTURE MAP — what is actually there

`capture.py` carries two **pure, selftest-shaped** event triggers, with their own reasoning recorded:

```python
def charger_pull_due(charging, since, now, settle, already) -> bool
def notworn_pull_due(worn, since, now, settle, already) -> bool
```

> *"far faster than autopull_poller's hourly cadence (VIGIL-DEEP-ANALYSIS §2C: the old poller could
> delay the pull up to an hour)"*

So "demote the poller" is not a proposal. It is a shipped decision. Writing this brief as though the
trigger were missing would be the stale-capability error the house keeps re-finding — costing work as
unbuilt when it ships.

## 2 · 🔴 THE FINDING — the event path has NEVER ARMED

Measured on the capture box, whole journal:

| line | occurrences |
|---|---|
| `auto-pull: armed` (event triggers) | **0** |
| `auto-pull: enabled` (poller) | **312** |
| any not-worn / charger trigger firing | **0** |

The loop returns before arming:

```python
if not pcfg.get("auto") or not pcfg.get("on_charger", True):
    return
```

```yaml
# box config (gitignored — the repo cannot see this)
auto: True
on_charger: False        # ← returns here
auto_interval_sec: 3600
```

### 2a · The flag's name describes a third of what it does

`on_charger` reads as *"disable the on-charger trigger"*. It also silently disables the **not-worn**
trigger — which has nothing to do with charging, and which the code's own comment calls
**"the only reachable trigger for a coin-cell device such as the H10"**.

⚠️ **Cross-device blast radius, and it is the part that makes this more than a ring finding.** The
Polar H10 runs on a CR2025 cell, so `charging` is permanently False and the on-charger path is
structurally unreachable for it. `notworn_pull_due` exists *specifically* to give it a trigger. That
trigger has been dead for as long as the flag has been set. **A recording device whose only retrieval
trigger is disabled fills its single onboard slot once and then silently records nothing** — the
fabricated-absence class from `POLAR-ONBOARD-BACKUP-FOLLOWUPS` §4.

### 2b · The symptom is an ABSENT log line

This is the fleet's defect class in its purest form so far. Nothing failed. Nothing errored. No gate
could see it, because **a gate cannot observe a line that was never printed**. It was found by
*counting arming lines* rather than by reading the code — the code says the feature exists, and it
does.

## 3 · What this dissolves

Two live arguments were about a path that has never run:

- **The settle-vs-sleep-window question.** The doff settle is clamped to ≥210 s
  (`max(notworn_settle_sec, _DROP_NOT_WORN_SEC + 30)`), deliberately, so a pull cannot hold a link
  inside the power-drop grace. Whether 210 s beats the ring's post-drop awake tail is a real question —
  and **unanswerable until something arms**. It is sequenced after, not before.
- **This morning's night.** doff 04:38:10 → the doff trigger would have fired ~04:41:40 → it never
  armed → the recording waited for the 05:45:52 poller tick and was retrieved there, phase-exact.
  ⚠️ Which is why *"the poller is healthy"* and *"the system is slow"* were **both true**: the poller
  was the only mechanism running at all.

⚠️ **A conflation corrected in the making of this brief:** the ~10 s figure is the **file-close
debounce** (doff → `duration_s` reset), NOT a sleep window. Different constants, different clocks.
The ring stays awake while a link is HELD (6 h docked, measured today); after the link drops it stays
awake for an **unmeasured tail**, bounded today at ≤22 min. That tail is the missing constant, and §5
schedules it.

## 4 · UNIT 1 — split the flag, and make arming visible

**(a) `on_charger` governs ONLY the charger trigger.** The not-worn trigger gets its own flag.

⚠️ **The deployed box's behaviour must not flip on the next hourly auto-deploy.** Enabling a path that
has never executed is an *event* — it gets a deliberate config change and a visible arming line, not a
silent default flip. So the new flag defaults to the box's current effective behaviour, and turning it
on is somebody's decision.

**(b) The arming diagnostic prints in BOTH directions at daemon start:**

```
auto-pull: armed — not-worn (settle 210 s) + charger (settle 15 s), 2 device(s)
auto-pull: NOT armed — pull.on_charger=False disables the charger trigger; pull.on_doff absent → default off
```

An absence-shaped failure becomes present-shaped. **That is the whole fix**: the defect was never that
the flag was False, it was that nothing said so.

**(c) The H10 datum** is recorded in §2a so the blast radius is not re-derived as a ring-only issue.

## 5 · Sequenced after unit 1

- [x] **Measure the post-drop awake tail — the history route was RUN, and it does NOT resolve.** See
      §5a. ⚠️ **§8 demotes this**: the tail no longer gates the primary path, only the recovery path. See
      §5a. It yields the pull-duration half of the answer and a single uncontaminated data point, and
      it establishes that the tail needs a deliberate experiment. The three-way decision (sufficient /
      shorten the settle / hold-through-pull) is **still open**.
- [x] **§5's recording state machine** (`UNKNOWN → RECORDING → END_CANDIDATE → END_CONFIRMED`) on the
      `duration_s` axis. ⚠️ **The recording axis is `OXYII-PRESENCE-MODEL`'s model** — coordinate the
      seam before locking the enum, and do not collide with that brief's in-flight `IDLE_UNWORN` emit.
      **VERIFIED BUILT 2026-09-05 — `oxy_lifecycle.OxyRecState`**, and the seam warning is satisfied
      rather than merely avoided. The enum carries FIVE states, not the four this line lists —
      `NOT_RECORDING` ("duration_s observed 0") sits between UNKNOWN and RECORDING — with
      `REC_LEGAL_TRANSITIONS` pinning the legal moves, including the one worth reading:
      `END_CANDIDATE → RECORDING` for a ring re-donned before the old session's pull confirmed, whose
      *"confirmation debt lives in the inventory ledger, not in this axis"*.
      **The `IDLE_UNWORN` collision does not occur**: presence and recording are two SEPARATE enums in
      the same module — `OxyLinkState` (holding `IDLE_UNWORN`) and `OxyRecState` — so the two briefs'
      models coexist on their own axes instead of competing for one. That is the coordination this item
      asked for, done at the seam rather than by one side deferring.
- [~] **T0–T7 latency instrumentation — MAPPED in §11.** T1/T2/T4/T5 are already emitted (T4 via
      `classify()` — corrected 2026-08-25); only **T3** needs an emit, and T3/T4 currently share one
      timestamp. T6/T7 are downstream, T0 is the axis. ~~⚠️ §11(c): the ledger has never actually been
      written in production — verify at the next auto-pull.~~
      **§11(c) ANSWERED 2026-09-05 — the ledger IS written in production, measured on the box.**
      `/srv/tepna/captures/stored/inventory.jsonl`, 40 546 B, last written 2026-09-04 05:44:

      | | |
      |---|---|
      | rows | **109** across **20 distinct sessions** |
      | span | 2026-08-25 → 2026-09-04 |
      | states | DISCOVERED 22 · DOWNLOADING 22 · **VERIFYING 21** · VERIFIED 22 · COMMITTED 22 |

      So the transaction runs end to end in production, and **T3 is emitting**: 21 of 22. The single
      exception is `20260824222502`, the EARLIEST session in the ledger (2026-08-25 05:12) — it
      predates the T3 emit (954720bc, #1761) rather than showing a gap in it. Checked rather than
      assumed, because "21 of 22" invites exactly the wrong inference.
      ⚠️ **`[~]`, not `[x]`.** Two of this item's claims are settled — T3 emits, the ledger is written —
      and one is NOT: whether **T3/T4 still share a timestamp** is unverified here. Ticking on the
      strength of the settled half is the ticked-box-whose-first-clause-is-true defect §7 exists to
      catch.
- [ ] **§22's 8-case restart matrix — MAPPED in §10: 5 of 8 already built** by #1702's
      `crash_1…crash_10`. The residue (cases 2, 3, 7) is exactly the recording-axis cases and belongs
      with unit 2. Do not write eight new tests.
- [ ] **§24 real-ring tests — the OFFLINE half is RUN and green over n=42 (§12).** The remaining seven
      items need a live ring and are all axis-gated; §12a is the consolidated checklist for that window,
      and its first two items cost nothing but observation.
- [x] **§11 multi-recording ordering — ANSWERED in §9**, from the measured `O2RING-PROTOCOL` §4
      semantics. Ordering is protocol-guaranteed; the *eviction* half is unmeasured and §9a specifies
      the log that would close it.

### 5a · The history route was run, and both directions are confounded

**Pre-stated bands, written before the measurement:** tail ≥ (settle + worst pull) ⇒ fire-after-drop
as built · tail between one pull and that ⇒ shorten the settle (owner decision) · tail below one pull
⇒ hold-through-pull.

**Corpus.** 30 days of the box's `tepna-capture` journal (2026-07-25 → 2026-08-24), 21 596 lines
mentioning the ring. Drop anchors are the first `alert: … has been offline for ~N min` of each cluster
separated by ≥3 h; `N` is a clean mode (**5 min in 53 of 53**), so drop = t_alert − 300 s. **53 drops.**

**What history does give — the other half of the inequality.** Pull duration, n=433 completed pulls:
**median 20.7 s · p90 68.6 s · max 104.7 s**. So a fire-after-drop pull must fit inside
**210 s settle + ≤105 s ≈ 5.25 min** of awake tail.

Split by scope, because the two are not the same cost and §8's design uses the cheaper one:

| scope | n | min | median | p90 | **max** |
|---|---|---|---|---|---|
| `which=all` | 417 | 0.0 s | 22.1 s | 69.4 s | **104.7 s** |
| `which=latest` | 16 | 4.1 s | 18.1 s | 31.1 s | **41.1 s** |

**Zero of the 433 exceeded 170 s**, at either scope. `which=latest` is the scope a close-triggered
pull uses, and `which=all` bounds it above for the same content, so 104.7 s is the conservative
ceiling and 41.1 s the observed one for the path actually proposed.

**Why it cannot give the tail itself.** Both bounds are confounded, in opposite ways:

- **From below — the successes are re-wear, not tail.** Ten successful reaches land 1.2–15.0 min after
  a drop, which reads exactly like the answer. It is not: **nine of the ten are followed by an unbroken
  48–560 min session** (next `not advertising` at 48.4, 560.5, 84.0, 79.3, 244.4, 129.4, 129.2, 127.8
  and 125.9 min). A tail reach is brief by construction; a 2–9 h session is the ring being **put back
  on**. Three of those anchors sit at 20:19, 21:58 and 22:40 local — *bedtime* — so the "drop" is a
  pre-donning gap and the "success" is the start of the night.
- **From above — the failures are not attributable to the ring.**
  `BleakDeviceNotFoundError('O2Ring not advertising')` fires within 6 min of the drop in **49 of 53**
  episodes (the other four at 10.3, 13.2, 14.2, 19.8 min), which reads like a ~2 min tail. It cannot be
  spent that way: the message is a compound of *ring asleep* ∨ *adapter deaf* ∨ *out of range*, and this
  box's UB500 is known to go deaf. The qc `missing stream(s)` lines were tried as the discriminator and
  are too weak — only **4 of 53** windows show ring-only absence, **22** show other devices missing too
  (itself ambiguous, since a morning doff removes the H10 and the Verity as well), and **27** contain no
  qc line at all.

**The one uncontaminated point.** `2026-08-19 21:59:20` — a `_STORED.dat` save **1.2 min after a drop**,
with the link gone **2.4 min later**. That is a real post-drop pull: tail ≥ 1.2 min, and plausibly under
3.6 min — i.e. **below the 5.25 min the current settle needs**. n=1. It is a reason to run the
experiment, not a result, and it is the only reason §5's checkbox is not simply closed as "sufficient".

**⚠️ What the tail does NOT gate — the mistake is easy and I made it.** The tail bounds the *pull*,
not the *observation of the close*. `_DROP_NOT_WORN_SEC = 180 s` (`capture-host/capture.py:1421`) and
the settle is `max(notworn_settle_sec, _DROP_NOT_WORN_SEC + 30)`, so the link is deliberately **held
for 180 s** after not-worn — and the ring's close lands at ~10 s, well inside it. `observed_s` is
therefore available whenever the daemon was connected at the doff moment, and it does not depend on
the tail at all. The genuinely rare `source: "stored"` case is doff *during* a BLE outage, a smaller
and different population — and one this corpus is equally poor at sizing, since a mid-recording
interference drop and a doff drop share the same `not advertising` signature.

**The experiment this leaves.** After a *known* doff, attempt a connect every 30 s and record the first
failure — while holding the H10 connected throughout as an **adapter-health control that must stay
green**. Without that control the first failure is unattributable, which is precisely the reason 30 days
of history cannot answer a question one instrumented ring-window can. Fold it into the §24 real-ring
checklist rather than spending a separate window on it.


## 6 · ANSWERED by the owner — and the doff trigger was collateral damage

**Why is `on_charger: False`?** Asked 2026-08-24. The owner's recollection, **verbatim, with its
uncertainty left intact** because it is a recollection and not a record:

> *"maybe to do something with not fake streaming and blocking WiFi to download cpap data; probably
> more related to Verity but possibly somewhere in that direction."*

⚠️ **Recorded as "probably/possibly", deliberately.** Hardening a hedged memory into a definite
history is how a guess becomes a citation. Two candidate concerns are legible in it, and both are
**dock-time** concerns:

1. **Docked devices fake-streaming junk.** Real and measured — today's docked ring produced ~6 h of
   `contact=0` frames.
2. **BLE pull activity colliding with the ez Share WiFi harvest window** (2.4 GHz coexistence).

🔴 **But the flag governs pull TRIGGERS, not streaming — so for concern (1) it never did anything.**
Whatever fake-streaming was happening kept happening; the flag only stopped the pull. That is worth
saying plainly rather than treating the original intent as achieved.

**And the doff trigger was never the target.** It fires at mask-off, temporally unrelated to docking
and far from the 13:00 harvest window. It was collateral damage of the conflation in §2a — disabled
by a flag aimed at something else entirely.

### 6a · Enablement plan (owner-sanctioned) — ⚠️ **STEPS 3–4 SUPERSEDED BY §8**

`on_charger` **stays False** on the box: the original intent is respected, fuzzy as it is. Only the
doff trigger is enabled, in this order, so each step proves the next:

1. Unit 1 lands → deploy. **DONE 2026-08-24** (#1743; the box's hourly `tepna-update.timer` picked it
   up into `/opt/tepna` the same evening).
2. **Verify the arming line prints both states** — the diagnostic proving itself before it is trusted.
   **PENDING, and the mechanism is the interesting part.** The code reached `/opt/tepna` at 22:39
   while the running daemon had started at 21:33, so it is still executing pre-merge code and the
   line cannot appear yet — every `auto-pull` line in the surrounding 6 h is the old
   `enabled — checking … every 3600s` form. **This is not a stuck timer: `tepna-update.sh` defers the
   restart on purpose**, and says so —

   ```
   22:39:48  updated a7dfe94c9114 → 2458ade2c07d
   22:39:48  deferred — a device is recording; the daemon keeps the old code until the box is idle
   23:41:10  updated 575e22e89157 → 7880c4936647
   23:41:10  deferred — a device is recording; the daemon keeps the old code until the box is idle
   ```

   So **a deploy during a recording night is code-on-disk only**, and the restart lands when the box
   goes idle — after the night ends. **Do not force one**: the box's own policy already encodes the
   right answer, and overriding it would interrupt a capture to verify a log line. ⚠️ The corollary
   is worth carrying beyond this brief: on this box, *"merged and deployed"* does **not** imply
   *"running"*, and `git log -1` in `/opt/tepna` will agree with `main` while the daemon executes
   something older. Check `systemctl show tepna-capture -p ActiveEnterTimestamp` against the deploy
   time before concluding a change is live.
3. **`pull.on_doff` IS ENABLED — deliberately, since 2026-08-25.** This step previously read *"do not
   flip"*, on the grounds that under current code it fires the **superseded** settle-then-reconnect
   path. It is now on, and staying on until unit 2 lands. **Provenance, recorded unsmoothed:** the flip
   was the **owner's call, executed by the owner's own hand** — but made on the coordinator session's
   recommendation, and *that recommendation predated anyone reading this section*, which had landed
   overnight in #1753. A "do not" written by the fleet and a "do" recommended hours later in ignorance
   of it is the `doc-search-before-deciding` class, and it is recorded here rather than tidied away.

   **Why it is now retained on purpose, rather than merely tolerated.** The settle is
   `max(notworn_settle_sec, _DROP_NOT_WORN_SEC + 30)` = **`max(300, 210)` = 300 s** — confirmed live in
   the box's own arming line, `not-worn=on (300s)` — and the power drop is at **180 s**, so every firing
   attempts a reconnect **exactly 120 s after the link dropped**. That is §5a's unanswerable question,
   run on every natural doff in production. Worst case per firing is a failed reconnect that the hourly
   reconciliation net covers.

   ⚠️ **BUT ONLY SOME FIRINGS CARRY INFORMATION, and this paragraph first said otherwise.** A firing
   brackets the tail only when the attempt **reaches the air**. The failure classes are not
   interchangeable, and §5a already drew this line for the historical corpus:

   - `BleakDeviceNotFoundError` / *"not advertising"* → the ring did not answer ⇒ **tail ≤ 120 s** at
     that firing. **A data point.**
   - **success** (a pull completes) ⇒ **tail ≥ 120 s**. **A data point.**
   - **`BleakDBusError`** (`org.bluez.Error.InProgress`) → the ADAPTER was busy; the attempt never
     reached the ring. **No information whatever about the tail** — and this box's radio contends
     routinely.

   **First day's yield, measured:** three firings since arming at 05:49 — `06:03:37` O2Ring **failed
   (BleakDBusError)**, `06:06:27` and `07:07:31` Polar Verity `→ 0 new file(s)`. So **one** O2Ring
   firing, and it was the uninformative class: **zero usable tail points on day one.** Counting firings
   as measurements is exactly the *ran-and-examined-nothing* error this suite keeps finding, so the
   collection rule is: **filter on the failure class, never on the firing count.**

   ⚠️ **Superseded when unit 2 lands.** The wait-for-flush held-link path (§14) does not need the tail
   at all, and the settle-based path retires with it. Until then this is a measurement, not a design.
4. ~~The first doff window measures the settle-vs-awake-tail question on a real firing~~ — **no longer
   the question.** §8 removes the tail from the primary path entirely; §5a demotes it to gating the
   **recovery** path only.

**What replaces steps 3–4.** The doff trigger becomes a **unit 2** question, not a config flip, and
unit 2 waits on `OxyRecState.END_CANDIDATE` (§8b — the lead is landing the recording axis separately).
Sequence, once that symbol exists: unit 2 implements the close-triggered held-link pull **with the
§8a abort deadline**, its first real firing measures **close→finalized** (the one genuinely unmeasured
number), and only then is there a flag worth turning on. Step 2 stands unchanged and is still the
gate on everything after it.

*(This section was written before §8 and is left in place rather than deleted, per the brief
lifecycle: the superseded plan is the record of why the current one looks the way it does.)*

### 6b · Follow-up the flag never addressed

**Docked fake-streaming is a separate open item.** If a docked device streaming `contact=0` frames for
hours is unwanted, that needs its own fix — the pull-trigger flag never touched it, and closing this
brief without saying so would leave a concern that has been "handled" for an unknown period by a
mechanism that could not handle it.

## 7 · Done when

- [x] The two triggers are independently flagged, and no deployed behaviour changes silently.
      **VERIFIED BUILT 2026-09-05** — `autopull_arming()` returns `charger`/`doff`/`close` separately
      with a `why`. ⚠ The one silent path, `if not devices: return`, is a DECISION and not a gap:
      `test_the_charger_poller_returns_when_no_device_can_be_pulled` pins it, because a Muse fleet has
      no onboard recording and *"arming a poller with nothing to poll would log 'armed — pulling 0
      device(s)', which is worse than silence"*. Recorded because I re-derived that question and tried
      to "fix" it; their test reddened the change, which is what a defended decision is for.
- [x] `armed` / `NOT armed` prints at start with the governing flag and value named.
      **VERIFIED BUILT 2026-09-05** — both lines exist in `charger_pull_poller`; the armed one names
      every flag with its value (`charger=on (15s) not-worn=on (210s) on-close=OFF presence=…`).
- [x] A control proves the diagnostic fires in both directions — the absent-line failure cannot recur.
      **DONE 2026-09-05 (#2200)** — `test_the_autopull_arming_line_fires_when_ARMED` /
      `…_when_NOT_ARMED` in `tests/test_capture.py`. Paired deliberately: a one-directional test passes
      against a diagnostic that prints the same string unconditionally. Verified to bite — removing
      either line reds exactly its own test. The pre-existing test on `autopull_arming()` could not
      cover this: it checks the DECISION, not that the decision is ever said, and the original defect
      was an absence (0 `armed` lines against 312 poller lines on 2026-08-24).
- [ ] Every item in §5 is built, or recorded as declined with a measured reason.

---

## 8 · OWNER'S DESIGN RULING — pull over the HELD LINK, not after the drop

**Relayed 2026-08-24 via the `Mutator` session as owner-prompted; recorded with that provenance
rather than as an independently confirmed owner statement.** The owner asked why the link survives
180 s post-doff when the close is observed at ~10 s. Following it through dissolves the
settle-vs-tail conflict instead of resolving it:

> Since the ring closes its own session file ~10 s post-doff (device verdict), the 180 s grace
> protects nothing session-wise. **Do not fire after the drop at all — pull over the still-held link
> on observing the `duration_s` reset, then let the drop happen on its existing schedule.**

**The arithmetic closes the original objection, and the margin is wider than first stated.** The old
objection (§4's, quoted in `notworn_pull_due`'s docstring) is that a pull inside the grace *holds the
link open and blocks the drop*. It does not, on timing: close at **+10 s**, and the window to the drop
at **+180 s** is **170 s**. Against `which=latest`'s observed max of **41.1 s** that is a **4.1×**
margin; against the conservative all-scope ceiling of 104.7 s it is still **1.6×**, and **0 of 433
observed pulls exceeded 170 s**. So the clamp's battery concern is satisfied **by timing rather than
by ordering**.

**Consequences:**

1. `_DROP_NOT_WORN_SEC` and the ≥210 s clamp stay **UNTOUCHED**. The trigger moves from *"after drop
   + settle"* to *"on close, over the held link"*, which sidesteps the owner-gated power policy
   entirely rather than asking for an exception to it.
2. The awake-tail experiment (§5a) becomes **unnecessary for the primary path** and stays queued for
   the **recovery** path — a pull that fails and retries *after* the drop still depends on the tail.
3. §7's live-capture invariant is trivially satisfied post-doff: the paused frames are `contact=0`
   junk. Record the pause in the journal as always.
4. Unit 2 likely **simplifies**: the doff trigger keys on the recording-state engine's
   `END_CANDIDATE` — which §5 builds anyway — instead of the drop/settle machinery.
5. **Brief off-finger needs no special-casing.** The ring closes the session regardless, so an
   immediate pull of a short session is correct behaviour, not a false trigger.

### 8a · The two risks, and the one that must be built rather than measured

- **Trailer flush (measure it).** A pull at +10 s may catch an unfinalized file. Check the
  finalization predicate (`48 12 5a da`) before serving, re-serve on the existing recovery path, and
  **instrument the close→finalized delay — nobody has measured it.** Worst case the pull waits and
  retries inside the grace.
- 🔴 **An observed maximum is not a bound — the pull needs a HARD DEADLINE.** Every number above is
  an observed max over 433 samples, and the invariant being defended ("never delay the power drop")
  is one a single hung pull violates. The margin analysis says the design is *sound*; it does not say
  the implementation is *safe*. **The pull must abort itself at a deadline strictly inside the grace**
  (drop_at − a guard band), so blocking the drop is impossible by construction rather than improbable
  by measurement. Without that, this is the repo's standing defect class in mirror image: treating a
  distribution's tail as a guarantee. With it, the arithmetic above is a statement about how *often*
  the deadline is hit — which is the honest thing for it to be.

  **The requirement, as agreed with the lead and to be built verbatim:** the close-triggered pull runs
  under an **abort deadline of `drop_at − guard_band`**. Hitting the deadline **aborts to `.part`**,
  and the existing recovery inherits it — the hourly poller, or a post-drop retry (which is where §5a's
  awake tail still applies). The arithmetic's role is to predict the **frequency** of a deadline hit —
  rare, at 4.1× headroom on `which=latest` — and never to substitute for the deadline itself.


### 8b · The link-axis seam — settled with the lead, 2026-08-24

Scoping unit 2 turned up a blocker that is worth recording because it is a point **in §8's favour**:
**§8's held-link pull was not representable in `capture-host/oxy_lifecycle.py`'s landed transition
table.** Entry existed — `(IDLE_UNWORN, PAUSED_FOR_PULL)` and `(LIVE, PAUSED_FOR_PULL)` — but neither
`PAUSED_FOR_PULL` nor `PULLING` had any edge back to `LIVE` or `IDLE_UNWORN`; the only route home was
`→ CONNECTING → CONNECTED → LIVE`. The table therefore **encoded the old design as an invariant — a
pull costs the link** — which is exactly what §8 overturns, and a held-link pull handing the link back
would have raised `InvalidTransition`.

**That is the transition table doing its job.** The invariant was load-bearing for fire-after-drop, and
it fails *loudly at runtime* rather than silently — which is the visible failure mode these tables are
built for. It was found by reading the table before writing against it, not by a gate.

**Settled (the lead owns both, and is building the recording axis):**

1. **The recording axis is a SECOND enum in `oxy_lifecycle.py`** — `OxyRecState`:
   `UNKNOWN / NOT_RECORDING / RECORDING / END_CANDIDATE / END_CONFIRMED`, the owner spec's five and no
   more, with its own transition table. **The lead builds it**, folding in the in-flight `IDLE_UNWORN`
   emit. Unit 2 keys on `END_CANDIDATE` as a real symbol and **must not mint its own vocabulary** —
   as of this writing `END_CANDIDATE` does not yet exist anywhere in `capture-host/`.
2. **The two tables stay independent — no cross-axis transitions, ever** (owner spec §3). Correlation
   happens in the **reader**.
3. **Journaling: the same `OXYLIFE` writer with an appended `axis` column** (append-only; blank = link,
   for historical rows). Both axes in one journal, no second sidecar.
4. **All four resume edges become legal:** `(PULLING → LIVE)`, `(PULLING → IDLE_UNWORN)`,
   `(PAUSED_FOR_PULL → LIVE)`, `(PAUSED_FOR_PULL → IDLE_UNWORN)`. **The resume target is chosen by
   current contact at exit** — worn → `LIVE`, unworn → `IDLE_UNWORN`. §8's doff case lands in the
   latter, but a pull **may** resume directly into `LIVE`: manual and reconciliation pulls can run
   worn, so the autopull's off-finger condition makes `IDLE_UNWORN` the *common* exit, not the only
   legal one.
5. 🔑 **Success and deadline-abort share the same edge; the journal `reason` distinguishes them**
   (`"pull complete"` vs `"aborted at deadline — .part retained"`). The `PAUSED_FOR_PULL` pair covers
   abort-before-start, the `PULLING` pair covers success *and* mid-pull abort. **Do not mint a state
   per outcome** — the LINK state after either outcome is genuinely identical, and a state per outcome
   would put ledger facts into the link axis.


## 9 · §11 MULTI-RECORDING ORDERING — answered from measurement, with one gap left open

§11 asks for the ring's *"actual device ordering semantics"*, warns *"do not assume filename ordering
is chronological unless the protocol guarantees it"*, and asks the scheduler to prioritise the session
most at risk of being overwritten. Taking those three in turn:

**Ordering needs no assumption — the protocol supplies it.** `0xF1 LIST` returns a **count byte + N×16-byte
slots**, each a `YYYYMMDDhhmmss` **14-ASCII** stamp plus 2 zero pad (measured on hardware,
`O2RING-PROTOCOL-2026-07-17-BRIEF.md` §4). That key is fixed-width, zero-padded and most-significant-first,
so **lexicographic order on the raw slot bytes IS chronological order**. §11's caution is satisfied by the
protocol rather than by assumption. **Sort the raw 14 bytes; do not parse to a date in order to sort** — a
parse introduces the Clock-Contract failure modes (§🔒) into an operation that does not need them.

**One discontinuity, and it is already observable.** The key is the **ring's own RTC**, which the daemon
syncs to the host at first contact, on a new recording session, and on a drift backstop. Across an RTC
reset (battery) the keys are **not monotonic** — a stale-dated session can sort before genuinely older
ones. Do **not** read non-monotonic keys as corruption: they are an RTC event, and one the box already
surfaces — `nightqc.rtc_drift_summary` rolls the `_rtclog.csv` written by `RingClockLogWriter`, which
watches the ring's RTC against the host every ~10 min and records battery-reset events precisely because
`STATUS` keeps only the latest.

🔴 **"Prioritise the session most at risk of being overwritten" CANNOT be implemented today — the eviction
policy is UNMEASURED.** Neither `O2RING-PROTOCOL` nor `OXYII-PROTOCOL-HARVEST` records how many sessions
the store holds or what the ring does when it is full. The measured capacity fact is **per session**, not
per store: the 10 h / 36 000-sample / 108 058 B cap at which a session stops and does not roll over. Ranking
by "oldest is most at risk" would be exactly the assumption §11 forbids, one level down from the filename
question it warns about.

**What is measured, and it bounds the urgency.** Over 30 days of box journal, sessions newly retrieved per
pull are **1 (×11) · 2 (×4) · 4 (×1)** — at most four accumulating between pulls, against 42 distinct
sessions retrieved in total. So the loss §11 describes ("new session arrives + processing takes too long +
oldest session is lost") is a real shape but not a pressing one at the current hourly cadence.

### 9a · The instrumentation that closes it — and it costs no extra round trip

**`LIST` is already issued on every pull, and its reply already carries the count byte and every slot key.
Nothing logs them** — confirmed by grep over 30 days of journal: there is no line reporting a list size or
its contents anywhere. Recording the full list (count + keys) at each pull makes two questions answerable
**from ordinary operation instead of a dedicated experiment**:

- **Capacity** — the count stops growing at the store's limit.
- **Eviction** — a key present in one list and absent from a later one, never pulled, is a lost session,
  and it is the only direct evidence of the policy §11 wants the scheduler to respect.

Until that log exists, "most at risk" has **no evidence behind it**, and the honest scheduler behaviour is
the one already shipped: pull `which=all`, oldest-key-first, and let completeness stand in for a priority
we cannot yet justify.


## 10 · §22 RESTART RECOVERY — 5 of 8 cases are ALREADY BUILT; the residue is exactly the axis cases

§22 lists eight restart cases and requires that after a restart the system reconcile *"device state +
local durable state + unfinished `.part` state + session journal"*. **Do not write eight new tests.**
Five are already covered by the `crash_1…crash_10` series `oxy_transfer.py` shipped with (#1702), and
the three that are not are precisely the ones gated on the recording axis. Mapped case by case:

| § | case | status | where |
|---|---|---|---|
| 1 | host restarts while **not connected** | ✅ covered | `crash_1_before_any_request_leaves_nothing`, `crash_9_after_the_ledger_write_everything_agrees` |
| 2 | host restarts **during recording** | 🔴 **blocked** | needs the recording axis — nothing durable records "a recording is in progress on the device" |
| 3 | host restarts **immediately after recording ends** | 🔴 **blocked** | `END_CANDIDATE` must survive a restart before this is testable |
| 4 | host restarts **during `.dat` download** | ✅ covered | `crash_3_mid_download_leaves_a_part_that_is_never_adopted`, `crash_4_complete_looking_bytes_are_still_not_adopted`, `resume_truncates_a_longer_stale_part_rather_than_splicing` |
| 5 | host restarts **after download, before atomic commit** | ✅ covered | `crash_6_verified_but_not_committed_is_recoverable`, `crash_7_a_failed_rename_leaves_the_source_never_neither` |
| 6 | host restarts **after commit, before analysis** | ✅ covered | `crash_8_committed_bytes_with_a_stale_ledger_are_repulled_never_lost` |
| 7 | **BLE disconnects during recording** | 🔴 **blocked** | recording axis again |
| 8 | **BLE disconnects during `.dat` pull** | ✅ covered | `download_reports_a_transport_exception_as_transport`, `select_retries_a_recoverable_failure_within_the_bound`, `select_stops_at_the_attempt_bound` |

**The four reconciliation legs §22 names are all implemented**, and it is worth naming which function
owns each so a later reader does not go looking for one module that does all four:

- **device state** → `oxy_transfer.select(listing, ledger_rows)` — what the ring still holds against
  what the ledger has seen.
- **local durable state** and **unfinished `.part`** → `oxy_inventory.reconcile(ledger_rows,
  disk_listing)`, whose four outcomes (`verified` · `repull` · `missing` · `size_drift`) are
  deliberately asymmetric — `size_drift` in particular is never silently re-trusted *or* re-pulled.
- **session journal** → the ledger rows both of the above consume.

⚠️ **What these tests do NOT establish, stated so it is not over-claimed.** They are unit tests over
pure functions that *construct the state at each crash point*; they do not actually restart a process.
That is the right design rather than a shortcut — **a process kill does not lose page-cache data**, so
a kill-based harness cannot test durability no matter how it is written; durability against **machine**
failure is `fsync`'s job and is covered separately in `test_chaos_ordering.py`. So this table is a claim
about **reconciliation**, and the honest reading of "§22 is 5/8 done" is *"five of the eight
reconciliation behaviours are pinned"*, not *"five of the eight crashes have been survived in
production"*.

**What to build when the axis lands:** cases 2, 3 and 7 — one restart-reconciliation test each, keyed
on `OxyRecState` surviving a restart. They belong with unit 2, not before it.


## 11 · §23 T0–T7 — three stamps have a home, and NOT ONE has yet been written in production

§23 asks for eight timestamps and the deltas between them, with the key metric **recording end →
durable raw `.dat`**. Three separate facts, and they are easy to conflate:

**(a) Where each stamp would live.** `oxy_inventory` rows already carry an `at` field — injectable so a
row can never carry a fabricated time — and its states line up with §23's stages. But only four states
are actually emitted by `pull_session.pull()`, so the mapping has holes:

| stamp | §23 | ledger state | emitted today? |
|---|---|---|---|
| **T0** | recording end observable | — | 🔴 **recording axis** (§8b) |
| **T1** | harvest requested | `DISCOVERED` | ✅ yes |
| **T2** | `.dat` download starts | `DOWNLOADING` | ✅ yes |
| **T3** | last byte received | `VERIFYING` exists in `STATES` | ❌ **never emitted** |
| **T4** | verification complete | `VERIFIED` | ✅ yes — see the correction below |
| **T5** | atomic commit complete | `COMMITTED` | ✅ yes |
| **T6** | decode complete | — | ❌ downstream, no row |
| **T7** | event ledger durable | — | ❌ downstream, no row |

**⚠️ CORRECTED 2026-08-25 — this table first listed T4 as never emitted, and that was wrong.**
`pull_session.pull()` writes the post-download row with a state returned by
**`oxy_inventory.classify()`**, which yields `VERIFIED` whenever the Format-A trailer parses. The
original claim came from grepping for the literal `oxy_inventory.VERIFIED` in `pull_session.py`, which
finds nothing — the constant never appears there. **Occurrence is not reachability**, and a
literal-name grep cannot see a state chosen at runtime. Only `VERIFYING` is genuinely never written:
`classify()` returns exactly `DISCOVERED` · `PARTIAL` · `VERIFIED`, never `VERIFYING`.

So the real gap is **one stamp, not two** — and smaller still than that:

- **T3 and T4 currently share a single timestamp.** One row is appended after the download carrying
  the classify verdict, and its `at` is simultaneously "bytes complete" and "verdict reached". For a
  verify step that is a trailer parse over bytes already in memory, that conflation is nearly free —
  but §23 asks for both, and `T4 − T3` is precisely the number that would say whether verification
  ever costs anything.
- **Separating them is one emit**: append a `VERIFYING` row *before* `classify()`, leaving the existing
  row as T4 unchanged.

T6/T7 are downstream of this module entirely. T0 is the axis.

**(b) The key metric is not yet computable, and the reason is T0.** *Recording end → durable raw* is
`T5 − T0`, and T0 is exactly the stamp the recording axis has to supply. Every other input to it exists.
So §23's headline number arrives with unit 2 — it is not separately blocked.

🔴 **(c) The ledger has NEVER BEEN WRITTEN in production, and this is the part worth acting on.** The
transactional pull layer was wired into `pull_session` by **#1733, committed 2026-08-24 15:41**. The most
recent auto-pull on the box saved at **05:45 that same morning** — *before* the wiring. There is
consequently **no `inventory.jsonl` anywhere on the box**, verified directly, despite 42 stored sessions
having been retrieved into that same directory over the preceding month.

That is not a defect; it is the *unexercised* state, and it is the one this repo keeps mistaking for a
working one. Everything reads correct — the code is present, deployed, imported and reachable from
`capture.py` via `pull_session.pull()` — and **not one row has ever been written.**

**So the next auto-pull is a verification opportunity, and it should be treated as one:** confirm
`inventory.jsonl` appears in the stored directory and carries `DISCOVERED` / `DOWNLOADING` / `COMMITTED`
rows with plausible `at` values. Until that has been *seen*, "the transactional pull layer is live" is a
claim about code, not about behaviour — and §🔏's rule applies unchanged: **prose is not evidence.**

⚠️ Note also that this qualifies §10. Its "5 of 8 restart cases are already built" is a statement about
the **library**, which `pull()` genuinely does call — but the ledger those tests reconcile against does
not exist on the box yet, so no restart has ever been *recovered from* in production either.


## 12 · §24 REAL-CORPUS VERIFICATION — the offline half is RUN and green (n=42)

§24 requires the **existing real O2Ring corpus** and says *"do not consider synthetic tests
sufficient."* Its thirteen items split cleanly, and the split is the useful part: **six are verifiable
against the committed corpus with no ring window at all**, and they have now been run against all
**42 stored sessions** on the box (`/srv/tepna/captures/stored/`, 2026-07-23 → 2026-08-23).

| § 24 item | result over n=42 |
|---|---|
| **session identity** | **42/42 unique**, zero collisions |
| **duplicate prevention** | 0 duplicate stamps — the `device/YYYYMMDDhhmmss` key holds on real data |
| **`.dat` discovery** | 42/42 carry `format_a: true` |
| **trailer duration** | `approx_samples == (bytes − 10 − 48) / 3` for **42/42** — the Format A arithmetic holds on every real file, not just the golden |
| **multiple stored sessions** | up to 4 accumulate between pulls (§9), all retrieved |
| **periodic reconciliation** | `declared_size == bytes` for **42/42** — no committed file is short of what the ring declared |

**Two findings beyond a pass/fail.**

🔑 **The finalisation predicate is present in 42/42 AND its POSITION is fixed.** `48 12 5a da` appears
in every real trailer at **byte offset 4** (hex offset 8), without exception. That is materially
stronger than "the magic is present somewhere": an implementer can check a fixed offset rather than
scan, and a predicate that scans would accept a file whose magic appeared by coincidence in the
averages/desat payload. §8a's trailer-flush check should read **`trailer[4:8]`**, not search.

⚠️ **Three of the 42 sessions sit exactly at 108 058 B — the 10 h hard cap.** `O2RING-PROTOCOL` records
that the ring stops a session at 36 000 samples and does not roll over; this corpus shows it **actually
happening on 7 % of sessions**, so the cap is an operational fact, not a documented edge case. Those
three nights lost everything past the tenth hour, and no amount of harvest correctness recovers it —
which is an argument for the §8 close-triggered pull on its own terms, since a *prompt* pull at least
bounds the exposure to one session rather than one cap.

### 12a · What still needs a real ring window

The remaining seven items cannot be settled offline, because each needs a **live** device transitioning
state: recording start detection · recording continuation · recording end detection · immediate pull ·
interrupted pull · host restart · BLE disappearance. All seven are downstream of the recording axis
(§8b), so they belong to the same window as unit 2 rather than to a separate errand.

**The checklist that window should carry**, consolidating obligations this brief has accumulated in
five different sections so they are not each rediscovered:

1. ✅ **§6a step 2 — DONE 2026-08-25, see §13a.** The diagnostic printed at the 04:52 restart and named
   both flag states plus the inheritance.
2. ✅ **§11(c) — DONE 2026-08-25, see §13b.** `inventory.jsonl` was written by the 05:12 pull:
   `DISCOVERED → DOWNLOADING → VERIFIED → COMMITTED`, sha256 identical across the last two.
3. **§5a** — the awake-tail probe: connect every 30 s after a known doff, **holding the H10 connected
   as an adapter-health control that must stay green.**
4. **§8a** — instrument **close → finalized**, the one genuinely unmeasured number.
5. **§9a** — log the `LIST` reply (count + keys) so capacity and eviction become observable.

Items 1 and 2 cost nothing and are pure observation; they should be checked at the next natural event
rather than scheduled.


## 13 · FIRST PRODUCTION EXECUTION — §12a items 1 and 2 are VERIFIED, and §23 has real numbers

The night of 2026-08-24 ended, the box took its deferred restart at **04:52:11**, and the poller pulled
at **05:12**. Both no-code observations §12a queued have now been made, on real hardware, and the pull
produced the ledger's **first four rows in its entire existence**.

### 13a · §6a step 2 — the arming diagnostic works, and names the flag

Unit 1 (#1743) existed because the event path had never armed and **nothing said so**. Verbatim from the
box, first restart carrying it:

```
04:52:11 INFO auto-pull: poller enabled — checking Wellue O2Ring-S every 3600s (only while it is off
         the finger), up to 3 tries. This is the RECONCILIATION NET; event triggers: charger=OFF
         not-worn=OFF (pull.on_charger=False; pull.on_doff absent -> inherits on_charger=False)
04:52:11 INFO auto-pull: NOT armed — no event trigger enabled (pull.on_charger=False; pull.on_doff
         absent -> inherits on_charger=False). The hourly poller still runs; it is a reconciliation
         net, not the primary path.
```

Both states named, the inheritance spelled out, and the poller explicitly distinguished from the event
path. **✅ §12a item 1 closed** — the silent-absence class that motivated unit 1 is now loud.

### 13b · §11(c) — the transactional ledger has now been written, and it is correct

`inventory.jsonl` exists (4 rows, session `20260824222502`, 65 872 B):

| state | reason | `at` | notes |
|---|---|---|---|
| `DISCOVERED` | listed on flash | …162.2100 | `size`/`sha256` null — nothing pulled yet |
| `DOWNLOADING` | transfer in flight | …162.2384 | path is the `.part`, `reported_size` 65 872 |
| `VERIFIED` | **trailer finalised** | …171.0630 | `size == reported_size`, sha256 recorded |
| `COMMITTED` | atomically committed into the night tree | …171.0721 | path is the final `.dat`, same sha256 |

Every property the design claims holds on the first real run: the `.part` carries the in-flight states,
`VERIFIED` is reached **by the trailer parsing** rather than by size equality, the sha256 is identical
across `VERIFIED` and `COMMITTED` (the committed bytes are the verified bytes), and the final row is the
only one naming the `.dat`. **✅ §12a item 2 closed.**

⚠️ **No `VERIFYING` row, correctly.** T3 landed in #1761 at ~05:00 and this daemon started 04:52, so the
pull ran on code that predates it. The next pull carries T3.

### 13c · §23's first real deltas — and the reason T3 was worth building

| interval | measured |
|---|---|
| **T2 − T1** list → download start | **0.028 s** |
| **T4 − T2** download **+ verify** | **8.825 s** |
| **T5 − T4** atomic commit | **0.009 s** |
| **T5 − T1** whole harvest, list → durable | **8.862 s** |

Two readings.

**The §8 margin is far wider than the conservative estimate.** A complete harvest took **8.86 s** against
the 170 s close→drop window — **19×** headroom, against the 4.1× §8 derived from `which=latest`'s
observed max. §8a's abort deadline remains mandatory regardless: this is one sample, and the deadline
exists so that blocking the power drop is impossible by construction rather than improbable by
measurement (§8a). But the design's timing premise is now supported by a real execution rather than by
a distribution over historical pulls.

**And the 8.825 s is exactly the opaque blob T3 exists to split.** It is download *and* verify together,
because until #1761 both ended at a single `at`. Whether verification costs 9 ms like the commit does, or
seconds, is not derivable from this table — which is the whole argument for the emit, now stated with a
real number attached rather than in the abstract.


## 14 · `run_status` DECODES, AND IT SETTLES UNIT 2's OPEN QUESTION

The first instrumented night (coordinator session, 2026-08-25) decoded the ring's `run_status` byte as a
**three-state machine**, and the third state is the one that matters here:

| value | meaning |
|---|---|
| **1** | idle / pre-commit — *includes the first 120 s of wear*, because the ring discards sub-2-minute sessions, so `1 → 2` flips at exactly `duration_s = 120` |
| **2** | committed recording — held for the whole 6 h 05 m night |
| **3** | **post-close flush** — begins at the `duration_s` reset, runs **~110 s** with `dur = 0, contact = 0`, then quiet |

### 14a · Ruling: WAIT for `3 → 1`. Firing at the reset is systematically wrong, not occasionally

§8a listed the trailer-flush window as a risk to *mitigate* — check the finalisation predicate, re-serve
on the recovery path. With the flush **measured at ~110 s**, that framing is too generous to the
fire-at-reset option:

- The trailer is not on flash until **~doff + 120 s**.
- A pull fired at the reset (~doff + 10 s) completes around **doff + 20–50 s** (§13c: 8.9 s measured,
  §5a: 31 s p90 at `which=latest`) — i.e. **always before the trailer exists**.
- `classify()` therefore returns `PARTIAL` **every time**. Correctly and safely — the transactional
  layer cannot mis-commit it — but every close-triggered pull would spend the held link to produce a
  `.part` that must be re-pulled *after* the drop, on the awake-tail-dependent path §5a could not bound.

So fire-at-reset converts the primary path into a **guaranteed** detour. **Wait for `run_status 3 → 1`.**

### 14b · Consequence: the close-triggered pull MUST be `which=latest`

Waiting costs window. With §8a's 10 s guard band:

```
wait-for-flush window = 180 s grace − 120 s flush-end − 10 s guard = 50 s
```

against the measured pull-cost envelope (§5a, n=433):

| scope | p90 | max | fits the 50 s window? |
|---|---|---|---|
| **`which=latest`** | 31.1 s | 41.1 s | ✅ **yes, with headroom at its observed max** |
| `which=all` | 69.4 s | 104.7 s | ❌ **no — not even at p90** |

**`which=all` does not fit its own window on a typical night.** So the close-triggered pull is
`which=latest`; the hourly poller keeps `which=all` and remains the reconciliation net. The spec already
wanted that division of labour — this makes it **load-bearing rather than stylistic**.

### 14c · This is what promotes §8a's deadline from insurance to mechanism

§8a's abort deadline was derived against a **170 s** window, where a 8.9 s–41 s pull left it looking like
a formality. The real window is **50 s**, and `which=all`'s p90 exceeds it — so the deadline is not a
guard against a hypothetical hang, it is the thing that keeps a mis-scoped or slow pull from running into
the power drop. The §8a reasoning is unchanged and its conclusion is now load-bearing: **an observed
maximum is not a bound**, and at 50 s the distance between "usually fits" and "cannot overrun" is where
the whole invariant lives.


## APPENDIX — owner's full program spec (§1–27, verbatim)

    TEPNA — O2RING .DAT AUTO-HARVEST REFINEMENT
    ============================================
    (owner-issued spec, pasted verbatim into the lead session 2026-08-24 evening)
    
    OBJECTIVE
    ---------
    
    Improve the CURRENT Tepna O2Ring `.dat` harvesting implementation so that
    stored recordings are harvested at the safest and earliest possible time,
    while preserving the existing transactional, crash-safe, provenance-aware
    architecture.
    
    This is a REFINEMENT task, not a rewrite.
    
    The current implementation already has substantial infrastructure for:
    
    - O2Ring BLE communication
    - OXYFRAME parsing
    - recording-duration observation
    - `.dat` discovery
    - `.dat` download
    - `.part` files
    - recovery
    - identity/deduplication
    - SHA-256 verification
    - atomic promotion
    - pull lifecycle states
    - lifecycle journaling
    - crash-consistency testing.
    
    DO NOT replace these systems.
    
    The goal is to make the existing system behave more intelligently.
    
    ============================================================
    1. FIRST: READ THE CURRENT IMPLEMENTATION
    ============================================================
    
    Before changing anything, inspect the current HEAD completely.
    
    Specifically trace:
    
    - OxyII BLE connection lifecycle
    - OXYFRAME parser
    - `duration_s`
    - recording detection
    - O2Ring presence detection
    - `.dat` discovery
    - `pull_session`
    - `.part` handling
    - verification
    - atomic commit
    - pull lifecycle
    - OXYLIFE journal
    - session identity
    - existing scheduler/poller
    - OxyDex input path
    - current tests.
    
    Do not rely on old briefs if current code differs.
    
    Produce a short architecture map before modifying code.
    
    ============================================================
    2. CORE DESIGN PRINCIPLE
    ============================================================
    
    The `.dat` file is a TIME-LIMITED DEVICE-SIDE ASSET.
    
    The objective is therefore:
    
    DISCOVER RECORDING END
            ↓
    HARVEST `.DAT` IMMEDIATELY
            ↓
    MAKE RAW BYTES DURABLE
            ↓
    VERIFY
            ↓
    DECODE
            ↓
    PERSIST SESSION/EVENT INFORMATION
            ↓
    NORMAL ANALYSIS
    
    Do not wait for an arbitrary hourly poll when the system already has
    evidence that a recording episode has ended.
    
    ============================================================
    3. RECORDING STATE MUST BE SEPARATE FROM BLE STATE
    ============================================================
    
    Do NOT infer recording state directly from:
    
    - BLE connected/disconnected
    - advertising/not advertising
    - finger contact alone
    - SpO2 validity
    - notification arrival alone.
    
    These are transport/sensor observations.
    
    Maintain a distinct recording-state model.
    
    Conceptually:
    
    TRANSPORT:
    
    NOT_SEEN
    CONNECTING
    CONNECTED
    LIVE
    INTERRUPTED
    DISCONNECTED
    
    RECORDING:
    
    UNKNOWN
    NOT_RECORDING
    RECORDING
    END_CANDIDATE
    END_CONFIRMED
    
    Do not unnecessarily add more states.
    
    The two dimensions must remain independent.
    
    ============================================================
    4. USE duration_s AS THE PRIMARY MEASURED RECORDING SIGNAL
    ============================================================
    
    The current research and implementation indicate that `duration_s`
    advancing is the strongest measured indication that the O2Ring is
    actively recording.
    
    Use the existing implementation.
    
    Do NOT replace it with:
    
    - contact detection
    - BLE presence
    - advertising state
    - arbitrary timeout
    - SpO2 validity.
    
    When `duration_s` is observed advancing:
    
        RECORDING = RECORDING
    
    When `duration_s` resets or otherwise indicates episode termination:
    
        RECORDING = END_CANDIDATE
    
    Do not immediately assume the session is definitely closed if the
    current evidence is ambiguous.
    
    ============================================================
    5. END DETECTION
    ============================================================
    
    Design a small deterministic state machine.
    
    Example:
    
    UNKNOWN
      ↓ duration_s advances
    RECORDING
      ↓ duration_s continues advancing
    RECORDING
      ↓ duration_s resets / episode boundary observed
    END_CANDIDATE
      ↓ attempt immediate `.dat` harvest
      ↓ decode trailer
      ↓ compare stored duration with observed duration
    END_CONFIRMED
    
    If the `.dat` cannot yet be retrieved:
    
    END_CANDIDATE
      ↓ retry using existing retry/recovery mechanisms
      ↓ do NOT discard the session.
    
    The exact transition logic must use current Tepna contracts.
    
    ============================================================
    6. IMMEDIATE HARVEST
    ============================================================
    
    Once a recording end is sufficiently established, trigger the existing
    `pull_session` path immediately.
    
    Do NOT create a second `.dat` downloader.
    
    Do NOT duplicate the transaction logic.
    
    The trigger should simply call the existing safe pull mechanism.
    
    Preferred:
    
    recording episode ended
            ↓
    enqueue high-priority pull
            ↓
    existing pull_session()
            ↓
    existing transactional download
            ↓
    existing verification
            ↓
    existing atomic commit.
    
    The pull must be asynchronous and must not block normal BLE processing
    longer than necessary.
    
    ============================================================
    7. DO NOT BREAK LIVE CAPTURE
    ============================================================
    
    The ring may still need to provide:
    
    - live OXYFRAME data
    - recording-duration observations
    - status information.
    
    The pull operation must therefore cooperate with the existing BLE
    lifecycle.
    
    If the current device protocol requires a temporary pause:
    
    use the existing PAUSED_FOR_PULL / PULLING mechanism.
    
    Do not invent another connection manager.
    
    The invariant is:
    
    LIVE DATA MUST NOT BE SILENTLY LOST JUST BECAUSE A `.DAT` PULL STARTED.
    
    If some interruption is unavoidable, record it explicitly in the
    existing lifecycle/gap/provenance system.
    
    ============================================================
    8. DO NOT MAKE THE POLLER DISAPPEAR
    ============================================================
    
    Keep the periodic poller as a SAFETY NET.
    
    It must remain capable of finding a `.dat` if:
    
    - the recording-end event was missed
    - the host restarted
    - BLE disconnected at the wrong time
    - the ring became temporarily unavailable
    - the recording state was UNKNOWN
    - the host was asleep
    - an event notification was lost.
    
    Therefore:
    
    EVENT-DRIVEN HARVEST + PERIODIC RECONCILIATION
    
    is the desired architecture.
    
    The event path gives low latency.
    The periodic path provides recovery.
    Neither replaces the other.
    
    ============================================================
    9. RECONCILIATION
    ============================================================
    
    Every periodic poll should ask:
    
    "Does the device contain a stored recording that Tepna does not already
    have?"
    
    Do not rely exclusively on the recording-state machine.
    
    The system must converge to:
    
    DEVICE RECORDINGS = LOCAL DURABLE RECORDINGS
    
    subject to device availability and transfer failure.
    
    Known recordings must not be downloaded repeatedly.
    
    Use the existing identity mechanism.
    
    Do not use filename-only identity.
    
    ============================================================
    10. PRIORITY ORDER
    ============================================================
    
    When deciding what to do first:
    
    P0: Protect raw `.dat` from device-side overwrite.
    P1: Verify and atomically commit it.
    P2: Decode it.
    P3: Extract events.
    P4: Perform expensive analysis.
    
    Never reverse this priority.
    
    A successfully downloaded raw `.dat` must remain safe even if every
    downstream operation fails.
    
    ============================================================
    11. MULTIPLE RECORDINGS
    ============================================================
    
    If the ring contains multiple stored sessions:
    
    determine their actual device ordering semantics.
    
    Prioritize the session most at risk of being overwritten.
    
    Do not assume filename ordering is chronological unless the protocol
    guarantees it.
    
    The scheduler should prevent:
    
    new session arrives + processing takes too long + oldest session is lost.
    
    ============================================================
    12. SESSION IDENTITY
    ============================================================
    
    Use the current Tepna session identity mechanism.
    
    The same `.dat` discovered multiple times must resolve to the same
    logical session.
    
    Repeated discovery must be idempotent.
    
    A second pull attempt must not create a second session.
    
    A partial download followed by successful retry must result in ONE
    final artifact.
    
    ============================================================
    13. TRANSACTIONAL INVARIANT
    ============================================================
    
    The following invariant MUST always hold:
    
    A `.dat` is never considered DURABLE until:
    
    1. download is complete;
    2. file size is sane;
    3. protocol/content validation succeeds;
    4. SHA-256/content identity is recorded;
    5. atomic promotion succeeds.
    
    Use the current implementation.
    
    Do not weaken this for speed.
    
    Speed comes from starting earlier, not from reducing validation.
    
    ============================================================
    14. PARTIAL DOWNLOADS
    ============================================================
    
    Preserve current `.part` behavior.
    
    If the host dies: `.part` remains recoverable.
    If BLE disappears: `.part` remains recoverable.
    If the transfer fails: session remains recoverable.
    If verification fails: quarantine according to existing policy.
    
    Do not leave ambiguous files that appear to be complete.
    
    ============================================================
    15. RECORDING END VS FILE AVAILABILITY
    ============================================================
    
    These are two separate facts.
    
    Example:
    
    RECORDING_END_CONFIRMED but DAT_NOT_YET_AVAILABLE is a valid state.
    Likewise: DAT_AVAILABLE but RECORDING_END_NOT_OBSERVED is a valid state.
    
    Do not collapse them.
    
    The system should be able to say:
    
    RECORDING: ended at T1
    DAT: discovered at T2
    DAT: committed at T3
    
    This gives excellent provenance.
    
    ============================================================
    16. TRAILER CONFIRMATION
    ============================================================
    
    After successful `.dat` download and decode:
    
    read the stored recording trailer using the existing decoder.
    
    Compare the trailer's total duration with the independently observed
    `duration_s`.
    
    Use this as an independent session-boundary consistency check.
    
    Record:
    
    observed_duration_s
    stored_duration_s
    difference
    validation_status.
    
    Do NOT silently overwrite one with the other.
    
    If they disagree beyond the existing Tepna tolerance: mark the
    discrepancy. Do not fabricate a corrected value.
    
    ============================================================
    17. EVENT EXTRACTION
    ============================================================
    
    After raw `.dat` becomes durable, immediately make it available to the
    existing OxyDex analysis pipeline.
    
    Do NOT implement a second desaturation detector in the harvester.
    Do NOT implement a second pulse detector.
    Do NOT implement a second PPG detector.
    
    OxyDex remains responsible for oximetry interpretation.
    PpgDex remains responsible for live high-rate optical waveform
    interpretation.
    Integrator remains responsible for cross-sensor corroboration.
    
    The harvester's responsibility is:
    
    GET DATA SAFELY and MAKE DATA AVAILABLE QUICKLY.
    
    ============================================================
    18. PRESERVE HIGH-VALUE EVENT INFORMATION
    ============================================================
    
    If the existing OxyDex pipeline already produces event objects, ensure
    that those events can be persisted immediately after `.dat` analysis.
    
    An event should retain, where applicable:
    
    - session ID
    - event ID
    - event type
    - onset
    - nadir
    - recovery/end
    - duration
    - magnitude
    - signal quality
    - source
    - evidence classification
    - algorithm version.
    
    Do not create a competing event schema.
    
    Use the existing Tepna event contract.
    
    ============================================================
    19. CANDIDATES MUST NOT BE DESTROYED
    ============================================================
    
    Do not discard useful borderline candidates merely because they fail
    the final clinical/physiological threshold.
    
    Preserve the existing distinction between:
    
    MEASURED / ESTABLISHED / HEURISTIC
    
    and existing Tepna candidate/final semantics.
    
    Do not change Tepna's scientific rules.
    
    The objective is better preservation of evidence, not changing what
    counts as an event.
    
    ============================================================
    20. CLOCK / TIMESTAMP RULE
    ============================================================
    
    Use the existing Tepna Clock Contract.
    
    Do not introduce another timestamp authority.
    
    The harvester's job is to preserve:
    
    - device/session timing
    - host observation timing
    - download timing.
    
    These are different timestamps.
    
    Do not silently substitute host wall-clock time for device sample time.
    
    ============================================================
    21. JOURNALING
    ============================================================
    
    Use the existing OXYLIFE/session journal.
    
    Important transitions should be observable:
    
    RECORDING_DETECTED
    RECORDING_ACTIVE
    RECORDING_END_CANDIDATE
    DAT_DISCOVERED
    DAT_DOWNLOAD_STARTED
    DAT_DOWNLOAD_PARTIAL
    DAT_DOWNLOAD_VERIFIED
    DAT_COMMITTED
    DAT_DECODED
    DAT_ANALYSIS_COMPLETE
    
    Do not flood the journal with per-sample messages.
    
    Journal state transitions, not telemetry.
    
    ============================================================
    22. RESTART RECOVERY
    ============================================================
    
    Test:
    
    1. host restarts while not connected;
    2. host restarts during recording;
    3. host restarts immediately after recording ends;
    4. host restarts during `.dat` download;
    5. host restarts after `.dat` download but before atomic commit;
    6. host restarts after commit but before analysis;
    7. BLE disconnects during recording;
    8. BLE disconnects during `.dat` pull.
    
    After restart, the system must reconcile:
    
    device state + local durable state + unfinished `.part` state +
    session journal.
    
    No recording should be silently forgotten.
    
    ============================================================
    23. CRITICAL PERFORMANCE MEASUREMENT
    ============================================================
    
    Instrument these timestamps:
    
    T0 = recording end becomes observable
    T1 = harvest requested
    T2 = `.dat` download starts
    T3 = last byte received
    T4 = verification complete
    T5 = atomic commit complete
    T6 = decode complete
    T7 = event ledger/analysis durable.
    
    Report: T1-T0, T2-T0, T4-T0, T5-T0, T6-T0, T7-T0.
    
    The key metric is: RECORDING END → DURABLE RAW `.DAT`.
    The second metric is: DURABLE RAW `.DAT` → DURABLE EVENT DATA.
    
    Do not optimize based on subjective impressions.
    
    ============================================================
    24. TEST WITH REAL O2RING RECORDINGS
    ============================================================
    
    Use the existing real O2Ring corpus.
    
    Verify:
    
    - recording start detection
    - recording continuation
    - recording end detection
    - `.dat` discovery
    - immediate pull
    - trailer duration
    - session identity
    - duplicate prevention
    - interrupted pull
    - host restart
    - BLE disappearance
    - multiple stored sessions
    - periodic reconciliation.
    
    Do not consider synthetic tests sufficient.
    
    ============================================================
    25. DO NOT CHANGE SCIENTIFIC DEFINITIONS
    ============================================================
    
    This task is acquisition architecture.
    
    Do NOT alter:
    
    - ODI thresholds
    - desaturation definitions
    - event duration criteria
    - motion rules
    - PPG beat detection
    - HR algorithms
    - OxyDex evidence classifications
    - Integrator confidence rules.
    
    If an existing scientific rule appears wrong, report it separately.
    
    Do not mix scientific changes into this implementation.
    
    ============================================================
    26. ACCEPTANCE CRITERIA
    ============================================================
    
    The implementation is complete when:
    
    [ ] Recording state is independent of BLE transport state.
    [ ] `duration_s` is used according to the current Tepna evidence as the
        primary measured recording-state signal.
    [ ] Recording-end detection can trigger an immediate `.dat` pull.
    [ ] The existing transactional `pull_session` remains the ONLY pull path.
    [ ] The periodic poller remains as a recovery/reconciliation safety net.
    [ ] Raw `.dat` becomes durable before expensive analysis.
    [ ] Existing SHA-256 verification remains intact.
    [ ] Existing `.part` recovery remains intact.
    [ ] Existing atomic commit remains intact.
    [ ] Duplicate sessions cannot be created by repeated discovery.
    [ ] Recording end and DAT availability remain separate states.
    [ ] Trailer duration is compared against observed duration.
    [ ] All important transitions remain visible in the lifecycle journal.
    [ ] Host restart cannot silently lose an already-discovered recording.
    [ ] BLE loss cannot silently convert into "recording ended."
    [ ] Live capture is not silently corrupted by `.dat` harvesting.
    [ ] OxyDex remains the owner of stored oximetry analysis.
    [ ] PpgDex remains the owner of live high-rate PPG analysis.
    [ ] Integrator remains the owner of cross-sensor corroboration.
    [ ] Existing tests remain green.
    [ ] New tests demonstrate real recording-end → `.dat` harvest behavior.
    
    ============================================================
    27. FINAL ARCHITECTURAL GOAL
    ============================================================
    
    The final design should feel like this:
    
                             O2RING
                                │
                     live OXYFRAME stream
                                ▼
                      recording-state engine
                                │ duration_s advances
                                ▼
                           RECORDING
                                │ duration resets
                                ▼
                        END_CANDIDATE
                                ▼
                     HIGH-PRIORITY HARVEST
                                ▼
                         pull_session()
                     ┌──────────┴──────────┐
                  `.part`              BLE failure
                     ▼                     ▼
                 VERIFY                 RECOVER
                     ▼
                 ATOMIC COMMIT
                     ▼
                 DURABLE `.DAT`
                     ├──────────────► archive/evidence
                     ▼
                   OxyDex
                     ▼
                 event objects
                     ▼
                 GanglioR
                     ▼
                 Integrator
    
    Meanwhile:
    
    PERIODIC RECONCILIATION
            └────► catches anything the event-driven path missed.
    
    The design should be:
    
    EVENT-DRIVEN FOR SPEED
    + PERIODIC FOR RECOVERY
    + TRANSACTIONAL FOR SAFETY
    + MEASURED FOR STATE
    + DETERMINISTIC FOR REPRODUCIBILITY.
    
    Do not add complexity unless it directly improves one of those five
    properties.
