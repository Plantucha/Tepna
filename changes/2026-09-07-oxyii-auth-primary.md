<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---
**The daemon asked the ring whether the session was encrypted and never read the answer.** The `0xFF`
OP_AUTH frame was written fire-and-forget and no code looked at the reply, so `classify_auth_reply` —
which exists to decide plaintext / encrypted / refuse — shipped wired to nothing. The connect path now
captures the reply and acts on it, and that decision is PRIMARY.

**`encrypted` and `refuse` end the session.** This build has no decryptor on the live path, so
continuing means reading ciphertext as SpO₂ and pulse — and `decode()` would not object, because its
CRC covers the envelope, not the payload. A negotiated key we cannot use is no better than one we
cannot parse. The plant behind this is a canned key blob with vitals-shaped frames behind it: the
vitals path must never see them, and the test asserts the STATUS keys were never even published.

⚠️ **Silence is UNKNOWN, not plaintext.** Every ring in this project stays silent on `0xFF`, and
`classify_auth_reply(None)` returns `AUTH_PLAINTEXT` — a positive claim — so on silence it is *not
called at all*. The link is published as `auth_mode: "unknown"`, counted (`auth_unknown_links`), drawn
on the monitor, and logged once per link **with the branch-code verdict beside it**, because neither
half means anything alone: a silent ring is not evidence of plaintext, and a branch code is an
inference from a firmware label rather than a reading of this session.

**An auth stop is not a link fault.** It uses a fixed retry interval named `auth: encrypted` /
`auth: refused` rather than the exponential backoff, which models a flaky radio and would bury the
reason under "backoff".

⚠️ **A premise in the order was wrong and is corrected here rather than repeated:** the ciphertext
heuristic was described as the secondary already in force. It is not wired at all — measured, zero
non-test callers for both `frame_looks_like_ciphertext` and `sustained_ciphertext`. The only
corroborator running is `aes_session_suspect`, and the comments say exactly that.
`find_unwired`'s PENDING entry for `classify_auth_reply` is retired because it is now wired; the
entry for the probabilistic pair is rewritten to say the primary landed and they are still unclaimed.

Latent on this hardware: no ring here answers `0xFF`, so today every link takes the UNKNOWN path and
capture is unchanged. What changes is that the daemon now says so instead of assuming.
