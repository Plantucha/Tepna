<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
---
Four `_wpa_up` tests asked the machine they ran on which branch they covered. They now pin the `/sys` association verdict, and the primary/fallback precedence gets asserted instead of inherited.

**How it surfaced.** Deploying to the vigil box on 2026-07-29 ran the suite there and returned **2 failed, 1644 passed** — `test_wpa_up_installs_an_address_but_NEVER_a_route` and `test_wpa_up_still_returns_when_the_psk_conf_cannot_be_unlinked`, both asserting `_wpa_up(...) is True`. CI was green.

**Why both were right.** `_wpa_up` consults `associated()` first and falls back to `wpa_cli` **only** when that answers `None` — deliberately, so a definite verdict is never overridden (`cb63b31`). The two machines therefore run different code:

| | `/sys/class/net/wlp1s0` | `associated()` | branch covered | asserted `True`? |
|---|---|---|---|---|
| CI / dev box | absent | `None` | the **wpa_cli fallback** | passes |
| the vigil box | exists, `operstate: down` | `False` | no fallback, returns `False` | **fails** |

So the production code was correct — arguably more correct than the tests — and the `/sys` primary was **never covered on CI at all**. This is the class `#470` killed three of: *"tests that PASS in CI while covering DIFFERENT CODE there."* It also meant CI was green on two assertions that did not hold on the only machine the code ships to.

**The fix.** A `_assoc(monkeypatch, answer)` helper pins the verdict, and each of the four tests now names the branch it means: `True` where association is merely a precondition (the address-not-route guarantee, the unlink-resilience case), `None` where the test is *about* the `wpa_cli` calls (control-directory pinning) or about giving up, so the fallback genuinely runs.

**Three contract tests added**, because the precedence itself had no test and was covered only by CI's accident of lacking the interface:

- a definite `/sys` verdict **short-circuits** the `wpa_cli` poll — if it did not, the read-only-`/tmp` failure that made the harvest report "did not associate within 45 s" for a radio that associated in four seconds would come straight back
- a definite **not-associated is never overridden** by a `wpa_cli` saying `COMPLETED` — the exact 2026-07-29 shape, and the guess `cb63b31` removed
- the fallback runs **only** when `/sys` cannot tell

**Verified where it failed:** the fixed file was copied to the vigil box and run against its real `/sys` (wlp1s0 present, down) — **46 passed**. Locally `pytest` **1649 passed**, **100.00 %** statement + branch coverage, `ruff` clean.

Out-of-suite (`capture-host/`) — no bundle, no `manifestHash`, no fixture. Test-only: no production file is touched.
