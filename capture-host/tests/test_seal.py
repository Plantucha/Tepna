# tepna-capture — tests/test_seal.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`tepna-seal/1` — the committed vectors, the seven plants, and the two readers judged on the SAME bytes.

CAPTURE-NIGHT-SEAL §6: one synthetic night sealed under a committed TEST key pair and TEST card key,
deterministic nonces from the test key only; a byte-identical re-seal asserted; the Python sealer and
the Node reader verified against the same vectors so they cannot diverge unseen; seven plants, each red
BY NAME; anti-vacuity — the runner asserts each plant was SEEN, and the denominator is published as an
equality (seven, not ≥ seven).

The plants are built here by the sealer's own hooks, written to a temp dir, and handed to BOTH readers:
`unseal.unseal` in-process and `tools/verify-seals.mjs` as a child process with `--json`. A plant one
reader refuses and the other accepts is a drift, which is the whole reason the Node twin exists.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))

import seal  # noqa: E402
import seal_vectors as V  # noqa: E402
import sealfmt as F  # noqa: E402
import unseal  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE_VERIFIER = os.path.join(os.path.dirname(HERE), "tools", "verify-seals.mjs")
EXPECTED = json.load(open(os.path.join(V.VECTOR_DIR, "expected.json")))
PIN = EXPECTED["boxKeyFingerprint"]


@pytest.fixture(scope="module")
def key():
    return V.load_test_key()


@pytest.fixture
def night(tmp_path):
    return V.stage_night(str(tmp_path))


def _node(path, *, card_key=V.TEST_CARD_KEY, pin=PIN, known_revision=None):
    node = shutil.which("node")
    if not node:  # pragma: no cover — CI and the rig have node; a dev box might not
        pytest.skip("node is not installed")
    argv = [node, NODE_VERIFIER, path, "--card-key", card_key.hex(), "--pin", pin, "--json"]
    if known_revision is not None:
        argv += ["--known-revision", str(known_revision)]
    r = subprocess.run(argv, capture_output=True, text=True, timeout=60)
    assert r.returncode in (0, 2), r.stderr
    return _flat(json.loads(r.stdout.strip()))


def _python(path, *, card_key=V.TEST_CARD_KEY, pin=PIN, known_revision=None):
    return _flat(unseal.verdict(path, card_key=card_key, pinned_fingerprint=pin, known_revision=known_revision))


def _flat(v):
    """Both readers answer in `tepna.verdict/1`; the assertions below read the object, never prose."""
    assert_valid_verdict(v)
    if v["status"] == "PASS":
        return {"ok": True, "files": v["result"]["files"], "consent": v["result"]["consent"], "revision": v["result"]["revision"]}
    return {"ok": False, "kind": v["result"]["kind"], "detail": v["reason"]}


VERDICT_JS = os.path.join(os.path.dirname(HERE), "verdict.js")


def validate_verdict(v):
    """`{ok, errors, checked}` from THE contract's own validator, `verdict.js` (VERDICT-CONTRACT §2) —
    never a hand-written copy of its rules, which would drift the day the contract moved."""
    node = shutil.which("node")
    if not node:  # pragma: no cover
        pytest.skip("node is not installed")
    prog = "const V=require(process.argv[1]);const v=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(V.validate(v)))"
    r = subprocess.run([node, "-e", prog, VERDICT_JS], input=json.dumps(v), capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip())


def assert_valid_verdict(v):
    out = validate_verdict(v)
    assert out["ok"], (out["errors"], v)
    assert v["gate"] == "verify-seals" and v["scope"] == "internal"
    assert "status enum" in out["checked"] and "population equality" in out["checked"], out["checked"]   # the legs RAN


# ── the committed vector ──────────────────────────────────────────────────────────────────────────
def test_the_committed_vector_is_a_BYTE_IDENTICAL_re_seal_of_the_synthetic_night(night, key, tmp_path):
    """Deterministic nonces and data key from the test card key, RFC 6979 signatures, a fixed-epoch
    sorted zip: the same inputs seal to the same bytes, so a change to the recipe reds here first."""
    out = str(tmp_path / "re.tepna")
    seal.seal_night(night, out, **V.seal_kwargs(key))
    committed = open(os.path.join(V.VECTOR_DIR, EXPECTED["seal"]), "rb").read()
    assert open(out, "rb").read() == committed, "the recipe changed — regenerate the vectors ON PURPOSE or fix the drift"
    assert __import__("hashlib").sha256(committed).hexdigest() == EXPECTED["sha256"]


def test_both_readers_accept_the_committed_vector_and_agree_on_what_is_inside():
    path = os.path.join(V.VECTOR_DIR, EXPECTED["seal"])
    py, js = _python(path), _node(path)
    assert py["ok"] and js["ok"], (py, js)
    assert py["files"] == js["files"] == sorted(EXPECTED["inputs"])
    assert py["consent"] is None and js["consent"] is None, "consent was not asked — null, never 'no'"
    assert py["revision"] == js["revision"] == 1


def test_the_unsealed_bytes_are_the_night_EXACTLY(night):
    r = unseal.unseal(os.path.join(V.VECTOR_DIR, EXPECTED["seal"]), card_key=V.TEST_CARD_KEY, pinned_fingerprint=PIN)
    for name in V.NIGHT_INPUTS:
        assert r["files"][name] == open(os.path.join(night, name), "rb").read(), name
    assert r["bag_info"]["Payload-Oxum"] == "%d.%d" % (EXPECTED["header"]["bytes"], EXPECTED["header"]["files"])
    assert r["bag_info"]["Tepna-Research-Consent"] == "null"


def test_the_clear_header_reads_WITHOUT_a_key():
    h = unseal.read_header(os.path.join(V.VECTOR_DIR, EXPECTED["seal"]))
    assert h == EXPECTED["header"]
    assert h["boxId"] == V.BOX_ID and h["night"] == V.NIGHT and h["consent"] is None


# ── the eight plants — each red BY NAME, in both readers, and each SEEN ──────────────────────────
# Built by tools/seal_vectors.py (PLANTS / build_plant), so the committed plant vectors and this test
# build the SAME bytes; the "unknown signing key" plant signs with the SECOND committed test key.
PLANTS = V.PLANTS


def _build_plant(name, spec, night, key, tmp_path):
    """ONE set of plant bytes for every reader: the sealer-built plants are the COMMITTED vectors under
    plants/ (what the browser reader is judged on too); the reader-side plants are built here from a
    fresh (byte-identical) seal of the same night."""
    if spec.get("sealed"):
        return os.path.join(V.VECTOR_DIR, "plants", "plant-%s.tepna" % V.plant_slug(name))
    return V.build_plant(name, spec, night, key, str(tmp_path / ("plant-%s.tepna" % V.plant_slug(name))))


def test_the_committed_plant_vectors_are_byte_identical_to_a_regeneration(night, key, tmp_path):
    """The sealed plants under vectors/tepna-seal-1/plants/ are what the browser reader is judged on
    (phase C); they must be exactly what the generator writes today, or the three readers drift."""
    index = json.load(open(os.path.join(V.VECTOR_DIR, "plants", "expected.json")))
    sealed = {n for n, s in PLANTS.items() if s.get("sealed")}
    assert set(index) == sealed, (set(index), sealed)
    fresh = V.write_plants(key, str(tmp_path / "plants"))
    for name, rec in index.items():
        committed = open(os.path.join(V.VECTOR_DIR, "plants", rec["file"]), "rb").read()
        regenerated = open(os.path.join(str(tmp_path / "plants"), rec["file"]), "rb").read()
        assert committed == regenerated, (name, "committed plant differs from a regeneration")
        assert rec["sha256"] == fresh[name]["sha256"] == hashlib.sha256(committed).hexdigest(), name
        assert rec["expect"] == PLANTS[name]["expect"], name



def test_the_EIGHT_plants_red_by_name_in_BOTH_readers_and_each_is_SEEN(night, key, tmp_path):
    """The denominator is an EQUALITY: eight plants enumerated (§6's seven plus the consent-agreement
    plant from the #2796 review), eight verdicts from each reader, and every plant that must refuse DID
    refuse — a plant that came back `ok` is the vacuous green `verify-the-plant-was-seen` records, and
    reds here by the plant's name."""
    assert len(PLANTS) == 8, "the denominator is eight, not ≥ eight"
    seen = {}
    for name, spec in PLANTS.items():
        path = _build_plant(name, spec, night, key, tmp_path)
        ck = spec.get("read_card_key", V.TEST_CARD_KEY)
        kr = spec.get("known_revision")
        py, js = _python(path, card_key=ck, known_revision=kr), _node(path, card_key=ck, known_revision=kr)
        seen[name] = (py, js)
        expect = spec["expect"]
        if expect is None:
            assert py["ok"] and js["ok"], (name, py, js)
            assert py["consent"] is None and js["consent"] is None, (name, "absent consent must read null, never 'no'")
        else:
            assert not py["ok"] and not js["ok"], (name, "a plant was NOT SEEN", py, js)
            assert py["kind"] == expect, (name, py)
            assert js["kind"] == expect, (name, js)
    assert sorted(seen) == sorted(PLANTS), "every enumerated plant produced a verdict"


def test_the_plants_are_DISTINCT_defects_not_one_defect_seven_times(night, key, tmp_path):
    """Each plant must red on ITS OWN check — the flipped byte on the stream hash, not on the signature;
    the truncation on the Oxum, not on the manifest — or the taxonomy is decoration."""
    kinds = set()
    for name, spec in PLANTS.items():
        if spec["expect"] is None:
            continue
        path = _build_plant(name, spec, night, key, tmp_path)
        kinds.add(_python(path, card_key=spec.get("read_card_key", V.TEST_CARD_KEY),
                          known_revision=spec.get("known_revision"))["kind"])
    assert len(kinds) == 7, kinds


# ── the framing refusals a plant does not reach ───────────────────────────────────────────────────
def _vector_bytes():
    return bytearray(open(os.path.join(V.VECTOR_DIR, EXPECTED["seal"]), "rb").read())


@pytest.mark.parametrize("mutate,kind", [
    (lambda b: b"NOTASEAL" + bytes(b[8:]), "magic"),
    (lambda b: bytes(b[:9]) + bytes([2]) + bytes(b[10:]), "version"),
    (lambda b: bytes(b[:9 + 1 + 4]) + b"{not json" + bytes(b[9 + 1 + 4 + 9:]), "header"),
    (lambda b: bytes(b[:-100]), "payload"),
    (lambda b: bytes(b[:40]), "header"),
])
def test_framing_refusals_are_named(tmp_path, mutate, kind):
    p = str(tmp_path / "x.tepna")
    open(p, "wb").write(mutate(_vector_bytes()))
    assert _python(p)["kind"] == kind
    assert _node(p)["kind"] == kind


def test_a_wrong_format_string_is_a_header_refusal(night, key, tmp_path):
    p = str(tmp_path / "f.tepna")
    seal.seal_night(night, p, **V.seal_kwargs(key), mutate_header=lambda h: {**h, "format": "tepna-seal/9"})
    assert _python(p)["kind"] == "header" and _node(p)["kind"] == "header"


def test_a_non_integer_or_zero_revision_is_a_header_refusal(night, key, tmp_path):
    p = str(tmp_path / "r.tepna")
    seal.seal_night(night, p, **V.seal_kwargs(key), mutate_header=lambda h: {**h, "revision": 0})
    assert _python(p)["kind"] == "header" and _node(p)["kind"] == "header"


def test_a_missing_card_recipient_is_a_header_refusal(night, key, tmp_path):
    p = str(tmp_path / "n.tepna")
    seal.seal_night(night, p, **V.seal_kwargs(key), mutate_header=lambda h: {**h, "recipients": []})
    assert _python(p)["kind"] == "header" and _node(p)["kind"] == "header"


def test_a_signature_of_the_wrong_length_is_named(tmp_path):
    b = _vector_bytes(); n = 9 + 1; hlen = int.from_bytes(b[n:n + 4], "big"); p = n + 4 + hlen
    b[p:p + 2] = (63).to_bytes(2, "big")
    f = str(tmp_path / "s.tepna"); open(f, "wb").write(bytes(b))
    assert _python(f)["kind"] == "signature" and _node(f)["kind"] == "signature"


def test_a_tampered_tag_file_reds_on_the_TAG_manifest(night, key, tmp_path):
    def m(bag):
        bag["bag-info.txt"] = bag["bag-info.txt"] + b"a tampered line with no colon\n"; return bag
    p = str(tmp_path / "t.tepna")
    seal.seal_night(night, p, **V.seal_kwargs(key), mutate_bag=m)
    assert _python(p)["kind"] == "manifest:bag-info.txt" and _node(p)["kind"] == "manifest:bag-info.txt"


def test_a_manifest_naming_a_file_the_bag_lacks_is_named(night, key, tmp_path):
    def m(bag):
        bag["manifest-sha256.txt"] += b"0" * 64 + b"  data/ghost.txt\n"
        # keep the tag manifest honest so the failure is the DATA manifest's
        import hashlib
        lines = [l for l in bag["tagmanifest-sha256.txt"].decode().splitlines() if not l.endswith("manifest-sha256.txt")]
        lines.append("%s  manifest-sha256.txt" % hashlib.sha256(bag["manifest-sha256.txt"]).hexdigest())
        bag["tagmanifest-sha256.txt"] = ("\n".join(lines) + "\n").encode(); return bag
    p = str(tmp_path / "g.tepna")
    seal.seal_night(night, p, **V.seal_kwargs(key), mutate_bag=m)
    assert _python(p)["kind"] == "manifest:data/ghost.txt" and _node(p)["kind"] == "manifest:data/ghost.txt"


def test_consent_values_round_trip_and_anything_else_is_refused_at_seal_time(night, key, tmp_path):
    for c in ("yes", "no", None):
        p = str(tmp_path / ("c-%s.tepna" % c))
        seal.seal_night(night, p, **V.seal_kwargs(key, consent=c))
        assert _python(p)["consent"] == c and _node(p)["consent"] == c
    with pytest.raises(seal.SealError):
        seal.seal_night(night, str(tmp_path / "bad.tepna"), **V.seal_kwargs(key, consent="maybe"))


def test_an_empty_night_and_a_bad_card_key_length_refuse_at_seal_time(tmp_path, key):
    os.makedirs(tmp_path / "empty")
    with pytest.raises(seal.SealError):
        seal.seal_night(str(tmp_path / "empty"), str(tmp_path / "e.tepna"), **V.seal_kwargs(key))
    with pytest.raises(seal.SealError):
        seal.seal_night(str(tmp_path / "empty"), str(tmp_path / "e.tepna"), **V.seal_kwargs(key, card_key=b"short"))


def test_the_write_is_ATOMIC(night, key, tmp_path):
    """A sync client watching outbox/ must never see a half-written seal: temp + rename, and no `.part`
    left behind on success."""
    out = str(tmp_path / "a.tepna")
    seal.seal_night(night, out, **V.seal_kwargs(key))
    assert os.path.exists(out) and not os.path.exists(out + ".part")


def test_production_material_is_RANDOM_not_derived(night, key, tmp_path):
    """Without `deterministic_from`, two seals of the same night differ (nonce and data key from the
    rng) — the determinism is a test property and must not leak into a box."""
    calls = []
    def rng(n):
        calls.append(n); return bytes([len(calls)]) * n
    kw = V.seal_kwargs(key); kw.pop("deterministic_from")
    a = str(tmp_path / "a.tepna"); b = str(tmp_path / "b.tepna")
    seal.seal_night(night, a, rng=rng, **kw); seal.seal_night(night, b, rng=rng, **kw)
    assert calls == [F.GCM_NONCE_BYTES, F.DATA_KEY_BYTES] * 2
    assert open(a, "rb").read() != open(b, "rb").read()


# ── the card code ─────────────────────────────────────────────────────────────────────────────────
def test_card_code_is_26_crockford_symbols_in_groups_and_round_trips():
    code = F.card_code_encode(V.TEST_CARD_KEY)
    assert len(code.replace("-", "")) == 26 and code.count("-") == 6
    assert F.card_code_decode(code) == V.TEST_CARD_KEY
    assert F.card_code_decode(code.lower().replace("0", "o").replace("1", "l")) == V.TEST_CARD_KEY, "Crockford's ambiguous letters are forgiven"
    assert open(os.path.join(V.VECTOR_DIR, "test-card-key.txt")).read().strip().endswith(code)


@pytest.mark.parametrize("bad", ["ABCD", "U" * 26, "0" * 25 + "1"])
def test_card_code_refuses_the_wrong_length_alphabet_or_padding(bad):
    with pytest.raises(ValueError):
        F.card_code_decode(bad)


def test_card_code_refuses_a_key_of_the_wrong_length():
    with pytest.raises(ValueError):
        F.card_code_encode(b"\x00" * 15)


# ── the verdict object itself ─────────────────────────────────────────────────────────────────────
def test_a_file_that_cannot_be_read_is_NOT_RUN_in_both_readers_with_the_population_saying_so(tmp_path):
    """NOT_RUN is not FAIL and not PASS: nothing was examined, and `population.checked` is 0 so a naive
    reader cannot count it as green."""
    missing = str(tmp_path / "absent.tepna")
    py = unseal.verdict(missing, card_key=V.TEST_CARD_KEY, pinned_fingerprint=PIN)
    assert_valid_verdict(py)
    assert py["status"] == "NOT_RUN" and py["population"] == {"checked": 0, "eligible": 1, "excluded": 1} and py["result"] is None
    node = shutil.which("node")
    if not node:  # pragma: no cover
        pytest.skip("node is not installed")
    r = subprocess.run([node, NODE_VERIFIER, missing, "--card-key", V.TEST_CARD_KEY.hex(), "--pin", PIN, "--json"],
                       capture_output=True, text=True, timeout=60)
    js = json.loads(r.stdout.strip())
    assert_valid_verdict(js)
    assert r.returncode == 2 and js["status"] == "NOT_RUN" and js["population"]["checked"] == 0


def test_the_vector_selftest_emits_a_PASS_verdict_on_stdout_and_prose_on_stderr():
    node = shutil.which("node")
    if not node:  # pragma: no cover
        pytest.skip("node is not installed")
    r = subprocess.run([node, NODE_VERIFIER, "--vectors"], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    v = json.loads(r.stdout.strip())
    assert_valid_verdict(v)
    assert v["status"] == "PASS" and "ok" in r.stderr, "the object is the API; the prose is for a human"


def test_the_NODE_verifier_also_says_why_its_commit_is_null(tmp_path):
    """The node-side parity of the test below, and the exact case that broke 22 tests in a scratch.

    `verify-seals.mjs` runs `git rev-parse --short HEAD` in ITS OWN directory, so inside a mutation
    scratch — a copied tree with no `.git` — the commit is null. Before this was fixed the tool
    emitted a bare null and its own validator refused the object:

        verify-seals produced an invalid verdict: producedBy.commit is null without
        producedBy.commitReason (∅: say why)

    The comment above `commitShort()` had called that reason "implicit". **An implicit reason is not
    a stated reason** — knowing why is not recording why, which is §∅'s in-band/out-of-band argument
    applied to a justification rather than to a value.

    ⚠️ The reason string is deliberately NOT `verdict.NO_GIT_REASON`: that names `build_id.probe`,
    the Python probe, which this tool never runs. Each producer says why ITS OWN attempt failed."""
    node = shutil.which("node")
    if not node:  # pragma: no cover
        pytest.skip("node is not installed")
    # HERE is capture-host/ (NODE_VERIFIER above joins dirname(HERE) with tools/), so ONE dirname
    # reaches the repo root. I wrote two and it failed — a path-anchor slip inside a test about a
    # path-anchor defect, caught by the run rather than by rereading it.
    root = os.path.dirname(HERE)                           # the repo root, which HAS a .git
    away = tmp_path / "nogit"                              # a copy that does not
    (away / "tools").mkdir(parents=True)
    shutil.copy(os.path.join(root, "tools", "verify-seals.mjs"), away / "tools" / "verify-seals.mjs")
    shutil.copy(os.path.join(root, "verdict.js"), away / "verdict.js")
    shutil.copytree(V.VECTOR_DIR, away / "capture-host" / "tests" / "vectors" / os.path.basename(V.VECTOR_DIR))
    assert not (away / ".git").exists(), "the point of this fixture is that git cannot be read here"
    r = subprocess.run([node, str(away / "tools" / "verify-seals.mjs"), "--vectors"],
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr                     # pre-fix this THREW instead of emitting
    v = json.loads(r.stdout.strip())
    assert_valid_verdict(v)
    assert v["producedBy"]["commit"] is None, v["producedBy"]
    assert v["producedBy"]["commitReason"], "a null commit without a reason is the defect"
    assert "git rev-parse" in v["producedBy"]["commitReason"], v["producedBy"]["commitReason"]


def test_the_commit_field_is_null_outside_a_git_tree_not_a_guess(monkeypatch):
    """Since wave 2 the object is built by `verdict.make`, so the commit comes from `verdict.commit_sha`
    and a null carries `commitReason` (verdict.js refuses a bare null)."""
    import verdict as VD
    monkeypatch.setattr(VD, "commit_sha", lambda: None)
    v = unseal.verdict(os.path.join(V.VECTOR_DIR, EXPECTED["seal"]), card_key=V.TEST_CARD_KEY, pinned_fingerprint=PIN)
    assert_valid_verdict(v)
    assert v["producedBy"]["commit"] is None and v["producedBy"]["commitReason"] == VD.NO_GIT_REASON


def test_the_committed_verdict_sample_is_the_live_object_modulo_provenance():
    """`tools/verdict-adoption.json` reads `verdict-sample.json` as a FILE, because the static CI runner's
    python3 has no `cryptography` and cannot run this reader. A committed object is a claim unless
    something holds it equal to the builder: this does, on every field but the run's own provenance
    (`at`, `producedBy`). Regenerate: `python3 capture-host/unseal.py --verdict-sample > <file>`."""
    with open(os.path.join(V.VECTOR_DIR, "verdict-sample.json"), encoding="utf-8") as fh:
        committed = json.load(fh)
    assert_valid_verdict(committed)
    live = unseal.verdict_sample()
    strip = lambda v: {k: x for k, x in v.items() if k not in ("at", "producedBy")}  # noqa: E731
    assert strip(committed) == strip(live), "the committed sample drifted from the reader — regenerate it ON PURPOSE"


def test_evidence_never_carries_a_checkout_s_absolute_path():
    """The plant behind #2815's first red: the committed sample named this worktree's /home/… path and
    every other checkout read it as drift. A file under the repo is named repo-relative; one outside it
    (a real sealed night under /srv) keeps the path it was given."""
    v = unseal.verdict_sample()
    assert not any(e.startswith(os.sep) for e in v["evidence"]), v["evidence"]
    assert v["evidence"] == ["capture-host/unseal.py", "capture-host/tests/vectors/tepna-seal-1/TESTBOX0-2026-09-20.tepna"]
    assert unseal._evidence_path("/srv/tepna/sealed/BOX-2026-09-20.tepna") == "/srv/tepna/sealed/BOX-2026-09-20.tepna"
    with open(os.path.join(V.VECTOR_DIR, "verdict-sample.json"), encoding="utf-8") as fh:
        assert not any(e.startswith(os.sep) for e in json.load(fh)["evidence"]), "the committed sample carries a checkout path"


def test_the_verdict_sample_is_the_committed_vector_judged_PASS_and_needs_no_corpus():
    """`--verdict-sample` is what `tools/verdict-adoption.json` names for this producer: the committed
    vector under the committed test card key and fingerprint — PASS, with the three synthetic files."""
    v = unseal.verdict_sample()
    assert_valid_verdict(v)
    assert v["status"] == "PASS" and v["result"]["files"] == sorted(V.NIGHT_INPUTS)
    assert v["scope"] == "internal" and v["population"] == {"checked": 1, "eligible": 1, "excluded": 0}


# ── the refusals a plant cannot reach without the box's key — re-signed by the TEST key ─────────
def _reframe(header_bytes, payload, key):
    """A seal with the given header and payload, SIGNED by `key` — so a deliberately bad payload
    passes the signature and reaches the check under test."""
    import hashlib
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import Prehashed, decode_dss_signature
    digest = hashlib.sha256(header_bytes + hashlib.sha256(payload).digest()).digest()
    r, s = decode_dss_signature(key.sign(digest, ec.ECDSA(Prehashed(hashes.SHA256()), deterministic_signing=True)))
    sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return (F.MAGIC + bytes([F.VERSION]) + len(header_bytes).to_bytes(4, "big") + header_bytes
            + len(sig).to_bytes(2, "big") + sig + len(payload).to_bytes(8, "big") + payload)


def _parts():
    b = _vector_bytes(); n = 10; hlen = int.from_bytes(b[n:n + 4], "big")
    hb = bytes(b[n + 4:n + 4 + hlen]); p = n + 4 + hlen + 2 + 64
    plen = int.from_bytes(b[p:p + 8], "big")
    return hb, bytes(b[p + 8:p + 8 + plen])


def test_a_payload_whose_GCM_tag_fails_under_a_VALID_signature_is_named_payload(key, tmp_path):
    hb, payload = _parts()
    bad = bytearray(payload); bad[-1] ^= 0x01
    f = str(tmp_path / "gcm.tepna"); open(f, "wb").write(_reframe(hb, bytes(bad), key))
    assert _python(f)["kind"] == "payload" and _node(f)["kind"] == "payload"


def _encrypt_as_the_sealer(plain, header_bytes):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce, data_key = seal._derive_test_material(V.TEST_CARD_KEY)
    return nonce + AESGCM(data_key).encrypt(nonce, plain, header_bytes)


def test_a_decrypted_payload_that_is_not_a_zip_is_named_zip(key, tmp_path):
    hb, _ = _parts()
    f = str(tmp_path / "nz.tepna"); open(f, "wb").write(_reframe(hb, _encrypt_as_the_sealer(b"not a zip at all", hb), key))
    assert _python(f)["kind"] == "zip" and _node(f)["kind"] == "zip"


@pytest.mark.parametrize("drop", ["bag-info.txt", "tagmanifest-sha256.txt"])
def test_a_bag_missing_a_tag_file_is_named_zip(night, key, tmp_path, drop):
    def m(bag):
        del bag[drop]; return bag
    p = str(tmp_path / "d.tepna"); seal.seal_night(night, p, **V.seal_kwargs(key), mutate_bag=m)
    assert _python(p)["kind"] == "zip" and _node(p)["kind"] == "zip"


def test_a_manifest_with_an_unparseable_line_is_named_zip_and_a_blank_line_is_ignored(night, key, tmp_path):
    def m(bag):
        bag["tagmanifest-sha256.txt"] = b"\n" + bag["tagmanifest-sha256.txt"] + b"garbage-without-two-spaces\n"; return bag
    p = str(tmp_path / "u.tepna"); seal.seal_night(night, p, **V.seal_kwargs(key), mutate_bag=m)
    assert _python(p)["kind"] == "zip" and _node(p)["kind"] == "zip"


def test_a_bag_info_that_is_not_utf8_is_named_zip(night, key, tmp_path):
    def m(bag):
        bag["bag-info.txt"] = b"\xff\xfe not text"; return bag
    p = str(tmp_path / "b.tepna"); seal.seal_night(night, p, **V.seal_kwargs(key), mutate_bag=m)
    assert _python(p)["kind"] == "zip" and _node(p)["kind"] == "zip"


def test_a_boxKey_that_hashes_to_the_pin_but_is_not_a_point_is_a_header_refusal(night, key, tmp_path):
    """The fingerprint check passes by construction (the reader pins whatever the card says); the key
    still has to BE a P-256 point before anything is verified with it."""
    import base64
    garbage = b"\x04" + b"\x00" * 64
    def m(h):
        return {**h, "boxKey": base64.b64encode(garbage).decode(), "boxKeyFingerprint": F.fingerprint(garbage)}
    p = str(tmp_path / "k.tepna"); seal.seal_night(night, p, **V.seal_kwargs(key), mutate_header=m)
    pin = F.fingerprint(garbage)
    assert _python(p, pin=pin)["kind"] == "header" and _node(p, pin=pin)["kind"] == "header"


def test_an_unknown_refusal_kind_is_a_programming_error_not_a_verdict():
    with pytest.raises(ValueError):
        unseal.SealRefused("sparkly", "no such kind")


def test_a_symlink_in_the_night_dir_is_not_sealed(night, key, tmp_path):
    """The bag holds the night's files AS THE BOX WROTE THEM; a link is not a file the box wrote."""
    os.symlink(os.path.join(night, V.NIGHT_INPUTS[0]), os.path.join(night, "link.txt"))
    p = str(tmp_path / "l.tepna"); h = seal.seal_night(night, p, **V.seal_kwargs(key))
    assert h["files"] == 3 and "link.txt" not in _python(p)["files"]


# ── the generator reproduces the committed vectors, and mints fresh test material when asked ─────
def test_the_generator_REPRODUCES_the_committed_vectors_byte_for_byte(tmp_path, monkeypatch):
    """`tools/seal_vectors.py` run into a scratch directory with the committed test key must produce the
    committed seal exactly — the generator is the vectors' provenance, not a one-time act."""
    out = tmp_path / "vec"; out.mkdir()
    shutil.copy(os.path.join(V.VECTOR_DIR, "test-signing-key.pem"), out / "test-signing-key.pem")
    shutil.copy(os.path.join(V.VECTOR_DIR, V.OTHER_KEY_PEM), out / V.OTHER_KEY_PEM)   # both committed keys ⇒ plants reproduce too
    monkeypatch.setattr(V, "VECTOR_DIR", str(out))
    assert V.main() == 0
    committed = os.path.join(HERE, "tests", "vectors", "tepna-seal-1", EXPECTED["seal"])   # not V.VECTOR_DIR: that is patched
    assert (out / EXPECTED["seal"]).read_bytes() == open(committed, "rb").read()
    for rec in json.load(open(os.path.join(HERE, "tests", "vectors", "tepna-seal-1", "plants", "expected.json"))).values():
        assert (out / "plants" / rec["file"]).read_bytes() == open(os.path.join(HERE, "tests", "vectors", "tepna-seal-1", "plants", rec["file"]), "rb").read(), rec["file"]
    exp = json.load(open(out / "expected.json"))
    assert exp["sha256"] == EXPECTED["sha256"] and exp["header"] == EXPECTED["header"]
    assert (out / "test-card-key.txt").read_text().strip().endswith(F.card_code_encode(V.TEST_CARD_KEY))


def test_the_generator_mints_a_key_pair_when_none_is_committed(tmp_path, monkeypatch):
    out = tmp_path / "fresh"
    monkeypatch.setattr(V, "VECTOR_DIR", str(out))
    assert V.main() == 0
    assert (out / "test-signing-key.pem").exists() and (out / EXPECTED["seal"]).exists()
    exp = json.load(open(out / "expected.json"))
    assert exp["boxKeyFingerprint"] != PIN, "a fresh key pair is a different box"
    r = unseal.unseal(str(out / EXPECTED["seal"]), card_key=V.TEST_CARD_KEY, pinned_fingerprint=exp["boxKeyFingerprint"])
    assert sorted(r["files"]) == sorted(V.NIGHT_INPUTS)


def test_the_validator_REFUSES_a_pass_over_nothing_and_a_broken_denominator():
    """The §1 rules are exercised, not just the enum: `PASS` with `checked: 0` is the examined-nothing
    shape and is invalid by schema; `checked + excluded` must EQUAL `eligible`; a non-PASS with no
    reason is an adjective, not a verdict."""
    good = unseal.verdict(os.path.join(V.VECTOR_DIR, EXPECTED["seal"]), card_key=V.TEST_CARD_KEY, pinned_fingerprint=PIN)
    assert_valid_verdict(good)
    for mutate in (
        lambda v: v["population"].update(checked=0, excluded=1),            # PASS over nothing
        lambda v: v["population"].update(checked=2),                        # 2 + 0 != 1
        lambda v: v.update(status="FAIL", reason=None),                     # a verdict without a why
        lambda v: v.update(status="NOT_APPLICABLE", reason=""),             # empty is not a reason
        lambda v: v.update(status="OK"),                                    # an eighth status
        lambda v: v.update(evidence=[]),                                    # PASS with nothing to open
    ):
        v = json.loads(json.dumps(good)); mutate(v)
        out = validate_verdict(v)
        assert not out["ok"], (mutate, v)


def test_a_reader_CRASH_is_an_UNKNOWN_verdict_not_an_exception(monkeypatch, tmp_path):
    """A crash is not a verdict. Both readers turn a non-refusal exception into UNKNOWN with the error as
    the reason, so a consumer never mistakes a stack trace for green — or for red."""
    path = os.path.join(V.VECTOR_DIR, EXPECTED["seal"])
    monkeypatch.setattr(unseal, "_split", lambda blob: (_ for _ in ()).throw(RuntimeError("boom")))
    v = unseal.verdict(path, card_key=V.TEST_CARD_KEY, pinned_fingerprint=PIN)
    assert_valid_verdict(v)
    assert v["status"] == "UNKNOWN" and "boom" in v["reason"] and v["result"] is None
    # the Node reader, through its exported `judge` with a key WebCrypto's importKey rejects outright
    # (a TypeError, not a SealRefused) — a first draft used a 2-byte card key, which HKDF accepts and
    # AES-KW then refuses by name: a FAIL, not a crash. The trigger has to be outside the vocabulary.
    node = shutil.which("node")
    if not node:  # pragma: no cover
        pytest.skip("node is not installed")
    # argv[1] is a placeholder: the module runs its CLI when argv[1] is its own path, and this must
    # import it as a library
    prog = ("import(process.argv[2]).then(m => m.judge(process.argv[3], {cardKey: undefined, pinnedFingerprint: process.argv[4]}))"
            ".then(v => console.log(JSON.stringify(v)))")
    r = subprocess.run([node, "--input-type=module", "-e", prog, "-", NODE_VERIFIER, path, PIN], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    js = json.loads(r.stdout.strip())
    assert_valid_verdict(js)
    assert js["status"] == "UNKNOWN" and "reader failed" in js["reason"] and js["result"] is None


def test_the_consent_plant_is_symmetric_a_bag_that_disagrees_with_a_null_header_is_refused_too(night, key, tmp_path):
    def m(bag):
        bag["bag-info.txt"] = bag["bag-info.txt"].replace(b"Tepna-Research-Consent: null", b"Tepna-Research-Consent: no")
        import hashlib
        lines = [l for l in bag["tagmanifest-sha256.txt"].decode().splitlines() if not l.endswith("bag-info.txt")]
        lines.append("%s  bag-info.txt" % hashlib.sha256(bag["bag-info.txt"]).hexdigest())
        bag["tagmanifest-sha256.txt"] = ("\n".join(sorted(lines)) + "\n").encode(); return bag
    p = str(tmp_path / "cd.tepna"); seal.seal_night(night, p, **V.seal_kwargs(key), mutate_bag=m)
    assert _python(p)["kind"] == "consent" and _node(p)["kind"] == "consent"


# ── THE SEALER DOES NOT HOLD THE NIGHT (residue 2026-09-22-seal-bags-the-whole-night-in-memory) ────
# `build_bag` returns every file's bytes in a dict, so sealing cost the night plus three copies of the
# zip. Measured on vigil 2026-09-22 against the real 2026-09-12 night (2067 MB): peak **3475 MB**,
# 1.68x the night, in a child the daemon spawns while it holds every BLE link. Streaming the same
# entries one file at a time and writing the payload without concatenating it: **1057 MB**, 0.51x,
# same 95 s, and the sealed file's SHA-256 is the SAME on both implementations.
#
# These two tests are what make that safe: the zip must be byte-identical to the bag's, and the peak
# must stay small enough that the old reader FAILS the bound. A bound the previous implementation
# would also pass measures nothing.

def _tree(root, sizes=(3000, 40000, 17)):
    """A night of CAPTURE-SHAPED rows, which matters for the memory bound below: the cost of the bag
    is the night, the cost of everything after it is the ZIP, so a fixture of incompressible noise
    makes the two readers look alike. Measured — with random bytes the old reader traces 1.1x the
    night and the new one 0.5x (no separation at any bound worth writing); with these rows, 1.69x and
    0.94x, and the 1.69 is the same ratio the real 2067 MB night gives."""
    os.makedirs(os.path.join(root, "sub"), exist_ok=True)
    names = ["a_PPG.txt", "sub/b_ECG.txt", "z.json"]
    for name, n in zip(names, sizes):
        out = bytearray()
        i = 0
        while len(out) < n:
            out += b"%d;%d;%d;%d;0\n" % (i * 8, i * 8000000, 100 + i % 37, 120 + i % 11)
            i += 1
        with open(os.path.join(root, name), "wb") as fh:
            fh.write(bytes(out[:n]))
    return names


ZIP_KW = dict(box_id="B1", night="2026-09-12", consent=None, revision=2,
              bagging_date="2026-09-22", extra_info={"Tepna-Capture-Host-Sha": "0000000"})


def test_zip_night_bytes_is_the_same_zip_as_the_bag(tmp_path):
    """The licence for the streaming path: identical bytes, not merely an equivalent bag."""
    d = str(tmp_path / "night")
    os.makedirs(d)
    _tree(d)
    for consent in (None, "yes", "no"):
        kw = dict(ZIP_KW, consent=consent)
        want = seal.bag_zip_bytes(seal.build_bag(d, **kw))
        got, n_files, n_bytes = seal.zip_night_bytes(d, **kw)
        assert got == want, f"the streamed zip differs from the bag's for consent={consent!r}"
        assert n_files == 3 and n_bytes == 3000 + 40000 + 17
    # …and BOTH refuse the same empty night, rather than sealing nothing. Asserted on both readers
    # on purpose: `seal_night` no longer reaches `build_bag` on the production path, so its own
    # refusal would otherwise lose its last caller and stop being exercised at all.
    empty = str(tmp_path / "empty")
    os.makedirs(empty)
    for call in (lambda: seal.zip_night_bytes(empty, **ZIP_KW), lambda: seal.build_bag(empty, **ZIP_KW)):
        with pytest.raises(seal.SealError) as e:
            call()
        assert "holds no files" in str(e.value)


def test_a_file_that_MOVES_under_the_sealer_is_refused_not_sealed(tmp_path, monkeypatch):
    """`bag-info.txt` sorts before `data/`, so the Oxum is counted from `stat` before a byte is read.
    A night still being written would make that count a lie; the streamer verifies each file against
    the size it counted and raises. `build_bag` cannot see this case at all — it reports what it read."""
    d = str(tmp_path / "night")
    os.makedirs(d)
    _tree(d)
    real_getsize = os.path.getsize
    monkeypatch.setattr(seal.os.path, "getsize",
                        lambda p: real_getsize(p) + 1 if p.endswith("z.json") else real_getsize(p))
    with pytest.raises(seal.SealError) as e:
        seal.zip_night_bytes(d, **ZIP_KW)
    assert "changed size under the sealer" in str(e.value) and "z.json" in str(e.value)


def test_sealing_does_not_hold_the_night_in_memory(tmp_path, key):
    """The bound, with the separation MEASURED rather than assumed.

    ⚠️ 1.25x THE NIGHT IS NOT A ROUND NUMBER, IT IS A SEPARATION. On this fixture the streaming
    sealer traces **0.94x** the night at its peak and `origin/main`'s bag reader **1.69x**, so this
    assertion fails there and passes here; on vigil's real 2067 MB night the same pair is 1057 MB and
    3475 MB (0.51x / 1.68x — the old ratio reproduces exactly). Before relaxing this threshold,
    re-measure BOTH readers on the same fixture and keep the gap, or the test stops being able to
    tell them apart and goes on reporting green about a sealer it never examined.

    ⚠️ And keep the fixture COMPRESSIBLE. The first version of this test used random bytes, where the
    two readers trace 1.1x and 0.5x — no bound separates them, and the one I had written (2.5x) passed
    on BOTH. The fixture is part of the instrument.
    """
    import tracemalloc
    d = str(tmp_path / "night")
    os.makedirs(d)
    sizes = (8_000_000, 12_000_000, 4_000_000)
    _tree(d, sizes=sizes)
    night_bytes = sum(sizes)
    out = str(tmp_path / "sealed.tepna")
    tracemalloc.start()
    seal.seal_night(d, out, **V.seal_kwargs(key, night="2026-09-12"))
    _cur, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert os.path.getsize(out) > 0, "the fixture must actually seal, or the bound is vacuous"
    assert peak < 1.25 * night_bytes, (
        f"the sealer held {peak / night_bytes:.2f}x the night ({peak / 1e6:.1f} MB of "
        f"{night_bytes / 1e6:.1f} MB)")
