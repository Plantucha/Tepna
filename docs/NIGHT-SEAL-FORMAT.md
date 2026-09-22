# `tepna-seal/1` — the sealed-night format

**Status:** REFERENCE (living; format FROZEN at `tepna-seal/1` on 2026-09-21 — any change bumps the version) · **Created:** 2026-09-21 · **Source:** `briefs/CAPTURE-NIGHT-SEAL-2026-09-21-BRIEF.md` §2, §3, §6

One self-protecting file per night, carrier-agnostic: a cloud listing, a USB drive, an email attachment
or a phone share all carry it unchanged, and a reader with the patient's **card** verifies and opens it
with WebCrypto primitives alone. This page is the executable contract — `capture-host/sealfmt.py` echoes
every constant below, `capture-host/seal.py` writes it, `capture-host/unseal.py` and
`tools/verify-seals.mjs` read it, and `capture-host/tests/vectors/tepna-seal-1/` pins the bytes both
readers must accept. §2 of the brief is the design; this is the byte layout it left to the implementer,
each choice with its reason.

## 1 · File

Name: `<boxId>-<YYYY-MM-DD>.tepna`. Layout, in order, all integers big-endian:

| bytes | field | notes |
|---|---|---|
| 9 | magic `TEPNASEAL` | ASCII |
| 1 | version `1` | u8; a reader that knows only 1 refuses anything else by name (`version`) |
| 4 | header length | u32 |
| … | **clear header** | JSON, UTF-8, compact, keys sorted (§2 below). Readable with no key |
| 2 | signature length | u16 — always 64 for this version |
| 64 | **signature** | ECDSA P-256 / SHA-256, **raw `r ‖ s`** (IEEE P1363), the form WebCrypto produces and verifies |
| 8 | payload length | u64 |
| 12 | GCM nonce | |
| … | **payload** | AES-256-GCM ciphertext ‖ 16-byte tag over `zip(bag)`, **AAD = the clear-header bytes** |

**What the signature covers:** the message is `header-bytes ‖ SHA-256(payload)` where `payload` is
nonce ‖ ciphertext ‖ tag exactly as stored. The signer hashes that message once and signs the digest
(RFC 6979 deterministic ECDSA — the signature depends on key and message only, so a weak RNG cannot leak
the key and a test re-seal is byte-identical); WebCrypto's `verify({name:"ECDSA", hash:"SHA-256"})` hashes
its input once and checks, so the browser passes the same message. **The header bytes on disk are the
signed bytes** — a reader hashes what it read and never re-serialises. ECDSA verification is indifferent
to how `r ‖ s` was produced: an RFC 6979 signature and a randomised one verify identically, so phase C's
WebCrypto reader needs no special case for the deterministic signer.

**Why AAD:** binding the ciphertext to the header means a forged header fails at the GCM tag as well as
at the signature. It costs nothing and removes a class of header-swap experiments.

## 2 · Clear header

```json
{"anchor":null,"boxId":"S8AW2100","boxKey":"BASE64(raw P-256 point, 65 bytes)",
 "boxKeyFingerprint":"sha256/…","bytes":828698,"closedAt":1789977600000,"consent":null,
 "files":3,"format":"tepna-seal/1","keyId":1,"night":"2026-09-20",
 "recipients":[{"keyId":1,"kind":"card","wrap":"AES-KW","wrapped":"BASE64(40 bytes)"}],"revision":1}
```

- `format` — exactly `tepna-seal/1`.
- `boxId`, `night` — the file name's two halves.
- `closedAt` — floating `tMs` per the Clock Contract (local civil time encoded as if UTC).
- `files`, `bytes` — the bag's `data/` count and byte total (also `Payload-Oxum` inside).
- `keyId` — the card-key version; a rotated card is `keyId+1` and old nights stay under theirs.
- `boxKey` — the box's P-256 public key as the **raw uncompressed point** (`04 ‖ X ‖ Y`, 65 bytes, what
  WebCrypto exports as `"raw"`), base64. In the clear so the **fingerprint pin** runs before any key
  material is touched.
- `boxKeyFingerprint` — `sha256/<hex>` over those 65 bytes. Printed on the card; a reader **pins** to the
  card's value and refuses a file whose key hashes to anything else (`fingerprint`), whatever its signature.
- `recipients[]` — an envelope; v1 ships the card recipient only. `wrapped` is the 32-byte data key
  under **AES-KW (RFC 3394)** with the KEK below → 40 bytes. A clinic ECDH recipient slots in later
  without a format break.
- `consent` — `"yes"` | `"no"` | `null`. **`null` means not asked**; a reader that finds the field absent
  reads `null` and never `"no"` (§∅ applies to consent). Mirrored from `bag-info.txt`.
- `revision` — the re-issue counter (brief §4). In the clear so a stale re-issue presented after a newer
  one is refused (`revision`) before decryption. A seal is never patched; it is re-issued whole.
- `anchor` — an RFC 3161 token or OpenTimestamps proof over the signature when the box happened to be
  online at close; `null` otherwise. Recorded, never fabricated, never a blocker.

## 3 · Keys

| key | size | source | derivation |
|---|---|---|---|
| card key | 128 bit | random at box setup; printed as 26 Crockford base32 symbols in groups of four, 2 zero padding bits | — |
| KEK | 256 bit | HKDF-SHA-256 | `ikm = card key`, `salt = UTF-8(boxId) ‖ UTF-8(str(keyId))`, `info = "tepna-seal/1 card-kek"` |
| data key | 256 bit | random per seal (production) | wrapped with AES-KW under the KEK → `recipients[].wrapped` |
| box signing key | P-256 | generated at first boot, private half never leaves the box | fingerprint above |

**Card code.** 128 bits → 130 bits with two trailing zero bits → 26 symbols of the Crockford alphabet
`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, printed `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX`. Decoding accepts any
case, ignores hyphens and spaces, maps `I`/`L`→`1` and `O`→`0`, and refuses non-zero padding.

## 4 · Payload — a BagIt 1.0 bag, zipped deterministically

Inside the ciphertext is a zip of a plain **BagIt 1.0** bag (RFC 8493): `bagit.txt`, `bag-info.txt`,
`manifest-sha256.txt`, `tagmanifest-sha256.txt`, `data/<the night's files exactly as the box wrote
them>`. The bag is the deposit-grade unit (brief §8); the seal is only its envelope.

`bag-info.txt` carries `Payload-Oxum: <bytes>.<files>`, `Bagging-Date`, `Source-Organization: Tepna box
<boxId>`, `Tepna-Box-Id`, `Tepna-Night`, `Tepna-Research-Consent: yes|no|null`, `Tepna-Seal-Revision`, and
capture-host version and git sha, keys sorted.

**The zip is deterministic**: entries in sorted order, every `date_time` = 1980-01-01 00:00:00, deflate
level 6, no extra fields, mode 0644. That is what makes a test re-seal byte-identical, and deflate is what
a browser reads back with `DecompressionStream("deflate-raw")` — no vendored zip library on either side.

## 5 · Verification order, and what each step refuses

A reader checks in this order and refuses **by name** — `SealRefused(kind, detail)` in Python, the same
`kind` vocabulary in Node, and both emit one `tepna.verdict/1` object (`FAIL` with `reason = "<kind>:
<detail>"`; `NOT_RUN` when the file cannot be read; `PASS` with what is inside):

| step | refusal kind | the brief's plant it guards |
|---|---|---|
| magic, version | `magic`, `version` | — |
| header parse, `format` | `header` | — |
| `boxKey` hashes to the **pinned** fingerprint | `fingerprint` | a valid-looking signature from an unknown key |
| ECDSA over header ‖ SHA-256(payload) | `signature` | a forged header over the correct payload |
| `revision` ≥ newest already seen | `revision` | a stale revision presented after a newer one |
| AES-KW unwrap of the data key | `card-key` | wrong card key |
| AES-GCM tag (AAD = header) | `payload` | — |
| zip structure, tag files present and UTF-8 | `zip` | — |
| `Payload-Oxum` vs `data/` — **before any hashing** | `oxum` | a truncated payload |
| `tagmanifest-sha256.txt`, then `manifest-sha256.txt` | `manifest:<path>` | one flipped byte in one stream — reds **that stream's name** |
| `consent` absent | *not a refusal* — reads `null` | `consent` absent must read `null`, never `"no"` |

## 6 · Test vectors and determinism

`capture-host/tests/vectors/tepna-seal-1/` holds a TEST P-256 key pair, the TEST card key
(`000102…0f`, code `000G-40R4-0M30-E209-185G-R38E-1W`), the sealed synthetic night
`TESTBOX0-2026-09-20.tepna` (three tracked `uploads/synthetic_*` files) and `expected.json`.
`tools/seal_vectors.py` regenerates them; `tests/test_seal.py` asserts the regeneration is byte-identical
and judges **both** readers on the vector and on the seven plants; `tools/verify-seals.mjs --vectors` is
the Node self-check in `npm run check`.

**Determinism is a test property, not a production one.** With `deterministic_from=<test card key>` the
sealer derives the nonce and the data key from that key (`info = "tepna-seal/1 TEST nonce"` /
`"… TEST datakey"`, distinct from the KEK info so a nonce can never collide with a key). Production draws
both from `os.urandom`. The test material is committed on purpose and is worthless for anything else.

## 7 · What phase A does not do

Seal at night close, the atomic outbox write on the box, revision re-issue, the card PDF and the consent
question at setup, key generation at first boot — phase B (Wren, deploy owner-authorized). The browser
reader — phase C. The `anchor` acquisition — phase E. This page freezes the bytes those phases produce and
read.
