---
bump: patch
type: fixed
brief: none
---

Read a declared night rule as code. A rule bound one line earlier and passed by name was invisible
to the suite's detector, a call in the first argument hid the options, and a tool source planted in
a string read as the host tool's own code.
