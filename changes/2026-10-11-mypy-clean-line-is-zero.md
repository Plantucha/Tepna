<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`capture-host/check.sh` reads mypy's clean summary line ("Success: no issues found in N source files")
as the count 0. Since MYPY_BASELINE reached 0 (#3373) every green run printed that line and the advisory
reported "NO COUNT — mypy aborted; nothing was examined", a false reading of a pass. Only mypy's two
summary shapes count; anything else still reads NO COUNT. Planted in `test_check_script.py`: the clean
line (singular and plural) → 0, four look-alike lines → NO COUNT.
