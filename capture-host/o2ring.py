#!/usr/bin/env python3
# tepna-capture — o2ring.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""
o2ring.py - Wellue O2Ring S USB (HID) client. Auth is fully solved & verified.

=== TRANSPORT (measured) ===
  Device:   VID 0x1915 PID 0xF33C (Nordic HID, vendor usage page 0xFF00)
  Report:   64-byte HID reports, no report IDs. On Windows/hidapi prepend a 0x00
            report-id byte (writes become 65 bytes).
  OUT:      commands go out as HID SET_REPORT (control ep 0x00).
  IN:       replies arrive on interrupt-IN ep 0x81 as 64-byte reports.
  Frame:    [len][body...][crc]  zero-padded to 64.  len = len(body)+1.
            The len byte is NOT covered by the crc.

=== FRAME ENVELOPE (body, between len and crc) ===
  magic(0xA5, or 0xAA legacy) | op | ~op&0xFF | flag | seq | len_lo | len_hi | payload
  crc = CRC-8/SMBUS(body)   # poly 0x07, init 0, no refl, no xorout  (VERIFIED)

=== AUTH GENERATOR (VERIFIED: reproduces all captured auth frames byte-for-byte) ===
  _LEPU = md5(b"lepucloud")                       # fixed 16-byte constant
  key[0:8]   = _LEPU[0,2,4,..14]                  # even-indexed bytes
  key[8:12]  = serial ASCII (vendor app used "0000"; device wire serial 2592302100)
  key[12:16] = little-endian uint32  int(time.time())   # current unix time
  payload    = key XOR _LEPU                       # the 16-byte auth payload
  frame      = encode(0xFF, payload)               # op 0xFF = AUTH
  The ring validates the embedded timestamp against its RTC, so generate fresh
  (no replay needed). Success = the ring's screen icon flips to two-arrows.

=== ENCRYPTED HANDSHAKE (newer firmware; from the vendor SDK lepu-blepro-1.3.9, NOT yet
    seen on our ring) ===
  Rings shipped ~mid-2026 (seen: FW 1.13.1.0, branch 2D010001) ANSWER the 0xFF AUTH with a
  20-byte payload, flag == 1.  r = payload XOR _LEPU (cyclic); type = r[0]; klen = r[1];
  AES key = r[4 : 4+klen] (16 B).  From then on the ring expects EVERY request payload
  AES/ECB/PKCS5-encrypted (frame length = ciphertext length, empty payloads become one
  16-byte block) and encrypts every reply payload the same way.  The 0xFF command itself
  stays plaintext.  The SDK waits 1000 ms for that reply; silence = plaintext ring (ours:
  2D010002 never answers 0xFF).  A client that ignores the reply parses ciphertext:
  garbage serial/fw, unprintable file names, 0-byte pulls (SomnoTrace discussion #180).
  Implemented below as SESSION (module-level cipher state) — see authenticate().

Usage:
  python o2ring.py selftest                 # offline: prove crc + auth generator + AES
  python o2ring.py auth                      # generate fresh auth, send, read reply
  python o2ring.py info                      # auth + GET_INFO (serial, RTC)
  python o2ring.py list                      # auth + FILE_LIST (stored sessions)
  python o2ring.py pull <session_id> [-o f]  # auth + download one recording
  python o2ring.py pull-all [-d dir]         # download every stored recording
  python o2ring.py monitor                   # just read interrupt-IN
  python o2ring.py replay <framehex>         # send a raw frame verbatim (fallback)
  python o2ring.py probe [--sweep]           # auth, then map the USB command surface;
                                             #   safe read-only ops by default. --sweep
                                             #   tries all 0x00-0xFF (skips destructive).

NOTE: the ring REFUSES FILE_START while WORN (FILE_LIST still answers). Do the
actual download OFF-body (docked/charging). File-transfer framing below matches
the vendor BLE codec + the USB [len] wrapper; confirm on your first live pull.
"""
import argparse
import hashlib
import struct
import sys
import time

VID = 0x1915
PID = 0xF33C
REPORT_LEN = 64
_LEPU = hashlib.md5(b"lepucloud").digest()

# opcodes
OP_AUTH = 0xFF
OP_HELLO = 0xE0
OP_GET_INFO = 0xE1
OP_FILE_LIST = 0xF1
OP_FILE_START = 0xF2
OP_FILE_DATA = 0xF3
OP_FILE_END = 0xF4

# Opcodes that wipe data / power off the ring. NEVER emit these.
DESTRUCTIVE = {0xE3, 0xEE}   # 0xE3 FACTORY_RESET, 0xEE FACTORY_RESET_ALL

OP_NAMES = {
    0x00: "GET_CONFIG", 0x01: "SET_CONFIG", 0x03: "LIVE_PPG_A", 0x04: "LIVE_SAMPLES",
    0x05: "GET_RT_PPG", 0x10: "SETUP", 0x15: "poll", 0x83: "VIBRATE",
    0xC0: "SET_UTC_TIME", 0xE0: "hello", 0xE1: "GET_INFO", 0xE3: "FACTORY_RESET",
    0xE4: "GET_BATTERY", 0xEE: "FACTORY_RESET_ALL", 0xF1: "FILE_LIST",
    0xF2: "FILE_START", 0xF3: "FILE_DATA", 0xF4: "FILE_END", 0xFF: "AUTH",
}

# Read-only / non-mutating probes: (magic, op, payload). Excludes writes (SET_CONFIG,
# SET_UTC_TIME), actuators (VIBRATE), handshake-only (SETUP), and destructive ops.
PROBE_SAFE = [
    (0xA5, OP_HELLO, b""),
    (0xA5, OP_GET_INFO, b""),
    (0xA5, 0x00, b""),                  # GET_CONFIG
    (0xA5, 0xE4, b""),                  # GET_BATTERY
    (0xA5, OP_FILE_LIST, b""),
    (0xA5, 0x04, b""),                  # LIVE_SAMPLES (read/drain)
    (0xA5, 0x03, b""),                  # LIVE_PPG_A (read/drain)
    (0xA5, 0x05, bytes([0x07, 0x01])),  # GET_RT_PPG (needs these args)
    (0xAA, 0x15, b""),                  # legacy poll
]


def crc8_smbus(data: bytes) -> int:
    crc = 0
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xFF if (crc & 0x80) else (crc << 1) & 0xFF
    return crc


def encode(op: int, payload: bytes = b"", magic: int = 0xA5, flag: int = 0,
           seq: int = 0) -> bytes:
    """Build a full 64-byte report for one command."""
    n = len(payload)
    body = bytes([magic, op, (~op) & 0xFF, flag, seq, n & 0xFF, (n >> 8) & 0xFF]) + payload
    frame = bytes([len(body) + 1]) + body + bytes([crc8_smbus(body)])
    if len(frame) > REPORT_LEN:
        raise ValueError("frame exceeds 64 bytes")
    return frame.ljust(REPORT_LEN, b"\x00")


def decode(report: bytes):
    """Parse a reply report -> dict(op, flag, payload). Reply mirrors the envelope."""
    ln = report[0]
    body = report[1:1 + ln - 1]         # drop trailing crc
    if len(body) < 7:
        return {"op": None, "flag": None, "payload": body, "raw": report[:1 + ln]}
    magic, op, _nop, flag, seq, lo, hi = body[:7]
    plen = lo | (hi << 8)
    return {"magic": magic, "op": op, "flag": flag, "seq": seq,
            "payload": body[7:7 + plen], "raw": report[:1 + ln]}


def auth_payload(serial: bytes = b"0000", ts: int | None = None) -> bytes:
    ts = int(time.time()) if ts is None else ts
    key = bytearray(16)
    for i in range(8):
        key[i] = _LEPU[i * 2]
    key[8:12] = (serial + b"0000")[:4]
    key[12:16] = struct.pack("<I", ts & 0xFFFFFFFF)
    return bytes(a ^ b for a, b in zip(bytes(key), _LEPU))


def build_auth(serial: bytes = b"0000", ts: int | None = None,
               magic: int = 0xA5) -> bytes:
    return encode(OP_AUTH, auth_payload(serial, ts), magic=magic)


# ---------------------------------------------------------------- AES-ECB ------
# Self-contained AES (FIPS-197) so the client stays a single file with no crypto dependency;
# payloads are <= 512 B so speed is irrelevant. Checked against the FIPS-197 vectors in tests.

def _gen_sbox():
    sbox = [0] * 256
    p = q = 1
    while True:
        p = p ^ ((p << 1) & 0xFF) ^ (0x1B if p & 0x80 else 0)      # p *= 3 in GF(2^8)
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xFF
        if q & 0x80:
            q ^= 0x09                                             # q /= 3
        x = q ^ (q << 1) ^ (q << 2) ^ (q << 3) ^ (q << 4)         # affine transform
        sbox[p] = (x ^ (x >> 8) ^ 0x63) & 0xFF
        if p == 1:
            break
    sbox[0] = 0x63
    return sbox


_SBOX = _gen_sbox()
_INV_SBOX = [0] * 256
for _i, _v in enumerate(_SBOX):
    _INV_SBOX[_v] = _i


def _xtime(a):
    return ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else a << 1


def _gmul(a, b):
    r = 0
    while b:
        if b & 1:
            r ^= a
        a = _xtime(a)
        b >>= 1
    return r


def _expand_key(key: bytes):
    nk = len(key) // 4
    if nk not in (4, 6, 8) or len(key) % 4:
        raise ValueError("AES key must be 16, 24 or 32 bytes")
    rounds = nk + 6
    w = [list(key[i * 4:i * 4 + 4]) for i in range(nk)]
    rcon = 1
    for i in range(nk, 4 * (rounds + 1)):
        t = list(w[i - 1])
        if i % nk == 0:
            t = [_SBOX[t[1]] ^ rcon, _SBOX[t[2]], _SBOX[t[3]], _SBOX[t[0]]]
            rcon = _xtime(rcon)
        elif nk > 6 and i % nk == 4:
            t = [_SBOX[b] for b in t]
        w.append([a ^ b for a, b in zip(w[i - nk], t)])
    return [[b for word in w[r * 4:r * 4 + 4] for b in word] for r in range(rounds + 1)], rounds


def _add_round_key(s, k):
    return [a ^ b for a, b in zip(s, k)]


def _shift_rows(s):
    return [s[(i + 4 * (i % 4)) % 16] for i in range(16)]


def _inv_shift_rows(s):
    return [s[(i - 4 * (i % 4)) % 16] for i in range(16)]


def _mix_columns(s, inv=False):
    out = []
    for c in range(4):
        a = s[c * 4:c * 4 + 4]
        if inv:
            out += [_gmul(a[0], 14) ^ _gmul(a[1], 11) ^ _gmul(a[2], 13) ^ _gmul(a[3], 9),
                    _gmul(a[0], 9) ^ _gmul(a[1], 14) ^ _gmul(a[2], 11) ^ _gmul(a[3], 13),
                    _gmul(a[0], 13) ^ _gmul(a[1], 9) ^ _gmul(a[2], 14) ^ _gmul(a[3], 11),
                    _gmul(a[0], 11) ^ _gmul(a[1], 13) ^ _gmul(a[2], 9) ^ _gmul(a[3], 14)]
        else:
            out += [_gmul(a[0], 2) ^ _gmul(a[1], 3) ^ a[2] ^ a[3],
                    a[0] ^ _gmul(a[1], 2) ^ _gmul(a[2], 3) ^ a[3],
                    a[0] ^ a[1] ^ _gmul(a[2], 2) ^ _gmul(a[3], 3),
                    _gmul(a[0], 3) ^ a[1] ^ a[2] ^ _gmul(a[3], 2)]
    return out


def aes_encrypt_block(key: bytes, block: bytes) -> bytes:
    rk, rounds = _expand_key(key)
    s = _add_round_key(list(block), rk[0])
    for r in range(1, rounds + 1):
        s = [_SBOX[b] for b in s]
        s = _shift_rows(s)
        if r != rounds:
            s = _mix_columns(s)
        s = _add_round_key(s, rk[r])
    return bytes(s)


def aes_decrypt_block(key: bytes, block: bytes) -> bytes:
    rk, rounds = _expand_key(key)
    s = _add_round_key(list(block), rk[rounds])
    for r in range(rounds - 1, -1, -1):
        s = _inv_shift_rows(s)
        s = [_INV_SBOX[b] for b in s]
        s = _add_round_key(s, rk[r])
        if r != 0:
            s = _mix_columns(s, inv=True)
    return bytes(s)


def aes_ecb_encrypt(key: bytes, data: bytes) -> bytes:
    """AES/ECB/PKCS5Padding — exactly what the SDK's javax.crypto call does (empty -> 16 B)."""
    pad = 16 - len(data) % 16
    data = data + bytes([pad]) * pad
    return b"".join(aes_encrypt_block(key, data[i:i + 16]) for i in range(0, len(data), 16))


def aes_ecb_decrypt(key: bytes, data: bytes) -> bytes:
    if not data or len(data) % 16:
        raise ValueError("ciphertext length not a multiple of 16")
    out = b"".join(aes_decrypt_block(key, data[i:i + 16]) for i in range(0, len(data), 16))
    pad = out[-1]
    if not 1 <= pad <= 16 or out[-pad:] != bytes([pad]) * pad:
        raise ValueError("bad PKCS5 padding")
    return out[:-pad]


# ----------------------------------------------------------- session cipher ----

def parse_key_reply(payload: bytes):
    """Decode the 0xFF reply of a new-firmware ring -> AES key, or None if it does not look
    like one. SDK: r = payload XOR md5("lepucloud") cyclic; r[0] = type, r[1] = key length,
    key = r[4:4+len]. Only AES-valid key lengths are accepted."""
    if len(payload) < 20:
        return None
    r = bytes(b ^ _LEPU[i % 16] for i, b in enumerate(payload))
    klen = r[1]
    if klen not in (16, 24, 32) or 4 + klen > len(r):
        return None
    return r[4:4 + klen]


class Cipher:
    """Per-connection cipher state. key None = plaintext ring (all rings before ~2026-06).
    Once a key is set every request payload except AUTH is AES-encrypted and every reply
    payload is decrypted, mirroring the SDK (encrypt in the command builder when key is
    non-empty, decrypt in every response handler)."""

    def __init__(self):
        self.key = None
        self.errors = 0

    def reset(self):
        self.key = None
        self.errors = 0

    def wrap(self, op: int, payload: bytes) -> bytes:
        if self.key is None or op == OP_AUTH:
            return payload
        return aes_ecb_encrypt(self.key, payload)

    def unwrap(self, op: int, payload: bytes) -> bytes:
        if self.key is None or op == OP_AUTH:
            return payload
        if not payload or len(payload) % 16:
            return payload            # cannot be AES output — pass through untouched
        try:
            return aes_ecb_decrypt(self.key, payload)
        except ValueError:
            self.errors += 1
            print(f"  !! op=0x{op:02x}: {len(payload)} B reply did not decrypt with the session "
                  "key — passing raw payload through")
            return payload


SESSION = Cipher()


def open_device():
    import hid
    dev = hid.device()
    dev.open(VID, PID)
    dev.set_nonblocking(0)
    return dev


def send(dev, report64: bytes):
    return dev.write(b"\x00" + report64)


def send_cmd(dev, op: int, payload: bytes = b"", magic: int = 0xA5):
    """Frame + send one command, encrypting the payload when the session has a key."""
    return send(dev, encode(op, SESSION.wrap(op, payload), magic=magic))


def read_report(dev, timeout_ms=1500):
    data = dev.read(REPORT_LEN, timeout_ms)
    return bytes(data) if data else None


def read_reply(dev, want_op=None, timeout_ms=2000, tries=12):
    """Read reports until one REASSEMBLES into a frame decoding to want_op. A logical frame spans
    consecutive reports while report[0]==0x3f (63 = a full report's worth of content); ONLY the first
    report carries the a5/op header, continuation reports are raw payload bytes, so the frame is
    concat(report[1:1+report[0]]). Skips 1-byte markers and the non-a5/aa "05.." status frames the ring
    interleaves. Parses the reassembled frame directly because a large FILE_DATA payload (u16 len, up to
    512 B) overflows decode()'s single-byte length. The payload is decrypted here when the session has
    a key, so callers only ever see plaintext (and plaintext lengths)."""
    for _ in range(tries):
        rep = read_report(dev, timeout_ms)
        if not rep:
            continue
        n = rep[0]
        if n < 7 or rep[1] not in (0xA5, 0xAA):     # marker / 05.. status — not a frame start
            continue
        buf = bytearray(rep[1:1 + n])
        while n == 0x3f:                            # continued: append raw payload from next reports
            cont = read_report(dev, timeout_ms)
            if not cont:
                break
            n = cont[0]
            buf += cont[1:1 + n]
        if len(buf) < 7:
            continue
        op = buf[1]
        plen = buf[5] | (buf[6] << 8)
        msg = {"magic": buf[0], "op": op, "flag": buf[3], "seq": buf[4],
               "payload": SESSION.unwrap(op, bytes(buf[7:7 + plen]))}
        if want_op is None or op == want_op:
            return msg
    return None


def authenticate(dev, serial=b"0000", timeout_s=90, verbose=True, keyed_grace_s=5.0):
    """Old firmware (verified on hardware): AUTH is FIRE-AND-FORGET — op 0xFF never replies. The
    ring's HELLO (0xE0) reply is the auth-success ("two-arrows") signal, so the handshake is: send
    AUTH a5+aa + legacy poll + HELLO every ~1 s and return once a 0xE0 comes back. This must run
    continuously from right after enumeration — a silent gap breaks readiness.

    New firmware (SDK-derived, not seen on our ring): the ring ANSWERS 0xFF with flag=1 and a 20-byte
    key blob and switches to AES from then on. That reply used to be dropped here because we only
    looked for 0xE0. Now every frame is inspected: a key reply installs the session key (SESSION),
    after which AUTH is no longer re-sent (each AUTH may re-key) and the loop continues with
    poll + HELLO — now encrypted — until the HELLO ack. If a key was installed but no HELLO ack
    arrives within keyed_grace_s, return anyway: GET_INFO decrypting cleanly is the real proof.

    Returns the decoded HELLO reply on success, the 0xFF key reply on keyed-without-hello,
    or None on timeout."""
    SESSION.reset()
    a5 = build_auth(serial, magic=0xA5)
    aa = build_auth(serial, magic=0xAA)
    end = time.time() + timeout_s
    keyed_at = None
    key_reply = None
    while time.time() < end:
        batch = [] if SESSION.key else [a5, aa]
        batch += [encode(0x15, SESSION.wrap(0x15, b""), magic=0xAA),
                  encode(OP_HELLO, SESSION.wrap(OP_HELLO, b""))]
        for f in batch:
            send(dev, f)
        deadline = time.time() + 0.9
        while time.time() < deadline:
            rep = read_reply(dev, want_op=None, timeout_ms=900, tries=1)
            if rep is None:
                break
            if rep["op"] == OP_AUTH and rep["flag"] == 1:
                key = parse_key_reply(rep["payload"])
                if key is None:
                    if verbose:
                        print(f"AUTH reply is not a key blob: {rep['payload'].hex(' ')}")
                    continue
                if verbose and key != SESSION.key:
                    print(f"AUTH reply: encrypted-handshake ring — {len(key) * 8}-bit AES session "
                          f"key installed (blob {rep['payload'].hex(' ')})")
                SESSION.key = key
                keyed_at = keyed_at or time.time()
                key_reply = rep
                send_cmd(dev, OP_HELLO)          # the plaintext HELLO just sent is now unreadable
                continue
            if rep["op"] == OP_HELLO:
                if verbose:
                    print(f"AUTH OK — hello ack: {rep['payload'].hex(' ')}"
                          + ("  [AES session]" if SESSION.key else ""))
                return rep
        if keyed_at and time.time() - keyed_at >= keyed_grace_s:
            if verbose:
                print("AUTH: session key installed but no hello ack — proceeding (unverified path)")
            return key_reply
    return None


def file_list(dev):
    send_cmd(dev, OP_FILE_LIST)
    msg = read_reply(dev, want_op=OP_FILE_LIST)
    if not msg:
        return []
    p = msg["payload"]
    count = p[0]
    sessions = []
    for i in range(count):
        slot = p[1 + i * 16: 1 + i * 16 + 16]
        sid = slot[:14].split(b"\x00")[0].decode("ascii", "replace")
        sessions.append(sid)
    return sessions


def file_start(dev, session_id: str):
    """FILE_START payload = the 14-char session id ASCII zero-padded to 24 bytes (vendor-verified;
    NOT ts14 + 0x0000 + ftype). Reply carries the file size as u32 LE at payload[0:4]. The ring
    REFUSES FILE_START while worn — pull off-body."""
    payload = session_id.encode("ascii")[:14].ljust(24, b"\x00")
    send_cmd(dev, OP_FILE_START, payload)
    return read_reply(dev, want_op=OP_FILE_START)


def file_data(dev, offset: int):
    send_cmd(dev, OP_FILE_DATA, struct.pack("<I", offset))
    return read_reply(dev, want_op=OP_FILE_DATA)


def file_end(dev):
    send_cmd(dev, OP_FILE_END)
    return read_reply(dev, want_op=OP_FILE_END, timeout_ms=1000)


OXY_TRAILER_MAGIC = bytes.fromhex("48125ada")   # at trailer[4:8]; marks a complete file


def _emit_csv(dat_path: str):
    """Decode a saved .dat to CSV next to it (best-effort; parse_dat is optional)."""
    try:
        import parse_dat
    except ImportError:
        print("  (parse_dat.py not importable; skipping CSV)")
        return
    with open(dat_path, "rb") as fh:
        data = fh.read()
    meta, samples, trailer = parse_dat.parse_oxy_dat(data)
    start_dt = parse_dat.oxy_start_dt(dat_path)
    csv_path = dat_path.rsplit(".", 1)[0] + ".csv"
    parse_dat.write_csv(csv_path, samples, start_dt)
    print(f"  CSV: {csv_path}  ({meta['n_samples']} samples @1Hz)")
    if trailer:
        ok, _ = parse_dat.self_consistency(samples, trailer)
        print(f"  trailer: avg_spo2={trailer['avg_spo2']} min={trailer['min_spo2']} "
              f"avg_hr={trailer['avg_hr']} dur={trailer['total_seconds']}s  "
              f"self-consistency={'PASS' if ok else 'CHECK header offset'}")


def pull_session(dev, session_id: str, max_bytes=8 * 1024 * 1024):
    st = file_start(dev, session_id)
    if not st:
        raise RuntimeError("FILE_START timed out (is the ring OFF-body / docked?)")
    # FILE_START reply typically carries the file size (u32 LE) at payload[0:4].
    size = struct.unpack_from("<I", st["payload"], 0)[0] if len(st["payload"]) >= 4 else None
    print(f"  FILE_START reply: {st['payload'].hex(' ')}  size={size}")
    buf = bytearray()
    offset = 0
    while offset < (size or max_bytes) and offset < max_bytes:
        msg = file_data(dev, offset)
        if not msg or not msg["payload"]:
            break
        chunk = msg["payload"]          # plaintext (read_reply already decrypted): offsets = file bytes
        buf += chunk
        offset += len(chunk)
        if size and offset >= size:
            break
    file_end(dev)
    data = bytes(buf[:size]) if size else bytes(buf)   # cap at size: over-reading scrambles the trailer
    complete = len(data) >= 48 and data[-48 + 4:-48 + 8] == OXY_TRAILER_MAGIC
    print(f"  pulled {len(data)} bytes  complete-trailer={complete}")
    return data


def _probe_one(dev, magic, op, payload, quiet_empty=False):
    """Send one opcode, print whatever comes back. Best-effort (probe)."""
    send_cmd(dev, op, payload, magic=magic)
    msg = read_reply(dev, want_op=None, timeout_ms=800, tries=4)
    name = OP_NAMES.get(op, "?")
    if msg is None:
        if not quiet_empty:
            print(f"  magic={magic:#04x} op=0x{op:02x} {name:14s} -> (no reply)")
        return
    pl = msg["payload"]
    print(f"  magic={magic:#04x} op=0x{op:02x} {name:14s} -> flag={msg.get('flag')} "
          f"len={len(pl)} payload={pl[:32].hex(' ')}")


def cmd_probe(dev, sweep=False):
    """Authenticate, then map the USB command surface. Never emits DESTRUCTIVE ops."""
    authenticate(dev)
    print("=== safe read-only probe ===")
    for magic, op, payload in PROBE_SAFE:
        _probe_one(dev, magic, op, payload)
    if sweep:
        print("=== full opcode sweep 0x00-0xFF (empty payload) ===")
        print("!! WARNING: blindly probing undocumented opcodes may hit state-changing "
              "commands. Known destructive ops are skipped, but unknown ones cannot be. !!")
        probed = {op for _, op, _ in PROBE_SAFE}
        for op in range(256):
            if op in DESTRUCTIVE:
                print(f"  op=0x{op:02x} {OP_NAMES.get(op, ''):14s} -> SKIPPED (destructive)")
                continue
            if op in probed:
                continue
            _probe_one(dev, 0xA5, op, b"", quiet_empty=True)


def cmd_selftest():  # pragma: no cover  (offline self-demo; see tests/ for coverage)
    ok = True
    # auth generator: reproduce a captured frame exactly (aa-variant, ts=1788096060)
    got = build_auth(b"0000", ts=1788096060, magic=0xAA)
    want = bytes.fromhex("18aaff00000010000068158872091cb098c8c7daf86da199b4")
    a = got[:len(want)] == want
    ok &= a
    print(f"auth aa-variant ts=1788096060 -> {'OK' if a else 'FAIL'}")
    print(f"   got : {got[:25].hex(' ')}")
    print(f"   want: {want.hex(' ')}")
    # a5-variant frame 157 (ts=1788095920)
    got2 = build_auth(b"0000", ts=1788095920, magic=0xA5)
    want2 = bytes.fromhex("18a5ff00000010000068158872091cb098c8c7da746ea19925")
    b = got2[:len(want2)] == want2
    ok &= b
    print(f"auth a5-variant ts=1788095920 -> {'OK' if b else 'FAIL'}")
    print(f"   got : {got2[:25].hex(' ')}")
    print(f"   want: {want2.hex(' ')}")
    # AES-128 against FIPS-197 Appendix C.1
    ct = aes_encrypt_block(bytes(range(16)), bytes.fromhex("00112233445566778899aabbccddeeff"))
    c = ct == bytes.fromhex("69c4e0d86a7b0430d8cdb78070b4c55a")
    ok &= c
    print(f"AES-128 FIPS-197 C.1 -> {'OK' if c else 'FAIL'}  ({ct.hex()})")
    print("SELFTEST", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("selftest")
    sub.add_parser("auth")
    sub.add_parser("info")
    sub.add_parser("list")
    p = sub.add_parser("pull"); p.add_argument("session_id"); p.add_argument("-o", "--out")
    pa = sub.add_parser("pull-all"); pa.add_argument("-d", "--dir", default=".")
    m = sub.add_parser("monitor"); m.add_argument("--seconds", type=float, default=10)
    r = sub.add_parser("replay"); r.add_argument("frame_hex")
    pr = sub.add_parser("probe"); pr.add_argument("--sweep", action="store_true")
    a = ap.parse_args()
    a_serial = b"0000"

    if a.cmd == "selftest":
        sys.exit(cmd_selftest())

    dev = open_device()
    try:
        if a.cmd == "monitor":
            end = time.time() + a.seconds
            while time.time() < end:
                rep = read_report(dev, 500)
                if rep:
                    print("IN:", rep[:rep[0] + 1].hex(' '))
            return
        if a.cmd == "replay":
            raw = bytes.fromhex(a.frame_hex.replace(" ", "")).ljust(REPORT_LEN, b"\x00")
            op = raw[2] if len(raw) > 2 else None   # report[0]=len,[1]=magic,[2]=op
            if op in DESTRUCTIVE:
                print(f"REFUSED: opcode 0x{op:02x} ({OP_NAMES.get(op, '?')}) is destructive "
                      "(factory reset / power-off) — not sent.")
                return
            send(dev, raw)                          # verbatim: never encrypted
            r = read_reply(dev)
            print("reply:", r["payload"].hex(' ') if r else "(none)")
            return
        if a.cmd == "probe":
            cmd_probe(dev, sweep=a.sweep)
            return

        authenticate(dev, a_serial)      # every session starts with a fresh auth

        if a.cmd == "auth":
            return
        if a.cmd == "info":
            send_cmd(dev, OP_GET_INFO)
            msg = read_reply(dev, want_op=OP_GET_INFO)
            p = msg["payload"] if msg else b""
            print("GET_INFO payload:", p.hex(' '))
            # RTC at payload[24:31] = year(u16 LE),mon,day,hr,min,sec (local civil)
            if len(p) >= 31:
                y = p[24] | (p[25] << 8)
                print(f"  RTC = {y:04d}-{p[26]:02d}-{p[27]:02d} {p[28]:02d}:{p[29]:02d}:{p[30]:02d} (local)")
            return
        if a.cmd == "list":
            for sid in file_list(dev):
                print("session:", sid)
            return
        if a.cmd == "pull":
            data = pull_session(dev, a.session_id)
            out = a.out or f"{a.session_id}.dat"
            with open(out, "wb") as fh:
                fh.write(data)
            print("saved", out)
            _emit_csv(out)
            return
        if a.cmd == "pull-all":
            import os
            for sid in file_list(dev):
                print("pulling", sid)
                data = pull_session(dev, sid)
                path = os.path.join(a.dir, f"{sid}.dat")
                with open(path, "wb") as fh:
                    fh.write(data)
                print("saved", path)
                _emit_csv(path)
    finally:
        dev.close()

if __name__ == "__main__":  # pragma: no cover
    main()
