---
bump: patch
type: fixed
brief: none
---

The sink gate reads an escaper's replace patterns in linear time. The scan's three alternatives now differ in their first character. The earlier form let its last alternative match a square bracket. An empty character class then parsed two ways, and a long run of them backtracked exponentially. A bare closing bracket outside a class now ends the scan, and that body earns no credit. The gate sees the same escapers as before.
