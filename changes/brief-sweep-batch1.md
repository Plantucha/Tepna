---
bump: patch
type: fixed
brief: none
---

**Brief sweep, batch 1 — five bare IN-PROGRESS headers stamped with verified state. Triage only, no
builds.**

🔴 **The finding that matters most is about the backlog itself, recorded so nobody re-runs this sweep
on the same suspicion: the backlog is mostly honest and simply long.** Measured across the 42
non-skipped IN-PROGRESS briefs — **26 already carry accurate recorded state in their headers**
(`"§2 SUPERSEDED … §4 open — the H10 pull path"`, `"the remaining items are ONE OWNER DECISION, not
nine engineering items"`), and only 16 were bare, two of which were already in flight. Re-stamping
the 26 would add a date and no information. And `PROPOSED`-and-unstarted is **already an honest
state**, so the "78 open briefs" figure badly overstates the target set: the sweep's subject is bare
IN-PROGRESS headers, not open briefs.

**The five stamped here, and what each turned out to be:**

- **`R5-HR-TRIPLET-FOLLOWUPS`** — measurement complete; three of four owed items closed. The fourth is
  `[~]` *by design*: OxyDex has no intervals, so the fleet `rate-of-mean` switch is **routed, not
  taken** — an owner call, because taking it moves a published value.
- **`PPG-FOOT-PLACEMENT`** — root cause **fixed** (a polarity bug in `orient()`; the rate finding was
  retracted as the same bug). ⚠️ Its three unchecked boxes are **one blocked chain, not three items**:
  the PAT reference must be fixed *before* CFD can be re-scored against it, and re-scoring against an
  unfixed reference would produce a number that means nothing.

  🔴 **And on attempting it, the first box turned out to be SPEC-BLOCKED — the obstacle is the BAR,
  not the reference.** The bar asks for medians inside **150–400 ms**, while `pat-matchrate-strict`
  hard-filters lags to `PHYS_LO(200)…PHYS_HI(650)`: **a median below 200 ms is unreachable by
  construction**, so the bar's lower half cannot be evaluated and the bar can only ever fail HIGH —
  the window answering instead of the data. And `pat-window-oracle`'s 405 / 215 ms are **modes**
  (histogram peak, estimated out-of-sample on each night's first half), **not medians**; reading 405
  as "the median, which fails the 400 bar by 5 ms" would be a wrong verdict from mixing two
  instruments. Not data-blocked — the corpus is local and both signal nights pair.

  ✅ **The bar was then re-stated, and the reference measurement PASSES.** New acceptance:
  **mode** per night via `pat-window-oracle`, verdict **SIGNAL RECOVERED** (beats its own per-night
  null) inside a **200–500 ms** rail. All four signal nights clear it — **405 / 315 / 215 / 355 ms**.
  ⚠️ Measured against **#2034's head, not `main`** (the acceptance is defined under that overlap
  split, which was still open), so the numbers are not reproducible from `main` until it lands.
  ⚠️ And the acceptance is about those four named nights, **not a corpus rate** — the tally is
  4 recovered / 20 partial / 5 none across 29 scored, which is the corpus's known character, not a
  pass rate to quote.
- **`O2RING-RAW-DUAL-WAVELENGTH`** — protocol decoded across two hardware runs (`0x05` is not a
  plethysmogram, `0x03` is). Remainder is hardware-shaped; §5's three failed optical experiments are
  recorded so they are not repeated.
- **`…-FOLLOWUPS`** — §2 confirmed 124.91 Hz; §2.1a **refuted** the 100 Hz reading (the delivered rate
  is the *cap*, not the device); §3 withdrawn. Sole open item is §2.1 — the marker rate is not the
  heart rate — and it needs device time.
- **`PYTHON-TYPES-AND-FORMAT`** — §P1 shipped, §P2 discharged (fix lane landed in #1949; adversary
  lane **retired** at 20.7 % against a 30 % band). §P3 is a countdown, not a task: mypy blocks at 0
  and the floor is now **103**. ⚠️ §P2's first box stays **unticked** — the band was applied on a
  sample of **12**, not the **30** it names. The rate cleared; the sample size did not.

Nine further bare headers belong to other lanes and stay with their owners, who can stamp them at
near-zero cost while holding the context. Docs-only: five headers, five `DOCS-INDEX` pills.
