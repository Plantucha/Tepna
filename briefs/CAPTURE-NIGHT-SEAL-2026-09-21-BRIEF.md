<!-- SPDX-License-Identifier: Apache-2.0 · Copyright 2026 Michal Planicka -->
**Status:** IN-PROGRESS (phase A landed 2026-09-21 — format frozen, vectors on main; **phase C landed #2812 2026-09-22** — `night-seal.js`, the in-page reader (WebCrypto + `DecompressionStream`, no vendored code), wired into OverDex's file input with the card prompt, IndexedDB per (boxId, keyId), the provenance badge and one `tepna.verdict/1` per seal; judged on the SAME vector and eight plants as the Python and Node readers in the node lane AND a `browser-gates` leg; the ~~four~~ (superseded 2026-09-25 — see the later clause; #2812's body names five sealer-built plants) sealer-built plants are now committed vectors under `plants/` ⚠️ **COUNT CHECKED 2026-09-25 (triage): `plants/expected.json` enumerates FIVE committed plant vectors, each with a file and a sha256 — `consent absent`, `consent disagrees`, `flipped byte in one stream`, `truncated payload`, `unknown signing key`. Either a fifth plant landed after this clause was written, or one of the five is not sealer-built and the clause should name which. Not resolved here: the enumeration is the evidence, the count is not, and I could not tell from the tree which of the five the word "sealer-built" excludes.**. B may proceed; D follows C) · **Created:** 2026-09-21 · **Interlocks:** `CORPUS-TIER-30-NIGHTS-2026-09-20-BRIEF.md` (dev-only tiering this brief scopes out of deployment) · `SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md` (sidecars travel inside the seal) · `LITERATURE-USE-POLICY-2026-07-11-BRIEF.md` (§10 citations) · owner design session 2026-09-21 (this brief is its transcript, condensed)

# CAPTURE-NIGHT-SEAL — one self-protecting file per night, carrier-agnostic

> **Premise (owner, 2026-09-21).** Deployment is NOT the development setup. There is no TrueNAS, no
> Tailscale, no relay Tepna operates. A deployed box sits on a patient's home Internet (or none), the
> archive is an external NTFS drive or a consumer cloud folder (Drive / OneDrive / Dropbox), and the
> reader is a clinician's generic PC opening a local Dex `.html`. Every design choice below follows
> from that premise; re-derive it before changing one.

## 0 · The one idea

**Make the artifact self-protecting so the transport does not have to be trusted.** A night leaves the
box as ONE file that carries its own integrity (per-file SHA-256 manifest), authenticity (per-box
signature), and confidentiality (encryption under a key the patient holds on a card). Then it can travel
over anything — an NTFS drive, an email, a sync client, a share link, a later outbound push — and the
Dex verifies it on open regardless of how it arrived. Nothing in the chain between the box and the Dex
needs to be secured, operated, or trusted, and nothing on the box ever listens on a port.

This is the pattern the field already uses, under three names (§10): digital preservation calls the
manifest a **bag** (BagIt, RFC 8493 — "fixity travels with the transfer"); regulated health data calls
the signature **ALCOA+ / DICOM PS3.15 digital signatures**; supply-chain security calls the off-box
proof a **transparency log** (Sigstore/Rekor). This brief composes them; it invents no cryptography.

## 1 · Why now, measured

- The repo hashes at four hops (`cpap_spool.py` per round, `oxy_transfer.py` per pull, `corpus-tier.mjs`
  local-vs-NAS, the 2026-09-21 one-off byte audit #2784) and **nowhere at night close** — the only point
  where the writer that owns the bytes knows they are complete. `doc-search` 2026-09-21: no prior brief.
- Two defects this month were transport corruption that a close-time manifest catches for free: the
  0-byte rsync temp file under `vigil-captures/2026-09-02` (#2784) and the 29 zero-byte markers that
  `corpus-tier` refused on its first run (#2780).
- §∅ says *captured bytes are immutable*. Today that is a rule; a signed manifest makes it **checkable**.
- Every deployment target named in the premise has zero integrity of its own: NTFS has no checksums,
  USB drives fail on unsafe removal, sync clients upload piecemeal and mangle names, and consumer cloud
  accounts are not HIPAA/GDPR-processor grade. The manifest is therefore the ONLY integrity layer that
  will exist in deployment, not belt-and-braces over ZFS.

## 2 · The sealed night — format `tepna-seal/1`

File name: `<boxId>-<YYYY-MM-DD>.tepna` (e.g. `S8AW2100-2026-09-20.tepna`). Layout, in order:

```
┌ magic "TEPNASEAL" + u8 version 1
├ clear header, JSON, UTF-8, length-prefixed (~300 B):
│   { format:"tepna-seal/1", boxId, night:"YYYY-MM-DD", closedAt (floating tMs per Clock Contract),
│     files:N, bytes:M, keyId:1, boxKeyFingerprint:"sha256/…", recipients:[{kind:"card",keyId:1}],
│     consent: "yes"|"no"|null, anchor: <RFC3161 token | OTS proof | null> }
├ signature: ECDSA P-256 / SHA-256 over (header bytes ‖ SHA-256(payload)), per-box key
└ payload: AES-256-GCM( zip( BagIt bag ) )   — nonce + tag per AES-GCM; data key wrapped per recipient
```

- **Inside the payload is a plain BagIt bag** (RFC 8493): `bagit.txt`, `bag-info.txt`, `manifest-sha256.txt`,
  `tagmanifest-sha256.txt`, `data/<the night's files exactly as the box wrote them>`. `bag-info.txt` carries
  `Payload-Oxum` (bytes.files — the cheap completeness check for removable media), `Bagging-Date`,
  `Source-Organization: Tepna box <boxId>`, capture-host version and git sha, device inventory, and the
  two fields below. The bag is the deposit-grade unit (§8); the seal is only its envelope.
- **`Tepna-Research-Consent: yes | no | null`** in `bag-info.txt` and mirrored in the clear header. `null`
  means *not asked* — never a default `no` wearing the shape of an answer (§∅ applies to consent). Asked once
  at box setup, beside the card (§3). Without this field every deployed night is unusable for §8.
- **Clear header is deliberately readable without a key**: a cloud listing, a drive, an email attachment
  shows *what it is* (box, night, size, consent) and the Dex can say "night 2026-09-20 from box S8AW2100 —
  enter its code" before decrypting. Nothing a scanner or a stranger could misuse is outside the envelope.
- **Signature key is per box**, P-256, generated at first boot, private half never leaves the box. P-256
  rather than Ed25519 because WebCrypto ECDSA P-256 verifies in every shipping browser today; Ed25519 in
  WebCrypto landed in all three engines in 2025 but "a clinician's generic PC" is the floor. Fingerprint
  printed on the card so the Dex can **pin** the key from the card rather than trust first sight.
- **`keyId` versions the card key**; a rotated card leaves old nights readable under their own version.
  **`recipients[]` is an envelope** — v1 ships with the card key only; a clinic public key (ECDH P-256 wrapped
  data key) slots in later with no format break (§9). `tepna-seal/1` is FROZEN once shipped; changes bump it.
- **`anchor`** is an RFC 3161 timestamp token or an OpenTimestamps proof over the signature, obtained only
  when the box happens to have outbound network at close; `null` otherwise — recorded, never fabricated,
  never a blocker. It is the one thing a compromised box cannot forge retroactively.

## 3 · The patient card — pairing without a password

Passphrases fail the patient (forgotten ⇒ 30 nights gone by design) and annoy the clinician. Deployed
medical devices pair with **cards**, and so does this:

- At box setup the box generates a 128-bit random card key and saves a **card PDF** to `outbox/`:
  box id · `keyId` · the key as a 26-character base32 code in groups of four (Crockford alphabet, no
  ambiguous letters) · the signing-key fingerprint · the same as a QR. The box has no printer — the patient
  prints it or photographs it; a phone photo is a valid card.
- The Dex asks for the code the first time it meets a `boxId`, stores it in IndexedDB keyed by
  `(boxId, keyId)`, and never asks again on that PC. Typed works in every browser; the native
  `BarcodeDetector` API scans the QR on Chromium desktops with a webcam (no vendored decoder — Firefox and
  Safari desktop fall back to typing).
- **Lost card** → the box re-displays it (the box already holds the plaintext; this adds no exposure).
  **Stolen card** → the box rotates to `keyId+1`; old nights stay under their version.
- **Honest strength:** "something you have," same class as BitLocker To Go. Protects against every transport
  threat in the premise — lost drive, cloud leak, wrong share link, curious sync provider. Does NOT protect
  against an adversary holding both the file and the card. That is the correct level for v1 and is what the
  deployed devices do. Stronger options and why they are not v1: NFC (Web NFC is Android-Chrome only; no
  desktop reader), FIDO2/passkey with the PRF extension (WebAuthn needs a domain as relying party and
  **does not run from a `file://` page**, which every Dex is), rotating tokens (a sealed file needs a stable
  key). The passkey path becomes viable only if Dexes are ever served from a domain — §9.

## 4 · Box side — offline by construction

- At night close (the same point the end-of-night back-check runs, #2315): bag → zip → sign → encrypt →
  write `outbox/<boxId>-<night>.tepna` **atomically** (temp + rename, so a sync client never uploads a
  half-written seal). The unsealed night stays on local disk as the evidence record (§∅ immutable) under
  the owner's 30-day retention ruling.
- Post-close writers (back-check sidecars, late device pulls) produce **a re-issued seal** of the same
  night with `bag-info.txt`'s `Tepna-Seal-Revision: 2`; the previous file is kept until the new one is
  verified, then replaced. A seal is never patched in place.
- `outbox/` is a plain folder. The patient points a sync client at it, copies it to a drive, or shares
  from the phone. **The box never talks to a cloud API, never listens on a port, and Tepna operates no
  server.** The sync client acts on the patient's own account under the patient's own consent, which keeps
  Tepna out of the data-processor role. Later, optional (§9): outbound push of already-sealed files.
- Card + consent question at setup (§3, §2). `seal.py` / `unseal.py` in `capture-host/`, under `check.sh`
  (100 % coverage floor applies), `unseal.py` refusing loudly on every plant in §6.

## 5 · Dex side — verify on open, no vendored code

- OverDex's existing file input (`overdex-walk.js`) accepts `.tepna`; per-node Dexes follow. Pipeline in
  page: read clear header → ask/recall card key → derive (HKDF-SHA-256 from the card key, salt = boxId ‖
  keyId) → AES-GCM decrypt (WebCrypto) → inflate entries with the browser-native
  `DecompressionStream('deflate-raw')` → parse the zip central directory (~40 lines; `manifest-gate.js`
  already hashes with `crypto.subtle`) → verify signature against the pinned/carried key → verify
  `manifest-sha256.txt` for **the streams actually opened** (per-file hashes mean a 4 GB night is not hashed
  to open one stream) → hand the files to the same parsers the folder path uses.
- **Result is a provenance badge, not a gate**, sited like the evidence badges (`.ev-corner` /
  inline): `sealed · box S8AW2100 · closed 06:12 · verified` / `TAMPERED: _ECG.txt` (that stream reds,
  the night still opens) / `signature: unknown key — not on card` / `unsealed folder — provenance
  unknown` (legacy corpus folders still open; they say so). A tampered file reds by name; nothing refuses
  silently and nothing fabricates "verified".
- No network anywhere in this path (§📚 hard line 1); the box public key travels in the header and is
  pinned from the card. `tests/dex-tests.js` gate + a `browser-gates` leg, because WebCrypto and
  `DecompressionStream` are browser-only and a Node co-load cannot see a `ReferenceError` there (§👥.3).

## 6 · Gates and plants — the format cannot drift between its two implementations

- **Committed test vectors:** one synthetic night (the existing synthetic corpus) sealed under a committed
  test key pair + test card key, as a fixture. The Python sealer and the JS reader are verified against the
  SAME vectors, so they cannot diverge unseen; a byte-identical re-seal under the test keys is asserted
  (deterministic nonces from the test key ONLY — production nonces are random).
- **Plants that must red, each by name:** one flipped byte in one stream (that stream's hash) · a truncated
  payload (`Payload-Oxum`, before any hashing) · wrong card key (AES-GCM tag) · a valid-looking signature
  from an unknown key (fingerprint mismatch) · a forged header with the correct payload (signature covers
  header ‖ payload hash) · a stale revision presented after a newer one (`Tepna-Seal-Revision`) · `consent`
  absent from the header (must read `null`, not `"no"`).
- **Anti-vacuity:** the plant runner asserts the reader *saw* each plant (a comment-swallowed decoy gives a
  vacuous green — memory `verify-the-plant-was-seen`), and the gate publishes its denominator (all seven
  plants enumerated as an equality, not `≥`).
- The corpus verification that #2784 did by hand becomes a nightly `tools/verify-seals.mjs` over the
  outbox and the archive, log kept, **reporting only on state change** (owner ruling 2026-09-13) — NDSA
  level 3 with no infrastructure.

## 7 · Phases, lanes, order — one PR per phase

| phase | what | lane | gate |
|---|---|---|---|
| **A** | format spec (this §2 frozen into `docs/NIGHT-SEAL-FORMAT.md`), committed test vectors, `capture-host/seal.py` + `unseal.py`, Node `tools/verify-seals.mjs`, the seven plants | Kestrel (spec, vectors, Node) + Heron (Python) | `check.sh` · `npm run check` |
| **B** | box integration: seal at night close, atomic outbox write, revision re-issue, card PDF + consent question at setup, key generation at first boot | Wren (box-local), **deploy owner-authorized** | box night with a real seal, verified on the rig |
| **C** | OverDex reader + provenance badge, `browser-gates` leg — **LANDED #2812 (2026-09-22)**: `night-seal.js` + OverDex wiring; node-lane group `night-seal` (38 assertions on the vector + eight plants + vocabulary parity + verdict validity) and the `gateNightSeal` browser leg (drives the real `ingest()` in the served bundle; eight plants red by name in-page, equality on eight) | Magpie | `Dex-Test-Suite.html?full` · `browser-gates` |
| **D** | per-node Dex readers (each node's file input accepts `.tepna`) | Magpie | per-node equiv legs unchanged (the payload is the same bytes) |
| **E** | optional outbound push of sealed files + RFC 3161 / OTS anchor when online; clinic-key recipient | later, on first external box | — |
| **F** | `tools/dataset-export.mjs`: de-identification profile → bag + datasheet → deposit (§8) | Osprey | committed synthetic run |

A lands first because it freezes the format before any file exists in the wild; B and C can proceed in
parallel once A's vectors are on `main`. D–F wait on evidence, not effort.

## 8 · Sharing with the science community — the bag IS the deposit unit

Encryption is not the obstacle to a dataset; the owner holds the keys and the unsealed corpus. What
repositories demand — fixity manifest, provenance, open documented formats, reproducible published
numbers — the seal already carries (§2) or the repo already has (the sourced-CLAIM records over the 441
trio exports, #2787/#2790). So a release is: unseal N nights → apply a **de-identification profile** (drop
serials and `boxId`, shift each subject's dates by one consistent random offset — the Clock Contract's
floating `tMs` makes that a single subtraction, relative timing survives — keep no free text) → re-bag →
attach a datasheet (Gebru et al. 2021) + `CITATION.cff` + license (owner's call; CC-BY-4.0 is the norm for
data) → deposit. Targets: **PhysioNet** (credentialed access + DUA — the waveform/sleep community's home;
the owner has signed NSRR's DUA and knows the form) or **Zenodo** (DOI; right for the synthetic corpus and
derived tables). Only nights with `Tepna-Research-Consent: yes` are selectable; the owner's own tri-device
corpus needs no third-party consent, only a de-identification choice.

## 9 · Deliberately out of scope (and what would bring each back)

- **Any server, relay, account, or cloud API Tepna operates.** Returns only if a first external deployment
  shows patients cannot manage a sync folder — then phase E, outbound-only.
- **Inbound network access to the box, in any form, ever.** Password SSH on a home connection is the
  brute-forced-from-hour-one failure; the literature is unanimous (§10). Nothing brings this back.
- **PKI / per-clinician keys / passkeys.** The `recipients[]` envelope reserves the slot; a clinic public
  key returns when a pairing UX exists; passkeys return if Dexes are served from a domain.
- **At-rest disk encryption on the box.** A live compromise holds the key; theft of the box is a different
  threat than the transport threats named. Owner's call, separate from this brief.
- **Vendored crypto or zip libraries in a bundle.** WebCrypto + `DecompressionStream` + a 40-line zip
  directory parser cover it; a library returns only if a target browser lacks one of those.
- **The dev-only NAS symlink tier** (`corpus-tier.mjs`). NTFS symlinks do not survive a Windows round trip;
  it was never a deployment feature and `docs/CORPUS-LOCATIONS.md` says so.
- **Timestamp anchoring as a requirement.** It needs egress; it is recorded when available and `null` when
  not (§2). A sealed night never waits on the network.

## 10 · Literature (read 2026-09-21; the design is a composition of these, not an invention)

- RFC 8493, *The BagIt File Packaging Format (V1.0)*, IETF 2018 — payload manifest, `Payload-Oxum`,
  serialization §4. Used for deposit by LoC, Dryad, DataONE.
- NDSA *Levels of Digital Preservation* — fixity at ingest (L1), verify every transfer (L2), fixed-interval
  checks with logs (L3), event-driven checks and no single writer to all copies (L4). This brief reaches L3
  with zero infrastructure.
- FDA (2018) / MHRA (2018) data-integrity guidance — ALCOA+ (attributable · legible · contemporaneous ·
  original · accurate + complete · consistent · enduring · available). The clear header + signature +
  revision field answer *attributable / original / enduring*.
- DICOM PS3.15 *Security and System Management Profiles* — digital signatures over waveform objects with
  periodic re-verification "detecting media degradation or deliberate tampering".
- Sigstore / Rekor (transparency log) and RFC 3161 (time-stamp protocol); OpenTimestamps — the off-box
  proof a compromised signer cannot forge retroactively; here optional and outbound-only.
- OpenZFS checksums and scrub literature — why a filesystem cannot stand in for an application manifest
  (it protects only its own copy of what it was given) and why NTFS/USB/consumer cloud have nothing at all.
- Remote-access practice 2026 (NIST SP 800-207 zero trust; Tailscale/WireGuard write-ups): "public SSH
  should not exist"; here made moot by having no inbound path at all.
- Gebru et al., *Datasheets for Datasets*, CACM 2021 — the release documentation in §8.

## 11 · Decisions

**Taken at Kestrel's level (owner may override):** one file per night · BagIt inside · P-256 + AES-256-GCM
+ HKDF, WebCrypto-native · card = printed/photographed code + QR + fingerprint, typed everywhere, scanned
where native · consent field tri-state with `null` · atomic outbox write and revisioned re-issue ·
provenance badge, never a refusal.

**Owner rulings recorded 2026-09-21:** deployment premise (§ top) · consumer cloud is a first-class
carrier · card model over passphrase · research-sharing must not be made harder (§8) · **write it up** (this
brief).

**Open for the owner:** (1) timing — see the recommendation delivered with this brief; (2) who asks the
consent question and in what words (a clinical/legal wording, not an engineering one); (3) data license
for §8 releases.

## 12 · Done when

- [x] `docs/NIGHT-SEAL-FORMAT.md` frozen at `tepna-seal/1`; committed test vectors; Python sealer and Node
      verifier agree byte-for-byte on them; all seven plants red by name with the denominator published (A).
      **DONE 2026-09-21 (Heron).** `sealfmt.py` · `seal.py` · `unseal.py` · `tools/verify-seals.mjs` ·
      `tests/vectors/tepna-seal-1/` (a 126 457-byte seal of three tracked `uploads/synthetic_*` files under a
      committed TEST key pair and card key). 40 tests at the 100 % floor; the seven plants judged in BOTH readers
      by the same files, seven verdicts each, denominator an equality; the re-seal byte-identical (RFC 6979
      signatures, deterministic zip). Both readers emit `tepna.verdict/1` (§🧾), validated against its §1 table in
      the test until `verdict.js` lands. The shared plants caught one drift before it shipped: the Node reader
      CRASHED on non-UTF-8 `bag-info.txt` where Python refused `zip` — now both refuse. Encodings §2 left open
      are fixed and reasoned in the format doc (u32 header length, raw `r‖s`, AES-KW wrap, header as GCM AAD,
      `boxKey` and `revision` in the clear).
- [ ] A real box night arrives in `outbox/` as a seal, verified on the rig with `verify-seals.mjs`; card PDF
      and consent question exist at setup; deploy owner-authorized (B).
- [ ] OverDex opens a `.tepna` from its file input, shows the provenance badge, reds the tampered plant by
      stream name, and still opens an unsealed legacy folder with the "provenance unknown" badge (C).
- [ ] Nightly `verify-seals` log exists and reports only on state change (§6).
- [ ] Residue rows, if any, in `briefs/RESIDUE.md`; header flipped to DONE with the measured numbers.

## 13 · Phase B — the three box-side decisions (Wren, 2026-09-21, written BEFORE building)

Phase A left three things to the box, and Kestrel released them to the box lane with a steer on each.
Written here first, then built; the owner may override any of them. Measured constraints they sit on:
the daemon runs as the capture user under `ProtectHome=true` + `ProtectSystem=strict` with
`ReadWritePaths=/srv/tepna`, so every persistent secret lives under `/srv/tepna/`; the venv carries
`cryptography` and NO PDF or QR library (`qrcode`, `segno`, `reportlab`, `fpdf`, `PIL` all absent,
checked 2026-09-21); the box has no printer and no display beyond the monitor page.

**(1) Signing key — generated once, on the box, by the daemon, never exported.**
`/srv/tepna/keys/seal-signing.pem` — a P-256 private key in PEM, mode `0600`, owner the capture user.
Generated by `seal.generate_signing_key()` the FIRST time a seal is needed and the file is absent
(first boot in practice; no separate setup step, so a box that has never sealed has no key to leak).
Never written anywhere else: not into `outbox/`, not into `captures/` (the archive rsync mirrors
`captures/` only), not into a card. The public half + `boxKeyFingerprint` go into every seal header
(already `seal_night`'s behaviour) and onto the card, so a reader can pin the box across nights. A
missing or unreadable key file at seal time is a `NOT_RUN` verdict for that night's seal, never a
freshly generated key that silently breaks the pin — regeneration is an operator action (delete the
file), logged.

**(2) Card key + keyId — one JSON store beside the signing key; the card is an HTML file the browser
prints.**
`/srv/tepna/keys/seal-card.json`, `0600`: `{"keyId": N, "keys": {"1": <hex>, …}, "createdAt": …,
"rotatedAt": […]}`. `keyId` is the CURRENT card; older keys stay in the store because the box must be
able to re-display a lost card and to re-issue an old night's seal under the key that night was
sealed with (a rotated card leaves old nights readable — §2). Rotation (`stolen`) appends `keyId+1`
and re-renders the card; re-display (`lost`) re-renders the current one. Both are operator actions on
the monitor's Settings page (authenticated like the other write endpoints), not automatic.
The card itself: `outbox/<boxId>-card-k<keyId>.html` — a single self-contained file, no scripts, no
external fetch: box id · keyId · the 26 Crockford symbols in groups of four (`card_code_encode`) in
large type · the signing-key fingerprint · the same code as a QR (SVG, inline). The patient opens it
on any device, prints it (the browser's print-to-PDF IS the PDF the brief asked for — the box has no
PDF library and adding one to write a one-page document is more SOUP than the page is worth), or
photographs the screen. The same rendering is served on the monitor's Settings page.
*The QR needs an encoder and none is installed.* Decision: add **`segno`** (pure Python, BSD-3, no
transitive dependencies) to `capture-host/requirements.txt` and the SOUP table — QR generation is a
solved problem and a hand-rolled encoder with no decoder to test it against is the one thing this
brief must not ship. Until the owner confirms the dependency (a `pip install` on the box is an
owner-authorized step), the card renders WITHOUT the QR and says so in its own text: typed entry
works in every browser; the QR is the convenience, not the key.

**(3) `extra_info` for `bag-info.txt` — five facts, each read from where it lives, `null` when it
does not.**
`Tepna-Capture-Host-Version: <suite.manifest.json version>` · `Tepna-Capture-Host-Commit: <short sha
from build_id.probe, or null with the reason>` · `Tepna-Device-Inventory: <vendor model device_id;
…>` from the running config's `devices:` (names and ids, never BLE addresses — identity on the air is
the box's business, not the bag's) · `Tepna-Research-Consent: yes|no|null` from `seal.research_consent`
in the box config — **`null` until the setup question has been asked and answered; the box never
defaults it**, and the wording of the question is the owner's (§11 open item 2), so v1 ships the
field and the Settings control, not the words · `Tepna-Seal-Revision: N`.

**Integration.** Config block `seal:` — `enabled: false` (default OFF: writing a patient's night into
a folder a sync client may watch is the owner's switch, like `scan_coexistence_verified`), `box_id`
(default: the hostname), `outbox: /srv/tepna/outbox`, `research_consent: null`. Seal at night
close = the point the morning QC digest fires for a night that is no longer current (the same
`qc_poller` tick that runs the end-of-night back-check): `seal_night(...)` into
`outbox/<boxId>-<night>.tepna` (temp + rename on the same filesystem). Re-issue: on later ticks the
closed night's directory is compared with the seal header's `files`/`bytes`; a post-close writer
(back-check sidecar, late pull) makes them differ ⇒ a new seal at `revision+1` is written to a temp
name, verified with `unseal.verify`, and only then replaces the previous file. Every seal, re-issue
and refusal emits a `tepna.verdict/1` object (`gate: night-seal`) beside the seal — the same
contract the nightly QC and back-check adopted in wave 1 — so the reader's first question, "is this
night sealed and does it verify?", is a field, not a log line.
