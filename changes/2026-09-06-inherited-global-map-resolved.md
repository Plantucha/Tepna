<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
An inherited global `adapter:` written as a declared NAME inherited nothing.

A device's own `adapter:` resolved through the `adapters:` map; the inherited global was taken raw:

    mac = resolve_adapter_name(cfg, spec) if spec else (cfg or {}).get("adapter")

So `adapter: sena` at the top level resolved to nothing, every device relying on inheritance became
unowned, and the two forms were not interchangeable in that one position — while
`resolve_adapter_name`'s own docstring promises names exist *"so the config and the systemd unit read
the same way"*.

Now the global goes through the same resolver as a per-device pin. A MAC global is unaffected:
`_looks_like_mac` passes it straight through, which the real-shape test asserts (vigil has a MAC
global and no `adapters:` map at all).

**A typo'd global still inherits nothing**, and that is asserted as its own case: `resolve_adapter_name`
returns None for a name that is neither in the map nor a MAC, so an unknown global cannot silently
become "the default controller". Without that paired test the fix could have been written as a
fallback that adopts any string — which is the failure `resolve_adapter_name` was built to refuse.

The test that pinned the old behaviour is flipped rather than deleted, because the row said that is
what a fix would look like. Two adapter-less devices, not one: a single-device fixture cannot show a
partition, so a bug returning only the first inheriting device would pass it.

Found while triaging `PER-DEVICE-ADAPTER-PINNING`'s inheritance clause (#2267), pinned there and fixed
here.
