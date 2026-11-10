# tepna-capture — tests/test_deploy_sse_frames.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The installer's stream check must be able to report success.

`deploy/sse-frames.sh` counts SSE frames so the Caddy installer can prove the live waveform actually
streams instead of trusting an HTTP status code. The first version of that check was written inline
and was **permanently broken**: an SSE stream never ends, so it is cut off on purpose and curl exits
28 every time; under `set -o pipefail` the whole `curl | grep -c` pipeline is therefore non-zero, and
the `|| N=0` fallback replaced every real count with zero. It ran once, against a config that had
just been fixed and was working, and reported `0 frames in 9 s`.

A second reading of the same defect: the fixed version printed `0` for a stream it never reached,
and `0` is also what an open stream carrying no data frames prints. One observable result stood
for three causes, and the caller acts on only one of them. CLAUDE.md ∅ asks a value nobody
measured to be null rather than 0, so the two unreached states now print no count and name
themselves on stderr.

A check that can only fail is worse than no check — the natural response is to stop believing it. So
these tests drive the real script against a real HTTP server and assert it reports the true count.
"""

import http.server
import json
import os
import shutil
import subprocess
import threading
import time

import pytest

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deploy", "sse-frames.sh")

pytestmark = pytest.mark.skipif(not shutil.which("curl"), reason="curl not installed")


class _SseHandler(http.server.BaseHTTPRequestHandler):
    """Emits frames forever, like the real webmon endpoint. Never sends Content-Length, never ends."""

    # ⚠️ RATE AND WINDOW SCALE TOGETHER, so the FRAME COUNTS are unchanged and only the clock shrinks.
    # Measured 2026-10-05: this file was 14.53 s of a 421.40 s suite, all of it real stream windows —
    # 3 + 2 + 2 + 5 + 2 + 2 = 16 s at 5 frames/s. The windows are not an artificial wait; they ARE the
    # measurement, so they cannot simply be shortened: `test_the_count_scales_with_the_window` discriminates
    # on 5 s out-counting 2 s, and a smaller window means fewer frames and a thinner margin.
    #
    # But the discriminating quantity is FRAMES, not seconds. At 50 frames/s a 0.2 s window counts the same
    # ~10 frames that 2 s counted at 5/s, and 0.5 s counts the same ~25 that 5 s did — identical counts,
    # identical margins, a tenth of the wall. `deploy/sse-frames.sh` takes the window as an argument and
    # passes it to `timeout` and `curl --max-time`, both of which accept fractional seconds.
    frames_per_sec = 50

    def do_GET(self):  # noqa: N802 - stdlib naming
        if self.path == "/deny":  # the endpoint answered, and refused the credential
            self.send_response(401)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"no\n")
            return
        if self.path == "/empty":  # a stream that opens but carries no data
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            try:
                for _ in range(200):
                    self.wfile.write(b": keepalive\n\n")  # a comment line, not a data frame
                    self.wfile.flush()
                    time.sleep(0.1)
            except (BrokenPipeError, ConnectionResetError):
                pass  # the client under test hung up — that is the scenario, not a fault
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            i = 0
            while True:
                payload = json.dumps({"stream": "ecg", "fs": 130, "v": [i]})
                self.wfile.write(f"data: {payload}\n\n".encode())
                self.wfile.flush()
                i += 1
                time.sleep(1.0 / self.frames_per_sec)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the test client closing the stream is the point of this fixture, not a fault

    def log_message(self, *a):  # keep pytest output clean
        pass


@pytest.fixture()
def server():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _SseHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def _run(url, secs=3):
    r = subprocess.run(["bash", SCRIPT, url, str(secs)], capture_output=True, text=True, timeout=secs + 20)
    return r


# ── the defect ────────────────────────────────────────────────────────────────────────────────
def test_a_live_stream_is_counted_and_not_reported_as_zero(server):
    """THE bug. The inline version returned 0 here, on a stream delivering 5 frames a second."""
    r = _run(server + "/stream", 0.3)
    n = int(r.stdout.strip())
    assert n >= 5, f"0.3 s at 50 frames/s should count ~15, got {n} (rc {r.returncode}, stderr {r.stderr!r})"


def test_exit_status_is_success_even_though_curl_times_out(server):
    """curl exits 28 by design here. The script must not propagate that as failure, or every caller
    that checks `$?` concludes the stream is broken."""
    r = _run(server + "/stream", 0.2)
    assert r.returncode == 0, f"script failed with {r.returncode}: {r.stderr!r}"


def test_the_count_scales_with_the_window(server):
    """A count that ignores its time budget would pass the test above while measuring nothing."""
    short = int(_run(server + "/stream", 0.2).stdout.strip())
    long = int(_run(server + "/stream", 0.5).stdout.strip())
    assert long > short, f"5 s ({long}) should out-count 2 s ({short})"


# ── it must still be able to say no ───────────────────────────────────────────────────────────
def test_a_stream_with_no_data_frames_counts_zero(server):
    """Keepalive comments are not frames. Fixing the false negative must not create a false green."""
    r = _run(server + "/empty", 0.2)
    assert r.stdout.strip() == "0"
    assert r.returncode == 0


def test_an_unreachable_url_REFUSES_instead_of_counting_zero(server):
    """A refused connection counted nothing, so it must print no count.

    This test replaces one that pinned the opposite. It asserted `0` and exit 0 here, which is byte
    for byte what an open stream carrying no data frames prints. The installer reads that state as
    an encoder buffering the stream, and an unreached endpoint cannot support that conclusion.
    """
    r = subprocess.run(["bash", SCRIPT, "http://127.0.0.1:1/nope", "2"], capture_output=True, text=True, timeout=30)
    assert r.returncode == 3, f"expected the no-response status, got {r.returncode}: {r.stderr!r}"
    assert r.stdout.strip() == "", f"a count was printed for a stream nobody reached: {r.stdout!r}"
    assert "no HTTP response" in r.stderr


def test_a_rejected_endpoint_is_not_reported_as_an_empty_stream(server):
    """A 401 behind the auth block answered and carried no frames. Counting 0 there blames the
    encoder for a credential fault."""
    r = _run(server + "/deny", 0.5)
    assert r.returncode == 4, f"expected the non-2xx status, got {r.returncode}: {r.stderr!r}"
    assert r.stdout.strip() == "", f"a count was printed for a refused endpoint: {r.stdout!r}"
    assert "401" in r.stderr


def test_the_three_absent_frame_states_are_DISTINGUISHABLE(server):
    """The defect was one observable result for three causes. Hold all three apart in one place."""
    empty = _run(server + "/empty", 0.2)
    denied = _run(server + "/deny", 0.5)
    gone = subprocess.run(["bash", SCRIPT, "http://127.0.0.1:1/nope", "2"], capture_output=True, text=True, timeout=30)
    seen = {(r.stdout.strip(), r.returncode) for r in (empty, denied, gone)}
    assert len(seen) == 3, f"three causes produced {len(seen)} distinct result(s): {seen}"
    assert (empty.stdout.strip(), empty.returncode) == ("0", 0), "only a reached stream reports a count"


def test_the_window_and_not_the_belt_ends_the_run(server):
    """`timeout` is the belt over `--max-time` and must fire later. Were it firing first it would
    SIGTERM curl before the --write-out line, and a live stream would read as no response. So the
    run ends on the window, and the belt stays well clear of it."""
    t0 = time.monotonic()
    r = _run(server + "/stream", 0.3)
    elapsed = time.monotonic() - t0
    assert r.returncode == 0, f"a reached stream reported status {r.returncode}: {r.stderr!r}"
    assert elapsed < 3.0, f"the run took {elapsed:.2f} s for a 0.3 s window — the belt fired first"


# ── the properties the installer depends on ───────────────────────────────────────────────────
def test_it_advertises_gzip_like_a_browser():
    """Without --compressed this check is blind to the exact bug it exists to catch: a plain curl
    does not advertise gzip, so it never sees the encoder buffering."""
    assert "--compressed" in open(SCRIPT, encoding="utf-8").read()


def test_the_installer_delegates_to_this_script_instead_of_counting_inline():
    """Inline counting under pipefail is what broke. Keep the tested path the only path."""
    inst = os.path.join(os.path.dirname(SCRIPT), "expose-monitor.sh")
    body = open(inst, encoding="utf-8").read()
    after = body.split("systemctl reload caddy")[-1]
    assert "sse-frames.sh" in after, "the installer must use the tested counter"
    assert "grep -c '^data:'" not in after, "counting frames inline in the installer reintroduces the pipefail clobber"


def test_the_installer_reads_the_counters_status_before_its_count():
    """A refusal prints no count. A caller reading only stdout turns that into `0 frames`, which is
    the buffering diagnosis — the one conclusion an unreached stream cannot support."""
    inst = os.path.join(os.path.dirname(SCRIPT), "expose-monitor.sh")
    after = open(inst, encoding="utf-8").read().split("systemctl reload caddy")[-1]
    assert "UNMEASURED" in after, "the installer must name an unmeasured stream as unmeasured"
    assert "${N:-0}" not in after, "defaulting the count to 0 restores the reading the script refuses"
