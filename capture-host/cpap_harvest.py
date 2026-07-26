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
    """The listing's human size as KB. Tolerates '2229KB', '1.5MB', '832B', ''."""
    digits = "".join(c for c in (s or "") if c.isdigit() or c == ".")
    if not digits:
        return 0.0
    v, u = float(digits), (s or "").upper()
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


def should_fetch(entry: dict, dest_path: str) -> bool:
    """Skip-if-present on name + approximate size. Makes the steady state nearly free (one night ≈ 2.5 MB
    ≈ 20 s) and lets an interrupted backfill resume. Size is compared loosely because the listing reports
    rounded KB. A file that is present but the WRONG size is re-fetched, not trusted."""
    want = size_kb(entry.get("size", ""))
    if not os.path.exists(dest_path):
        return True
    if want <= 0:
        return False
    have = os.path.getsize(dest_path) / 1024.0
    return abs(have - want) > max(1.0, want * 0.02)


def short_read(entry: dict, got_bytes: int) -> bool:
    """True when a download is materially smaller than the listing promised — i.e. the card truncated
    under load. A short read is NOT a valid file; accepting one writes a corrupt EDF that parses far
    enough to look real. Same class as the part-decoded PMD frame in `VIGIL-HARDENING-III §1`."""
    want = size_kb(entry.get("size", ""))
    if want <= 0:
        return False
    return abs(got_bytes / 1024.0 - want) > max(2.0, want * 0.05)


def due_now(now: _dt.datetime, at_hour: int, last_run_date) -> bool:
    """Fire once per calendar day, at or after `at_hour` local. Deliberately a wall clock rather than an
    event trigger off night completion: a fixed hour well clear of both therapy and capture is simpler to
    reason about and to audit after the fact. A missed day self-heals — the next run's skip-if-present
    backfill picks up whatever was not pulled, with no catch-up special case."""
    return now.hour >= int(at_hour) and last_run_date != now.date()


def is_night_dir(entry: dict) -> bool:
    return bool(entry.get("isdir")) and bool(_NIGHT.fullmatch(entry.get("name", "")))


def blocking_devices(status_devices: dict) -> list[str]:
    """Devices that must stop the harvest. ANY connected sensor blocks it — mirrors `autopull_poller`'s
    "never interrupt a live capture" and `_OXYII_PAUSE`. Returns names so the skip can say WHICH."""
    return sorted(n for n, st in (status_devices or {}).items() if (st or {}).get("connected"))


# ── IO ──────────────────────────────────────────────────────────────────────────────────────────────
class EzShare:
    """Thin bounded HTTP client for the card. Every request has a timeout and capped retries."""

    def __init__(self, base: str = DEFAULT_BASE, timeout: float = 20.0, retries: int = 5,
                 delay: float = 0.15, ignore=DEFAULT_IGNORE):
        self.base, self.timeout, self.retries, self.delay = base.rstrip("/"), timeout, max(1, retries), delay
        self.ignore = tuple(ignore)

    def _get(self, url: str) -> bytes:
        last = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(url, timeout=self.timeout) as r:
                    return r.read()
            except Exception as e:                     # noqa: BLE001 — every transport error is retryable
                last = e
                time.sleep(0.4 * (attempt + 1))
        raise RuntimeError(f"{url}: {last}")

    def listing(self, href: str = "dir?dir=A:") -> list[dict]:
        url = urllib.parse.urljoin(self.base + "/", href)
        return parse_listing(self._get(url).decode("utf-8", "replace"), self.ignore)

    def fetch(self, entry: dict, dest_dir: str) -> tuple[str, int, bool]:
        """Download one entry. Returns (path, bytes, was_short). Writes via a .part temp then renames, so
        an interrupted run can never leave a truncated file that skip-if-present would later accept."""
        dest = os.path.join(dest_dir, local_name(entry["name"]))
        os.makedirs(dest_dir, exist_ok=True)
        data = self._get(urllib.parse.urljoin(self.base + "/", entry["href"]))
        tmp = dest + ".part"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, dest)
        time.sleep(self.delay)
        return dest, len(data), short_read(entry, len(data))


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


def _sh(argv: list[str], timeout: float, sudo: bool = False) -> tuple[int, str]:
    """Run one command, bounded, never raising. `sudo -n` (non-interactive) because this runs from a
    daemon with nobody to answer a password prompt — a missing sudoers rule must fail fast and loudly,
    not hang until the run deadline."""
    cmd = (["sudo", "-n", *argv] if sudo else argv)
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        out = ((p.stdout or "") + (p.stderr or "")).strip()
        if p.returncode:
            log.warning("cpap: %s -> rc=%d %s", " ".join(cmd[:4]), p.returncode, out[:160])
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
_WPA_CONF = 'network={{\n\tssid="{ssid}"\n\tpsk="{psk}"\n\tkey_mgmt=WPA-PSK\n\tscan_ssid=1\n}}\n'


def _wpa_up(iface: str, ssid: str, psk: str, addr: str, timeout: float) -> bool:
    import tempfile
    fd, conf = tempfile.mkstemp(prefix="tepna-ezshare-", suffix=".conf")
    try:
        os.write(fd, _WPA_CONF.format(ssid=ssid, psk=psk).encode())
        os.close(fd)
        os.chmod(conf, 0o600)                          # the PSK is in here; never world-readable
        _sh(["ip", "link", "set", iface, "up"], 10, sudo=True)
        # -B daemonises. Bound to OUR conf and OUR interface: the packaged wpa_supplicant.service may
        # also be enabled, and two supplicants driving one interface fight over the association.
        rc, out = _sh(["wpa_supplicant", "-B", "-i", iface, "-c", conf], 20, sudo=True)
        if rc:
            return False
        deadline = time.monotonic() + max(5.0, timeout)
        while time.monotonic() < deadline:             # bounded wait for association
            rc, out = _sh(["wpa_cli", "-i", iface, "status"], 8, sudo=True)
            if rc == 0 and "wpa_state=COMPLETED" in out:
                _sh(["ip", "addr", "add", addr, "dev", iface], 10, sudo=True)   # NO route, ever
                return True
            time.sleep(1.0)
        log.warning("cpap: wpa_supplicant did not associate to %r within %.0fs", ssid, timeout)
        _wpa_down(iface)
        return False
    finally:
        try:
            os.unlink(conf)                            # the PSK does not outlive the association
        except OSError:
            pass


def _wpa_down(iface: str) -> bool:
    # Order matters: drop the address first so nothing can route over a half-torn link, then kill the
    # supplicant, then down the interface. Every step is best-effort — a box that cannot tear down
    # cleanly must still not raise into the harvest task.
    _sh(["ip", "addr", "flush", "dev", iface], 10, sudo=True)
    _sh(["wpa_cli", "-i", iface, "terminate"], 10, sudo=True)
    _sh(["ip", "link", "set", iface, "down"], 10, sudo=True)
    return True


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
            iface: str = WPA_IFACE, addr: str = WPA_ADDR) -> bool:
    """Associate to the card, then PROVE the box's lifeline survived it.

    `guard_dev` is the default-route interface observed before associating. If the default route moves
    (or disappears), the association is torn down and this returns False — we would rather skip a day of
    CPAP files than strand the box on a network with no route out. The guard runs for BOTH backends:
    the wpa path cannot install a route by construction, but verifying beats reasoning about it."""
    if backend() == "nmcli":
        harden_profile(profile)
        if not _nmcli(["connection", "up", profile], timeout):
            return False
    else:
        if not _wpa_up(iface, ssid, psk, addr, timeout):
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


def wifi_down(profile: str, timeout: float = 30.0, iface: str = WPA_IFACE) -> bool:
    """Drop the association. Safe to call when already down — the poller calls this on the way in as
    well as the way out, so a run killed mid-transfer cannot leave the card associated indefinitely."""
    if backend() == "nmcli":
        return _nmcli(["connection", "down", profile], timeout)
    return _wpa_down(iface)


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
    st = {"files": 0, "bytes": 0, "skipped": 0, "nights": 0, "short": [], "errors": [],
          "partial": False, "nights_on_card": 0}

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
                continue
            try:
                _p, n, was_short = ez.fetch(e, subdir)
            except Exception as ex:                    # noqa: BLE001 — one bad file must not end the run
                st["errors"].append(f"{e['name']}: {ex}")
                continue
            st["files"] += 1
            st["bytes"] += n
            if was_short:
                st["short"].append(f"{e['name']}: listing {e['size']}, got {n / 1024:.0f}KB")

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
    return st
