---
bump: patch
type: fixed
brief: none
---

Size every hook self-test's writer-fate payload from the kernel's own `fs.pipe-max-size`, so the pipe cannot absorb it and the leg decides.
