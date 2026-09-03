<!--
  RUN-POLAR-MUTATION-PASS-2026-08-08-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-08-08 · **Follows:** `CAPTURE-HOST-MUTATION-FLEET-2026-08-04-BRIEF.md` §4.1 · **DRAIN 2026-09-02 (Osprey):** section 6's `SKIP anchor` item **CLOSED** with evidence (see it — the string never existed in code; the mechanism's absence is what confirms retirement). **ONE item remains open** and it is real work, not a stamp: *the 45 timeouts re-run un-contended and reclassified*. **Owner: Osprey. Next step:** that re-run is one work-unit under the full gate; the brief flips DONE when it lands.

# `capture.run_polar` — the pass the fleet brief called the prize, and the one-line reason it was blocked

`CAPTURE-HOST-MUTATION-FLEET` §3 named this *"the single highest-value unit in `capture-host`"* — 502
reachable, 100 % concentration, 44 % of the fleet remainder in one function — and *"it has never been
attempted."* §4.1 gave it its own brief. This is that brief and its first pass.

## 1 · What blocked it was never the size

Earlier sessions measured `capture.py` and treated it as intractable **because of its size** (4 420
lines, a 26-minute run, 109 test files). That diagnosis was wrong, and the fleet brief's own
concentration metric already said so: it is ONE function with ONE fixture family.

The actual blocker is one line of the tooling. `tools/mutate.py` picks a module's test files
heuristically — tests that mention the module — and `capture.py` is imported almost everywhere, so it
selected **110 of them**. The clean baseline alone:

```
110 files   680 s        ← the heuristic's selection
 10 files     5.83 s     ← the files that actually reach run_polar
```

**117×.** mutmut derives its per-mutant timeout from that baseline and pays it per mutant. That is the
difference between a pass that runs and a pass that cannot be started, and it is `--tests`, not effort.

**The trade is deliberate and points the safe way.** A mutant killed only by a test outside the scoped
set now reads as SURVIVED — a false alarm, never a blind spot; the same superset property
`tools/mutate_pure.py` already relies on. Every kill claimed below is confirmed by ID against the real
module, and the full 3 000-assertion suite runs at PR time regardless.

## 2 · The measurement

`mutmut 3.7.0`, generation `26ba4c9b28e0`, scratch `mut-capture-9ugo1yv0`, 2026-08-08.

| | count |
|---|---:|
| `x_run_polar__mutmut_*` generated | **1 286** |
| killed | 586 |
| survived | 655 |
| timeout | 45 |

Triage of the 700 non-killed (`mutation_triage.classify`):

| bucket | as first measured | after the message-argument decision (§5.1) |
|---|---:|---:|
| REACHABLE | 560 | **400** |
| PROSE | 12 | **172** |
| UNOBSERVABLE | 128 | 128 |
| EQUIVALENT? | 0 | 1 |

**Ceiling 90.0 %,** unchanged — `ceiling()` subtracts only UNOBSERVABLE, deliberately, so setting work
aside cannot flatter the number. Quote it beside any kill-rate for this function or the number is
unattainable.

⚠️ **The 45 timeouts are not survivors and must not be reported as gaps.** A timeout under CPU
contention is a mutant that would otherwise have been killed — `CAPTURE-HOST-MUTATION-FLEET` §6 records
one 5.18 s test pushing three unrelated mutants from KILLED to TIMEOUT. They are carried to §5.

### The mutant-name form, because it cost a 978-second run

`--only 'capture.x__run_polar__*'` matches **nothing**. mutmut's name is `x` + the function name
verbatim: `_now` → `x__now__` because *the function* starts with an underscore; `run_polar` →
`x_run_polar__`, one underscore. The fleet brief's example (`capture.x__now__*`) is correct for its
own function and misleads when copied.

mutmut asserts `"Filtered for specific mutants, but nothing matches"`; `tools/mutate.py` surfaces that
as `rc=1` with a **truncated** traceback, and the results dump then reads `not checked` for every
mutant — **which is exactly the shape of the poisoned/mid-run read** the runbook warns about. A wrong
filter and a poisoned baseline are indistinguishable at the output. `--list` before `--only`.

## 3 · The first family: the live-telemetry contract (69 mutants, one cause)

The largest coherent family among the 560 was **`BUS.register` / `BUS.push` / `BUS.unregister` with an
argument DROPPED or set to `None`** — 69 of them, the exact class `blind_spots.py` finds statically.

**Why every one survived.** `test_telemetry.py` exercises the bus directly with hand-written calls.
`test_capture_runners.py` drives `run_polar` and then asserts on **files on disk**. The whole live
contract sat between the two, unobserved — and neither defect this path has actually shipped is
visible in a file:

* **2026-08-05** — the initial registration passed `pmd.SAMPLE_HZ[meas]`, the rate the hardware ships
  at, not the rate this box negotiated. `stream_health` judges WEAK as `eff_fs < 0.7·nominal`, so ACC
  delivering its agreed 25 Hz against a declared 200 scored 0.125 and painted amber all night.
* the **`bpm` card did not exist** — the strap's own HR was written to file and never registered, so
  it had no card at all while RR did.

Both are one argument. Neither reaches a file.

### 3.1 · A test that declared its own subject unreachable

`test_telemetry.py::test_capture_registers_pmd_streams_with_an_UNKNOWN_rate_until_negotiated` pins the
2026-08-05 fix by **scanning capture.py's source** for `SAMPLE_HZ`, and says why:

> *"the registration sits deep inside `run_polar`'s per-connection setup, behind a live BLE session
> that no unit test reaches. A behavioural test here would need the device."*

**The premise is false.** `FlexPolarClient` in `test_capture_runners.py` negotiates all six PMD streams
with no device at all, and the two-phase registration is plain in the calls:

```
('ecg', 'ECG (H10)', 'µV',   0, 1, ())     ← before negotiation: rate UNKNOWN
('ecg', 'ECG (H10)', 'µV', 130, 1, ())     ← after START: the negotiated rate
```

A text scan also cannot tell `0` from `1` — mutant 312 does exactly that and survives the scan. The
scan is LEFT IN PLACE (it guards a different thing, the literal in the source) but it is no longer the
only guard. **Generalise the lesson, not the fix:** a test whose docstring explains why its subject
cannot be reached behaviourally is a claim about the fixtures, and it should be checked against them
before it is believed — a sibling file already reached it.

### 3.2 · Result — 66 killed, 3 proven equivalent

`tests/test_run_polar_live_contract.py`, 10 tests. Every kill confirmed by re-applying the mutant to
the real `capture.py` under a unique-anchor guard, with `__pycache__` cleared per iteration (both are
§6 method findings that previously produced confident wrong answers).

| stage | killed | left |
|---|---:|---:|
| card identity · key rule · two-phase rate · RR+bpm cards · push shape · PPI order · unregister | 43 | 26 |
| + an `on_hr` frame, + rejecting a DEVICE-QUALIFIED stream | 62 | 7 |
| + the push-rate assertion | **66** | 3 |

**The 3 are EQUIVALENT, proven not assumed.** `BUS.unregister(_live_key(pmd.MEAS_NAME.get(meas,
str(meas)), tag))` — mutants 1017/1019/1020 mutate only the `.get()` **default**. `writers` is keyed
solely by `meas_of.values()`, and that set is identical to `MEAS_NAME`'s keys (`[0,1,2,3,5,6]`), so the
default is unreachable. The fleet brief §7 notes `EQUIVALENT?` has read **0** in every automated run
while equivalences keep being proved by hand; these are three more for that column, and they argue
again for wiring the witness search.

## 4 · Two things the measurement corrected — both would have shipped as wrong prose

* **The push-rate finding was not the defect I assumed.** Seeing `hz` mutants survive, I was ready to
  report that the 2026-08-05 false-amber defect still existed on the push side. It does not:
  `stream_health` takes its nominal from `m.fs`, set by `register`, which is correctly `0` until
  negotiated. The push `fs` instead drives `msg["fs"]` — the rate the live SSE frame declares and the
  monitor plots its time axis against — and the ring capacity `max(64, ring_seconds·rate)`. A `None`
  there collapses to `rate = 1`: a one-sample-per-second axis under a 130 Hz trace. Real, and a
  different defect from the one I nearly named.
* **18 of the 26 second-round survivors were not a hard case at all** — the driver simply never passed
  an `hr_frame`, so `on_hr` was never entered while its bus contract was being asserted "confidently".
  A test that does not reach the code says nothing about it, and it says it in green.

Also pinned while there: RR arrives in the SIG's 1/1024 s units. Pushing the raw value instead of
converting to ms is a silent **+2.4 %** on every interval — a plausible number in a plausible unit,
which is the class of error nothing downstream can catch.

## 5 · The work-list, after one decision

### 5.1 · A message call's ARGUMENTS are prose (decided 2026-08-08, owner)

`classify` used to return REACHABLE for a `log.*`/`print` call that lost an argument, on the reasoning
that it is killable *without* pinning wording: assert `ts in out`, which survives a reword and dies on
the drop. Sound in the small. At scale it was **160 of 560** — a quarter of a list whose entire job is
to say what deserves a human's time. Collecting them means asserting that particular values appear in
particular log lines across the daemon, which freezes operator-facing text and reds the build on every
message edit. That is the cost `CAPTURE-HOST-MUTATION-FLEET` §5 already declines to pay for `flush=`
and `XX`-wrapping; there is no principled reason to pay it here.

Two things make the decision honest rather than a way of shrinking a number:

> **Numbers settled 2026-08-09, after being corrected WRONGLY once.** The figures here are
> 560 → 400 REACHABLE, 12 → 172 PROSE, **160 moved**, computed on a line map verified 700/700 against
> the current `capture.py`.
>
> An intermediate commit changed them to 459/113/101. That was an artifact, and the mechanism is worth
> recording because it is the same one §5.4 is about. `in_message_call` is looked up as
> `mutant_line in message_call_lines(source)`. The mutant lines had been derived against `capture.py`
> BEFORE a rebase; `message_call_lines` was then run against the file AFTER it, which had grown by 75
> lines. Every lookup silently missed, so message arguments were not recognised and REACHABLE read
> high. Nothing raised — a line-number lookup against the wrong file is still a valid lookup.
>
> The guard that catches it is cheap and is now the first thing the triage does: assert that every
> recorded line still equals the mutant's own `minus` text. 700/700, or the numbers are not reported.

* **The ceiling did not move.** `ceiling()` subtracts UNOBSERVABLE only. PROSE is reported in its own
  column, so a reader sees exactly what was set aside and can disagree with it.
* **A mutation that ESCAPES the message stays REACHABLE** — a lost `%` operand that raises, an
  `and`→`or` on a guard that happens to mention `log`. Test-locked.

Implementing it exposed that the old rule had also been silently *under*-counting, in the direction
that costs work rather than hides it. `classify` sees one line, and most message arguments live on
CONTINUATION lines of a multi-line call — `pmd.CTRL_STATUS.get(st, hex(st)))` carries no `log.` to
match. `message_call_lines()` now parses the source and returns every line inside a log/print call,
which the caller passes as `in_message_call=`. It also follows a **logger method bound to a local**:

```python
_lvl = (log.warning if not (pmd.is_started(st) or transient) else log.debug if … else log.info)
_lvl("%s START %s (%s) → %s", name, pmd.MEAS_NAME.get(meas, meas), how, …)
```

Nineteen mutants sat on that pair of statements. The alias is inferred from the **code** (an assignment
whose value is an attribute of a logger), never from the identifier, so a local that merely happens to
be called `_lvl` is not swept in. The helper **fails closed** on unparseable source — an empty set, so
every line is judged on its own merits; failing open would let one syntax error mark a module PROSE.

### 5.2 · What is left

| family | count | note |
|---|---:|---|
| ~~`_set()` — the status-card fields~~ | **45** | **CLOSED** — 43 killed, 2 equivalent; see §5.3. NOT 66: the first grouping over-counted by 21 because `_STOP.is_set()` contains the substring `_set(` |
| branch conditions | 63 | the multi-iteration surface `_stop_after(…, 1)` never enters |
| backoff / sleep cadences | 23 | the four-way reconnect-sleep choice |
| writer dispatch | 21 | |
| PMD control-point I/O | 16 | |
| BUS | 69 | **closed by this brief's pass** |
| other | ~141 | incl. `decode_frame`'s `fs=`/`prev_last_ns=`/`scale=` (the seam anchor — dropping it silently reverts to nominal back-timing), `device_time`/`clock_skew_sec`, and the `stale_bond_hits`/`rebond_attempts` counters behind the two-strike logic that cost 4.5 h of ECG on 2026-07-29 |

**`_set()` was the next unit — §5.3.**

### 5.3 · `_set()` — the status card (45 mutants)

The same defect shape as the bus family, on the surface an operator and every alert actually read.
`_set` writes `STATUS["devices"][name]`, which is what `status.json` carries, what `monitor.html`
paints, and what `alerts.py` keys on. None of it reaches a capture file, so the file-based assertions
were blind to all of it.

**Asserted on the RECORDED CALLS, not only on the final dict.** The card is cumulative, so a later
`_set` hides a field an earlier one dropped — `connected=False, address=addr, last_error=None` is
overwritten by `connected=True` within milliseconds, and the point is that it ran. The recorder WRAPS
`_set` rather than standing in for it, because a replacement breaks `link_epoch`'s counter and the
charging inference downstream.

| stage | killed | left |
|---|---:|---:|
| session-open reset · `link_epoch` · `pmd_options` merge · `pmd_supported` · `device_time`+`clock_skew_sec` · rejected vs UNACKNOWLEDGED | 24 | 21 |
| + rising/falling battery · decode-error reason · optional backup · stall watchdog | 33 | 12 |
| + the blanket device-NAME check, the charging ORDER, `charging is False` | 36 | 9 |
| + the pause branch · the failed re-pair · the twice-refused discovery · the optional un-quiet | **43** | 2 |

**Closed: 43 killed, 2 proven equivalent.** The last four fixtures each drive a path that exists only
because something went wrong, and each pins a distinction that matters operationally rather than a
value that happens to be there:

* **paused vs adapter-recovering** — one branch, two reasons. A pull owning the link resolves in
  seconds; the watchdog resetting the adapter means the radio is being power-cycled. `connected` must
  read `False`, not `None`: None is this daemon's "unknown" everywhere else, and a card that cannot say
  whether the link is up is a different claim from one saying it is down.
* **a re-pair that itself fails** — there is no further move the daemon can make, so the card has to
  hand the job to a human. The absence of this whole recovery cost 4.5 h of ECG on 2026-07-29 while the
  task reconnected every ~70 s reporting success.
* **TWO consecutive service-discovery refusals, not one** — a single refusal is also what an ordinary
  mid-negotiation drop looks like, and re-pairing costs ~20 s of scripted `bluetoothctl`, so firing on
  one would re-pair on every flap.
* **an optional device that turns up stops being quiet** — leaving its address in `_OPT_QUIET` means a
  LATER genuine absence is never reported.

All four passed on their first run, which is the shape a fixture takes when it is not reaching the
code. The negative control is what settled it: 7 of 7 previously-surviving mutants died.

**Three fixtures were measuring nothing until the mutants said so**, and each failure is the same
species — a test that reaches green without reaching the code:

* the stall watchdog reads `_time.monotonic()`, which a patched `asyncio.sleep` does **not** advance.
  The test passed `_STREAM_STALL_S` in and still never entered the branch.
* `decode_frame` is **tolerant** of truncation — it returns `(None, [])` and the callback moves on. The
  real parse error is a frame whose declared type and encoding disagree (ACC needs `base == 1`).
* the battery refresh rides `secs % 120 == 0`; 40 ticks never reach it.

**The mutants also found a gap in my own assertions.** Several `_set(None, …)` mutants survived every
per-field test, because all of them read the KWARGS and ignored the device NAME.
`STATUS["devices"][None]` is a real dict that accepts every field silently — the operator's card simply
never changes, and on a multi-sensor box one strap's error lands on another's card. The fix is a
blanket check that every status write names the configured device, plus its mirror image (a call that
names the right card and carries no fields at all). Blanket rather than per-call deliberately: the
failure is generic, so it should also cover paths a later fixture adds.

**Two more proven equivalents.** Mutants 805/807 mutate the default of
`STATUS["devices"].get(name, {})` on the `pmd_options` line. `_set` opens with
`STATUS["devices"].setdefault(name, {})`, and the session-opening `_set(name, connected=False, …)` runs
first, so the key always exists and the default is unreachable — the same shape as the three in §3.2.

### 5.3b · The writer dispatch — the durable record (22 mutants)

The mirror of §3's bus family: that one pins what reaches the monitor and disappears, this pins what
is written to disk and is the only copy. The second is what the box exists to produce, and a wrong
column is not noticed until someone computes HRV from the night, months later, unrecoverably.

**Why all 22 survived.** The existing coverage is the file's EXISTENCE and its SIZE:

```python
ecgs = list((tmp_path / "captures").rglob("*_ECG.txt"))
assert ecgs and ecgs[0].stat().st_size > 60
```

Both are invariant under every one of these mutations. A PPI row with `hr` and `pp_ms` transposed is
exactly as long as a correct one — 60 is a believable interval only if you are not looking, and 850 is
not a believable HR only if you are.

**Closed: 12 killed, 10 EQUIVALENT.** The tests read the files back and assert column layout and
values: PSL's PPI order (interval first, hr LAST, flag bits split to blocker/contact/contact), the
three LED channels with ambient as its own column, ACC's three axes in order, GYRO/MAG's scaled floats,
ECG's back-timing (the frame stamps only its last sample, so `sensor_ns` must climb to exactly the
frame's value), and HR's split into `_HR.txt` + the `_RR.txt` sibling that is the HRV substrate.

**FINDING — `t_ms` is a DEAD PARAMETER on five writer methods.** Confirmed by AST over `writers.py`,
not by eye:

| method | never reads |
|---|---|
| `write_ecg` · `write_acc` · `write_ppg` · `write_gyro` · `write_mag` | `t_ms` |
| `write_ppi` · `write_hr` | `sensor_ns` (deliberate, documented) |

`write_ecg` instead derives its `timestamp [ms]` column itself, as `self._rel_ms(sensor_ns)`. So the
caller computes `t_ms` in `decode_frame`, passes it, and the writer computes the same column a second
way. **Two sources for one column**: if they ever diverge the file says one thing and every caller
believes another. Five of the ten equivalents are exactly this — `t_ms=None` changes nothing because
nothing reads it. Reported, not changed: dropping a parameter is a signature change, and CLAUDE.md's
back-compat rule says keep it. The dead-ness is now visible in a test rather than only in the AST.

The other equivalents are honest by design and are pinned so they stay that way: PPI and HR carry **no
device-clock column** (PPI frames have no usable device clock — every row this box has written has
`sensor_ns == 0`, which `nightqc.file_span_sec` already assumes), so a test now stops someone "fixing"
the writer to emit a column of zeros. `write_ppg(…, v[:4], …)` is equivalent because the writer takes
`cols[:3]` internally, and `hr_writer = ""` is equivalent because `""` is falsy exactly where `None`
was and is overwritten whenever `hr` is a requested stream.

### 5.4 · A harness defect that made earlier numbers wrong

The kill-checker applied a mutant by matching its source line as a **text anchor**, and refused when
the anchor was not unique — correct, per `CAPTURE-HOST-MUTATION-FLEET` §6, since a non-unique anchor
once mutated the wrong function and hid two real gaps. But **17 of the 45 `_set` mutants have
non-unique lines**, so the first run reported `13/45` when it had only *measured* 28. A skipped mutant
reads exactly like a surviving one in a summary.

Worse, the triage table truncated `minus`/`plus` to 100 characters, so a long line could not be applied
faithfully at all. That one surfaced only because the re-verification assertion fired.

Both are fixed by dropping text anchors entirely: each mutant is now located by its **body offset** in
the generated mutants module, mapped to an absolute `capture.py` line, and that line is **verified to
equal the original** before anything is written. All 700 map with zero drift. Any earlier pass that
printed `SKIP anchor` under-measured by however many it skipped.

## 6 · Done when

* The 45 timeouts are re-run un-contended and reclassified; any that resolve to KILLED are removed from
  the survivor count rather than carried as gaps.
* ~~`_set()`'s survivors are attempted with the fixture from §3.~~ **DONE 2026-08-09** — 45 (not 66;
  see §5.2). **Closed: 43 killed, 2 proven equivalent.**
* ~~A decision is recorded on the `log.*` argument survivors.~~ **DONE 2026-08-08** — reclassified
  PROSE (§5.1). 160 moved; the ceiling was deliberately left where it was.
* ~~`--list`-before-`--only` is added to `MUTATION-AUDIT-RUNBOOK` alongside the name-form rule in §2~~
  **DONE 2026-08-18** — added as §1's **eighth** entry (the section was titled "Seven ways" and
  retitled), carrying the name-form table (`_now` → `x__now__`, two underscores; `run_polar` →
  `x_run_polar__`, one) and the reason it belongs in that section rather than in §2: a wrong filter
  makes the results dump read `not checked` for **every** mutant, which is the **third** distinct
  cause of that same output alongside a mid-run read and a poisoned baseline. The dump cannot tell
  them apart, so `--list` first is the only cheap discriminator.
  **and the text-anchor kill-checker is retired repo-wide in favour of §5.4's verified line map** —
  any earlier pass that printed `SKIP anchor` under-measured by however many it skipped.
  ✅ *This second half is **RESOLVED 2026-09-02 (Osprey, drain)** — and the original doubt was
  well-placed, because the instrument was mis-specified rather than the claim being wrong.*
  **`SKIP anchor` never existed in code at all.** `git log -S 'SKIP anchor' --all` over the WHOLE
  tree returns **5 commits**, and every one touches only prose — `MUTATION-AUDIT-RUNBOOK`, this
  brief, and four changesets. Scoped to `tools/` + `capture-host/` it returns **0**, which is the
  query that produced the original "consistent with either" verdict: it searched for a literal
  output string that no tool ever emitted, so its silence could not discriminate. (Both queries
  positive-controlled first — the same `-S` over those paths finds `pat-window-oracle` in 6 commits
  and `mutate_triage` in 7, so the zero is a measurement, not a blind query.)
  **The claim itself holds, on the right evidence:** no anchor mechanism survives in the mutation
  tools — `grep -niE 'anchor' capture-host/tools/mutate_{diff,pure,triage}.py` returns nothing while
  a `def ` control returns 6/8/6 on those same files. Retirement confirmed by the absence of the
  MECHANISM, which is checkable, not by the absence of a STRING, which was not.*
