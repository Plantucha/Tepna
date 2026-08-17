---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

A mutant that never returns wedged `mutation-crawl.mjs` permanently. **Mutation testing manufactures
non-terminating loops** — deleting the body of `while (t < prev) t += 86400000;` leaves
`while (cond) ;`, and Level B produced exactly that shape on `clock.js` — so this is an expected
output of the technique, not an edge case.

**Measured 2026-08-16.** `ppgdex-dsp.js` swept cleanly (538/1346 killed, 808 survivors, canary
PASSED, 38 min). The probe phase then ran **11 h 11 m of CPU at 93 %, single-threaded, with zero
output**, wrote no result file, and blocked `oxydex-dsp.js` and `ecgdex-dsp.js` from ever being
crawled. It would not have stopped on its own; it had to be killed.

**The fix is where the call happens, not what it calls.** `runBattery` did:

```js
r = fn.apply(null, args);          // host-side call into a realm function — uninterruptible
```

`vm`'s `timeout` option interrupts synchronous script execution, but only for code running *inside*
`runInContext`. Holding a function reference from the realm and calling it from the host escapes that
completely, which is precisely what happened. The call is now made inside the realm, where the budget
applies:

```js
ctx.__probeFn = fn; ctx.__probeArgs = args;
r = vm.runInContext('__probeFn.apply(null, __probeArgs)', ctx, { timeout: PROBE_TIMEOUT_MS });
```

Default 2000 ms, overridable with `--probe-timeout-ms`.

**Symmetry matters:** the original and the mutant run under the same budget, so a genuinely slow
function times out on *both* sides and produces no false difference. A timeout is recorded as its own
outcome (`TIMEOUT:<ms> — did not terminate`) rather than folded into `THREW`, because "did not
terminate" is a real behavioural difference and labelling it keeps it from reading as an ordinary
killable one-liner — no test asserts "hangs" the way it asserts a value.

**Four selftest cases, so this cannot regress silently:** a terminating function still returns its
value, a throwing function still reports `THREW`, an infinite loop reports `TIMEOUT`, and the exact
`while (cond) ;` shape statement-deletion produces reports `TIMEOUT`. The last two previously ran
forever.

⚠️ **The first version of those assertions failed, and the file had already warned me why.** Battery
results are JSON-stringified, so a timeout arrives as `"TIMEOUT:…"` **with quotes**, and an anchored
`/^TIMEOUT:/` never matches — the identical trap `batteryIsUsable` documents for `THREW`. The fix was
correct; the test was wrong, and it took the fix down with it. Anchors are now `/^"?TIMEOUT:/`.

No behavioural change to sweeping, triage, resume, or the reported numbers.
