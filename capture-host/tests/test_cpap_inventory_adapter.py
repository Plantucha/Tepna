# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The adapter's one real job is telling three kinds of "empty" apart, so that is what these test.
# Every case is a tmp tree: no BLE, no network, no daemon.

import json
import os

import cpap_inventory_adapter as ad


def _tree(tmp_path, *, datalog=None, envelopes=None):
    root = tmp_path / "cpap"
    if datalog is not None:
        d = root / "DATALOG"
        d.mkdir(parents=True)
        for n in datalog:
            (d / n).mkdir()
    else:
        root.mkdir(parents=True, exist_ok=True)
    env = tmp_path / "live"
    if envelopes is not None:
        env.mkdir()
        for n in envelopes:
            (env / "DATALOG" / n).mkdir(parents=True)
            (env / "DATALOG" / n / f"{n}_221405_BRP.edf").write_bytes(b"0")
    return str(root), str(env)


# ── the three "empty"s, which is the whole point ─────────────────────────────────────────────────
def test_a_missing_DATALOG_is_not_consulted_while_an_empty_one_IS(tmp_path):
    """ "Read it, found nothing" and "there was nothing to read" are opposite, and they are the two
    states a naive `os.listdir` in a try/except collapses into one."""
    root, _ = _tree(tmp_path)  # no DATALOG at all
    assert ad.card_nights(root) == ([], False)
    os.makedirs(os.path.join(root, "DATALOG"))
    assert ad.card_nights(root) == ([], True)  # present and empty: consulted, and empty is real


def test_a_missing_envelope_dir_is_not_consulted(tmp_path):
    root, env = _tree(tmp_path, datalog=[])
    assert ad.envelope_nights(env) == ([], False)
    os.makedirs(env)
    assert ad.envelope_nights(env) == ([], True)  # the stream dir exists and never filed a night
    os.makedirs(os.path.join(env, "DATALOG"))
    assert ad.envelope_nights(env) == ([], True)


def test_a_stream_night_is_a_DATALOG_folder_holding_an_edf(tmp_path):
    """The stream files its EDFs in the card's layout. A folder with no `.edf` is a night the stream
    opened and never wrote, and a `.meta.json` at the top is no night at all — no writer puts one
    there, which is how every box read "consulted, no envelopes"."""
    _, env = _tree(tmp_path, datalog=[], envelopes=["20261029", "20261030"])
    os.makedirs(os.path.join(env, "DATALOG", "20261028"))  # opened, nothing written
    open(os.path.join(env, "DATALOG", "20261028", "notes.txt"), "w").close()
    open(os.path.join(env, "AS11_20261027_BRP.edf.meta.json"), "w").close()
    assert ad.envelope_nights(env) == (["20261029", "20261030"], True)


def test_an_unlistable_stream_DATALOG_is_not_consulted(tmp_path):
    _, env = _tree(tmp_path, datalog=[])
    os.makedirs(env)
    open(os.path.join(env, "DATALOG"), "w").close()  # a file where the folder belongs
    assert ad.envelope_nights(env) == ([], False)


def test_an_unreadable_spool_ledger_is_NOT_an_empty_one(tmp_path):
    """The spool is a once-daily Summary transaction, so most therapy-end runs have nothing new. An
    absent or throwing ledger must report not-consulted, or the oracle manufactures a discrepancy per
    night from a source nobody read."""

    def _boom(_root):
        raise OSError("no ledger here")

    assert ad.spool_nights(str(tmp_path), read_spool=_boom) == ([], False)
    assert ad.spool_nights(str(tmp_path), read_spool=lambda _r: None) == ([], False)
    assert ad.spool_nights(str(tmp_path), read_spool=lambda _r: []) == ([], True)  # read, and empty


def test_spool_days_pass_through_as_the_inventory(tmp_path):
    got, ok = ad.spool_nights(str(tmp_path), read_spool=lambda _r: ["2026-10-29", "2026-10-30"])
    assert ok is True and got == ["2026-10-29", "2026-10-30"]


# ── the decoded spool: the nights live inside the round, not in the ledger row ───────────────────
def _v(n):
    out = bytearray()
    while True:
        b, n = n & 0x7F, n >> 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _f(fn, v):
    return _v(fn << 3) + _v(v)


def _m(fn, body):
    return _v(fn << 3 | 2) + _v(len(body)) + body


NOON = 1791043200000  # 2026-10-03T16:00Z = local noon at UTC-4


def _day(start_ms, *, session=True):
    """One Summary record: PeriodStart, the zigzag offset 479 (= -240 min), and one session if asked."""
    sess = _m(6, _m(1, _f(1, start_ms + 600 * 60000) + _f(2, 420))) if session else b""
    return _m(2, _f(2, start_ms) + _f(4, 479) + sess)


def _spool(tmp_path, rounds):
    """A spool store on disk: `rounds` is a list of (filename, bytes or None for an absent file)."""
    root = tmp_path / "spool"
    (root / "committed").mkdir(parents=True)
    with open(root / "cpap_spool_ledger.jsonl", "w") as fh:
        for i, (name, raw) in enumerate(rounds):
            if raw is not None:
                (root / "committed" / name).write_bytes(raw)
            # the row's cursor is the BLOCK start, the same for every round of one block
            row = {"file": name, "spool_type": "Summary", "committed_cursor": "20261003", "round": i}
            fh.write(json.dumps(row) + "\n")
    return str(root)


def test_the_spool_names_one_night_per_record_not_per_ledger_row(tmp_path):
    """Two rounds of one block share one cursor. Keying on the row named one night for both; the
    decoded records name the three nights the device actually listed."""
    day = 86400000
    root = _spool(tmp_path, [("r0.bin", _day(NOON) + _day(NOON + day)), ("r1.bin", _day(NOON + 2 * day))])
    got, ok = ad.spool_nights(root)
    assert ok is True and got == ["2026-10-03", "2026-10-04", "2026-10-05"]


def test_a_spool_day_with_no_session_is_not_a_night(tmp_path):
    root = _spool(tmp_path, [("r0.bin", _day(NOON) + _day(NOON + 86400000, session=False))])
    assert ad.spool_nights(root) == (["2026-10-03"], True)


def test_an_absent_ledger_or_root_is_NOT_an_empty_spool(tmp_path):
    """`cpap_spool.read_ledger` returns [] for an absent file. Read through it, the box root — which
    holds no ledger — reported "consulted, the device listed nothing" on every night."""
    assert ad.decoded_spool_days(str(tmp_path)) is None
    assert ad.decoded_spool_days(None) is None
    assert ad.spool_nights(str(tmp_path)) == ([], False)


def test_an_absent_round_file_makes_the_spool_unconsulted(tmp_path):
    """A partial spool turns every night it lost into a finding, so one absent round refuses it all."""
    root = _spool(tmp_path, [("r0.bin", _day(NOON)), ("r1.bin", None)])
    assert ad.decoded_spool_days(root) is None
    assert ad.spool_nights(root) == ([], False)


def test_a_round_that_does_not_decode_makes_the_spool_unconsulted(tmp_path):
    root = _spool(tmp_path, [("r0.bin", _day(NOON)[:-3])])  # truncated mid-record
    assert ad.spool_nights(root) == ([], False)


def test_an_empty_ledger_is_a_spool_read_whole_that_listed_nothing(tmp_path):
    assert ad.spool_nights(_spool(tmp_path, [])) == ([], True)


# ── the card flag is READ, never derived ─────────────────────────────────────────────────────────
def test_the_card_flag_comes_from_the_RESULT_not_from_its_state(tmp_path):
    """⚠️ `state == "error"` splits BOTH ways: a completed walk with short reads is error+consulted,
    a walk that never happened is error+unconsulted. The information is not in `state` at all, which
    is why the transport publishes the flag. Same state, opposite handling — asserted here so nobody
    can 'simplify' this into `state != "error"`."""
    root, env = _tree(tmp_path, datalog=["20260827"], envelopes=["20260827"])
    spool = lambda _r: ["20260827"]  # noqa: E731

    read = ad.reconcile_after_harvest(
        {"state": "error", "consulted": True},
        dest_root=root,
        envelope_root=env,
        spool_root=str(tmp_path),
        read_spool=spool,
    )
    never = ad.reconcile_after_harvest(
        {"state": "error", "consulted": False},
        dest_root=root,
        envelope_root=env,
        spool_root=str(tmp_path),
        read_spool=spool,
    )
    assert read["consulted"]["card"] is True
    assert never["consulted"]["card"] is False


def test_a_result_with_NO_consulted_key_is_treated_as_unconsulted(tmp_path):
    """A hook result that omits the flag is a hook we do not understand. Defaulting to True would
    manufacture findings from a card nobody read — the failure this whole module exists to prevent."""
    root, env = _tree(tmp_path, datalog=[], envelopes=["20260827"])
    r = ad.reconcile_after_harvest(
        {"state": "ok"}, dest_root=root, envelope_root=env, spool_root=str(tmp_path), read_spool=lambda _r: []
    )
    assert r["consulted"]["card"] is False


# ── end to end ───────────────────────────────────────────────────────────────────────────────────
def test_a_real_discrepancy_reaches_both_the_QC_field_and_the_journal(tmp_path):
    root, env = _tree(tmp_path, datalog=["20260827"], envelopes=[])
    qc = str(tmp_path / "QC-SUMMARY.json")
    jr = str(tmp_path / ad.JOURNAL_NAME)
    payload = ad.on_harvest_complete(
        {"state": "ok", "consulted": True},
        dest_root=root,
        envelope_root=env,
        spool_root=str(tmp_path),
        qc_path=qc,
        journal_path=jr,
        read_spool=lambda _r: ["20260827"],
    )
    assert payload["ok"] is True
    assert payload["by_state"] == {"MISSED-LIVE": 1}
    assert json.load(open(qc))[ad.QC_FIELD]["discrepancies"] == 1
    lines = [json.loads(x) for x in open(jr)]
    assert len(lines) == 1 and lines[0]["state"] == "MISSED-LIVE"


def test_a_refusal_is_carried_through_to_BOTH_reports_and_produces_one_journal_line(tmp_path):
    """Zero journal lines is what a HEALTHY night produces. A refusal that wrote nothing would be
    indistinguishable from a clean one on disk."""
    root, env = _tree(tmp_path, datalog=[], envelopes=[])
    qc = str(tmp_path / "QC-SUMMARY.json")
    jr = str(tmp_path / ad.JOURNAL_NAME)
    payload = ad.on_harvest_complete(
        {"state": "barren", "consulted": True},
        dest_root=root,
        envelope_root=env,
        spool_root=str(tmp_path),
        qc_path=qc,
        journal_path=jr,
        read_spool=lambda _r: [],
    )
    assert payload["ok"] is False and payload["discrepancies"] is None
    assert json.load(open(qc))[ad.QC_FIELD]["ok"] is False
    assert len([json.loads(x) for x in open(jr)]) == 1


def test_an_existing_QC_SUMMARY_keeps_its_other_fields(tmp_path):
    root, env = _tree(tmp_path, datalog=["20260827"], envelopes=["20260827"])
    qc = str(tmp_path / "QC-SUMMARY.json")
    with open(qc, "w") as fh:
        json.dump({"spo2": {"ok": True}}, fh)
    ad.on_harvest_complete(
        {"state": "ok", "consulted": True},
        dest_root=root,
        envelope_root=env,
        spool_root=str(tmp_path),
        qc_path=qc,
        journal_path=str(tmp_path / "j.jsonl"),
        read_spool=lambda _r: ["20260827"],
    )
    d = json.load(open(qc))
    assert d["spo2"] == {"ok": True} and ad.QC_FIELD in d


def test_the_reporter_cannot_change_the_harvest_outcome(tmp_path):
    """It returns None on any internal failure rather than raising: a reporter that can take down the
    thing it reports on is a liability, and the files are already on disk by the time it runs."""

    class _Boom:
        def get(self, *_a, **_k):
            raise RuntimeError("nope")

    assert (
        ad.on_harvest_complete(
            _Boom(),
            dest_root="/nonexistent",
            envelope_root="/nonexistent",
            spool_root="/nonexistent",
            qc_path="/nonexistent/q.json",
            journal_path="/nonexistent/j.jsonl",
        )
        is None
    )


def test_an_unwritable_report_path_does_not_lose_the_measurement(tmp_path):
    """The report is not the data. A failed write returns the payload anyway, so a caller that logs it
    still sees what was found."""
    root, env = _tree(tmp_path, datalog=["20260827"], envelopes=[])
    payload = ad.on_harvest_complete(
        {"state": "ok", "consulted": True},
        dest_root=root,
        envelope_root=env,
        spool_root=str(tmp_path),
        qc_path="/nonexistent/dir/q.json",
        journal_path="/nonexistent/dir/j.jsonl",
        read_spool=lambda _r: ["20260827"],
    )
    assert payload is not None and payload["discrepancies"] == 1


# ── the log surface, and the row that names no night ─────────────────────────────────────────────
class _Log:
    def __init__(self):
        self.info_calls, self.exc_calls = [], []

    def info(self, *a):
        self.info_calls.append(a)

    def exception(self, *a):
        self.exc_calls.append(a)


def test_the_log_line_reports_the_split_when_there_is_something_to_report(tmp_path):
    root, env = _tree(tmp_path, datalog=["20260827"], envelopes=[])
    lg = _Log()
    ad.on_harvest_complete(
        {"state": "ok", "consulted": True},
        dest_root=root,
        envelope_root=env,
        spool_root=str(tmp_path),
        qc_path=str(tmp_path / "q.json"),
        journal_path=str(tmp_path / "j.jsonl"),
        read_spool=lambda _r: ["20260827"],
        log=lg,
    )
    assert lg.info_calls and "discrepancy" in lg.info_calls[0][0]


def test_a_refusal_logs_its_REASON_rather_than_a_count(tmp_path):
    """Logging "0 discrepancies" for a run that examined nothing is the laundering this module
    exists to prevent, one layer out — so the refusal branch prints the reason instead."""
    root, env = _tree(tmp_path, datalog=[], envelopes=[])
    lg = _Log()
    ad.on_harvest_complete(
        {"state": "barren", "consulted": True},
        dest_root=root,
        envelope_root=env,
        spool_root=str(tmp_path),
        qc_path=str(tmp_path / "q.json"),
        journal_path=str(tmp_path / "j.jsonl"),
        read_spool=lambda _r: [],
        log=lg,
    )
    assert lg.info_calls and "no data" in lg.info_calls[0][1]


def test_an_internal_failure_is_LOGGED_and_swallowed(tmp_path):
    class _Boom:
        def get(self, *_a, **_k):
            raise RuntimeError("nope")

    lg = _Log()
    assert (
        ad.on_harvest_complete(
            _Boom(),
            dest_root="/nonexistent",
            envelope_root="/nonexistent",
            spool_root="/nonexistent",
            qc_path="/x/q.json",
            journal_path="/x/j.jsonl",
            log=lg,
        )
        is None
    )
    assert lg.exc_calls  # the harvest is unaffected, but the failure is not silent


def test_the_log_lines_carry_their_exact_arguments(tmp_path):
    """One complete night and one gap, so a sum and a difference of the two counts disagree."""
    root, env = _tree(tmp_path, datalog=["20260826", "20260827"], envelopes=["20260826"])
    lg = _Log()
    ad.on_harvest_complete(
        {"state": "ok", "consulted": True},
        dest_root=root,
        envelope_root=env,
        spool_root=str(tmp_path),
        qc_path=str(tmp_path / "q.json"),
        journal_path=str(tmp_path / "j.jsonl"),
        read_spool=lambda _r: ["20260826", "20260827"],
        log=lg,
    )
    assert lg.info_calls == [("cpap inventory: %d discrepancy(ies) over %d night(s) %s", 1, 2, {"MISSED-LIVE": 1})]


def test_a_refusal_logs_the_format_and_the_oracles_reason(tmp_path):
    root, env = _tree(tmp_path, datalog=[], envelopes=[])
    lg = _Log()
    payload = ad.on_harvest_complete(
        {"state": "barren", "consulted": True},
        dest_root=root,
        envelope_root=env,
        spool_root=str(tmp_path),
        qc_path=str(tmp_path / "q.json"),
        journal_path=str(tmp_path / "j.jsonl"),
        read_spool=lambda _r: [],
        log=lg,
    )
    assert lg.info_calls == [("cpap inventory: %s", payload["reason"])]


def test_an_internal_failure_logs_that_the_harvest_is_unaffected():
    class _Boom:
        def get(self, *_a, **_k):
            raise RuntimeError("nope")

    lg = _Log()
    ad.on_harvest_complete(
        _Boom(),
        dest_root="/nonexistent",
        envelope_root="/nonexistent",
        spool_root="/nonexistent",
        qc_path="/x/q.json",
        journal_path="/x/j.jsonl",
        log=lg,
    )
    assert lg.exc_calls == [("cpap inventory reconciliation failed; the harvest itself is unaffected",)]


def test_the_harvest_hook_reads_the_spool_at_the_root_it_was_given(tmp_path):
    root, env = _tree(tmp_path, datalog=["20260827"], envelopes=["20260827"])
    seen = []
    ad.on_harvest_complete(
        {"state": "ok", "consulted": True},
        dest_root=root,
        envelope_root=env,
        spool_root="/the/spool",
        qc_path=str(tmp_path / "q.json"),
        journal_path=str(tmp_path / "j.jsonl"),
        read_spool=lambda r: seen.append(r) or ["20260827"],
    )
    assert seen == ["/the/spool"]


def test_an_unconsulted_spool_reaches_the_oracle_as_unconsulted(tmp_path):
    root, env = _tree(tmp_path, datalog=["20260827"], envelopes=["20260827"])
    r = ad.reconcile_after_harvest(
        {"state": "ok", "consulted": True},
        dest_root=root,
        envelope_root=env,
        spool_root=str(tmp_path),
        read_spool=lambda _r: None,
    )
    assert r["consulted"]["spool"] is False


# ── a None root is "not consulted", never "looked and found nothing" ──────────────────────────────
def test_a_None_envelope_root_is_UNCONSULTED_not_an_empty_envelope_set():
    """🔴 `os.listdir(None)` LISTS THE CURRENT WORKING DIRECTORY — not an error, a confident listing of
    somewhere else. `cpap.ble_stream.edf_dir` is OPTIONAL: a bus-only box streams to the telemetry bus
    with no on-disk EDFs, which is a real deployment mode. Without the guard such a box reports "I
    looked, and there are no envelopes" on every night, forever. Verified before the fix: it returned
    `([], True)`."""
    assert ad.envelope_nights(None) == ([], False)
    assert ad.envelope_nights("") == ([], False)


def test_a_None_dest_root_is_UNCONSULTED_and_does_not_raise():
    """`os.path.join(None, ...)` raises TypeError, which `on_harvest_complete`'s broad except would
    swallow — so the reconciliation would never run and the only evidence would be a log line nobody
    reads. Guarded before the join rather than after."""
    assert ad.card_nights(None) == ([], False)


def test_a_bus_only_box_reconciles_without_manufacturing_envelope_findings(tmp_path):
    """The whole point, end to end: no edf_dir configured, a card night present and a spool that
    listed it. The night must come back NOT-DIAGNOSABLE naming the envelope axis — never
    MISSED-LIVE, which would accuse the live capture of failing on a box that has none."""
    root, _ = _tree(tmp_path, datalog=["20260827"])
    r = ad.reconcile_after_harvest(
        {"state": "ok", "consulted": True},
        dest_root=root,
        envelope_root=None,
        spool_root=str(tmp_path),
        read_spool=lambda _r: ["20260827"],
    )
    assert [x["state"] for x in r["records"]] == ["NOT-DIAGNOSABLE"]
    assert r["records"][0]["unconsulted"] == ["envelopes"]
