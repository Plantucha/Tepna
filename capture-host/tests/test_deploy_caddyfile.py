# tepna-capture — tests/test_deploy_caddyfile.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The reverse proxy must not compress the live stream.

Caddy's encoder buffers until a deflate block fills. An SSE stream never ends, so a bare
`encode gzip` — whose default match includes `text/*`, and `text/event-stream` is a `text/*` —
holds the waveform hostage indefinitely. Measured on the box 2026-07-26 before the fix:
`/api/stream/ecg` delivered **0 frames in 30 s** to a gzip-capable client while delivering 15 in
8 s to one that did not advertise gzip, and `/api/stream/_all` arrived in 26-second clumps.

Two things made this survive review for a day:

* `flush_interval -1` was already set, with a comment saying it exists so the scope paints. It
  unbuffers the *proxy*. Nothing unbuffered the *encoder*. A half-fix reads exactly like a fix.
* Every post-install check was an HTTP status code, and the broken config returned 200 on every
  path. `curl` without `--compressed` does not advertise gzip, so the one tool used to verify it
  was the one client on the network immune to the bug. Browsers always advertise gzip.

So this test asserts the property directly against the config the deploy script generates.
"""
import fnmatch
import os
import re
import subprocess
import sys

import pytest

DEPLOY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deploy")
SCRIPT = os.path.join(DEPLOY, "expose-monitor.sh")

# Content types Caddy would be asked to encode. The stream is the one that must never be in the set.
SSE = "text/event-stream"
MUST_COMPRESS = ["text/html; charset=utf-8", "application/json; charset=utf-8",
                 "text/css; charset=utf-8", "text/plain; charset=utf-8",
                 "text/javascript; charset=utf-8"]


def _generate(auth=""):
    """Run the deploy script's own config generator — not a copy of it.

    Asserting against a re-typed config would only prove the test agrees with the test. The
    generator is a python heredoc inside the shell script; extract and execute that.
    """
    src = open(SCRIPT, encoding="utf-8").read()
    m = re.search(r"<<'PY'\n(.*?)\nPY\n", src, re.S)
    assert m, "could not find the python config generator in expose-monitor.sh"
    out = os.path.join(os.environ.get("PYTEST_TMP", "/tmp"), "Caddyfile.gen.test")
    subprocess.run([sys.executable, "-c", m.group(1), out],
                   env={**os.environ, "AUTH": auth}, check=True)
    return open(out, encoding="utf-8").read()


# What Caddy compresses when `encode` carries no `match` block. Empirically confirmed against the
# box's Caddy 2.6.2 on 2026-07-26: a bare `encode gzip` returned `Content-Encoding: gzip` on a
# `text/event-stream` response. `text/*` is the entry that swallows the stream.
CADDY_DEFAULT_MATCH = ["text/*", "application/json*", "application/javascript*",
                       "application/xhtml+xml*", "application/atom+xml*", "application/rss+xml*",
                       "image/svg+xml*", "application/wasm*"]


def _has_explicit_match(cfg):
    m = re.search(r"\n\tencode\s+\S+\s*\{(.*?)\n\t\}\n", cfg, re.S)
    return bool(m) and "match" in m.group(1)


def _encode_patterns(cfg):
    """The Content-Type globs the encoder will actually apply.

    With no explicit `match`, Caddy applies its own default — so returning that default here (rather
    than None) keeps every downstream assertion meaningful, and makes a bare `encode gzip` fail on
    the property that matters instead of on a TypeError.
    """
    m = re.search(r"\n\tencode\s+\S+\s*\{(.*?)\n\t\}\n", cfg, re.S)
    if not m or "match" not in m.group(1):
        return list(CADDY_DEFAULT_MATCH)
    return re.findall(r"header\s+Content-Type\s+(\S+)", m.group(1))


def _matches(patterns, ctype):
    """Caddy header matching is case-insensitive with `*` wildcards."""
    return any(fnmatch.fnmatch(ctype.lower(), p.lower()) for p in patterns)


# ── the property that broke ───────────────────────────────────────────────────────────────────
def test_encode_has_an_explicit_match_block():
    """A bare `encode gzip` takes Caddy's default match, and that default includes text/*."""
    assert _has_explicit_match(_generate()), (
        "encode must carry an explicit `match` — the default one compresses text/event-stream")


def test_the_event_stream_is_never_compressed():
    """THE bug. `text/event-stream` reaching the encoder means a frozen waveform in every browser."""
    pats = _encode_patterns(_generate())
    assert not _matches(pats, SSE), (
        f"{SSE} matches {[p for p in pats if fnmatch.fnmatch(SSE, p.lower())]} — "
        "the live stream will be buffered until a deflate block fills, i.e. never")


def test_no_bare_text_wildcard():
    """`text/*` is the specific glob that swallowed the stream. Name the subtypes instead."""
    pats = _encode_patterns(_generate())
    assert "text/*" not in [p.lower() for p in pats], (
        "text/* includes text/event-stream; list text/html*, text/css*, ... explicitly")


def test_compression_is_still_applied_to_what_should_be_compressed():
    """Excluding the stream must not turn into excluding everything — this is served over wifi to a
    phone, and monitor.html is not small. A fix that silently disables gzip is a different bug."""
    pats = _encode_patterns(_generate())
    for ct in MUST_COMPRESS:
        assert _matches(pats, ct), f"{ct} should still be gzipped, no pattern in {pats} matches it"


def test_javascript_is_matched_under_the_content_type_go_actually_sends():
    """Go's mime table maps .js to text/javascript, not application/javascript. Listing only the
    application/ form would quietly stop compressing every Dex bundle's scripts."""
    assert _matches(_encode_patterns(_generate()), "text/javascript; charset=utf-8")


# ── the other half of the same fix ────────────────────────────────────────────────────────────
def test_both_proxy_routes_disable_buffering():
    """flush_interval -1 unbuffers the proxy; the encode match unbuffers the encoder. The bug was
    live for a day *because* one of the two was present and commented as the fix."""
    # Count the directive, not the word: the comments above discuss flush_interval by name.
    cfg = "\n".join(l for l in _generate().splitlines() if not l.lstrip().startswith("#"))
    blocks = re.findall(r"reverse_proxy[^\n]*\{(.*?)\}", cfg, re.S)
    # A FLOOR, NOT AN EXACT COUNT. The property this test exists for is the loop below — EVERY proxy
    # to the SSE origin must unbuffer. `== 2` also pinned how many routes there happen to be, so
    # adding the bare-IP /monitor + /api routes (so the monitor is reachable from a phone, which
    # cannot resolve mDNS) failed a test about buffering for a reason that had nothing to do with
    # buffering. The floor is still needed: with zero blocks the loop passes vacuously, which is the
    # failure mode this file exists to prevent.
    assert len(blocks) >= 2, f"expected at least the /api/* and /monitor* proxies, found {len(blocks)}"
    for b in blocks:
        assert re.search(r"flush_interval\s+-1", b), (
            "every proxy to the SSE origin needs flush_interval -1")


def test_the_installer_verifies_the_stream_and_not_just_a_status_code():
    """The broken config answered 200 on every path. Checking status codes could never catch it."""
    src = open(SCRIPT, encoding="utf-8").read()
    assert "--compressed" in src, (
        "post-install verification must advertise gzip like a browser does; a plain curl was "
        "immune to the exact bug being checked for")
    assert "/api/stream/" in src.split("systemctl reload caddy")[-1], (
        "the installer must count frames off a live stream after installing")


# ── the generator itself ──────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("auth", ["", "basicauth { vigil $2a$14$abcdefghijklmnopqrstuv }"])
def test_generated_config_is_well_formed_with_and_without_auth(auth):
    """A bcrypt hash is full of `$`. It is composed in python precisely so the shell cannot expand
    it; check the braces still balance and the hash survives verbatim."""
    cfg = _generate(auth)
    assert cfg.count("{") == cfg.count("}"), "unbalanced braces in the generated Caddyfile"
    if auth:
        assert "$2a$14$abcdefghijklmnopqrstuv" in cfg, "the bcrypt hash was mangled"
