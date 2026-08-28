# tepna-capture — tests/test_mutation_triage.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `mutation_triage.classify` decides whether a surviving mutant is worth a human's time. A wrong bucket
# is harmful in BOTH directions: UNOBSERVABLE→REACHABLE sends someone chasing a mutant no test can
# kill; REACHABLE→UNOBSERVABLE dismisses a real defect as noise. Every case below is a real diff taken
# from a 2026-08-04 run, not an invented one.

import pytest

import mutation_triage
from mutation_triage import (
    EQUIVALENT,
    PROSE,
    REACHABLE,
    UNOBSERVABLE,
    ceiling,
    classify,
    concentration,
)


# ── UNOBSERVABLE: no assertion can distinguish these ────────────────────────────────────────────────
def test_a_flush_only_change_is_unobservable():
    """The family that broke a hand estimate: 30 of pull_session's survivors differ ONLY in `flush=`.
    capsys and capfd read the captured buffer regardless of flushing, so True/False/None produce byte-
    identical output. Counting these as reachable projected a 94.4% ceiling for a module whose real one
    is 89.1%."""
    b, w = classify('print(f"connecting to {addr} …", flush=True)',
                    'print(f"connecting to {addr} …", flush=False)')
    assert b == UNOBSERVABLE and "flush" in w
    assert classify('print("x", flush=True)', 'print("x", flush=None)')[0] == UNOBSERVABLE


def test_mutmuts_XX_literal_wrapping_is_unobservable():
    """mutmut rewrites `"latest"` as `"XXlatestXX"`. Killable only by asserting the exact string, which
    pins wording and reds the build on every message edit."""
    assert classify('ap.add_argument("--which", help="latest | all")',
                    'ap.add_argument("--which", help="XXlatest | allXX")')[0] == UNOBSERVABLE


def test_a_case_flip_is_unobservable():
    assert classify('getattr(client, "mtu_size", "?")',
                    'getattr(client, "MTU_SIZE", "?")')[0] == UNOBSERVABLE


# ── PROSE: the values survive, only the wording moved ───────────────────────────────────────────────
def test_wording_only_with_values_intact_is_prose():
    b, w = classify('print(f"saved {n} bytes → {path}")', 'print(f"wrote {n} bytes → {path}")')
    assert b == PROSE and "values intact" in w


def test_a_bare_literal_change_outside_a_message_is_still_prose():
    b, w = classify('reason = "no mountpoint configured"', 'reason = "nothing configured"')
    assert b == PROSE and "surrounding code unchanged" in w


# ── PROSE: set aside, and the reversal that put it here ─────────────────────────────────────────────
def test_a_message_that_lost_its_interpolated_value_is_PROSE_not_the_work_list():
    """REVERSED 2026-08-08 (owner). This asserted REACHABLE, on the reasoning that both forms leave the
    message unable to NAME its value and both die to `assert ts in out`, which survives any rewording.

    Sound in the small, wrong at scale. Measured on `run_polar`: ~150 of 560 REACHABLE survivors were
    message arguments — a quarter of a list whose whole job is to say what deserves a human's time.
    Collecting them means asserting that particular values appear in particular log lines across the
    daemon, which freezes operator-facing wording and reds the build on every message edit. That is the
    cost §5 of CAPTURE-HOST-MUTATION-FLEET already declines to pay for `flush=` and `XX`-wrapping.

    The two arms still differ in `why` — argument dropped vs replaced with None — because the reason is
    what a human reads; the BUCKET is what the triage decision is made on."""
    dropped = classify('print(f"── session {ts} ──", flush=True)', 'print(flush=True)')
    noned = classify('print(f"session {ts}", flush=True)', 'print(None, flush=True)')
    assert dropped[0] == PROSE and noned[0] == PROSE
    assert "lost an argument" in noned[1], "the None form is still recognised as a lost argument"
    assert "structurally" in dropped[1], "a wholly dropped argument lands on the general message arm"
    for _b, why in (dropped, noned):
        assert "wording" in why, "the reason must say WHY it was set aside, not merely that it was"


def test_ordinary_code_changes_are_reachable():
    assert classify("if want <= 0:", "if want <= 1:")[0] == REACHABLE
    assert classify("return not (lo < have <= hi)", "return not (lo <= have <= hi)")[0] == REACHABLE


def test_a_structurally_changed_message_is_PROSE_even_without_a_none():
    b, w = classify('log.warning("cpap: %s rc=%d", cmd, rc)', 'log.warning("cpap: %s rc=%d", cmd)')
    assert b == PROSE and "structurally" in w


# ── the continuation-line problem: a line cannot answer this about itself ───────────────────────────
def test_a_CONTINUATION_line_of_a_multiline_log_call_is_prose_when_the_caller_says_so():
    """`log.warning("%s START %s → %s", name,` spans lines; `classify` is handed one of them. The
    continuation carries no `log.` to match, so on its own it reads as an ordinary code change — which
    is how most of run_polar's ~150 message survivors ended up on the work-list. The caller has the
    source and passes the answer in."""
    minus = "pmd.CTRL_STATUS.get(st, hex(st)))"
    plus = "pmd.CTRL_STATUS.get(None, hex(st)))"
    assert classify(minus, plus)[0] == REACHABLE, "on its own the line is indistinguishable from code"
    assert classify(minus, plus, in_message_call=True)[0] == PROSE


def test_in_message_call_defaults_off_so_existing_callers_are_unchanged():
    """Trailing, optional, keyword-only — CLAUDE.md's back-compat rule. A caller with no source cannot
    compute it, and must not silently get the more permissive answer."""
    import inspect
    sig = inspect.signature(classify)
    p = sig.parameters["in_message_call"]
    assert p.default is False and p.kind is inspect.Parameter.KEYWORD_ONLY
    assert list(sig.parameters)[:2] == ["minus", "plus"], "the new parameter must come LAST"


def test_message_call_lines_finds_the_whole_call_including_continuations():
    src = (
        "def f(name, st):\n"
        "    x = compute(st)\n"
        "    log.warning('%s START %s',\n"
        "                name,\n"
        "                st)\n"
        "    return x\n")
    got = mutation_triage.message_call_lines(src)
    assert got == {3, 4, 5}, f"the call spans lines 3-5, got {sorted(got)}"
    assert 2 not in got and 6 not in got, "ordinary statements must not be swept in"


def test_message_call_lines_does_not_sweep_in_lookalikes():
    """`d.get("info")` and `self.write(buf)` are not logging. Matching on the LEVEL name alone would
    take both, and quietly mark real code unkillable — the direction that loses defects."""
    src = ("def f(d, fh, buf):\n"
           "    a = d.get('info')\n"
           "    fh.write(buf)\n"
           "    b = d.info\n"
           "    return a, b\n")
    assert mutation_triage.message_call_lines(src) == frozenset()


def test_message_call_lines_fails_CLOSED_on_unparseable_source():
    """Empty set, so every line is judged on its own merits. Failing OPEN would let one syntax error
    mark a whole module PROSE — a triage that reports nothing to do because it could not read."""
    assert mutation_triage.message_call_lines("def broken(:\n  pass\n") == frozenset()


def test_a_message_call_that_escapes_the_message_is_still_reachable():
    """The reclassification is about wording, not about anything a log line touches. A mutation on the
    same line that changes CONTROL FLOW is not prose and must stay on the work-list."""
    b, _w = classify("if rc and log.isEnabledFor(10):", "if rc or log.isEnabledFor(10):")
    assert b == REACHABLE, "an `and`->`or` on a guard is a behaviour change, not a rewording"


def test_identical_lines_are_flagged_not_silently_dropped():
    """A no-op diff means the reader misparsed, not that the mutant is harmless — flag it for a human
    rather than bucketing it as noise."""
    assert classify("x = 1", " x = 1 ")[0] == EQUIVALENT


# ── the arithmetic a report must not get wrong ──────────────────────────────────────────────────────
def test_ceiling_reports_all_three_numbers_from_the_real_pull_session_run():
    c = ceiling(total=466, survived=123, timeouts=7, unobservable=51, reachable=65)
    assert c["killed"] == 336
    assert round(c["now_pct"], 1) == 72.1
    assert c["ceiling"] == 415 and round(c["ceiling_pct"], 1) == 89.1
    assert c["if_all_reachable"] == 401 and round(c["if_all_reachable_pct"], 1) == 86.1


def test_timeouts_count_against_the_rate_and_are_not_folded_into_killed():
    """A timeout is neither killed nor survived. Treating it as either is how a rate drifts: the same
    module read 5 timeouts under load and 0 idle, which moved the apparent kill count by 5."""
    with_to = ceiling(100, 10, 5, 0, 0)
    without = ceiling(100, 10, 0, 0, 0)
    assert with_to["killed"] == 85 and without["killed"] == 90


def test_an_empty_denominator_is_refused_rather_than_divided_by():
    """`mutmut results` returning nothing reads exactly like a clean sweep. Dividing by it is how a
    100% kill rate was once reported for a run that had not measured anything."""
    with pytest.raises(ValueError, match="not a rate"):
        ceiling(0, 0, 0, 0, 0)


def test_counts_exceeding_the_total_are_refused():
    """Survivors from one run against a total from another — the stale-list trap in miniature."""
    with pytest.raises(ValueError, match="exceeds total"):
        ceiling(100, 90, 20, 0, 0)


# ── concentration: the number the fleet ranking is SORTED by ────────────────────────────────────────
# This shipped in the same commit as a brief that ranks all 19 modules by it, and shipped untested. The
# tests below are the ones that would have had to exist before that brief quoted a single figure.

def test_concentration_finds_the_largest_cluster_and_its_share():
    """The real `clockcfg` shape: 27 of 37 reachable in one function is why six tests returned 40
    mutants. `top_share` is what §2 of the fleet brief sorts on."""
    c = concentration(["status"] * 27 + ["_write"] * 7 + ["main"] * 3)
    assert c["total"] == 37
    assert c["top"] == "status" and c["top_n"] == 27
    assert round(c["top_share"], 3) == round(27 / 37, 3)


def test_clusters_are_ordered_by_size_then_name_so_a_ranking_is_stable():
    """Ties broken by name, not by dict order. Without it the same survivor file ranks two equal
    clusters differently between runs, and a ranking that reorders on re-measurement is not a ranking."""
    c = concentration(["b", "b", "a", "a", "c"])
    assert c["clusters"] == [("a", 2), ("b", 2), ("c", 1)], "size desc, then name asc"
    assert c["top"] == "a", "the tie-break must be deterministic, and it must not be insertion order"


def test_no_reachable_mutants_is_zero_share_not_a_division():
    """A fully-closed module (`settings_schema` reached this) has an empty reachable set. Ranking it
    must not raise, and it must not report a 100% cluster — there is no cluster."""
    c = concentration([])
    assert c == {"total": 0, "clusters": [], "top": None, "top_n": 0, "top_share": 0.0}


def test_a_single_function_reports_full_concentration_which_is_the_known_defect():
    """DELIBERATE, and the reason `capture.run_polar` was mis-ranked as the cheapest big pass.

    Concentration is computed per FUNCTION, so a 1,900-line function scores 1.0 no matter how its
    mutants spread inside it — `run_polar`'s 502 reachable are spread over hundreds of lines, whose
    densest holds 13. At this granularity that is indistinguishable from `clockcfg`'s genuinely dense
    27-in-one-function. Ranking by this figure alone is what produced the claim that it was 'one
    fixture family'. The fix is per-source-line granularity above some function size; until then this
    test pins the limitation so it is read as known rather than rediscovered."""
    dense = concentration(["small_fn"] * 20)
    sprawling = concentration(["huge_fn"] * 502)
    assert dense["top_share"] == sprawling["top_share"] == 1.0, \
        "the metric cannot tell these apart — do not rank on top_share alone"


def test_message_call_lines_follows_a_LOGGER_METHOD_BOUND_TO_A_LOCAL():
    """capture.py chooses the level first and calls it second, so the call site reads `_lvl(...)` and
    matches no logger name at all. Nineteen run_polar mutants sat on exactly that pair of statements."""
    src = ("def f(st, name, how, transient):\n"
           "    _lvl = (log.warning if not transient else log.info)\n"
           "    _lvl('%s START %s (%s)',\n"
           "         name, st, how)\n"
           "    return 1\n")
    got = mutation_triage.message_call_lines(src)
    assert 3 in got and 4 in got, f"the aliased call and its continuation must be found, got {sorted(got)}"
    assert 5 not in got, "the return statement is not part of the call"


def test_an_alias_is_inferred_from_the_CODE_not_from_the_NAME():
    """A local called `_lvl` that holds something else is ordinary code. Matching on the identifier
    would mark real logic unkillable — the direction that loses defects."""
    src = ("def f(d):\n"
           "    _lvl = d.get('threshold')\n"
           "    _lvl(1, 2)\n"
           "    return _lvl\n")
    assert mutation_triage.message_call_lines(src) == frozenset()


def test_a_call_through_a_SUBSCRIPT_or_a_RETURNED_CALLABLE_is_handled_not_crashed():
    """Not every callee is a dotted name. `handlers[0](...)`, `get_logger()(...)` and a lambda call all
    have a `func` that is neither Attribute nor Name, so name extraction yields nothing.

    Two things must hold, and they pull in opposite directions: the walk must not raise (this runs over
    a 4,400-line module and one exotic call site would blind the whole file), and an unresolvable callee
    must NOT be treated as a logger — a call we cannot identify is not one we may quietly mark PROSE."""
    src = ("def f(handlers, get_logger, d):\n"
           "    handlers[0]('a %s', d)\n"
           "    get_logger()('b %s', d)\n"
           "    (lambda m: m)('c')\n"
           "    d['k']['j'](1)\n"
           "    return 1\n")
    assert mutation_triage.message_call_lines(src) == frozenset(), (
        "a callee that cannot be resolved to a logger must not be swept in")


def test_an_alias_call_through_an_unresolvable_callee_still_does_not_crash():
    """The alias pass and the call pass walk the same tree; an exotic callee must survive both."""
    src = ("def f(reg):\n"
           "    _lvl = log.warning\n"
           "    reg['fn']('x')\n"
           "    _lvl('y %s', 1)\n"
           "    return 0\n")
    got = mutation_triage.message_call_lines(src)
    assert 4 in got, "the aliased logger call is still found"
    assert 3 not in got, "the unresolvable one is not"


def test_alias_collection_does_not_STOP_at_the_first_unrelated_assignment():
    """The alias scan walks every Assign in the module and SKIPS the ones that are not loggers. Skipping
    must be `continue`, not `break`.

    This is not a style point. In `capture.py` the `_lvl = log.warning if … else log.info` assignment
    sits ~1,800 lines in, after hundreds of ordinary ones — so a `break` finds no aliases AT ALL and the
    19 mutants that alias exists to reclassify go straight back onto the work-list. The diff-scoped
    mutation gate caught this on the PR that introduced it; the tests here did not, because every one of
    them put the logger assignment first."""
    src = ("def f(d, n):\n"
           "    a = d['x']\n"          # unrelated, and FIRST
           "    b = n + 1\n"
           "    c = [q for q in d]\n"
           "    _lvl = log.warning\n"  # the logger, only after several others
           "    _lvl('m %s', a)\n"
           "    return b, c\n")
    got = mutation_triage.message_call_lines(src)
    assert 6 in got, (
        f"the aliased call must be found even though three unrelated assignments precede it; got "
        f"{sorted(got)} — a `break` in the alias scan yields an empty set here")


def test_sys_stderr_write_is_recognised_as_a_message_call():
    """`sys.stderr.write` is in this module's message vocabulary, and it is the one callee whose
    ATTRIBUTE names matter: the check is `base == "sys" and "write" in names`, so the walk must collect
    every attribute on the way down, not just the root."""
    src = ("import sys\n"
           "def f(x):\n"
           "    sys.stderr.write('boom %s\\n' % x)\n"
           "    return x\n")
    assert 3 in mutation_triage.message_call_lines(src), (
        "sys.stderr.write must be recognised — the attribute chain, not only its root, decides it")


def test_a_non_sys_write_is_still_not_a_message_call():
    """The counterpart: `fh.write(buf)` shares the method name and is ordinary I/O."""
    src = ("def f(fh, buf):\n"
           "    fh.write(buf)\n"
           "    return 1\n")
    assert mutation_triage.message_call_lines(src) == frozenset()


# ── the message-call wiring (2026-08-27) ─────────────────────────────────────
# `classify(…, in_message_call=…)` has existed and been tested since 2026-08-08, and NOTHING EVER
# PASSED IT. `tools/mutate_triage.py` called `classify(a, b)` at both sites, so every mutant on a
# CONTINUATION line of a multi-line `log.info(...)` was judged REACHABLE — the exact distortion
# `mutation_triage`'s own header quantifies. These pin the mapping that makes the flag suppliable.
# They live in `mutation_triage`, NOT in `tools/mutate_triage.py`, and that placement is the point:
# that module's header states the tool "remains UNCOVERED by design", so anything that can silently
# mislead has to sit up here inside the floor. Both of these did mislead — see their docstrings.
import mutation_triage as _MT

_SHOW = """# x_foo__mutmut_1: survived
--- p
+++ p
@@ -1,5 +1,5 @@
 def foo(x):
     log.info(
         'a', x)
-    return 1
+    return 2"""
_SRC = "import os\n\n\ndef foo(x):\n    log.info(\n        'a=%s', x + 1)\n    return 1\n"


def test_hunk_lineno_is_FUNCTION_relative_not_file_relative():
    """⚠️ A property of mutmut, not a choice: `mutmut show` diffs `cst.Module([function]).code`, so the
    `@@` header numbers from 1 at the FUNCTION's first line (mutmut 3.7 `__main__.py:1710`). Feeding
    this straight to `message_call_lines(file_source)` would compare a function offset against file
    line numbers — a plausible-looking number about the wrong thing."""
    assert _MT.hunk_lineno(_SHOW) == 4          # the `-` line, counting from the function's `def`


def test_hunk_lineno_skips_ADDED_lines_when_counting():
    """A `+` line does not exist in the ORIGINAL, and the original is the text whose message-calls are
    being asked about. Counting it would shift every subsequent line by one."""
    show = "@@ -1,3 +1,4 @@\n def f():\n+    added = 1\n-    return 1\n+    return 2"
    assert _MT.hunk_lineno(show) == 2


def test_hunk_lineno_returns_None_when_there_is_no_removed_line():
    assert _MT.hunk_lineno("@@ -1,2 +1,3 @@\n def f():\n+    x = 1") is None
    assert _MT.hunk_lineno("no hunk header at all") is None
    # A MALFORMED `@@` line must not arm the counter: `seen` stays None, so every following line is
    # skipped and the answer is None rather than a position measured from a header we could not read.
    assert _MT.hunk_lineno("@@ not a hunk header @@\n-    return 1") is None


def test_function_start_line_uses_the_AST_not_a_text_search():
    """`def x_foo__mutmut_1` exists in mutmut's generated module; a text search for `def foo` would
    also match it, and a decorated or nested definition shifts a naive match."""
    assert _MT.function_start_line(_SRC, "foo") == 4
    assert _MT.function_start_line(_SRC, "absent") is None
    assert _MT.function_start_line("def broken(:\n", "broken") is None      # unparseable → None


def test_file_lineno_of_composes_the_two_into_a_FILE_line():
    assert _MT.file_lineno_of(_SHOW, _SRC, "foo") == 7                      # 4 + 4 - 1
    assert _MT.file_lineno_of(_SHOW, _SRC, "absent") is None
    assert _MT.file_lineno_of("no hunk", _SRC, "foo") is None


def test_a_CONTINUATION_line_mutant_is_recognised_as_prose():
    """🔴 THE WHOLE POINT. `x + 1` -> `x - 1` inside a multi-line `log.info(...)` is a change to a
    MESSAGE ARGUMENT, and the owner's 2026-08-08 decision is that those are prose. Without the flag it
    reads REACHABLE and takes a slot in a work-list that is supposed to say what deserves a human."""
    show = ("@@ -1,4 +1,4 @@\n def foo(x):\n     log.info(\n-        'a=%s', x + 1)\n"
            "+        'a=%s', x - 1)\n     return 1")
    assert _MT.file_lineno_of(show, _SRC, "foo") == 6
    assert _MT.in_message_call(show, _SRC, "m.x_foo__mutmut_1") is True
    a, b = "        'a=%s', x + 1)", "        'a=%s', x - 1)"
    assert classify(a, b)[0] == "REACHABLE"                    # the old behaviour
    assert classify(a, b, in_message_call=True)[0] == "PROSE"  # the wired behaviour


def test_in_message_call_FAILS_CLOSED_on_every_unavailable_input():
    """False is `classify`'s existing default, so a failure keeps the OLD behaviour. The direction is
    deliberate: a False leaves a mutant in the work-list where it already was, while a wrong True
    silently REMOVES work from a list whose job is to say what deserves attention."""
    assert _MT.in_message_call(_SHOW, "", "m.x_foo__mutmut_1") is False          # unreadable source
    assert _MT.in_message_call("no hunk", _SRC, "m.x_foo__mutmut_1") is False    # no removed line
    assert _MT.in_message_call(_SHOW, _SRC, "m.x_absent__mutmut_1") is False     # unknown function
    assert _MT.in_message_call(_SHOW, "def broken(:\n", "m.x_foo__mutmut_1") is False  # unparseable


def test_func_of_mutant_handles_the_THREE_real_name_shapes():
    """🔴 MEASURED MANGLING, and it is why only 27 of 66 survivors mapped to a line number.

    The inherited regex `.*x_?(.+?)__mutmut_\\d+.*` is wrong for two real shapes:
      · `x__coexistence_refusal__mutmut_3` -> `istence_refusal` — `x_?` ate one character too many
        against a lazy `(.+?)`.
      · `xǁLiveStreamControllerǁ_start__mutmut_73` -> `ǁLiveStreamControllerǁ_start` — mutmut qualifies
        METHODS with `ǁ`, and an AST lookup for that finds nothing.
    A leading underscore is part of the NAME (`_start`), not the `x_` prefix, so it must survive."""
    assert _MT.func_of_mutant("m.x_foo__mutmut_1") == "foo"
    assert _MT.func_of_mutant("cpap_stream.x__coexistence_refusal__mutmut_3") == "_coexistence_refusal"
    assert _MT.func_of_mutant("cpap_stream.xǁLiveStreamControllerǁ_start__mutmut_73") == "_start"
    assert _MT.func_of_mutant("cpap_stream.xǁCǁ_stop_op__mutmut_15") == "_stop_op"


def test_module_source_path_resolves_the_MODULE_not_the_interpreter():
    """🔴 THE BUG THAT MADE THE WHOLE WIRING INERT WHILE LOOKING CORRECT. The first version passed
    `py` — which at both call sites is `os.path.abspath(a.python)`, THE INTERPRETER — so it read the
    python binary, `message_call_lines` parsed nothing, and the flag was always False.

    ⚠️ It measured as a clean ZERO delta, and that is the part that nearly shipped: the aggregate
    agreed with the null hypothesis FOR THE WRONG REASON. With both bugs fixed the same module moves
    REACHABLE 20 -> 14."""
    p = _MT.module_source_path("/srv/ch", "cpap_stream")
    assert p.endswith("cpap_stream.py")
    assert "bin/python" not in p and "/.venv/" not in p


# ── mutants the diff-scoped gate found alive on these very functions (2026-08-27) ───────────────
# `mutation (diff-scoped)` reported SIX survivors on the lines this change added. Each means: alter
# that line and the suite stays green. They are killed here rather than excused — the gate is the one
# I moved inside the coverage floor two units earlier, and widening an exclusion to quiet it would be
# the exact move its own docstring warns about.

def test_in_message_call_is_FALSE_for_a_line_that_resolves_but_is_NOT_a_message_line():
    """🔴 KILLS `and` -> `or` in `return line is not None and line in message_call_lines(source)`.

    Every prior assertion had `line is None`, so the left operand alone decided them and the operator
    was never observed. `_SHOW` targets `return 1` — file line 7, which resolves perfectly well and is
    NOT inside the `log.info(...)` at 5-6. Under `or` this returns True and a plain `return` statement
    would be triaged as PROSE, i.e. quietly dropped from the work-list."""
    assert _MT.file_lineno_of(_SHOW, _SRC, "foo") == 7      # it resolves...
    assert 7 not in _MT.message_call_lines(_SRC)            # ...and is not a message line
    assert _MT.in_message_call(_SHOW, _SRC, "m.x_foo__mutmut_1") is False


def test_func_of_mutant_takes_the_LAST_dotted_segment_with_maxsplit_one():
    """🔴 KILLS four survivors on `core = core.rsplit('.', 1)[-1]`.

    Every existing case had at most ONE dot, where `rsplit`/`split`, `[-1]`/`[0]` and the separator
    are indistinguishable — the assertions pinned the shape and observed none of the choices. A
    two-dot name separates all of them: the module prefix here is `a.b`, so taking the first segment,
    splitting from the left, or failing to split at all each yields a different, wrong answer."""
    assert _MT.func_of_mutant("a.b.x_foo__mutmut_1") == "foo"
    assert _MT.func_of_mutant("pkg.mod.xǁCǁ_start__mutmut_2") == "_start"
    # And with no module prefix at all, so the split cannot be load-bearing in the other direction.
    assert _MT.func_of_mutant("x_foo__mutmut_1") == "foo"


def test_module_source_path_builds_the_EXACT_path_not_merely_a_plausible_one():
    """🔴 KILLS the surviving `module_source_path` mutant. The prior assertions were `endswith(...)`
    and a negative — both satisfied by several wrong constructions. Pin the whole string."""
    assert _MT.module_source_path("/srv/ch", "cpap_stream") == "/srv/ch/cpap_stream.py"
    assert _MT.module_source_path("/a/b", "x") == "/a/b/x.py"
