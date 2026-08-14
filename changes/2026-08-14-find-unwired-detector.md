---
bump: minor
type: added
---

`tools/find_unwired.py` — a seconds-fast scanner for machinery that exists, is tested, and is connected
to **nothing**.

This suite's documented failure mode is *a check that reports success about something it never
examined*. This finds its sibling: **a check that examines correctly and reports to nobody.** No CI job
can see that class, because every instance has passing tests — the tests call the function directly, and
that direct call is exactly the wiring production lacks. Five instances were found by hand on
2026-08-14, and three more shipped the same day: the charging veto (correct, 24 green assertions,
unreachable from the live path), the Deploy button (green 12-minute gate, failed on first real press),
and `clock_uncorrectable` (set, retracted, 7 tests, read by nothing).

**It found three orphans the hand audit missed**, because it subtracts `def` lines while a human
counting occurrences reads the definition as a use:

| finding | why |
|---|---|
| **`rate_unmet`** | published when a device refuses the configured rate, beside a log line reading *"The config still says %s; nothing else will tell you it did not happen"* — and the field published to make that visible reaches no consumer |
| **`connection_ceiling_error`** | separates *"the ADAPTER is out of connection slots"* from *"the sensor is absent"*; nothing calls it, so slot exhaustion presents as a dead sensor |
| `predict_step_split` | O2Ring frame-lock helper, tests only |

The first two are §1-class and carried to the brief's §6.1 as their own work-unit, not folded into §5's
minor dead code.

**Two earlier scan drafts produced confident nonsense, and the fixes are structural rather than careful:**

* Matching `name(` **misses callback references** — `to_thread(diskguard.prune_old_nights, …)` passes the
  function without parentheses, so retention and night-archiving both read as dead when both are wired.
  Scan 2 matches the bare name; a test pins that neither is reported.
* Regexing `_set(name, key=…)` out of source text collects the kwargs of **nested** calls (`timespec` is
  an argument to `isoformat`) and misses keys whose quoting the pattern did not anticipate (`tool`).
  Scan 1 walks the **AST** and takes only the `_set` call's own keywords, which makes both impossible
  rather than merely unlikely.

**⚠️ Advisory, never a hard gate.** A declarative constant, a CLI entry point, a protocol builder used
only by `probe_*.py` are all legitimately "unused" by this definition, and a gate that fails on them
trains people to silence it — the same failure one level up. Exit is always 0; the report is the product.
Allowlisted rows still print, with their reason, because a suppression you cannot see is how the next
real finding hides behind a stale entry.

**Its own tests found two bugs in it, both the class it exists to detect:** `_pyfiles()` read the
module-level `HERE` and ignored `scan(root)`, making that parameter **decorative** — accepted, ignored,
and the caller believes it took effect; and `def scan(root=HERE)` binds at **def time**, so `main()`
could not be redirected at all. Neither is visible when the tool is only ever pointed at the live
checkout. The synthetic-tree tests that exposed them also make the assertions deterministic, rather than
dependent on a codebase that changes with every merge.

From `CAPTURE-HOST-UNWIRED-MACHINERY-2026-08-14-BRIEF.md` §6. Brief moved to IN-PROGRESS with §1–§4 and
§6 ticked.
