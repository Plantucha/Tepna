---
bump: patch
type: fixed
brief: none
---

Six tools refuse an unrecognised flag by name at exit 2 instead of taking it as an input path — one of them had created a directory named `--help` and written five EDFs into it.
