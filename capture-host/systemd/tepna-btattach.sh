#!/usr/bin/env bash
# tepna-capture — systemd/tepna-btattach.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# ATTACH A ZEPHYR HCI-UART CONTROLLER AND GIVE IT BACK ITS IDENTITY.
#
# The nRF52840 dongles run a Zephyr HCI image over CDC-ACM, so they are not USB HCI adapters and the
# kernel will not bind them on its own: something must run `btattach` to put the line discipline on the
# tty. That much is ordinary. The part that is not ordinary, and the reason this file exists rather
# than a one-line ExecStart, is the address.
#
# ── THE ADDRESS DOES NOT SURVIVE POWER LOSS. MEASURED, NOT ASSUMED ─────────────────────────────────
# 2026-09-12, on three dongles power-cycled between the write and the read: every one came back
# 00:00:00:00:00:00. The `0xFC06` (Zephyr VS WRITE_BD_ADDR) write is RUNTIME-ONLY — it does not land in
# FICR, so it has to be re-issued on EVERY attach, after every unplug, after every reboot.
#
# That is not cosmetic, and this is the sentence to read twice: `capture._addressable()` REFUSES an
# all-zero address. A dongle attached without this write is not a radio that works badly — it is a
# radio that is silently dropped from the failover ladder, with no error anywhere, because "no usable
# address" and "not present" look identical from capture's side. The whole point of the unit is that a
# radio is either correctly identified or loudly absent, never quietly missing.
#
# ── THE SEQUENCE, VERIFIED ON HARDWARE ─────────────────────────────────────────────────────────────
#   1. btattach -B <tty> -S 1000000          the adapter appears, address 00:00:00:00:00:00
#   2. hcitool -i hciN cmd 0x3f 0x0006 …     six bytes LITTLE-ENDIAN; answered 01 06 FC 00 (status 0)
#   3. hciconfig hciN down; … up             REQUIRED — the kernel caches BD_ADDR during HCI setup, so
#                                            the write alone does not change what anything reads back
# Step 3 is the step that looks redundant and is not: with it the readback is the written address,
# without it the write reports success and every reader still sees zeros.
#
# ── WHY THE MAP LIVES ON THE BOX, NOT IN THE REPO ──────────────────────────────────────────────────
# Which dongle carries which address is HARDWARE INVENTORY — it is per-box, it changes when someone
# buys a dongle, and it has no meaning in a checkout. So the repo ships the mechanism and an example;
# the real map is deployment config beside config.yaml. `tepna-btattach.map.example` documents it.
#
# There is deliberately NO derive-an-address-from-the-serial fallback. The transform between the USB
# serial and the address these dongles were given is not a function (E1->21, D9->99, E7->E7 across the
# three in hand), so any rule would be invented rather than recovered; and a rarely-exercised second
# path that silently produces a DIFFERENT address than the one an operator pinned in `adapter:` is a
# worse failure than stopping. An unmapped serial is a configuration error and is treated as one.
#
# ── RESOLUTION IS BY USB SERIAL, NEVER BY ttyACMn ──────────────────────────────────────────────────
# The indices renumber on every replug — observed twice within ten minutes on 2026-09-12, where the
# dongle that had been ttyACM0 came back as ttyACM3. A unit pinned to an index attaches whichever radio
# happens to hold that number, which is the mis-pin class that cost a night in VIGIL-DEEP-ANALYSIS.
# DISCOVERY is read straight from sysfs — which tty, which serial, which hci — so none of it needs a
# tool that may be absent, the same reason the autosuspend sibling reads sysfs directly.
#
# The ADDRESS is the exception, and it is an honest one: writing it already requires `hcitool`, so the
# unit cannot run on a box without bluez-tools regardless, and reading it back through the same
# dependency costs nothing extra. See addr_of_hci for why the sysfs attribute alone is not enough.
#
# ── FINDING OUR OWN ADAPTER WITHOUT RACING A SIBLING INSTANCE ──────────────────────────────────────
# A btattach'd hciN appears as a CHILD of its tty's own sysfs node — /sys/class/tty/ttyACM1/hci1. So an
# instance resolves its adapter by looking inside its own tty, exactly, and two instances starting at
# once cannot claim each other's. (The obvious alternative — snapshot hci* before and diff after — is
# precisely the race, and it is silent when it loses.)
set -uo pipefail

MAP="${TEPNA_BTATTACH_MAP:-/etc/tepna/btattach.map}"
SPEED="${TEPNA_BTATTACH_SPEED:-1000000}"
SETTLE_S="${TEPNA_BTATTACH_SETTLE_S:-15}"
ZERO="00:00:00:00:00:00"

log() { echo "$*" >&2; }

# serial_of <ttyname> -> the USB serial of the device owning that tty, or empty.
# /sys/class/tty/ttyACM1/device is the INTERFACE (11-1.2:1.0); its parent holds `serial`.
serial_of() {
  cat "/sys/class/tty/$1/device/../serial" 2>/dev/null
}

# hci_of <ttyname> -> the hciN attached to that tty, or empty. See the sysfs note above.
hci_of() {
  local h
  for h in "/sys/class/tty/$1"/hci*; do
    [ -e "$h" ] && { basename "$h"; return; }
  done
}

# addr_of_hci <hciN> -> that controller's CURRENT address, upper-case, or empty if unreadable.
#
# ⚠️ /sys/class/bluetooth/hciN/address IS NOT UNIVERSAL, and assuming it was is how this function came
# to exist. Measured 2026-09-12 on kernel 7.0: the attribute is ABSENT for every adapter on the box —
# USB and UART alike — so a bare `cat` returns nothing and a caller comparing it against the wanted
# address concludes "wrong identity" about a controller that is perfectly correct. The first version
# of this script did exactly that and reported a ✗ for an adapter reading the right address.
#
# hciconfig is tried FIRST because it is the source that answered on the kernel in hand, with sysfs
# kept as the fallback for kernels that do expose it. An empty return is treated as unknown by every
# caller, never as a match.
addr_of_hci() {
  local a
  a=$(hciconfig "$1" 2>/dev/null | sed -n 's/.*BD Address: \([0-9A-Fa-f:]\{17\}\).*/\1/p' | head -1)
  [ -z "$a" ] && a=$(cat "/sys/class/bluetooth/$1/address" 2>/dev/null)
  echo "$a" | tr 'a-f' 'A-F'
}

# addr_for <serial> -> the mapped address (upper-case), or empty. Comments and blank lines ignored.
addr_for() {
  [ -r "$MAP" ] || return 0
  local s a
  while read -r s a _; do
    case "$s" in ''|'#'*) continue ;; esac
    if [ "$s" = "$1" ]; then
      echo "$a" | tr 'a-f' 'A-F'
      return
    fi
  done < "$MAP"
}

# tty_for <serial> -> the ttyACMn carrying that serial, or empty.
tty_for() {
  local t n
  for t in /sys/class/tty/ttyACM*; do
    [ -e "$t" ] || continue
    n=$(basename "$t")
    [ "$(serial_of "$n")" = "$1" ] && { echo "$n"; return; }
  done
}

# ── --check: report every Zephyr tty, what it maps to, and what it ACTUALLY reads back ─────────────
if [ "${1:-}" = "--check" ]; then
  found=0; problems=0
  for t in /sys/class/tty/ttyACM*; do
    [ -e "$t" ] || continue
    name=$(basename "$t")
    ser=$(serial_of "$name")
    [ -n "$ser" ] || continue
    found=$((found + 1))
    want=$(addr_for "$ser")
    hci=$(hci_of "$name")
    if [ -z "$want" ]; then
      log "  ✗ $name  serial=$ser  NOT IN MAP ($MAP) — this radio cannot be identified"
      problems=$((problems + 1)); continue
    fi
    if [ -z "$hci" ]; then
      log "  ✗ $name  serial=$ser  want=$want  NOT ATTACHED"
      problems=$((problems + 1)); continue
    fi
    got=$(addr_of_hci "$hci")
    if [ "$got" = "$want" ]; then
      log "  ✓ $name  $hci  $got"
    else
      # The zero case is called out by name because it is the one that is INVISIBLE downstream:
      # capture refuses it and reports nothing, so the radio just never appears.
      if [ "$got" = "$ZERO" ]; then
        why="address never written — capture will silently exclude it"
      elif [ -z "$got" ]; then
        why="address UNREADABLE — treated as unknown, never as a match"
      else
        why="wanted $want"
      fi
      log "  ✗ $name  $hci  $got — $why"
      problems=$((problems + 1))
    fi
  done
  [ "$found" = "0" ] && { log "  no CDC-ACM controller present — nothing to check"; exit 0; }
  log "  $found controller(s), $problems problem(s)"
  [ "$problems" = "0" ] || exit 1
  exit 0
fi

SERIAL="${1:-}"
[ -n "$SERIAL" ] || { log "usage: tepna-btattach.sh <usb-serial> | --check"; exit 2; }

ADDR=$(addr_for "$SERIAL")
if [ -z "$ADDR" ]; then
  # FAIL CLOSED. Attaching anyway would leave a zero-address adapter, which capture drops without a
  # word — a missing map entry would then present as a radio that simply is not there.
  log "tepna-btattach: serial $SERIAL is not in $MAP — refusing to attach an unidentifiable radio"
  exit 1
fi

TTY=$(tty_for "$SERIAL")
if [ -z "$TTY" ]; then
  # Not a failure: the box can boot before a dongle is plugged in, and this mirrors the autosuspend
  # sibling's stance on absent hardware. The instance simply has nothing to do.
  log "tepna-btattach: no tty for serial $SERIAL — dongle not present, nothing to attach"
  exit 0
fi

log "tepna-btattach: $SERIAL -> /dev/$TTY, address $ADDR"

# The identity fixer runs alongside btattach: it cannot run before (no adapter yet) and btattach does
# not return (it holds the line discipline for the life of the unit).
(
  deadline=$((SECONDS + SETTLE_S))
  hci=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    hci=$(hci_of "$TTY")
    [ -n "$hci" ] && break
    sleep 0.3
  done
  if [ -z "$hci" ]; then
    log "tepna-btattach: no adapter appeared on $TTY within ${SETTLE_S}s"
    exit 1
  fi

  # Six bytes, LITTLE-ENDIAN — the wire order is the reverse of the printed order.
  b=$(echo "$ADDR" | tr 'A-F' 'a-f' | awk -F: '{for(i=6;i>=1;i--) printf "0x%s ", $i}')
  # shellcheck disable=SC2086  # $b is a deliberately word-split list of six byte literals
  hcitool -i "$hci" cmd 0x3f 0x0006 $b >/dev/null 2>&1

  # Without this the write reports success and every reader still sees zeros (see the header).
  hciconfig "$hci" down >/dev/null 2>&1
  hciconfig "$hci" up   >/dev/null 2>&1

  # Report the READ-BACK, never the intention — a write that did not take is the failure this file
  # exists to prevent, and it is the one that is otherwise invisible.
  got=$(addr_of_hci "$hci")
  if [ "$got" = "$ADDR" ]; then
    log "tepna-btattach: $hci identified as $got"
  else
    # Leave it DOWN. An adapter carrying the wrong identity is worse than one that is plainly
    # unavailable: anything that pinned $ADDR would bond with a radio that is not the one it named.
    hciconfig "$hci" down >/dev/null 2>&1
    log "tepna-btattach: $hci reads $got, wanted $ADDR — left DOWN rather than serving a wrong identity"
  fi
) &

exec btattach -B "/dev/$TTY" -S "$SPEED"
