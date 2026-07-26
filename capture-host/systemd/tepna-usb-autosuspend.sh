#!/usr/bin/env bash
# tepna-capture — systemd/tepna-usb-autosuspend.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# DISABLE USB AUTOSUSPEND ON EVERY BLUETOOTH ADAPTER, AT BOOT, DETERMINISTICALLY.
#
# ── WHY A SERVICE AND NOT (ONLY) A UDEV RULE ───────────────────────────────────────────────────────
# `99-tepna-btdongle.rules` is correct and stays: it arms a dongle the moment it is HOTPLUGGED. What a
# udev rule cannot do is win a race it is not in. Observed on the box 2026-07-26 after a reboot:
#
#     13:55:34  usbcore: registered new device driver usb      <- adapters enumerate
#     13:55:38  systemd-udevd started                          <- udev arrives 4 s later
#     13:55:41  STARTUP WARNING: USB autosuspend is ENABLED
#
# The adapters existed before udevd did. `usbcore.autosuspend=2` is the kernel default, so nothing
# "flipped it back" — the kernel set `auto` at enumeration and the rule simply never got its turn.
# `udevadm test` confirmed the rule matches and WOULD set `on`, which is exactly what makes this
# failure mode nasty: every static check of the rule passes while the live value is wrong.
#
# That is a different bug from the one the 50->99 rename fixed (that was rule PRECEDENCE, this is
# rule TIMING), so it needs a different mechanism: a unit ordered explicitly after udev has settled
# and before capture starts, which re-asserts the setting on hardware that is already present.
#
# ── WHY IT MATCHES ON CLASS, NOT VENDOR ────────────────────────────────────────────────────────────
# The udev rule lists idVendor 2357 (TP-Link/Realtek) and 8087 (Intel). On 2026-07-26 a third adapter
# appeared — a Raytac MDBT50Q running Zephyr's USB HCI, idVendor 2fe3 — and was covered by neither
# clause, so it sat at the kernel default (control=auto, delay=2000 ms) while the other two at least
# carried delay=-1. A vendor allowlist protects the adapters you thought of.
#
# USB assigns Bluetooth its own class triple: bInterfaceClass=e0 (Wireless Controller),
# bInterfaceSubClass=01 (RF Controller), bInterfaceProtocol=01 (Bluetooth). Every conformant BT
# adapter reports it, so matching there covers the dongle you plug in next without an edit.
#
# ── WHAT IT WRITES, AND WHY BOTH ───────────────────────────────────────────────────────────────────
#   power/control=on                 opt the device out of runtime PM entirely.
#   power/autosuspend_delay_ms=-1    belt and braces: a negative delay disables autosuspend even if
#                                    something later flips control back to `auto`.
# Either alone is one stray power-tuner away from being undone; together the device stays awake.
set -uo pipefail

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

found=0
armed=0
problems=0
# A Bluetooth USB device exposes TWO interfaces matching e0/01/01 — interface 0 carries HCI
# commands/events/ACL, interface 1 carries SCO isochronous audio — and both resolve to the same
# parent device. Without this the box reported "6 adapter(s)" for three dongles and would have
# written every attribute twice. Caught on real hardware; the source-level tests could not see it.
seen=""

for iface in /sys/bus/usb/devices/*:*; do
  [ -e "$iface/bInterfaceClass" ] || continue
  cls=$(cat "$iface/bInterfaceClass" 2>/dev/null)
  sub=$(cat "$iface/bInterfaceSubClass" 2>/dev/null)
  pro=$(cat "$iface/bInterfaceProtocol" 2>/dev/null)
  [ "$cls" = "e0" ] && [ "$sub" = "01" ] && [ "$pro" = "01" ] || continue

  dev=$(dirname "$(readlink -f "$iface")")            # the USB DEVICE owning this interface
  [ -e "$dev/power/control" ] || continue
  id="$(cat "$dev/idVendor" 2>/dev/null):$(cat "$dev/idProduct" 2>/dev/null)"
  port=$(basename "$dev")
  case " $seen " in *" $port "*) continue ;; esac      # second interface of a device already handled
  seen="$seen $port"
  found=$((found + 1))

  ctl=$(cat "$dev/power/control" 2>/dev/null)
  dly=$(cat "$dev/power/autosuspend_delay_ms" 2>/dev/null)

  if [ "$CHECK" = "1" ]; then
    # `on` OR a negative delay is enough to keep it awake; report the pair either way.
    if [ "$ctl" = "on" ] || [ "${dly:-0}" -lt 0 ] 2>/dev/null; then
      echo "  ✓ $port  $id  control=$ctl delay=$dly"
    else
      echo "  ✗ $port  $id  control=$ctl delay=$dly — AUTOSUSPEND LIVE on a BLE adapter"
      problems=$((problems + 1))
    fi
    continue
  fi

  ok=1
  echo on > "$dev/power/control" 2>/dev/null || ok=0
  echo -1 > "$dev/power/autosuspend_delay_ms" 2>/dev/null || ok=0
  now_c=$(cat "$dev/power/control" 2>/dev/null)
  now_d=$(cat "$dev/power/autosuspend_delay_ms" 2>/dev/null)
  # Report the READ-BACK, never the intention: a write that silently did not take is the whole
  # failure this file exists to end.
  if [ "$ok" = "1" ] && [ "$now_c" = "on" ]; then
    echo "  armed $port  $id  control=$now_c delay=$now_d"
    armed=$((armed + 1))
  else
    echo "  FAILED $port  $id  control=$now_c delay=$now_d (wanted control=on)"
    problems=$((problems + 1))
  fi
done

if [ "$found" = "0" ]; then
  # Not a failure: the box may boot before a dongle is plugged, and the udev rule owns that case.
  echo "  no USB Bluetooth adapter present (class e0/01/01) — nothing to arm"
  exit 0
fi
[ "$CHECK" = "1" ] && { echo "  $found adapter(s), $problems exposed"; [ "$problems" = "0" ] || exit 1; exit 0; }
echo "  $found adapter(s), $armed armed, $problems failed"
[ "$problems" = "0" ] || exit 1
exit 0
