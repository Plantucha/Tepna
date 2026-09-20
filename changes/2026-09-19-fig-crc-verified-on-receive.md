---
bump: minor
type: fixed
brief: none
---

The AS11 link computed both frame CRCs on send and verified **neither** on receive. Both are now
checked, a failure resyncs instead of wedging the stream, and the count reaches a consumer.

## The defect

`fig_frame` has always written both — the payload CRC32 inside the header struct and a CRC32 over that
header. `fig_unframe` unpacked the payload CRC into a **discard name** (`_pcrc`) and never read the
header CRC at bytes 12–16 at all. **The framing carried its own integrity check and threw it away on
arrival.**

There is no cryptographic backstop either: the payload cipher is AES-256-CBC with **no MAC**, so a
flipped bit surfaced only if it happened to break the pad or the JSON. Nothing else was watching.

## ⚠️ Why a bad CRC must not return `None` — and the reason is in our own caller

`capture.py`'s notify handler is:

```python
while True:
    r = _L.fig_unframe(bytes(rx))
    if not r: break
    ...; rx[:] = rest          # trimmed ONLY on success
```

A corrupt frame that merely returned `None` would sit at the head of `rx` **forever** — every later
notification re-parsing the same bad bytes and breaking again, the link permanently deaf, and no error
anywhere. So a failed CRC **resyncs inside the call**, and `None` keeps its single meaning: *no complete
frame yet, send more bytes*.

**The two failures resync differently, and that difference is what the header CRC buys:**

| failure | action | why |
|---|---|---|
| header CRC | advance past this sync word (+4), rescan | `length` is not trustworthy |
| payload CRC | skip the **whole frame** | header verified ⇒ boundary known; rescanning at +4 would hunt a sync word *inside payload bytes* |

## The count reaches a consumer, not a log line

`on_bad_crc(kind)` is injected — the module stays dependency-free, per its own header — and the
production caller wires it to `blestats.fail("fig_crc", addr, kind)`, which publishes into
`status.json`. **A CRC that fails silently is a filter that discards data and tells nobody** — the
defect #2670 fixed one layer up, where `link`/`offline_op` counted into a dict `snapshot()` could not
enumerate. A test asserts the production call site wires it, because that is the part no mechanism
enforces.

⚠️ **The count is an upper bound and the docstring says so.** A corrupt prefix ahead of an *incomplete*
frame is re-examined each notification until that frame completes, so it is reported once per call
rather than once per event. Corruption followed by a complete frame is counted exactly once. An
unstated bound would be a fabricated number.

## Tests

Seven, four mutations, all killing — and each hits the tests it should:

| mutation | fires |
|---|---|
| drop the payload-CRC check | **4** |
| drop the header-CRC check | **2** |
| return `None` instead of resyncing | the anti-wedge test |
| payload failure rescans +4 instead of skipping the frame | the boundary test |

Including a **positive control** — a clean frame round-trips and reports nothing, so a verifier that
rejected everything would not pass.

⚠️ **The 100 % branch floor caught an under-tested claim of mine.** `..._verification_still_happens_
without_it` corrupted only the *payload*, leaving the header-bad-with-no-callback branch untaken — the
test under-tested its own name. Extended to both CRCs.

`check.sh` EXIT=0: 7424 passed, coverage 100.00%.

## Scope

`fig_unframe` and its one production call site. The resync shape — a corrupt header costing one frame
rather than the connection — is standard framing practice and is justified above from this codebase's
own caller.
