# tepna-capture — tests/test_settings_schema.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# settings_schema is the ALLOWLIST standing between the monitor's HTTP surface and the daemon's
# config.yaml. Its failure mode is not a wrong number on a page — it is a headless Pi that has written
# itself out of its own radio, web surface or storage with no way back except editing the file by hand.
# So these tests are about the boundary (what may be written, and within what range), not about coverage.

import ast
import math

import pytest

import settings_schema as ss
from settings_schema import SettingsError, coerce, describe, get_nested, set_nested
from tests._srcscan import module_source


# ── the boundary ────────────────────────────────────────────────────────────────────────────────────
# The keys that must NEVER become settable. Each one, if writable, bricks a headless box: a bad adapter
# loses the radio, a bad web.host loses the monitor, a bad root loses the captures. The module comment
# says they are "absent from this table ON PURPOSE" — this asserts that intent instead of trusting it.
FORBIDDEN = ["adapter", "root", "web.host", "web.port", "web.enabled", "incoming_subdir",
             "devices", "devices.0.address"]


@pytest.mark.parametrize("key", FORBIDDEN)
def test_dangerous_keys_are_not_settable(key):
    assert key not in ss.SETTINGS, f"{key} must never be UI-settable — it can lock the box out of itself"
    with pytest.raises(SettingsError, match="not a settable key"):
        coerce(key, "anything")


def test_an_unknown_key_is_rejected_rather_than_passed_through():
    with pytest.raises(SettingsError, match="not a settable key"):
        coerce("watchdog.enabledd", True)          # typo must fail closed, not create a dead key
    with pytest.raises(SettingsError):
        coerce("", 1)


# ── range enforcement, both directions ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("key,lo,hi", [(k, v[1], v[2]) for k, v in ss.SETTINGS.items() if v[1] is not None])
def test_every_bounded_setting_rejects_out_of_range_and_accepts_the_edges(key, lo, hi):
    assert coerce(key, lo) == lo                    # inclusive lower edge
    assert coerce(key, hi) == hi                    # inclusive upper edge
    with pytest.raises(SettingsError, match="must be between"):
        coerce(key, lo - 1)
    with pytest.raises(SettingsError, match="must be between"):
        coerce(key, hi + 1)


def test_a_number_is_coerced_to_the_declared_type():
    assert coerce("watchdog.grace_checks", "3") == 3
    assert isinstance(coerce("watchdog.grace_checks", "3"), int)
    assert coerce("link.rssi_interval_sec", "25") == 25.0
    assert isinstance(coerce("link.rssi_interval_sec", "25"), float)


def test_a_non_numeric_value_is_rejected():
    with pytest.raises(SettingsError, match="expects float"):
        coerce("link.rssi_interval_sec", "not-a-number")
    with pytest.raises(SettingsError, match="expects int"):
        coerce("watchdog.grace_checks", "two")


def test_nan_is_rejected():
    """An empty field in the UI used to arrive here as float('nan'), which slips past a naive < / >
    comparison (every NaN comparison is False) and would have been written to config.yaml."""
    with pytest.raises(SettingsError, match="empty/invalid"):
        coerce("link.rssi_interval_sec", float("nan"))
    with pytest.raises(SettingsError, match="empty/invalid"):
        coerce("link.rssi_interval_sec", "nan")
    # the guard must not reject legitimate infinities-adjacent-but-valid values by accident
    assert coerce("link.rssi_interval_sec", 25) == 25


def test_infinity_is_out_of_range_not_accepted():
    with pytest.raises(SettingsError, match="must be between"):
        coerce("link.rssi_interval_sec", math.inf)


# ── booleans ────────────────────────────────────────────────────────────────────────────────────────
def test_bools_accept_real_bools_and_the_two_json_ish_strings():
    assert coerce("watchdog.enabled", True) is True
    assert coerce("watchdog.enabled", False) is False
    assert coerce("watchdog.enabled", "true") is True
    assert coerce("watchdog.enabled", "TRUE") is True
    assert coerce("watchdog.enabled", "False") is False


@pytest.mark.parametrize("bad", [1, 0, "yes", "no", "1", "", None, "on"])
def test_bools_reject_everything_else(bad):
    """Notably 1/0 and "yes"/"on": accepting them invites a silent truthiness bug at the HTTP boundary,
    where a checkbox posting "on" would otherwise be read as the string it is."""
    with pytest.raises(SettingsError, match="expects a boolean"):
        coerce("watchdog.enabled", bad)


# ── nested get/set ──────────────────────────────────────────────────────────────────────────────────
def test_get_nested_walks_and_returns_none_for_missing_or_non_dict():
    cfg = {"watchdog": {"enabled": True, "interval_sec": 60}}
    assert get_nested(cfg, "watchdog.enabled") is True
    assert get_nested(cfg, "watchdog.missing") is None
    assert get_nested(cfg, "nope.nope") is None
    assert get_nested({"watchdog": 5}, "watchdog.enabled") is None   # scalar mid-path, not a crash


def test_set_nested_creates_missing_levels_and_replaces_a_scalar_branch():
    cfg = {}
    set_nested(cfg, "watchdog.enabled", False)
    assert cfg == {"watchdog": {"enabled": False}}
    set_nested(cfg, "watchdog.interval_sec", 90)          # existing dict is extended, not replaced
    assert cfg["watchdog"] == {"enabled": False, "interval_sec": 90}
    scalar = {"watchdog": 5}                              # a scalar where a dict is needed
    set_nested(scalar, "watchdog.enabled", True)
    assert scalar == {"watchdog": {"enabled": True}}


def test_set_nested_round_trips_through_get_nested_for_every_key():
    cfg = {}
    for key, (_t, _lo, _hi, _r, dflt, _h) in ss.SETTINGS.items():
        set_nested(cfg, key, dflt)
    for key, (_t, _lo, _hi, _r, dflt, _h) in ss.SETTINGS.items():
        assert get_nested(cfg, key) == dflt


# ── describe() ──────────────────────────────────────────────────────────────────────────────────────
def test_describe_falls_back_to_the_default_and_flags_it():
    rows = {r["key"]: r for r in describe({})}
    assert set(rows) == set(ss.SETTINGS), "describe must cover exactly the allowlist"
    for key, (typ, lo, hi, restart, dflt, help_) in ss.SETTINGS.items():
        r = rows[key]
        assert r["value"] == dflt and r["is_default"] is True
        assert r["default"] == dflt and r["type"] == typ.__name__
        assert r["min"] == lo and r["max"] == hi
        assert r["needs_restart"] is restart and r["help"] == help_


def test_describe_reports_an_override_as_not_default():
    cfg = {"watchdog": {"interval_sec": 90}}
    row = {r["key"]: r for r in describe(cfg)}["watchdog.interval_sec"]
    assert row["value"] == 90 and row["is_default"] is False


def test_describe_marks_a_value_equal_to_the_default_as_default():
    cfg = {"watchdog": {"interval_sec": ss.SETTINGS["watchdog.interval_sec"][4]}}
    row = {r["key"]: r for r in describe(cfg)}["watchdog.interval_sec"]
    assert row["is_default"] is True, "explicitly writing the default must not look like an override"


# ── the documented invariant ────────────────────────────────────────────────────────────────────────
def test_every_declared_default_is_a_valid_value_for_its_own_setting():
    """A default outside its own bounds would make the UI advertise a value the API then refuses."""
    for key, (_t, _lo, _hi, _r, dflt, _h) in ss.SETTINGS.items():
        assert coerce(key, dflt) == dflt, f"{key}'s default is not accepted by its own validator"


# How many schema defaults the source scan can currently reach and verify. See the equality below.
SOURCE_CHECKED_PATHS = 16   # 11 before heap_probe's five keys joined (#2999); see the equality below


def _cfg_section_of(node):
    """`cfg.get("sec")`, `cfg.get("sec") or {}`, `cfg.get("sec", {})` -> "sec"; anything else -> None."""
    if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or):
        node = node.values[0]
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get" and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "cfg" and node.args
            and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
        return node.args[0].value
    return None


def _config_fallbacks(src):
    """{"section.leaf": {"<literal source>", ...}} for every `<section-bound>.get("leaf", <default>)`.

    Scoped per function, because the same variable name is bound to different sections in different
    functions — see the test's docstring for the four paths that proves it on."""
    out = {}

    def visit(body, inherited):
        bind, subs = dict(inherited), []
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                subs.append(node)
                continue
            for n in ast.walk(node):
                if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
                    sec = _cfg_section_of(n.value)
                    if sec:
                        bind[n.targets[0].id] = sec
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for n in ast.walk(node):
                if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                        and n.func.attr == "get" and len(n.args) == 2
                        and isinstance(n.args[0], ast.Constant) and isinstance(n.args[0].value, str)):
                    continue
                holder = n.func.value
                sec = bind.get(holder.id) if isinstance(holder, ast.Name) else _cfg_section_of(holder)
                if sec:
                    out.setdefault(f"{sec}.{n.args[0].value}", set()).add(ast.unparse(n.args[1]).strip())
        for fn in subs:
            visit(fn.body, bind)

    visit(ast.parse(src).body, {})
    return out


def test_two_sections_sharing_a_leaf_keep_their_own_defaults():
    """THE PLANT for residue 2026-09-24-schema-default-scan-keys-on-the-leaf-alone. Keyed on the bare
    leaf, these two collapse into one set {True, False} and the failure is reported against whichever
    section happens to be in the schema — which is how adding `heap_probe.enabled` red `watchdog.enabled`
    in a PR that never touched the watchdog."""
    src = (
        "def a(cfg):\n"
        "    wcfg = cfg.get('watchdog') or {}\n"
        "    return wcfg.get('enabled', True)\n"
        "def b(cfg):\n"
        "    hcfg = cfg.get('heap_probe') or {}\n"
        "    return hcfg.get('enabled', False)\n")
    found = _config_fallbacks(src)
    assert found["watchdog.enabled"] == {"True"}
    assert found["heap_probe.enabled"] == {"False"}


def test_one_variable_name_bound_to_two_sections_is_not_one_section():
    """The scope half, and it produced a FALSE FINDING before it was fixed: a function-blind version of
    this scan reported `seal.poll_sec` holding both 600 and 300, and `archive.poll_sec` both 3600 and 60
    — four real paths rendered as two conflicts in capture.py that do not exist. `scfg` is `storage` in
    one function and `seal` in another; `acfg` is `alerts` in one and `archive` in another."""
    src = (
        "def storage_poller(cfg):\n"
        "    scfg = cfg.get('storage') or {}\n"
        "    return scfg.get('poll_sec', 300)\n"
        "def seal_poller(cfg):\n"
        "    scfg = cfg.get('seal') or {}\n"
        "    return scfg.get('poll_sec', 600)\n")
    found = _config_fallbacks(src)
    assert found["storage.poll_sec"] == {"300"}
    assert found["seal.poll_sec"] == {"600"}
    assert not any(len(v) > 1 for v in found.values()), f"no path may hold two literals here: {found}"


def test_the_real_capture_source_has_no_path_read_with_two_different_defaults():
    """Having separated the sections, the conflicts the flat scan reported are gone — and a REAL one
    would now be visible rather than hidden inside a leaf bucket."""
    found = _config_fallbacks(module_source("capture.py"))
    multi = {k: v for k, v in found.items() if len(v) > 1}
    assert not multi, f"one config path read with two different fallbacks: {multi}"


def test_a_chained_cfg_get_is_attributed_without_a_variable():
    """`(cfg.get("x") or {}).get("leaf", d)` reads inline, with no name to bind."""
    found = _config_fallbacks("def f(cfg):\n    return (cfg.get('as11_detector') or {}).get('poll_sec', 7)\n")
    assert found["as11_detector.poll_sec"] == {"7"}


def test_a_get_on_something_that_is_not_a_config_section_is_ignored():
    """`STATUS`, a dict of devices, a JSON body — a two-argument `.get` is everywhere. Only names bound
    to a `cfg.get(...)` count, or the scan would invent sections out of unrelated dictionaries."""
    found = _config_fallbacks("def f(d, cfg):\n    other = d.get('x') or {}\n    return other.get('enabled', True)\n")
    assert found == {}


def test_schema_defaults_match_the_daemon_fallbacks():
    """THE claim in the module header: "The default is the SINGLE SOURCE OF TRUTH — it is the same value
    the daemon falls back to." Prose, until now. capture.py reads config with `.get("leaf", <fallback>)`;
    if the two drift, the monitor advertises a default the daemon does not actually use, and a user who
    "resets to default" silently changes behaviour. Scanned from source because importing capture and
    reaching those lines needs a running BLE daemon.

    ⚠️ ATTRIBUTED BY SECTION, NOT BY LEAF (residue 2026-09-24-schema-default-scan-keys-on-the-leaf-alone).
    This used to be one regex keyed on the bare leaf, which had two costs. It blamed the wrong section —
    adding `heap_probe.enabled: False` reds `watchdog.enabled`, because both are `enabled` — and the only
    way past that failure was to DELETE the literal, after which the scan could not see the new section
    at all. A gate satisfied by removing the evidence it compares trains the next author to remove it.

    The binding is resolved INSIDE the enclosing function, and that is not a nicety: `scfg` is
    `cfg.get("storage")` in one function and `cfg.get("seal")` in another, `acfg` is `alerts` in one and
    `archive` in another. A function-blind version of this scan reported `seal.poll_sec` holding both 600
    and 300 and `archive.poll_sec` holding both 3600 and 60 — four real paths collapsed into two
    fabricated conflicts. Scoped, it separates them: storage 300, seal 600, alerts 60, archive 3600."""
    src = module_source("capture.py")   # skips on a mutmut file — see tests/_srcscan.py
    found = _config_fallbacks(src)

    checked = 0
    for key, (typ, _lo, _hi, _r, dflt, _h) in ss.SETTINGS.items():
        for raw in found.get(key, ()):
            if raw in ("True", "False"):
                actual = raw == "True"
            else:
                try:
                    actual = float(raw)
                except ValueError:
                    continue                          # a named constant, not a literal — covered below
            assert actual == dflt, (
                f"{key}: schema default {dflt!r} != capture.py fallback {raw!r} — "
                "the monitor would advertise a default the daemon does not use")
            checked += 1
    # AN EQUALITY, NOT A FLOOR. `>= 8` cannot notice a key falling out of the scan's reach — which is
    # exactly what happened when the leaf-keyed version was worked around by deleting a literal. Pinning
    # the population means a key that stops being checked reds here instead of going quiet. Adding a
    # schema key with a literal fallback in capture.py raises this number, deliberately.
    assert checked == SOURCE_CHECKED_PATHS, (
        f"{checked} schema defaults verified against capture.py source, expected "
        f"{SOURCE_CHECKED_PATHS} — a key that stopped being reachable from source is the failure this "
        f"equality exists to show, and a key that became reachable is a number to update here")


def test_the_two_named_constant_defaults_match_capture():
    """ppg_fs and rtc_resync_sec are read from module constants rather than a literal .get fallback, so
    the source scan above cannot see them. Import capture (no BLE needed at import) and compare."""
    import capture
    assert ss.SETTINGS["o2ring.ppg_fs"][4] == capture.O2PPG_FS_DEFAULT
    assert ss.SETTINGS["o2ring.rtc_resync_sec"][4] == capture._OXYII_RTC_RESYNC_SEC


def test_set_nested_walks_every_parent_and_assigns_the_last_key():
    """`parts[:-1]` walks the parents; `parts[-1]` is the leaf. Both are negative indices and both
    become `+1` under mutation — `parts[:1]` stops after the FIRST parent, so a three-deep key writes
    into the wrong dict, and `parts[+1]` assigns under the SECOND segment's name. Neither raises; the
    setting simply lands somewhere the reader never looks, which is a config change that appears to
    succeed and does nothing."""
    cfg = {}
    ss.set_nested(cfg, "power.drop_not_worn_sec", 180)
    assert cfg == {"power": {"drop_not_worn_sec": 180}}

    ss.set_nested(cfg, "a.b.c", 1)
    assert cfg["a"]["b"]["c"] == 1, "a three-deep key must walk BOTH parents, not stop at the first"

    ss.set_nested(cfg, "flat", 2)
    assert cfg["flat"] == 2, "a single-segment key assigns at the top level"

    cfg2 = {"power": "not-a-dict"}
    ss.set_nested(cfg2, "power.x", 3)
    assert cfg2 == {"power": {"x": 3}}, "a non-dict parent is replaced, not indexed into"
