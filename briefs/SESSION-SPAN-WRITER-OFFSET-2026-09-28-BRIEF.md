<!--
  SESSION-SPAN-WRITER-OFFSET-2026-09-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-09-28 · **Created:** 2026-09-28 ·
**Residue:** 2026-09-24-session-span-resolves-a-floating-stamp-in-the-readers-zone

# The session span must not depend on who reads it

`nightqc.summarize`'s session span was a floating civil stamp subtracted from an absolute instant. The
same night measured **116,853 s on a UTC box, 102,453 s in America/New_York and 149,253 s in
Asia/Tokyo** — one EDT and one JST offset apart. The UTC figure is 32.5 h for a single session, which is
the tell: the mixed frame inflates it past anything physical and nothing downstream objected.

This brief records what was built, the measurement behind each decision, and the two places where a
decision I had already committed to turned out to be wrong.

## 1 · One rule

> **Every civil stamp the box writes is read as FLOATING** (the components as written, `timegm`). **The
> night's recovered writer offset is the ONE place a floating value becomes an instant.** Where the offset
> cannot be recovered, no instant exists and every span that needs one is **UNKNOWN with a named reason.**

The constraint that forces this: everything the box writes is zone-free civil time — filename stamps,
`STARTS.csv`, row stamps, the LINK sidecar. `writers._phone_ts` says so in its own comment, *"Local civil
time, zone-free"*. **`mtime` is the only absolute instant a night contains.** So relating a
connection-open stamp to a last-write instant REQUIRES the writer's zone, and no rearrangement of
existing fields avoids it.

## 2 · Six conversion sites, not the three the residue row named

The row's audit was incomplete. Fixing a subset would have been worse than fixing none, because it would
have left `timeline` differencing a reader-zone LINK axis against a recovered-offset session axis.

| site | what it converts | needs the offset? |
|---|---|---|
| `nightqc._session_of` / `floating_stamp_s` | the `_YYYYMMDDHHMMSS_` filename stamp | yes |
| `nightqc._parse_phone_ts` | `STARTS.csv` daemon-start stamps | yes |
| `nightqc._midnight_of` | the night folder's own date | **no** — both sides civil |
| `timeline._stamp_ms` | the filename stamp again (now delegates) | yes |
| `timeline.read_link_samples` | the LINK sidecar's stamps | yes |
| `nightqc` cross-midnight **contiguity probe** | `earliest` vs `max(mtime)` | yes |

Two of these were live defects in their own right, both found by measurement rather than by reading:

* **`_midnight_of` decided POOLING** through the reader's zone while `earliest` was floating, so the
  `0 <= earliest − midnight < _SESSION_GAP_SEC` window shifted bodily with the viewer. Both sides are
  civil time (a folder NAME and a filename stamp), so this one needs no offset at all — read both as
  written and the zone cancels.
* **The contiguity probe** differenced a floating stamp against an absolute mtime, so the same night
  pooled in one reader's zone and not another. Found by a boundary test (`..._is_EXCLUSIVE_at_exactly_the_gap`),
  not by inspection.

## 3 · Recovering the writer's offset

An inference, bounded and refusable — never a recorded fact.

    d = mtime − floating(last row) = −offset_east + lag,   lag = mtime − last_row_instant

Each data file casts one `d`; votes are bucketed and the modal bucket wins. Two bases, in preference
order: **`last-row`** (the file's final host stamp — tightest, `lag` is one flush) and **`extent`** (its
start stamp plus its own recorded duration — no extra read, wider `lag`). `rows / fs` is deliberately not
a third basis: that rate is today's configured one and would make the recovered offset depend on a number
that goes stale (§A4c).

**The bucket is the QUANTUM of the quantity, not a tuned tolerance.** Every UTC offset in use since 1972
is a whole multiple of 15 minutes, the 45-minute ones included. Widening the bucket would merge two real
zones; narrowing it would split one zone on the lag alone.

**`_OFFSET_MAX_ABS_SEC = ±14 h` is a refusal bound, not a clamp** — the discipline §🔒 §7 states for
`CK_AXIS_MAX_PPM`. A vote outside it is discarded *before* it is counted and the file falls through to its
other basis. This is measured need, not a hypothetical: the suite's own `_cap_timed` fixtures write a
CONSTANT host stamp, and reading it recovered an "offset" of **5,804,100 s — 67 days — behind a clean
0.667 majority**. A majority of nonsense is still nonsense, so the bound is on the quantity.

### 3a · ROUND, not FLOOR — a committed decision that was wrong

I first floored, and wrote the argument down: *a flush follows its row, so `lag ≥ 0`, so the true offset is
at or below `d`*. The argument is sound and its conclusion is still wrong, because of **what the quantity
is**: every real UTC offset is an exact multiple of the bucket, so the true value sits exactly **on** a
bucket boundary — the one place where flooring is decided by arbitrarily small jitter of either sign.

Measured on the real **2026-09-27**: two unanimous voters at `d = +14,399.999` and `+14,389.962` both
floored to **13,500**, recovering an offset fifteen minutes from the truth off a **one-millisecond**
shortfall. Rounding puts both at 14,400.

The cost of rounding is the case flooring was meant to catch — a lag over half a bucket (451 s). That is a
killed session, which is precisely what an outlier *is* and what a majority exists to outvote; **boundary
jitter, by contrast, afflicts every file at once and no majority can help.** One quantizer for both bases.

**Large nights had been masking it.** With 10–1427 voters the majority absorbed the boundary-flipped files
and reported them as `outliers`, so the defect surfaced only once a thin night had no majority to hide it.
Outlier share fell from roughly 2.4 % to **0.81 % (103 of 12,786 voters)** when rounding landed — the
measurable confirmation that boundary flips were being mis-reported as killed sessions.

## 4 · The support floor, and the order a revision has to happen in

The constant carries all three steps, because the point is not the numbers — it is that a criterion is
stated before it is scored and any revision says what it fixes.

1. **ORIGINAL, pre-stated before any corpus was scored:** ≥ 3 voters AND a strict majority in the modal
   bucket. Rationale as written: three is the smallest population in which a majority can outvote a single
   outlier, and the outlier is known to exist (a killed session leaves an mtime hours past its last row);
   a plurality would resolve a 2-2 split by tie-break, which invents a zone. **What it refused:** any
   two-file night, *including when both voted the same bucket exactly*.
2. **REVISION, and the gap it fixes, stated BEFORE re-scoring:** the rationale is about outvoting an
   OUTLIER, and under unanimity there is no outlier to outvote — so the criterion did not bind the case it
   was refusing. It conflated "2 voters split 1-1" (undecidable, must refuse) with "2 voters agreeing"
   (two independent measurements concurring). **≥ 2 when unanimous, else ≥ 3 with a strict majority.** A
   cross-check survives in every case: one file's close stamp can never define a night's timeline alone.
   The `≥ 1 unanimous` variant was costed (28 failures rather than 39) and **rejected** — it lets a single
   file define the night's zone with nothing to check it against, which is the degenerate case the floor
   exists for.
3. **RE-SCORED** — and a verdict moved, which is §3a above. That is the procedure working: had the
   re-score come back unchanged, the quantizer defect would still be latent.

## 5 · Corpus control

82 folders of the 42-night `smoketest-captures` tree, scored three times.

| pass | result |
|---|---|
| original floor, flooring | 71 of 71 votable nights recover +14,400 s |
| revised floor, flooring | **one verdict moved** — 2026-09-27 → 13,500 s (§3a) |
| revised floor, rounding | **72 of 72 recover +14,400 s; no second value anywhere** |

Modal shares 0.80–1.00. Outliers 103 of 12,786 voters (0.81 %). **Ten refusals, every one correct:**

* 7 non-night folders (`cpap`, `cpap-ble`, `cpap-spool`, `device-mirror`, `device-mirror2`, `probe`,
  `sniffer`) with no data files at all;
* **`stored`** — 236 data files, zero host stamps. A ring's offline sync carries no host arrival stamps,
  so the night genuinely holds no evidence of the writer's zone. Refusing is the right answer;
* **2026-09-14** — 2 voters, not unanimous;
* **2026-08-08** — six voters splitting `14,405 / 15,758 / 17,348` two apiece, because two of its three
  sessions were killed and their mtimes sit 1,350 s and 2,950 s past their last rows. No bucket holds a
  majority. **The criterion working, not failing.**

The floor therefore refuses nights that captured essentially nothing, and nothing else. It was not tuned
to produce that: 2026-09-14 and 2026-09-27 are header-only nights carrying rows in exactly two files.

**Method credit:** `POOLED-CLOCK-FIT-2026-07-31-BRIEF` states it — *"plant a known offset and check
recovery. This is the single most valuable thing execution can add."* The plants below do exactly that.

## 6 · What each plant pins

| plant | what it would catch |
|---|---|
| span identical in four reader zones (UTC, New_York, **Kolkata**, Tokyo) | the defect itself; Kolkata is the half-hour zone that catches a sign error two whole-hour zones agree on |
| the span is the recorded duration **because the offset was applied** | a start left floating — the value, not merely its stability |
| a half-hour writer offset (19,800 s) recovered exactly | a recovery that silently serves whole hours only |
| a two-bucket night recovers the modal offset and **names** its outlier | averaging to an offset no file voted for, or dropping the dissenter silently |
| too few voters → UNKNOWN + reason + `frame: floating` + null `span_sec` | a guessed span, and a bare null that cannot say why |
| a vote beyond ±14 h refused on its MAGNITUDE | the 67-day fixture "offset" |
| the vote ROUNDS so a millisecond cannot move the zone | §3a, by name |

The value-pinning plant exists because its stability-only twin **passed vacuously**: an mtime placed
before the stamp collapses `max(session, mtime)` and the span reads 0 in every zone at once, which
satisfies "identical in every zone" while measuring nothing. That happened here.

## 7 · Declared versus recovered — and where part (2) enters

`summarize` and `timeline.build` take an optional **`writer_offset`**: a `declared_offset(...)` or a
previous `recover_writer_offset(...)`. `basis` is `"declared"` or `"recovered"` and the two are **never
blended** — a declared 0.0 is a premise, a recovered 0.0 is a measurement with voters behind it.
Everything a vote would have counted is null rather than 0 on a declared block (§∅: nothing was counted).

**This seam is not a test hook.** The durable fix is for the writer to RECORD its offset per session
(residue `2026-09-28-writer-records-no-utc-offset`), and this parameter is where that recorded value
enters: recorded becomes the preferred path and the inference the fallback for nights captured before it
existed. Its `find_unwired` allowlist entry names the condition for retiring it.

The suite's thin fixtures declare their frame through it rather than having it inferred from files that
carry no clock. Two wrappers per file, because **the suite holds two frames and they cannot be told apart
at runtime** — `mtime − stamp` is a duration in one and a duration plus an offset in the other — so each
site is classified by what its own fixture builds with. Three fixtures turned out to be internally
inconsistent, writing one value through the reader's zone while everything around it was civil; they only
ever worked because the old reader resolved the stamp back through the same zone and undid the error
exactly.

## 8 · A defect this introduced, and how it surfaced

In the floating frame a file with no start stamp cannot be placed, so **a night can hold rows and yield no
session** — `judged_session` then correctly answers `None`, and reading `cur[2]` off it crashed. It
presented as `qc poll failed: TypeError("'NoneType' object is not subscriptable")` in the QC poller's own
tests: a night silently losing its entire summary. `summarize` now gates on `sessions` rather than on
`data`, and `judged_session` / `night_window` publish null when nothing could be judged.

Worth recording because of *how* it was found: not by reasoning about the change, but by running the whole
capture-host suite rather than the eight files the unit obviously touched.

## 9 · Stated extensions — not built

* **Per-SESSION voting.** 2026-08-08 refuses as a night, yet all three of its sessions independently say
  +14,400 plus their own flush lag. A vote scoped per session would recover it. This is an extension, not
  a fix, and it is stated here rather than built.
* **The writer recording its offset** — part (2), its own unit with its own deploy question for the owner.

## 10 · Acceptance

- [x] the span is identical in four reader zones, value-pinned as well as stability-pinned
- [x] all six conversion sites read civil time as written
- [x] the offset is recovered with a pre-stated floor, a magnitude bound, and a published basis
- [x] a night that cannot state its zone publishes UNKNOWN with a named reason, never a guessed span
- [x] corpus control: 72 of 72 votable nights, one value, ten explained refusals
- [x] `capture-host/check.sh` green (ruff · shellcheck · pytest `--cov` 100 % · `find_unwired` · mypy)

`capture-host/check.sh`: **ruff ok · shellcheck ok · pytest ok (coverage floor met) · unwired ok**, mypy
`ADVISORY 11 (baseline 11, AT_BASELINE)`, exit 0. Full suite **8737 passed, 2 skipped, 0 failed**.

The advisory `format` lane reports ISSUES and is left that way deliberately: `ruff format` wants 484 lines
of `nightqc.py` and 555 of `tests/test_nightqc.py` that are **already on main**, because it collapses the
house style of aligned trailing comments. 192 of the lines it would restyle are mine, interleaved with
existing aligned-comment code in the same functions, so they match their neighbours. `check.sh`'s own
comment forbids a big-bang reformat and sets format to land file-by-file; `ruff check` is clean.

Landed as **#3188**.
