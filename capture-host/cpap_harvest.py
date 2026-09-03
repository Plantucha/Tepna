"""CPAP auto-harvest — pull a ResMed card image off an ez Share Wi-Fi SD adapter.

Executes `CPAP-AUTOHARVEST-2026-07-26-BRIEF.md`. CPAP joins Tepna as FILES, not a BLE stream
(`how-to-collect/cpap-edf.md`, `CPAPDEX-PHASE9-FOLLOWUPS §2`) — so this is a file harvester, not a
`capture.py` device runner. It has no BLE surface and never touches the adapter or the connect lock.

WHY IT IS SHAPED LIKE THIS
  • Once daily, in a fixed window, ONLY while nothing is streaming. The upstream projects poll every
    65 s–15 min; that is actively wrong here. The card is 2.4 GHz-only, and `CAPTURE-HOST §5` names
    2.4 GHz contention a first-order risk against the four BLE links this box holds all night. A pull
    during capture would put a Wi-Fi transmitter beside the bed, in-band, competing with exactly the
    links whose RSSI margin is the documented failure mode (`VIGIL-OVERNIGHT-FINDINGS`, ~110 min lost).
  • 13:00, NOT the 09:00 first proposed. Measured on the real card across the 14 most recent nights,
    last-write time ran 08:35 → 12:02, median 08:56, with 6/14 nights STILL WRITING after 09:00 — and
    the late files are the big ones. On 20260725 `CSL`/`EVE` landed 03:50/06:42 but `PLD`, `SA2` and
    `BRP` (the 25 Hz flow waveform CPAPDex exists to read) all landed at 10:10. A 09:00 pull that night
    would have taken two small files, missed the waveform, and REPORTED SUCCESS.
  • Everything bounded. Same discipline `VIGIL-DEEP-ANALYSIS §2` imposed on BLE awaits: the card drops
    requests under sustained load, so every fetch has a timeout, capped retries, and the whole run has a
    wall-clock cap. An unbounded harvester wedged mid-run is a task that silently never returns.

The pure functions (parse_listing / should_fetch / due_now / short_read) carry the logic and are unit
tested; the IO is a thin shell around them.
"""
from __future__ import annotations

import datetime as _dt
import html as _html
import logging
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request

import telemetry

log = logging.getLogger("cpap")

DEFAULT_BASE = "http://192.168.4.1"
DEFAULT_IGNORE = ("JOURNAL.JNL", "ezshare.cfg", "System Volume Information")

# A listing row puts mtime and size BEFORE the anchor, and the real filename INSIDE it:
#     2026- 7-26    3:50:50           1KB  <a href="…202607~1.EDF"> 20260725_225050_CSL.edf</a>
# The naive "anchor label + following text" pairing shifts every file's metadata by one row. It looks
# entirely plausible and is wrong — it produced a bogus throughput figure during Phase 0. Note the
# embedded spaces in the date/time, and the `Total Entries: N Total Size: NKB` footer that must NOT be
# taken for a file. Anchor-first parsing is the bug; metadata-first is correct.
_ROW = re.compile(
    r'(\d{4}-\s*\d{1,2}-\s*\d{1,2})\s+(\d{1,2}:\s*\d{1,2}:\s*\d{1,2})\s+'
    r'(&lt;DIR&gt;|[\d.]+\s*[KMG]?B)\s*<a\s+href="([^"]+)"[^>]*>\s*(.*?)\s*</a>',
    re.I | re.S)

_NIGHT = re.compile(r"\d{8}")


# ── pure ────────────────────────────────────────────────────────────────────────────────────────────
def parse_listing(text: str, ignore=DEFAULT_IGNORE) -> list[dict]:
    """Rows from one ez Share HTML directory listing. `.`/`..` and the ignore list are dropped."""
    out = []
    for d, tm, sz, href, lbl in _ROW.findall(text or ""):
        name = _html.unescape(re.sub("<[^>]+>", "", lbl)).strip()
        if name in (".", "..") or name in ignore:
            continue
        out.append({"name": name,
                    "href": _html.unescape(href),
                    "mtime": f"{d.replace(' ', '')} {tm.replace(' ', '')}",
                    "size": _html.unescape(sz).strip(),
                    "isdir": "DIR" in sz})
    return out


def size_kb(s: str) -> float:
    """The listing's human size as KB. Tolerates '2229KB', '1.5MB', '2.5GB', '832B', ''.

    `G` used to be missing here while `_ROW`'s own regex ACCEPTS `[KMG]?B` — producer and consumer
    disagreeing inside one file (CAPTURE-HOST-DEEP-AUDIT §E3). A `2.5GB` row fell through to the
    bytes branch and became 0.0024 KB, so a complete download read as an enormous over-read and the
    file was re-fetched forever. Latent on the real ResMed card, whose listing is integer-KB throughout
    (largest observed 2613 KB) — but the card is not the only thing this parser will ever meet."""
    digits = "".join(c for c in (s or "") if c.isdigit() or c == ".")
    if not digits:
        return 0.0
    v, u = float(digits), (s or "").upper()
    if "G" in u:
        return v * 1024 * 1024
    if "M" in u:
        return v * 1024
    if "K" in u:
        return v
    return v / 1024 if "B" in u else v


def local_name(name: str) -> str:
    """On-disk name. `STR.EDF` MUST become `STR.edf`: the card serves the 8.3 uppercase form and both
    OSCAR and the `resmed-edf` adapter expect lowercase. On a case-sensitive filesystem the wrong case
    yields a night with per-session EDFs and NO summary — which reads as partial data, not as a bug."""
    return "STR.edf" if name.upper() == "STR.EDF" else name


def size_tolerance_kb(s: str) -> float:
    """How far a file may legitimately differ from the size the listing PRINTED, in KB.

    ONE tolerance, shared by `should_fetch` and `short_read` — they used to carry different ones and the
    gap between them was a hole (CAPTURE-HOST-DEEP-AUDIT §C5). The skip test allowed
    `max(1.0, want*0.02)`; the truncation detector flagged only `> max(2.0, want*0.05)`. Since 5 % > 2 %,
    every truncation the detector could SEE was one the resume logic would re-fetch anyway, and the
    whole 0-2 % band was invisible to both: a truncated EDF was accepted, reported ok, and skipped
    forever.

    The percentage was the mistake. It was justified as "the listing reports rounded KB", but that error
    is bounded by the QUANTIZATION OF THE PRINTED NUMBER, not by the file's size — a value shown as
    `2229KB` is exact to ±0.5 KB whether the file is 2 KB or 2 GB. Scaling it with the file is what
    opened the hole: 44.6 KB of slack on a 2229 KB BRP.edf. So the tolerance is read off the string's own
    precision, half its last displayed digit. For the real ResMed card (integer KB throughout) that is
    0.5 KB; a `1.5MB` row would get the 51.2 KB it genuinely deserves.

    The correct sibling was already one module over: `pull_session.py:145` gates its skip on EXACT
    equality."""
    txt = (s or "").strip()
    digits = "".join(c for c in txt if c.isdigit() or c == ".")
    if not digits:
        return 0.0
    dec = len(digits.split(".", 1)[1]) if "." in digits else 0
    quantum = 10.0 ** (-dec)                       # in whatever unit the listing used
    u = txt.upper()
    if "M" in u:
        quantum *= 1024.0
    elif "G" in u:
        quantum *= 1024.0 * 1024.0
    elif "K" not in u and "B" in u:
        quantum /= 1024.0
    return max(quantum / 2.0, 1e-3)                # a byte of float slack, never a percentage


def size_window_kb(s: str) -> tuple[float, float]:
    """The (low, high] KB range a COMPLETE file may occupy, given what the listing printed.

    THE CARD CEILS. It does not round to nearest, and assuming it did rejected roughly half of every
    file it ever served. Measured on the real card 2026-07-28, ten files, listing vs Content-Length —
    `listed == ceil(bytes/1024)` in all ten:

        CSL      1 KB      832 B  =    0.81 KB   ceil 1
        EVE      2 KB     1344 B  =    1.31 KB   ceil 2   <- rejected as "short" under +/-0.5
        PLD    204 KB   208776 B  =  203.88 KB   ceil 204
        BRP   2229 KB  2281784 B  = 2228.30 KB   ceil 2229 <- rejected
        BRP     25 KB    25032 B  =   24.45 KB   ceil 25   <- rejected

    The old model was symmetric — `|have - printed| <= half the last displayed digit`. Its reasoning
    (quantization of the PRINTED number, never a percentage) was right and is kept; only the rounding
    direction was wrong. Under ceil a complete file may be up to a whole quantum SMALLER than printed
    and can never be larger, so the window is ASYMMETRIC: `(P - q, P]`.

    That asymmetry is the safety property, not a detail. It stays tight on the high side, and on the
    low side it admits exactly the values ceil could have produced — nothing more. A symmetric `P +/- q`
    would open a band above P where a genuinely corrupt file could pass, which is the §C5 hole this
    family of functions exists to close."""
    printed = size_kb(s)
    q = size_tolerance_kb(s) * 2.0                 # the quantum itself, not half of it
    if printed <= 0:
        return (0.0, 0.0)
    return (printed - q, printed + 1e-6)           # (low, high] with a float epsilon on the boundary


def reap_stale_part(dest_path: str, st: dict | None = None) -> bool:
    """Remove a `.part` that is byte-identical to the real file sitting beside it.

    RESIDUE FROM THE CEIL BUG. While the listing was read as round-to-nearest, a complete download was
    rejected AFTER being written, leaving a `.part` next to a real file that was already correct — 485
    of them, 246 MB, every one verified byte-identical with `cmp` on the box. They are unreachable by
    the promotion path in `fetch()`, because `should_fetch` now correctly SKIPS those files and fetch
    is never called at all. So they are reaped here, on the skip path, where the pair is already known.

    ONLY on an exact byte match, and only when the real file exists. A `.part` that DIFFERS may be an
    interrupted download whose bytes are the only ones we have — deleting that would destroy the very
    evidence the `.part` convention exists to preserve. Compared in chunks so a 2.6 MB waveform does not
    have to be held twice in memory."""
    tmp = dest_path + ".part"
    if not (os.path.exists(tmp) and os.path.exists(dest_path)):
        return False
    try:
        if os.path.getsize(tmp) != os.path.getsize(dest_path):
            return False
        with open(tmp, "rb") as a, open(dest_path, "rb") as b:
            while True:
                ca, cb = a.read(65536), b.read(65536)
                if ca != cb:
                    return False
                if not ca:
                    break
        os.unlink(tmp)
    except OSError:                                 # unreadable or vanished — leave it alone
        return False
    if st is not None:
        st["reaped"] = st.get("reaped", 0) + 1
    return True


def should_fetch(entry: dict, dest_path: str) -> bool:
    """Skip-if-present on name + size. Makes the steady state nearly free (one night ≈ 2.5 MB ≈ 20 s) and
    lets an interrupted backfill resume. A file that is present but the WRONG size is re-fetched, not
    trusted — see `size_window_kb` for what "wrong" means, why it is not a percentage, and why it is
    not symmetric either."""
    want = size_kb(entry.get("size", ""))
    if not os.path.exists(dest_path):
        return True
    if want <= 0:
        return False
    have = os.path.getsize(dest_path) / 1024.0
    lo, hi = size_window_kb(entry.get("size", ""))
    return not (lo < have <= hi)


def short_read(entry: dict, got_bytes: int, content_length: int | None = None) -> bool:
    """True when a download is smaller than the listing promised — i.e. the card truncated under load. A
    short read is NOT a valid file; accepting one writes a corrupt EDF that parses far enough to look
    real. Same class as the part-decoded PMD frame in `VIGIL-HARDENING-III §1`.

    Shares `size_tolerance_kb` with `should_fetch` by construction, so the two can no longer disagree
    about what counts as complete. Scope of the silent path this closes: it exists only where the card
    frames the body by connection-close. With a declared `Content-Length`, urllib raises
    `IncompleteRead`, `_get` retries, and the failure already lands in `st['errors']` with the file
    absent.

    `content_length`, when the caller has it, settles the question outright — see below."""
    # CONTENT-LENGTH FIRST, because it is EXACT and this card sends it. The listing prints a
    # ceil-rounded KB string ("104KB" for 105810 bytes); comparing received bytes against display text
    # is what made half of every download look truncated. When the server has declared the exact
    # length there is no rounding question to model — either we got it all, or it really is short.
    if content_length is not None and content_length > 0:
        return got_bytes < content_length
    want = size_kb(entry.get("size", ""))
    if want <= 0:
        return False
    lo, hi = size_window_kb(entry.get("size", ""))
    return not (lo < got_bytes / 1024.0 <= hi)


def due_now(now: _dt.datetime, at_hour: int, last_run_date, window_h: int = 2) -> bool:
    """Fire once per calendar day, inside a BOUNDED WINDOW [at_hour, at_hour+window_h).

    A floor (`now.hour >= at_hour`) was wrong and shipped once. It made every restart after the hour
    consider itself due — observed live 2026-07-26: a 19:25 restart re-armed a 13:00 job, and because a
    deferral deliberately does not consume the day, it then retried every 60 s. The only thing holding
    it was the streaming interlock, so it would have fired the moment the sensors came off at bedtime —
    starting a 2.4 GHz transfer at the START of a night, which is the exact contention this schedule
    exists to avoid (measured cost: 5-7 dB and 17 reconnects across three sensors).

    A window makes "a missed day self-heals" honest: it heals TOMORROW, in the window, rather than at
    whatever hour the box happened to restart.

    THE WINDOW WRAPS MIDNIGHT (CAPTURE-HOST-DEEP-AUDIT §E4). `at_hour <= h < at_hour + window_h` is
    arithmetic on a value that is modulo 24, so a window starting late in the day was silently clipped
    at 23:59. With the shipped `window_h=2` the only reachable clip is `at_hour: 23`, which got a
    1-hour window instead of two; the default 13 is unaffected. The once-per-day key stays the
    window's START date, so an 00:30 firing of a 23:00 window still consumes the 23rd, not the 24th —
    otherwise a wrapped window could fire twice."""
    d = window_start_date(now, at_hour, window_h)
    return d is not None and last_run_date != d


def window_start_date(now: _dt.datetime, at_hour: int, window_h: int = 2):
    """The DATE of the window `now` falls in, or None if it falls in none.

    Exposed because the caller has to record the same thing `due_now` compares against. Recording
    `now.date()` would be wrong for a wrapped window: a 23:00 window firing at 00:30 would stamp the
    24th while `due_now` asks about the 23rd, so it would be due again a minute later, forever."""
    delta = (now.hour - int(at_hour)) % 24
    if delta >= int(window_h):
        return None
    return (now - _dt.timedelta(hours=delta)).date()


def nights_for(scope: str, now: _dt.datetime) -> "set[str] | None":
    """Night folders (YYYYMMDD) for a manual pull. None means "every night on the card", which combined
    with skip-if-present IS "all missing" — the harvester never re-fetches what it already holds.

    Dated from `now` rather than read off the card: a night folder is stamped with its START date, so
    last night is yesterday's folder — and today's exists too once a nap or an early session is written.
    Both are included so "last night" cannot miss a session that straddles the boundary."""
    if scope == "missing":
        return None
    days = 2 if scope == "last" else 8            # 'last' = yesterday+today; 'week' = 7 nights + today
    return {(now.date() - _dt.timedelta(days=i)).strftime("%Y%m%d") for i in range(days)}


def is_night_dir(entry: dict) -> bool:
    return bool(entry.get("isdir")) and bool(_NIGHT.fullmatch(entry.get("name", "")))


def blocking_devices(status_devices: dict) -> list[str]:
    """Devices actually STREAMING, which must stop the harvest. Returns names so a skip can say WHICH.

    `connected` alone is NOT streaming, and blocking on it was wrong. A sensor on its charger reports
    connected=True while producing nothing: the Verity refuses PMD outright ("charging — PMD streams
    unavailable") and the ring reports worn=False on the dock. Observed 2026-07-26 — every sensor was
    docked and idle, yet the manual pull still refused with "streaming: Polar Verity Sense, Wellue
    O2Ring-S". The gate was unreachable on any evening the sensors were charging, which is precisely
    when a pull is safest.

    The rule this encodes: a harvest is unsafe when a radio is carrying real sample traffic near the
    body, not merely when a link exists. A charging device cannot be on a body."""
    # Single-sourced on `telemetry.on_body` so the rule cannot drift from its other caller. Blocks on
    # UNKNOWN as well as on-body: refusing a harvest costs a retry, and this side can afford that.
    out = [name for name, st in (status_devices or {}).items()
           if telemetry.on_body(st) is not False]
    return sorted(out)


# ── IO ──────────────────────────────────────────────────────────────────────────────────────────────
class ShortRead(RuntimeError):
    """A download smaller than the listing promised. Its own type so the harvester can tell a truncated
    body (retry next run; the `.part` is still on disk) from a transport failure."""


def reachable(base: str = DEFAULT_BASE, timeout: float = 5.0) -> bool:
    """Is the card ALREADY answering at `base`? One short, unretried, unprivileged GET.

    WHY THIS EXISTS. The harvest's only privileged work is joining the card's own Wi-Fi AP: `ip link`,
    `wpa_supplicant`, `wpa_cli`, `ip addr add`, and the teardown — all `sudo -n`, all needing sudoers
    entries that a stock box does not have. The DOWNLOAD itself is a plain unauthenticated HTTP GET and
    has never needed a privilege. Observed 2026-07-28: the 13:00 run died at `sudo -n mkdir -p` with
    "interactive authentication is required" and skipped the day, with the previous night's therapy data
    sitting one HTTP request away.

    An ez Share card does not have to be an access point. Put it in station mode and it joins the house
    network like any other client, at which point the box reaches it over the wired uplink and the entire
    privileged branch is dead code for that deployment. This probe is what lets the same build serve both:
    if the card answers, associate nothing.

    Deliberately NOT retried and deliberately short. This is a routing question — "can I already see it"
    — not a transfer, and a slow answer here is a no. The real client keeps its own retries for the
    fetches that matter."""
    try:
        req = urllib.request.Request(base.rstrip("/") + "/dir?dir=A:", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= getattr(r, "status", 200) < 400
    except Exception:                                   # noqa: BLE001 — unreachable is the answer, not an error
        return False


class EzShare:
    """Thin bounded HTTP client for the card. Every request has a timeout and capped retries."""

    def __init__(self, base: str = DEFAULT_BASE, timeout: float = 20.0, retries: int = 5,
                 delay: float = 0.15, ignore=DEFAULT_IGNORE):
        self.base, self.timeout, self.retries, self.delay = base.rstrip("/"), timeout, max(1, retries), delay
        self.ignore = tuple(ignore)

    def _get(self, url: str, want_length: bool = False):
        """Bytes, or (bytes, declared_length) when `want_length` — the exact size the server promised,
        which beats the listing's ceil-rounded display string for deciding completeness."""
        last = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(url, timeout=self.timeout) as r:
                    body = r.read()
                    if want_length:
                        try:
                            return body, int(r.headers.get("Content-Length") or 0)
                        except (TypeError, ValueError):     # a server that declares nothing usable
                            return body, 0
                    return body
            except Exception as e:                     # noqa: BLE001 — every transport error is retryable
                last = e
                time.sleep(0.4 * (attempt + 1))
        raise RuntimeError(f"{url}: {last}")

    def listing(self, href: str = "dir?dir=A:") -> list[dict]:
        url = urllib.parse.urljoin(self.base + "/", href)
        return parse_listing(self._get(url).decode("utf-8", "replace"), self.ignore)

    def fetch(self, entry: dict, dest_dir: str) -> tuple[str, int]:
        """Download one entry. Returns (path, bytes). Writes via a .part temp then renames, so
        an interrupted run can never leave a truncated file that skip-if-present would later accept.

        Raises `ShortRead` when the body is smaller than the listing promised — WITHOUT renaming. The
        `.part` guard was already here and did not cover this case: `short_read` was consulted only
        AFTER `os.replace` had already promoted the truncated body to its final name, at which point
        skip-if-present saw a plausible file and never came back for it (CAPTURE-HOST-DEEP-AUDIT §C5).
        Leaving the `.part` behind means the destination stays absent, so the next run re-fetches."""
        dest = os.path.join(dest_dir, local_name(entry["name"]))
        os.makedirs(dest_dir, exist_ok=True)
        url = urllib.parse.urljoin(self.base + "/", entry["href"])

        # PROMOTE AN ALREADY-COMPLETE .part INSTEAD OF RE-FETCHING IT.
        # The ceil bug left 487 of these — 246 MB of byte-perfect files rejected against a rounded
        # display string and re-downloaded, and re-rejected, every run. With the completeness test
        # fixed they would all simply re-download; a HEAD is cheaper than the body and settles it.
        # Only ever promotes on an EXACT match against the declared length: this is the one place that
        # turns an unverified file into a trusted one, so it does not get to guess.
        tmp = dest + ".part"
        if os.path.exists(tmp) and not os.path.exists(dest):
            try:
                req = urllib.request.Request(url, method="HEAD")
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    declared = int(r.headers.get("Content-Length") or 0)
                have = os.path.getsize(tmp)
                if declared > 0 and have == declared:
                    os.replace(tmp, dest)
                    return dest, have
            except Exception:                       # noqa: BLE001 — a failed HEAD just means "download it"
                pass

        data, declared = self._get(url, want_length=True)
        with open(tmp, "wb") as fh:
            fh.write(data)
        if short_read(entry, len(data), declared):
            time.sleep(self.delay)
            raise ShortRead(f"{entry['name']}: declared {declared or entry.get('size', '?')}, "
                            f"got {len(data)} bytes — left as {os.path.basename(tmp)}")
        os.replace(tmp, dest)
        time.sleep(self.delay)
        return dest, len(data)


def default_route_dev() -> str | None:
    """The interface currently carrying the default route, or None. This is the box's lifeline: SSH, the
    served monitor, NTP and the NAS pull all ride it, and the ez Share card is a dead end with no route
    anywhere. Read it BEFORE associating and again after, and treat any change as a fault."""
    try:
        p = subprocess.run(["ip", "route", "show", "default"],
                           capture_output=True, text=True, timeout=10)
        m = re.search(r"\bdev\s+(\S+)", p.stdout or "")
        return m.group(1) if m else None
    except Exception:                                  # noqa: BLE001 — never let a probe kill the task
        return None


# Exit codes this daemon's privileged helpers actually produce. `sudo` reserves 1 for its own refusal
# and passes the child's code through otherwise, so a bare number is ambiguous — the OUTPUT is what
# disambiguates, and every rule below requires it.
# NOTE THE `.*` BETWEEN THE THREAD NAME AND "panicked": the real line carries the pid —
# `thread 'main' (9270) panicked at src/system/audit.rs:80:14` — so a pattern that expects
# `'main' panicked` misses every actual occurrence. Written from the journal, not from memory of the
# format; the first version was tested against an invented string and matched nothing real.
_RUST_PANIC = re.compile(r"thread '[^']*'.*panicked at|note: run with `RUST_BACKTRACE")
_SUDO_REFUSED = re.compile(r"a (?:password|terminal) is required|not allowed to execute|"
                           r"may not run|no tty present|incorrect password", re.I)
_NOT_FOUND = re.compile(r"command not found|no such file or directory: |not installed|"
                        r"executable file not found", re.I)


def helper_failure_kind(rc: int, out: str = "") -> str:
    """Why a privileged helper failed, from its exit code AND its output. Pure.

    THE CASE THIS EXISTS FOR. On 2026-07-26 every helper on the live box failed with `rc=101` and
    `thread 'main' panicked at src/system/audit.rs:80:14` — sudo-rs CRASHING, not refusing. The daemon
    logged the number and nothing read it, so `cpap.state: "error"` sat unexplained for ten days and two
    correct-but-irrelevant code fixes were credited with covering it (FOLLOWUPS-II §1). A crash in the
    privilege layer is an operational fault of a different KIND from a missing sudoers rule: one means
    the box's sudo is broken and no amount of retrying helps, the other is a one-line config fix.

    Classification is by EVIDENCE, never by the number alone. `sudo` passes the child's exit code
    through, so 101 is only a crash when the output carries a panic; otherwise it is just a program's
    exit status and this says so rather than inventing a diagnosis."""
    text = str(out or "")
    if _RUST_PANIC.search(text):
        return "crashed"                    # the privilege layer itself died — retrying cannot help
    if rc == 124:
        return "timeout"                    # _sh's own marker, below
    if rc == 127 or _NOT_FOUND.search(text):
        return "missing"                    # the target binary is not installed
    if _SUDO_REFUSED.search(text):
        return "refused"                    # sudoers says no — a config fix, not a fault
    return "failed"                         # a genuine non-zero from the tool, cause unclassified


def _sh(argv: list[str], timeout: float, sudo: bool = False) -> tuple[int, str]:
    """Run one command, bounded, never raising. `sudo -n` (non-interactive) because this runs from a
    daemon with nobody to answer a password prompt — a missing sudoers rule must fail fast and loudly,
    not hang until the run deadline."""
    cmd = (["sudo", "-n", *argv] if sudo else argv)
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        out = ((p.stdout or "") + (p.stderr or "")).strip()
        if p.returncode:
            kind = helper_failure_kind(p.returncode, out)
            # CRASHED is the one worth raising the voice for: it means the privilege layer is broken, so
            # every other helper this cycle will fail too and the cause is not in this codebase.
            (log.error if kind == "crashed" else log.warning)(
                "cpap: %s -> rc=%d [%s] %s", " ".join(cmd[:4]), p.returncode, kind, out[:160])
        return p.returncode, out
    except FileNotFoundError:
        return 127, f"{cmd[0]}: not installed"
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout:.0f}s"
    except Exception as e:                             # noqa: BLE001 — association is best-effort
        return 1, repr(e)


# ── association backends ────────────────────────────────────────────────────────────────────────────
# Two, chosen at runtime. NetworkManager is what a desktop has; a server appliance does not — vigil runs
# netplan/systemd-networkd with no `nmcli` at all, which the nmcli-only first cut discovered the hard way
# (it would have logged "nmcli not installed" nightly and shown a permanently red card).

def backend() -> str:
    """'nmcli' when NetworkManager is present, else 'wpa' (wpa_supplicant). Probed, never assumed."""
    import shutil
    return "nmcli" if shutil.which("nmcli") else "wpa"


# The card's AP is a dead end: it routes nowhere and serves no DNS worth having. So the wpa backend
# assigns a STATIC address and installs NO ROUTE OF ANY KIND. That is a stronger guarantee than the
# nmcli path's `ipv4.never-default` — there is no route to suppress, and no DHCP client to talk us into
# one. `ip addr add` alone creates only the on-link /24, which is exactly enough to reach 192.168.4.1.
WPA_IFACE, WPA_ADDR = "wlp1s0", "192.168.4.2/24"


# Where the box's network interfaces are enumerated. A module constant so the existence check below is
# reachable from a test without a real radio.
SYS_NET = "/sys/class/net"


def default_wifi_iface(_sys: str | None = None) -> str:
    """The box's first `wl*` interface, or `WPA_IFACE` if none can be read.

    `WPA_IFACE` was a module constant with NO config key while `backend()` returns `wpa` whenever
    `nmcli` is absent — which this module's own comment says is precisely the vigil box. On that branch
    `profile` is DEAD, yet the failure was reported as `Wi-Fi profile 'ezshare' would not come up
    safely`, naming the one setting that branch never reads, and `config.example.yaml` documents
    `wifi_profile` as the only Wi-Fi knob (CAPTURE-HOST-DEEP-AUDIT §E5):

        nmcli on PATH? None -> backend() = wpa ; WPA_IFACE = wlp1s0 ; host has wlp10s0
        LOG WARNING: cpap: sudo -n ip link -> rc=1 Cannot find device "wlp1s0"

    Not silent — `STATUS['cpap']` goes to `state='error'` with a detail and each failed command logs a
    warning — so this is a robustness defect, not a hidden one. What was wrong is that the surfaced
    REASON pointed at the wrong knob. A discovered default plus a real `cpap.wifi_iface` key fixes
    both halves."""
    try:
        names = sorted(n for n in os.listdir(_sys or SYS_NET) if n.startswith("wl"))
    except OSError:
        return WPA_IFACE
    return names[0] if names else WPA_IFACE
# ctrl_interface is NOT optional: without it wpa_supplicant starts, associates or not, and creates no
# control socket — so `wpa_cli status` can never reach it and the association can never be confirmed.
# Found on real hardware 2026-07-26; mocked subprocesses cannot catch it, because the bug is in the
# CONFIG we hand the daemon, not in how we call it. Bounded-wait then teardown handled it correctly.
#
# …and it must be OUR OWN directory, not the system daemon's. `/run/wpa_supplicant` is where the
# packaged `wpa_supplicant.service` keeps ITS sockets, and on the vigil box that unit is ACTIVE
# (systemd-networkd + wpa_supplicant, no NetworkManager — the very branch `backend()` selects). Two
# consequences, both observed on real hardware 2026-07-27:
#
#   1. our `wpa_supplicant -B` exits 255 the moment it tries to own a socket in that directory —
#      "Successfully initialized wpa_supplicant" on stderr, then gone — so the harvest could NEVER
#      bring the card up on a stock Ubuntu box, and reported it as the PROFILE failing;
#   2. worse, a bare `wpa_cli -i <iface> …` resolves through that same shared directory, so the
#      status poll interrogated — and `_wpa_down`'s `terminate` would have KILLED — the SYSTEM
#      supplicant. On this box wlp1s0 is idle and the uplink is wired, so nothing was lost; on a
#      box that runs on Wi-Fi, the CPAP teardown would have taken the network down with it.
#
# So: a private directory, and every wpa_cli call is pinned to it with `-p`. The two daemons then
# cannot see each other's sockets, which is the only version of "bound to OUR interface" that holds.
# …and it must be a directory THIS DAEMON CAN CREATE. `/run/tepna-wpa` is root-owned territory, so
# 16a97fb's `sudo -n mkdir -p` needed a sudoers rule that was never added alongside it. Deployed to the
# box, that broke the harvest outright: the mkdir failed with "interactive authentication is required",
# the directory therefore did not exist, `wpa_supplicant -B` could not create its control socket and
# exited 255, and the run was reported as the Wi-Fi PROFILE failing. The last good pull (2026-07-27
# 22:03) ran the PREVIOUS code, whose log line is `wpa_cli -i wlp1s0 terminate` with no `-p` at all.
#
# The privilege was never necessary. wpa_supplicant runs as root and can write into any directory that
# EXISTS; nothing requires that directory to be root-owned. Verified on the box 2026-07-28:
#   mkdir -p -m 0700 /tmp/tepna-wpa-1000        (as vigil, no sudo)      -> OK
#   sudo -n wpa_supplicant -B -i wlp1s0 -c …    -> rc=0, sockets created inside it, root-owned
#   sudo -n wpa_cli -p /tmp/tepna-wpa-1000 …    -> wpa_state=SCANNING
# So the association works with the sudoers rules that ALREADY exist (ip · wpa_supplicant · wpa_cli),
# and 16a97fb's real gain — never sharing the system supplicant's socket directory — is kept intact.
#
# systemd's RuntimeDirectory= is the tidiest source when the unit provides one (it creates and cleans
# `/run/<name>` owned by the service user); the uid-scoped /tmp path is the portable fallback, 0700 so
# no other local user can reach the sockets.
# WHERE, exactly, is decided by PROBING — because guessing has now been wrong twice.
#
# First guess `/run/tepna-wpa` + `sudo mkdir`: needed a sudoers rule nobody added, so the directory
# never existed and wpa_supplicant exited 255. Second guess `/tmp/tepna-wpa-<uid>`, created
# unprivileged: verified by hand over SSH, shipped, and STILL failed —
#   "could not create the wpa control dir /tmp/tepna-wpa-1000: [Errno 30] Read-only file system"
# because the daemon runs under `ProtectSystem=strict`, which makes the whole hierarchy read-only
# except an explicit ReadWritePaths list. An SSH shell is not that sandbox, so the hand-verification
# proved nothing about the process that actually runs this. On the box:
#   ReadWritePaths=/srv/tepna /opt/tepna/capture-host …   PrivateTmp=no   RuntimeDirectory=(empty)
#
# So: try candidates in order and keep the first one that can actually be CREATED, which is the only
# question that matters and the only one a probe can answer from inside the sandbox that constrains it.
def _wpa_dir(root: str | None = None) -> str:
    cands = []
    rt = os.environ.get("RUNTIME_DIRECTORY")           # systemd's own, when the unit provides one
    if rt:
        cands.append(os.path.join(rt.split(":")[0], "wpa"))
    if root:                                            # the capture root is in ReadWritePaths by
        cands.append(os.path.join(root, ".run", "wpa")) # definition — the daemon writes there all night
    cands.append("/tmp/tepna-wpa-%d" % os.getuid())     # unsandboxed fallback (CLI use, dev boxes)
    for c in cands:
        try:
            os.makedirs(c, mode=0o700, exist_ok=True)
            return c
        except OSError:
            continue  # this candidate is unusable; the loop tries the next, and the last line
                      # hands back a path the CALLER warns about — the refusal is reported there
    return cands[-1]                                    # nothing worked; the caller warns and carries on


# ctrl_interface is a PARAMETER, not a module constant: the directory is probed per call (see
# _wpa_dir), so baking it in at import time would hand wpa_supplicant a path the daemon cannot write.
_WPA_CONF = ('ctrl_interface={ctrl}\nctrl_interface_group=0\n'
             'network={{\n\tssid="{ssid}"\n\tpsk="{psk}"\n\tkey_mgmt=WPA-PSK\n\tscan_ssid=1\n}}\n')


def associated(iface: str, sysfs: str = "/sys/class/net") -> bool | None:
    """Is `iface` associated to an AP? Read from /sys, so it needs NO privilege and no helper binary.

    WHY NOT wpa_cli, WHICH IS RIGHT THERE. wpa_cli creates its own CLIENT socket under /tmp, and the
    capture unit runs ProtectSystem=strict — so every status poll fails with
    `Failed to connect to non-global ctrl_ifname: … Read-only file system` even when wpa_supplicant is
    up, associated, and its sockets exist. The harvest was therefore reporting "did not associate
    within 45s" for a radio that had associated in four seconds. Measured on the box 2026-07-28.

    `carrier` is the same fact without the socket:

        link down            carrier unreadable (EINVAL)   ← NOT associated
        up, not associated   carrier=0                     wpa_state=SCANNING
        associated           carrier=1                     wpa_state=COMPLETED

    Verified against the real radio and the real card, side by side with wpa_cli, before this replaced
    it. Returns None when the file cannot be read at all, so the caller can tell "not associated" from
    "this kernel/driver will not tell me" and fall back rather than guess."""
    # `sysfs` is a parameter so this is testable by pointing it at a directory, rather than by
    # monkeypatching builtins.open — which is both fragile and reaches far beyond the code under test.
    try:
        with open(os.path.join(sysfs, iface, "carrier")) as fh:
            return fh.read().strip() == "1"
    except OSError:
        # EINVAL is the normal answer for a DOWN link — that is a real "no", not an unknown.
        try:
            with open(os.path.join(sysfs, iface, "operstate")) as fh:
                if fh.read().strip() == "down":
                    return False
        except OSError:
            pass      # operstate was unreadable too, so we still do not know — and `None` below is
                      # that answer. Never False: an unreadable link is not a DOWN link.
        return None


def supplicants_for(iface: str, cmdlines: dict[int, str]) -> list[int]:
    """PIDs from `cmdlines` that are OUR supplicant for `iface`. Pure, so the claim below is testable.

    `-i <iface>` is the discriminator, and it has to be, for two reasons measured on the live box:
      * the SYSTEM supplicant is always running there (`-u -s -O DIR=/run/wpa_supplicant`, D-Bus mode,
        no `-i`), so "is any wpa_supplicant alive?" answers yes forever and would warn on every cycle;
      * ours is started `wpa_supplicant -B -i <iface> -c <conf>`, so the interface is what separates
        the process we are responsible for from the one the OS owns.

    Matching is on the ARGUMENT, never on a substring of the whole line: an iface name is short enough
    ("wlan0") to appear inside an unrelated path, and this decides whether we shout about a leak."""
    out = []
    for pid, cmd in (cmdlines or {}).items():
        args = [a for a in str(cmd).split("\0") if a]
        if not args or os.path.basename(args[0]) != "wpa_supplicant":
            continue
        if any(a == "-i" and i + 1 < len(args) and args[i + 1] == iface for i, a in enumerate(args)):
            out.append(pid)
    return sorted(out)


def _live_supplicants(iface: str) -> list[int]:
    """`supplicants_for` against /proc. Read directly rather than via `pgrep -f`, which would match its
    OWN command line (CLAUDE.md §4) — the pattern would contain "wpa_supplicant" and the interface."""
    cmdlines = {}
    try:
        for name in os.listdir("/proc"):
            if not name.isdigit():
                continue
            try:
                with open(f"/proc/{name}/cmdline", "rb") as fh:
                    cmdlines[int(name)] = fh.read().decode("utf-8", "replace")
            except OSError:
                continue                       # the process exited between listdir and open
    except OSError:
        return []                              # no /proc (not Linux) — cannot verify, so claim nothing
    return supplicants_for(iface, cmdlines)


def _wpa_cli(wdir: str, iface: str, *args: str) -> list[str]:
    """A `wpa_cli` argv that can actually connect from inside the unit's sandbox.

    `-p` points at the SERVER sockets — load-bearing, because resolving through /run/wpa_supplicant
    would let `terminate` kill the box's own supplicant. But `-p` is only half of it: wpa_cli also
    creates its OWN CLIENT socket, and that goes under a compiled-in `/tmp` which is READ-ONLY for this
    unit (`ProtectSystem=strict`, and /tmp is not in ReadWritePaths). So every call failed with

        Failed to connect to non-global ctrl_ifname: wlp1s0  error: Read-only file system

    even with the server sockets sitting right there. That is the failure `associated()` was written to
    route around by reading /sys instead — but teardown has no /sys equivalent, so it stayed broken and
    leaked a root supplicant per harvest.

    `-s` moves the client socket, so it goes in the same probed-writable directory as the server ones.
    Verified against the real box 2026-07-29: `status` returned `wpa_state=INTERFACE_DISABLED` and
    `terminate` returned OK where both had been failing rc=255."""
    return ["wpa_cli", "-p", wdir, "-s", wdir, "-i", iface, *args]


def _wpa_up(iface: str, ssid: str, psk: str, addr: str, timeout: float, root: str | None = None) -> bool:
    import tempfile
    fd, conf = tempfile.mkstemp(prefix="tepna-ezshare-", suffix=".conf")
    try:
        wdir = _wpa_dir(root)
        os.write(fd, _WPA_CONF.format(ctrl=wdir, ssid=ssid, psk=psk).encode())
        os.close(fd)
        os.chmod(conf, 0o600)                          # the PSK is in here; never world-readable
        _sh(["ip", "link", "set", iface, "up"], 10, sudo=True)
        # -B daemonises. Bound to OUR conf, OUR interface and OUR control directory: the packaged
        # wpa_supplicant.service is active on this box, and two supplicants sharing one ctrl_interface
        # directory collide over the socket before they ever get as far as fighting over the radio.
        # UNPRIVILEGED by design and PROBED, not assumed — see _wpa_dir().
        if not os.path.isdir(wdir):
            log.warning("cpap: no writable wpa control dir (tried up to %s) — the association will fail "
                        "and say so", wdir)
        rc, out = _sh(["wpa_supplicant", "-B", "-i", iface, "-c", conf], 20, sudo=True)
        if rc:
            # Say WHY. `state='error', detail="profile 'ezshare' would not come up safely"` names the
            # profile, which is the one thing that was never wrong here — the same mis-aimed reason
            # CAPTURE-HOST-DEEP-AUDIT §E5 fixed once already, arriving by a different route.
            # A FAILED START IS NOT A FAILED ASSOCIATION. `wpa_supplicant -B` exits non-zero when one
            # is ALREADY running on this interface ("nl80211: deinit ifname=…"), and one can easily be:
            # the teardown's `wpa_cli terminate` is the only thing that reaps it, and that is precisely
            # the call that cannot run under ProtectSystem=strict. So a previous run's supplicant
            # survives, and it is perfectly capable of associating for us.
            # Log it and fall through to the poll rather than giving up. The poll is bounded, so the
            # worst case is unchanged — we fail after `timeout` either way — while the common case of
            # an inherited supplicant now succeeds instead of reporting a phantom failure.
            log.warning("cpap: wpa_supplicant -B returned rc=%s on %s (%s) — continuing; an existing "
                        "supplicant may still associate", rc, iface,
                        (out or "").strip().splitlines()[-1] if (out or "").strip() else "no output")
        deadline = time.monotonic() + max(5.0, timeout)
        while time.monotonic() < deadline:             # bounded wait for association
            # PRIMARY: /sys carrier — unprivileged, no socket, works under ProtectSystem=strict.
            # FALLBACK: wpa_cli, for a driver that will not expose carrier. Only consulted when the
            # primary says "I cannot tell" (None), never to override a definite answer — otherwise the
            # read-only-/tmp failure that made this necessary would simply come back.
            ok = associated(iface)
            if ok is None:
                rc, out = _sh(_wpa_cli(wdir, iface, "status"), 8, sudo=True)
                ok = rc == 0 and "wpa_state=COMPLETED" in out
            if ok:
                _sh(["ip", "addr", "add", addr, "dev", iface], 10, sudo=True)   # NO route, ever
                return True
            time.sleep(1.0)
        log.warning("cpap: wpa_supplicant did not associate to %r within %.0fs", ssid, timeout)
        _wpa_down(iface, root)
        return False
    finally:
        try:
            os.unlink(conf)                            # the PSK does not outlive the association
        except OSError:
            # THE LINE ABOVE IS A SECURITY INVARIANT, and this is the one path that breaks it. The
            # file holds a Wi-Fi PSK and was written to be ephemeral; if it survives, it survives
            # SILENTLY and nothing else in the system will ever look for it. The directory is
            # mode 0700, which bounds the exposure — it does not end it, and only a human can.
            log.warning("cpap: could NOT remove %s — it still holds a Wi-Fi PSK; delete it by hand",
                        conf, exc_info=True)


def _wpa_down(iface: str, root: str | None = None) -> bool:
    # Order matters: drop the address first so nothing can route over a half-torn link, then kill the
    # supplicant, then down the interface. Every step is best-effort — a box that cannot tear down
    # cleanly must still not raise into the harvest task.
    _sh(["ip", "addr", "flush", "dev", iface], 10, sudo=True)
    # `-p _wpa_dir(root)` is load-bearing, not tidiness: without it this resolves through the SYSTEM
    # supplicant's socket directory and `terminate` kills the box's own wpa_supplicant. Harmless here
    # only because the vigil box uplinks over wired eno1; on a Wi-Fi box the CPAP harvest's teardown
    # would have taken the network down with it.
    wdir = _wpa_dir(root)
    rc, out = _sh(_wpa_cli(wdir, iface, "terminate"), 10, sudo=True)
    _sh(["ip", "link", "set", iface, "down"], 10, sudo=True)
    # DO NOT SWALLOW IT. This used to `return True` unconditionally, so a terminate that never worked
    # reported a clean teardown and the harvest reported `ok: true` over a leaked root process. Measured
    # 2026-07-29: after a successful pull, `wpa_supplicant -B -i wlp1s0` was still running (holding an
    # already-deleted conf) because `terminate` had failed rc=255 and nothing said so. Downloads were
    # unaffected — the next run's `-B` fails and /sys still reports the association — but a green verdict
    # over a failed step is the shape this codebase keeps finding bugs behind.
    if rc:
        # VERIFY THE CLAIM BEFORE MAKING IT. The warning below exists because of a real leak (see the
        # note above), and it must keep firing for that. But measured on the live box 2026-08-05 it also
        # fires when there is nothing to leak: `terminate` returns rc=255 "Failed to connect to
        # non-global ctrl_ifname: <iface> — No such file or directory" whenever no control socket
        # exists, which is the normal state when our supplicant already exited. That warned twice per
        # cycle, forever, about a supplicant that was not running — and a warning that cries wolf twice
        # an hour is one nobody reads, which is how the 2026-07-29 leak went unnoticed in the first place.
        #
        # So ASK. `_live_supplicants` observes the thing the sentence asserts instead of inferring it
        # from a return code, and it cannot re-introduce the old blindness: a real leak still has a
        # process bound to `-i <iface>`, and still warns.
        leaked = _live_supplicants(iface)
        detail = (out or "").strip().splitlines()[-1] if (out or "").strip() else "no output"
        if leaked:
            log.warning("cpap: wpa_cli terminate failed on %s (rc=%s, %s) — supplicant STILL RUNNING "
                        "as pid(s) %s", iface, rc, detail, ", ".join(str(p) for p in leaked))
        else:
            log.info("cpap: wpa_cli terminate returned rc=%s on %s (%s) — no supplicant is bound to it, "
                     "so there was nothing to terminate", rc, iface, detail)
    return rc == 0


def harden_profile(profile: str) -> bool:
    """nmcli backend only. Force the safety settings on every run rather than trusting whoever created
    the profile; the failure it prevents is losing the box.

      ipv4.never-default yes    the card must NEVER become the default gateway — it routes nowhere
      ipv4.ignore-auto-dns yes  a default route is not the only way to break the box: NM would install
                                the card's DHCP resolvers system-wide and name resolution dies
      ipv6.method disabled      no v6 default from the card either
      autoconnect no            it may only ever come up because this poller asked

    The wpa backend needs none of this — it installs no route and runs no DHCP client, so returns True.
    """
    if backend() != "nmcli":
        return True
    return _nmcli(["connection", "modify", profile,
                   "ipv4.never-default", "yes",
                   "ipv4.ignore-auto-dns", "yes",
                   "ipv6.method", "disabled",
                   "connection.autoconnect", "no"], 20.0)


def wifi_up(profile: str, timeout: float = 45.0, guard_dev: str | None = None,
            ssid: str = "ez Share", psk: str = "88888888",
            iface: str | None = None, addr: str = WPA_ADDR, root: str | None = None) -> bool:
    """Associate to the card, then PROVE the box's lifeline survived it.

    `guard_dev` is the default-route interface observed before associating. If the default route moves
    (or disappears), the association is torn down and this returns False — we would rather skip a day of
    CPAP files than strand the box on a network with no route out. The guard runs for BOTH backends:
    the wpa path cannot install a route by construction, but verifying beats reasoning about it.

    `iface` defaults to the box's first `wl*` rather than a literal (§E5); pass `cpap.wifi_iface` to
    override. It FAILS FAST with a reason naming the interface, because the previous behaviour was to
    fail deep inside `ip link` and be reported as a `wifi_profile` problem — a setting the wpa branch
    never reads."""
    iface = iface or default_wifi_iface()
    if backend() == "nmcli":
        harden_profile(profile)
        if not _nmcli(["connection", "up", profile], timeout):
            return False
    else:
        if not os.path.isdir(os.path.join(SYS_NET, iface)):
            log.error("cpap: Wi-Fi interface %r does not exist on this box (wpa backend, so "
                      "`wifi_profile` is not consulted) — set `cpap.wifi_iface`", iface)
            return False
        if not _wpa_up(iface, ssid, psk, addr, timeout, root):
            return False
    if guard_dev is None:
        return True
    now = default_route_dev()
    if now != guard_dev:
        log.error("cpap: default route moved %r -> %r after associating — tearing down, the card must "
                  "never carry the default route", guard_dev, now)
        wifi_down(profile, iface=iface)
        return False
    return True


def wifi_down(profile: str, timeout: float = 30.0, iface: str | None = None, root: str | None = None) -> bool:
    """Drop the association. Safe to call when already down — the poller calls this on the way in as
    well as the way out, so a run killed mid-transfer cannot leave the card associated indefinitely."""
    if backend() == "nmcli":
        return _nmcli(["connection", "down", profile], timeout)
    return _wpa_down(iface or default_wifi_iface(), root)


def _nmcli(args: list[str], timeout: float) -> bool:
    rc, _out = _sh(["nmcli", *args], timeout)
    return rc == 0


def harvest(dest_root: str, base: str = DEFAULT_BASE, nights: set[str] | None = None,
            deadline: float | None = None, ignore=DEFAULT_IGNORE,
            timeout: float = 20.0, retries: int = 5) -> dict:
    """Mirror the card into `dest_root`, preserving the native ResMed layout verbatim (card-root files,
    SETTINGS/, DATALOG/<YYYYMMDD>/). §7's integration contract requires the vendor layout so files route
    with NO new parser branch, and the harvester must not rename, flatten or re-stamp anything — the EDF
    header carries its own start datetime and is the only clock authority (`CLAUDE.md` §🔒).

    `deadline` is a monotonic wall-clock cap; when it passes the run stops CLEANLY and reports partial.
    A truncated run is fine — skip-if-present resumes tomorrow. A run that never returns is not.
    """
    ez = EzShare(base, timeout=timeout, retries=retries, ignore=ignore)
    # `nights` is a COUNT and stays one — it is published into STATUS and rendered by the monitor, and
    # `test_webmon_state_contract` pins the shape of what the state endpoint serves. `night_keys` is the
    # same fact as a LIST, added as a SIBLING rather than by widening `nights`, for exactly the reason
    # `cpap_live` is a sibling of `cpap`: a consumer reading the old key must keep getting the old type.
    # The walk already knows these names (it creates one DATALOG directory per night), so this surfaces
    # information already in hand rather than adding a second traversal — which is what the CPAP
    # inventory oracle would otherwise have to do for itself.
    st = {"files": 0, "bytes": 0, "skipped": 0, "nights": 0, "night_keys": [], "short": [], "errors": [],
          "partial": False, "nights_on_card": 0, "reaped": 0}

    def expired() -> bool:
        if deadline is not None and time.monotonic() > deadline:
            st["partial"] = True
            return True
        return False

    def pull_into(entries, subdir):
        for e in entries:
            if expired():
                return
            if e["isdir"]:
                continue
            dest = os.path.join(subdir, local_name(e["name"]))
            if not should_fetch(e, dest):
                st["skipped"] += 1
                reap_stale_part(dest, st)
                continue
            try:
                _p, n = ez.fetch(e, subdir)
            except ShortRead as ex:
                # A truncated body is NOT a fetched file: it is left as a `.part`, so the destination
                # stays absent and the next run re-fetches it. Reported under `short` (the diagnostic
                # this list has always been for) rather than only as a transport error.
                st["short"].append(str(ex))
                continue
            except Exception as ex:                    # noqa: BLE001 — one bad file must not end the run
                st["errors"].append(f"{e['name']}: {ex}")
                continue
            st["files"] += 1
            st["bytes"] += n

    root = ez.listing()
    pull_into(root, dest_root)                                       # STR.edf, Identification.*

    for e in root:                                                   # SETTINGS/
        if e["isdir"] and e["name"].upper() == "SETTINGS" and not expired():
            pull_into(ez.listing(e["href"]), os.path.join(dest_root, e["name"]))

    for e in root:                                                   # DATALOG/<night>/
        if not (e["isdir"] and e["name"].upper() == "DATALOG") or expired():
            continue
        found = [n for n in ez.listing(e["href"]) if is_night_dir(n)]
        st["nights_on_card"] = len(found)
        todo = sorted((n for n in found if not nights or n["name"] in nights),
                      key=lambda x: x["name"])
        for n in todo:
            if expired():
                break
            pull_into(ez.listing(n["href"]), os.path.join(dest_root, "DATALOG", n["name"]))
            st["nights"] += 1
            st["night_keys"].append(n["name"])
    return st
