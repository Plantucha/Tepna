---
bump: patch
type: fixed
brief: none
---

The HR reference tool's headless realm now loads `consensus-dissent.js`. Without it `ppgHrMapReal` threw a ReferenceError that its own catch swallowed. The Verity corner read null, so every night refused with no HR map. The run scored 0 of 114 eligible nights over the box captures root. A refusal now quotes the error the worker recorded.
