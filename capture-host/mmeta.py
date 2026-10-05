# tepna-capture — mmeta.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE MUTATION GATE'S OWN HONESTY LAYER — reading mutmut's `mutants/<module>.py.meta`, the file the
# gate's two proven blind spots both hide in (OXYII-G1-TRANSACTIONAL-SYNC-FOLLOWUPS §2, §3).
#
# mutmut 3.x writes one JSON meta per mutated module:
#     {"exit_code_by_key": {"<stem>.x_<func>__mutmut_N": <exit_code> | null, ...}}
# A `null` value is a mutant that was GENERATED but never DECIDED — the run copied it in and then did
# not test it (a crashed invocation, a collection failure, a timeout). A killed OR a surviving mutant
# both carry a non-null exit code. So "how many mutants under this glob were actually tested" is a
# DIRECT, measured signal — not the "the process returned" proxy that `mutate_diff` counted as a clean
# run, and not `mutmut results` (which lists only survivors, so a legitimately all-killed glob reads as
# empty there and cannot be told from a glob that never ran).
#
# Two defects consume this file:
#   §3  a mutmut invocation that CRASHED after generation returns a real rc and no error, so the driver
#       counted it as a clean, empty run — the module dropped out of the gate while listed as covered.
#       `tested_count` == 0 on a glob the driver believes it ran is the tell.
#   §2  the reuse cache is keyed on the module SOURCE only, so a scratch reused after a test was ADDED or
#       MODIFIED serves mutmut's exit codes from the OLD tests — the new killer is not credited on the
#       first run. Keying an invalidation on the TEST tree, and clearing only the results (not the
#       expensive mutant source + warm .pyc), fixes it.
#
# Empirically confirmed the signal discriminates (2026-08-24, real /tmp scratches): clean runs read
# all-decided (cpap_spool 389/389, cpap_edf 880/880), a crashed/untested module reads 0/320.
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


def decided_under_glob(exit_codes: dict, glob: str) -> int:
    """How many mutants under `glob` were actually DECIDED (killed or survived) — a non-null exit code.

    `glob` is a mutmut name pattern like `oxy_transfer.x_select__mutmut_*`; its keys share the prefix
    before the `*`. A null value (generated-not-tested) does not count: that is precisely the state a
    crash leaves, and counting it would re-admit the false green. An empty / missing map counts zero.
    """
    prefix = glob.rstrip("*")
    return sum(1 for key, code in (exit_codes or {}).items() if code is not None and key.startswith(prefix))


def killed_under_glob(exit_codes: dict, glob: str) -> int:
    """How many mutants under `glob` were KILLED, read from the exit codes rather than derived.

    mutmut's own mapping: exit 1 is a failing test suite and exit 3 is an internal pytest error, and it
    treats BOTH as a kill (`status_by_exit_code`) — the mutant changed behaviour enough that the suite
    could not complete cleanly. Every other non-null code is some other outcome (0 survived, 5/33 no
    tests, 24/-24/152/255 timeout, 34 skipped, 35 suspicious, 37 caught by the type checker).

    MEASURED, NOT DERIVED, and that is the whole reason this exists. `killed` could be computed as
    `decided - survived - undecided`, but then the verdict's self-consistency assertion
    (`mutation_diff.result_inconsistency`) would be checking arithmetic it had just performed — vacuous
    by construction. Counting kills from the same map `decided` comes from gives the assertion something
    independent to disagree with.
    """
    prefix = glob.rstrip("*")
    return sum(1 for key, code in (exit_codes or {}).items() if code in (1, 3) and key.startswith(prefix))


def read_exit_codes(meta_path: Path) -> dict:
    """The `exit_code_by_key` map from a mutmut `<module>.py.meta`, or `{}` if it is absent/unreadable.

    Absence is itself a signal (a crash before generation writes no meta), and a malformed file is
    treated the same as absent — either way, nothing was measured, so nothing is credited."""
    try:
        data = json.loads(Path(meta_path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    codes = data.get("exit_code_by_key") if isinstance(data, dict) else None
    return codes if isinstance(codes, dict) else {}


def tested_count(work: Path, module: str, glob: str) -> int:
    """§3 — how many mutants under `glob` mutmut actually tested, read from the scratch's meta.

    `module` is the file name (`oxy_transfer.py`); the meta lives at `<work>/mutants/<module>.meta`.
    Zero on a glob the driver believes ran cleanly means the invocation dropped out — refuse, don't green.
    """
    return decided_under_glob(read_exit_codes(Path(work) / "mutants" / f"{module}.meta"), glob)


def killed_count(work: Path, module: str, glob: str) -> int:
    """`killed_under_glob` against the scratch's meta — the sibling of `tested_count`."""
    return killed_under_glob(read_exit_codes(Path(work) / "mutants" / f"{module}.meta"), glob)


def generated_under_glob(mutants_src: str, glob: str) -> int:
    """How many mutants mutmut GENERATED for `glob`, counted in the mutants file it wrote.

    ⚠️ THIS SEPARATES TWO CAUSES THAT `tested_count` ALONE CANNOT TELL APART, and one of them is
    benign. A function with no mutable operator — `identity()` is `return f"{a}/{b}"`: no comparison,
    no boolean, no numeric literal — yields ZERO mutants, and mutmut does not say so politely: it
    exits with `AssertionError: Filtered for specific mutants, but nothing matches`. That glob then
    reads 0-tested exactly like a crash, and refusing on it reds the safest diffs there are — a
    rename, a docstring, a format-only edit.

    Measured 2026-08-24 on a one-line change inside `oxy_inventory.identity`: 138 mutants in the file,
    **0** under that glob, whole run refused at exit 2.

    So the pair is a three-way split, not a two-way one:
        generated 0, decided 0  → nothing to mutate. Report it and pass; there is nothing to conclude.
        generated >0, decided 0 → the §3 crash. Refuse — an empty survivor list is "not checked".
        generated >0, decided >0 → covered.

    ⚠️ ANCHORED `^\\s*def`, NOT `^def`, AND THE DIFFERENCE INVERTS THE GUARD. mutmut emits a METHOD's
    mutants INDENTED inside the class body; only a module-level function's land at column 0. Measured
    2026-09-18 against real `mutate_file_contents` output:

        Counter.scaled   (method)     2 mutants, indent 4   →  `^def` counted 0
        module_level     (function)   3 mutants, indent 0   →  `^def` counted 3

    With `^def`, `generated_under_glob` returned 0 for EVERY class method, so the three-way split above
    collapsed for methods: a genuine CRASH (generated >0, decided 0) took the BENIGN arm, `_ran` was
    given back, and the run passed. The guard written to stop "a claim of coverage that does not exist"
    produced exactly that, one branch over, for every method in the tree.

    ⚠️ And the validating measurement could not have caught it: `oxy_inventory.identity` is
    module-level, at column 0 — the single shape where `^def` works. The function was checked only
    against the case that passes.

    🔴 AND THE SAME HOLE WAS STILL OPEN FOR `async def`, ONE SHAPE OVER (measured 2026-09-28). mutmut
    writes a coroutine's mutants as `async def x__run__mutmut_30(...)`, and `^\\s*def` does not match
    `async def` — only whitespace may precede the keyword. Measured against a real scratch tree:
    `wifi_uplink._run` had **44** mutants in `mutants/wifi_uplink.py` and this function returned **0**.

    That is 309 of capture-host's 1959 functions (16 %), and it is concentrated exactly where it hurts:
    47 of 64 in `webmon.py`, 85 in `capture.py`, all 10 of `as11_pull.py`. For every one of them the
    three-way split collapsed the same way it had for methods — a genuine CRASH (generated >0, decided
    0) took the BENIGN "nothing to mutate, pass" arm, so the §3 guard was disabled across the entire
    async surface of an asyncio daemon.

    The fix is the keyword, not another anchor: `async` is the only thing Python allows between the
    line start and `def`. Both earlier fixes and this one share one root — the pattern was written
    from the shape in front of the author, and the shapes it does not match report ABSENCE (`0`) rather
    than refusing, which §∅ is precisely about. A count that cannot see a construct must not answer
    for it. The tests below now pin all four shapes: module-level, indented method, async, and async
    method.
    """
    # The glob is built in exactly one place — `f"{stem_mod}.{s}__mutmut_*"` in tools/mutate_diff.py —
    # so it carries EXACTLY ONE dot: a module stem that cannot contain one, and a mangled name that
    # uses `ǁ` (U+01C1) for class qualification, never `.`. That made `split(".", 1)[1]` unobservable:
    # `rsplit`, maxsplit 2 and maxsplit-absent all agree on a one-dot string, so three mutants of this
    # line survived with nothing able to kill them (measured 2026-09-28).
    #
    # They are not recorded as equivalent, because the reason they agree is the reason the line was
    # wrong: on a shape it does not expect it would pick a MIDDLE segment, the regex would then match
    # nothing, and the count would come back 0 — the same silent zero for an unseen shape that this
    # whole function was just fixed for. So the shape is now a stated contract rather than a guess,
    # which is also what makes the line killable.
    return len(re.findall(r"^\s*(?:async\s+)?def " + re.escape(_stem_of(glob)) + r"\d+\(", mutants_src or "", re.M))


def _stem_of(glob: str) -> str:
    """The mangled function stem a glob names, with the module qualifier removed.

    Single-sourced because `registered_under_glob` must parse the glob EXACTLY as `generated_under_glob`
    does. The second count is independent in its OBSERVATION, not in its subject — two parsers would be
    two chances to disagree about which function is being counted, which is a different bug entirely."""
    stem = glob.rstrip("*")
    head, dot, tail = stem.partition(".")
    if not dot:
        return stem  # a bare mangled stem, already unqualified
    if "." in tail:
        raise ValueError(f"unexpected mutant glob {glob!r}: a module-qualified glob has exactly one dot")
    return tail


def registered_under_glob(mutants_src: str, glob: str) -> int:
    """The SAME count as `generated_under_glob`, read from a different thing mutmut writes.

    Beside each mutant definition mutmut emits a registration line into the function's dispatch table:

        mutants_x__run__mutmut['x__run__mutmut_44'] = x__run__mutmut_44 # type: ignore # mutmut generated

    That is an assignment, not a definition: no `def` keyword, no indentation rule, no `async`. Those
    are precisely the three things the definition scan has been blind to — `^def` missed indented
    methods, `^\\s*def` missed coroutines — so counting registrations is an INDEPENDENT observation of
    the same fact, and two independent counts that must agree is the only structure that catches a
    scan which cannot see its own subject.

    MEASURED 2026-09-28 across four real scratch trees (wifi_uplink, mmeta, clock_offset, nightqc):
    107 stems, the two counts agree on every one. Replay the same check with the PRE-#3214 definition
    pattern and it fires on 7 of wifi_uplink's 12 stems — `def` 0 against registrations of 44, 53, 22,
    49, 25, 76, 35. The historical blind spot is caught retrospectively, by real data rather than by a
    plant, which is the evidence that this cross-check would have worked before it was written.
    """
    stem = _stem_of(glob)
    return len(
        re.findall(
            r"^mutants_" + re.escape(stem.rstrip("_")) + r"\['" + re.escape(stem) + r"\d+'\]\s*=",
            mutants_src or "",
            re.M,
        )
    )


def generated_scan(mutants_src: str, glob: str) -> dict:
    """What `generated_under_glob` counted, and what it counted it OVER.

    A bare count cannot be checked. `0` comes back from a function with no mutable operator (benign,
    and the file WAS read), from a mutants file that does not exist (nothing was read at all), and from
    a scan that read the file and could not recognise the construct in it (the two historical bugs).
    Three different findings, one identical integer — which is how the same three-line function shipped
    the same class of defect twice in five weeks. So the population travels with the count:

        matched       mutants counted for THIS glob by the definition scan
        corroborated  the same, from mutmut's registration table — independent of `def`
        examined      mutant definitions in the file for ANY stem: the population actually read
        registered    registration lines for any stem: that same population from the other side
        sourceBytes   0 iff nothing was read at all

    This function only OBSERVES. `mutation_diff.unmeasured_zero` decides, because a scanner that
    judges its own output is the shape being fixed here.
    """
    src = mutants_src or ""
    return {
        "helper": "generated_under_glob",
        "glob": glob,
        "matched": generated_under_glob(src, glob),
        "corroborated": registered_under_glob(src, glob),
        "examined": len(re.findall(r"^\s*(?:async\s+)?def [^\s(]*__mutmut_\d+\(", src, re.M)),
        "registered": len(re.findall(r"^mutants_[^\s\[]*__mutmut\['[^']*__mutmut_\d+'\]\s*=", src, re.M)),
        "sourceBytes": len(src),
    }


def decided_scan(exit_codes: dict, glob: str) -> dict:
    """What `decided_under_glob` counted, and over what — the same ambiguity one layer up.

    `0` means "every mutant under this glob is null" (a crash after generation, a real finding), or
    "no key matches this glob" (the map was read and knows nothing of this function), or "the map is
    empty" (nothing was read: `read_exit_codes` returns `{}` for absent AND malformed alike).

        matched     keys under this glob carrying a non-null exit code
        underGlob   keys under this glob at all, null or not
        examined    keys in the map: the population actually read
    """
    prefix = glob.rstrip("*")
    codes = exit_codes or {}
    return {
        "helper": "decided_under_glob",
        "glob": glob,
        "matched": decided_under_glob(codes, glob),
        "underGlob": sum(1 for key in codes if key.startswith(prefix)),
        "examined": len(codes),
    }


def exit_codes_scan(meta_path: Path) -> dict:
    """Whether the meta was there and whether it PARSED — the distinction `read_exit_codes` erases.

    That function returns `{}` for absent, unreadable, malformed and present-but-empty alike, and its
    docstring calls that deliberate: "either way, nothing was measured". Right for CREDITING and wrong
    for REPORTING — "mutmut wrote no meta" and "mutmut wrote a meta this tool cannot parse" are
    different failures, and the second one is ours.
    """
    p = Path(meta_path)
    try:
        raw = p.read_bytes()
    except OSError:
        return {"helper": "read_exit_codes", "present": False, "parsed": False, "keys": 0}
    try:
        # BYTES, NOT TEXT, AND THE ENCODING IS NOT A PARAMETER. `read_text(encoding="utf-8")` was the
        # obvious spelling and left a mutant nothing could kill: `encoding=None` uses the HOST LOCALE's
        # encoding, which on this box is UTF-8, so no in-process test can tell the two apart. It is not
        # cosmetic either — under C/POSIX the locale encoding is ASCII, a meta carrying any non-ASCII
        # byte then raises UnicodeDecodeError, and that is a ValueError, so one layer up
        # `read_exit_codes` CATCHES it and returns `{}`: a good meta reported as malformed and mutmut
        # blamed for a file this tool read wrong.
        #
        # The subprocess test below it CAN observe that, and mutmut still cannot use it — a test whose
        # only contact with the code is a subprocess registers no trampoline hit, so it is never
        # selected against this mutant (the same fact `refresh_caches_if_tests_changed` records about
        # stale selections). So the answer is not a better test: `json.loads` takes bytes and decodes
        # UTF-8 per RFC 8259 whatever the locale says, which deletes the parameter, the locale
        # dependency and the unkillable mutant together. Invalid UTF-8 still raises UnicodeDecodeError,
        # still a ValueError, and lands in the `parsed: False` arm where it belongs.
        data = json.loads(raw)
    except ValueError:
        return {"helper": "read_exit_codes", "present": True, "parsed": False, "keys": 0}
    codes = data.get("exit_code_by_key") if isinstance(data, dict) else None
    return {
        "helper": "read_exit_codes",
        "present": True,
        "parsed": True,
        "keys": len(codes) if isinstance(codes, dict) else 0,
    }


def generated_count(work: Path, module: str, glob: str) -> int | None:
    """`generated_under_glob` against the scratch's mutants file; None when that file cannot be read.

    ∅ NOT 0 (ABSENCE-SURVEY f2f47e27c21e). A 0 is a legal count — a function with no mutable operator —
    so an unread file returned as 0 was indistinguishable from it, and the caller summed it into the
    verdict's `generated` total, understating a count it had not taken."""
    try:
        src = (Path(work) / "mutants" / module).read_text(encoding="utf-8")
    except OSError:
        return None
    return generated_under_glob(src, glob)


def test_tree_hash(tests_dir: Path) -> str:
    """A content hash of the whole test tree — every `*.py` under `tests_dir`, by relative path + bytes.

    Changes iff a test is added, removed, or edited; blind to mtimes and `__pycache__`. This is the key
    §2 needs: mutmut's mutant source is a pure function of the module, but its exit codes are a function
    of the TESTS, and only this hash moves when the tests do.
    """
    digest = hashlib.sha256()
    for path in sorted(Path(tests_dir).rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        digest.update(path.relative_to(tests_dir).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()[:16]


def refresh_caches_if_tests_changed(work: Path, module: str, tests_dir: Path, stamp: Path) -> bool:
    """§2 — invalidate mutmut's RESULTS **and SELECTION** caches for `module` when the tests change.

    NULLS every value in `<work>/mutants/<module>.meta`'s `exit_code_by_key` — it does NOT delete the file.
    A null is precisely "generated but not decided" (see this module's header), which is exactly what an
    invalidated result is: the mutant KEYS survive (so mutmut's `--only` filter still matches and it
    re-decides them), while `decided_under_glob` already excludes nulls so §3 reads the re-run honestly.

    Deleting the file instead would strip the keys, and with the source unchanged mutmut skips regeneration
    (`1 unmodified`) and then has nothing to filter against — crashing with `Filtered for specific mutants,
    but nothing matches`, i.e. the §2 invalidation would trigger the very crash §3 refuses on. (Measured
    2026-08-24: delete → EXIT 2 on the gate's own module; the fix keeps the mutant source + warm `.pyc`.)

    ⚠️ AND THE SELECTION, which this used to leave behind — measured 2026-09-27, and it is the more
    dangerous half. mutmut picks WHICH TESTS to run for a mutant from `mutants/mutmut-stats.json`
    (`tests_by_mangled_function_name`), built by a TRACED pass. Nulling the exit codes made every mutant
    re-decide — honestly — against a STALE selection, so a test edited to kill a mutant was never chosen
    to run against it and the mutant read SURVIVED. Two paths produce that map without the edited test:
    a test whose only contact with the code is a subprocess registers no trampoline hit at all, and
    `collect_or_load_stats` re-traces only `new_tests() = ids - collected_test_names()` — a set difference
    on test NAMES, so EDITING a test under the same name never re-traces it.

    Removing the stats file is the whole fix: `load_stats()` then returns False and mutmut does a FULL
    collection. It costs one traced pass (7.3 s measured on `solid_night_inputs`), which is the price of
    the answer being about the tests that exist.

    ⚠️ NOT symmetric with the meta above, deliberately. The meta is NULLED because deleting it strips the
    mutant keys and mutmut, seeing unchanged source, skips regeneration and then crashes with "Filtered
    for specific mutants, but nothing matches". The stats file has no such role — nothing filters on it —
    so deleting is safe and is the only way to force a full re-trace.

    The test hash is stamped into `stamp` so the comparison is against what was actually last measured, not
    an mtime. Returns True iff the caches were invalidated (tests changed or no prior stamp).
    """
    current = test_tree_hash(tests_dir)
    stamp = Path(stamp)
    previous = stamp.read_text(encoding="utf-8").strip() if stamp.exists() else None
    if previous == current:
        return False
    meta = Path(work) / "mutants" / f"{module}.meta"
    if meta.exists():
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            codes = data.get("exit_code_by_key")
            if isinstance(codes, dict):
                data["exit_code_by_key"] = dict.fromkeys(codes, None)
                meta.write_text(json.dumps(data), encoding="utf-8")
        except (OSError, ValueError):
            pass  # unreadable meta ⇒ nothing to invalidate; the stamp still advances
    # THE SELECTION. Unlinked, not rewritten: mutmut rebuilds it from a traced pass when it is absent,
    # and any partial edit here would be a guess about which associations are still true.
    stats = Path(work) / "mutants" / "mutmut-stats.json"
    try:
        stats.unlink()
    except OSError:
        pass  # already gone, or unreadable ⇒ mutmut collects afresh either way
    stamp.write_text(current, encoding="utf-8")
    return True
