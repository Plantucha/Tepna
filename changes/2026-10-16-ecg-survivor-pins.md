---
bump: patch
type: fixed
brief: none
---

Pin three ECG mutant survivors with regression tests.

The ECG mutant run with the fixed tools (PR #3587) left survivors in ecgdex-dsp.js. Three were genuine logic gaps in exported pure functions. These tests pin the correct behavior so the mutants stay dead.

Survivor ecgdex-dsp.js:2498: the _relGate floor 1.0 must not become 0. REM's LF/HF gate is night-relative with a floor. Without the floor, a night where every epoch is parasympathetic-dominant gets a purely relative gate and labels the least-vagal epoch REM. The test pins an LF/HF 0.8 epoch staying Light when q65 is 0.5.

Survivor ecgdex-dsp.js:5899 (bool && to ||): a non-finite firstRelMs must not take the EXACT branch. The ms column is garbage, so coverage falls back to the {idx, ms} walk. The test pins NaN firstRelMs producing two finite segments via the fallback.

Survivor ecgdex-dsp.js:6283 (bool && to ||): a truthy non-object opts.code (a version string) is not a bundle identity. Code must be null with a codeReason. The test pins the null and the explanation, plus a control that object opts.code passes through untouched.

Tests: three new survivor-pin blocks in tests/dex-tests.js. Each kills its mutant red to green.
