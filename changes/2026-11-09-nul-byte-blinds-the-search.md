---
bump: patch
type: fixed
brief: none
---

Two source files wrote a control byte as a raw byte, and the repository search skips any file that holds a NUL byte. `manifest-gate.js` wrote the manifest separator that way, and a probe battery wrote one input case that way. The search printed no output and exited 1, so the provenance gate's own source answered empty for every pattern. Both files now write the byte as an escape. An escape and a raw byte make the same string, so all nine bundle hashes stay byte-identical.
