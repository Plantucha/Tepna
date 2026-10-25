# tepna-capture — tests/test_pull_once_survivors_r6.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Residue `2026-10-22-pull-once-survivors-r6-of-6`: the last share of the survivors in
# `pull_session._pull_once`, from the COMMITTED ledger row through the closing lifecycle edge. The
# diff-scoped mutation gate mutates the whole function a PR touches, so these old lines red any PR
# that enters `_pull_once`.
#
# What these tests read, and why:
#   * The COMMITTED row's PATH. It is the row `oxy_restart.plan` trusts on the next run, and it is the
#     only row that names the FINAL `.dat` rather than the `.part` the bytes landed in. A COMMITTED row
#     with a null path says "the recording is safe" without saying where it is.
#   * The FORMAT-A GATE on the device summary. `parse_oxy_trailer` checks only the trailer's sub-magic,
#     never the header, so a file that is not Format A can still end in bytes that parse. The sidecar
#     must not report a device summary for a file it has just said is not Format A.
#   * The sidecar's exact TEXT. `test_pull_once_contract.py` pins that it spans several lines; this pins
#     the two-space indent, so the bytes beside the recording do not change with the suite green.
#   * The REASON on the closing lifecycle edge. `OXYLIFE.csv` is written from these reasons, and a null
#     one leaves the PULLING -> PAUSED_FOR_PULL row unexplained.
#
# Every pull here bounds its FILE_DATA waits (`_bound_data_waits`), so a mutant elsewhere in
# `_pull_once` that stops the offset from advancing FAILS these tests instead of hanging them.
#
# NOT tested here, and recorded as equivalent in `tools/mutate-equivalence.json` instead:
#   * the four mutants of `n_samples = max(0, (len(data) - 10 - 48)) // 3 if len(data) > 58 else 0`
#     (`or True`, `max(1, …)`, `>= 58`, `> 59`). Each changes the expression only where both arms
#     already give 0, so no length of `data` separates them.
#   * dropping `clock_status=acq_evidence.UNKNOWN` from the `assemble_dat` call. It equals the
#     parameter's default. The canary test at the bottom of this file reds the day that default
#     changes, which is the day that entry stops being true.

import inspect
import json
import os

import acq_evidence
import acq_evidence_o2ring
import oxy_inventory as inv
import oxy_lifecycle
import pull_session

from test_pull_once_survivors_p3 import _bound_data_waits
from test_pull_session import FakeRing, _install, _run

ADDR = "D1:98:62:7C:92:B3"
TS = "20260719010000"
SUBMAGIC = bytes([0x48, 0x12, 0x5A, 0xDA])


def _dat_path(tmp_path, ts=TS):
    return os.path.abspath(os.path.join(str(tmp_path), f"Wellue_O2Ring-S_{ts}_STORED.dat"))


def _finalised_trailer(seconds=300):
    """A 48-byte Format-A trailer that `oxyii.parse_oxy_trailer` accepts."""
    t = bytearray(48)
    t[4:8] = SUBMAGIC
    t[12], t[13] = seconds & 0xFF, seconds >> 8
    t[34], t[35], t[47] = 96, 81, 49
    return bytes(t)


def _pull(tmp_path, monkeypatch, blob, **kw):
    _install(monkeypatch, FakeRing([TS], blob))
    _bound_data_waits(monkeypatch)
    return _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000", **kw))


# ── the COMMITTED row ───────────────────────────────────────────────────────────────────────────────
def test_the_COMMITTED_row_names_the_final_dat_not_the_part(tmp_path, monkeypatch):
    """Every row before COMMITTED points at the `.part`. COMMITTED is written after the atomic rename,
    so it is the one row that must point at the final path, and the restart planner reads it there."""
    blob = b"\x01\x03" + b"c" * 90
    got = _pull(tmp_path, monkeypatch, blob)

    assert got == [_dat_path(tmp_path)], got
    rows = [r for r in inv.load_rows(str(tmp_path / "inventory.jsonl")) if r["state"] == inv.COMMITTED]
    assert len(rows) == 1, rows
    assert rows[0]["path"] == _dat_path(tmp_path), rows[0]


# ── the Format-A gate on the device summary ─────────────────────────────────────────────────────────
def test_a_trailer_on_a_file_that_is_not_format_a_yields_no_device_summary(tmp_path, monkeypatch):
    """The header says this is not Format A, and the trailer happens to carry the sub-magic. The sidecar
    reports `format_a: false`, so the summary is absent (null) and `finalized` is false. Parsing the
    trailer anyway would put a summary from an unknown layout beside a file the sidecar disowns."""
    blob = bytes([0xFF, 0xFF, 0, 0, 0, 0, 0, 0, 0x04, 0x00]) + bytes([96, 50, 0]) * 300 + _finalised_trailer()
    got = _pull(tmp_path, monkeypatch, blob)

    meta = json.load(open(got[0] + ".meta.json"))
    assert meta["format_a"] is False, meta
    assert meta["device_summary"] is None, meta["device_summary"]
    assert meta["finalized"] is False, meta


# ── the sidecar's exact text ────────────────────────────────────────────────────────────────────────
def test_the_sidecar_text_is_json_at_a_two_space_indent(tmp_path, monkeypatch):
    """The sidecar is the human-readable record of the pull. Its text is pinned byte for byte to the
    two-space form, which is also what every other sidecar in the night tree uses."""
    got = _pull(tmp_path, monkeypatch, b"\x01\x03" + b"j" * 90)

    raw = open(got[0] + ".meta.json").read()
    assert raw.startswith('{\n  "session": '), raw[:40]
    assert raw == json.dumps(json.loads(raw), indent=2), "the sidecar must be written at indent=2"


# ── the closing lifecycle edge ──────────────────────────────────────────────────────────────────────
def test_the_closing_lifecycle_edge_says_why_the_link_is_released(tmp_path, monkeypatch):
    """The last transition of a pull returns the link to PAUSED_FOR_PULL. Its reason is the text the
    lifecycle journal records for that row, so it must be the stated one, never null."""
    lc = oxy_lifecycle.OxyLifecycle()
    _pull(tmp_path, monkeypatch, b"\x01\x03" + b"l" * 90, lifecycle=lc)

    last = lc.history[-1]
    assert last.prev is oxy_lifecycle.OxyState.PULLING, last
    assert last.new is oxy_lifecycle.OxyState.PAUSED_FOR_PULL, last
    assert last.reason == "pull complete — releasing the link", last


# ── the equivalence this call site used to carry ────────────────────────────────────────────────────
def test_the_clock_status_argument_no_longer_repeats_the_default():
    """`_pull_once` passed `clock_status=acq_evidence.UNKNOWN` until 2026-10-24, and the equivalence
    ledger excused the mutant that dropped the argument: it repeated the signature's own default, so no
    input to `_pull_once` could tell the two apart. The call site now derives the word from the trailer
    it already parsed, which is exactly the input that distinguishes them — so the ledger entry is
    deleted rather than re-verified, and dropping the argument reds
    `test_pull_session.py::test_a_written_start_stamp_makes_the_real_pull_name_the_DEVICE_clock`."""
    default = inspect.signature(acq_evidence_o2ring.assemble_dat).parameters["clock_status"].default
    assert default is acq_evidence.UNKNOWN, default

    derived = acq_evidence_o2ring.clock_status_for_dat({"start_t_ms": 1_771_200_000_000})
    assert derived == acq_evidence.CLOCK_DEVICE_ONLY, derived
    assert derived != default, "the dropped-argument mutant has a distinguishing input now"
