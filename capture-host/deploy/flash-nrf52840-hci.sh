#!/usr/bin/env bash
# tepna-capture — deploy/flash-nrf52840-hci.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# flash-nrf52840-hci.sh — build + DFU-flash Zephyr `hci_usb` onto an nRF52840 dongle, tuned for Vigil.
#
# WHY THIS FIRMWARE AND NO OTHER (CAPTURE-HOST-2026-06-29-BRIEF §5, VIGIL-DEEP-ANALYSIS-2026-07-22 §5):
# Vigil is bleak → BlueZ → HCI. The dongle must therefore present as a STANDARD Bluetooth USB controller
# that `btusb` binds into a new `hciN`. Zephyr's `hci_usb` sample is the only firmware that does that, and
# with it `capture.py` needs ZERO changes — the nRF just shows up as another adapter to pin.
# Everything else is disqualified by that one constraint:
#   • stock "nRF52 USB CDC BLE Demo" (what a fresh dongle ships with) → /dev/ttyACM0, a serial port. BlueZ
#     never sees it. Useless to Vigil.
#   • Nordic connectivity fw (SoftDevice serialization) → needs pc-ble-driver-py, i.e. rewrite capture.py.
#   • Sniffle / nRF Sniffer → passive sniffing, cannot hold a connection.
#
# ⚠️ READ BEFORE RUNNING — the briefs put this LAST, not first:
# VIGIL-OVERNIGHT-FINDINGS-2026-07-24 §3 says: fix the power setting first, fix BLE resilience always,
# replace the radio only if BOTH a de-suspended dongle AND the internal radio fail you. The 07-24 wedges
# were USB autosuspend, not a connection ceiling; and §5 puts the nRF at "worth it past ~4 sensors" — we
# run 4, one of them `optional: true`. The nRF buys you the CONNECTION CEILING; it does NOT buy you range
# (PCB trace antenna, no RP-SMA — and body attenuation is the documented #1 loss mechanism). Run the free
# internal-radio A/B first.
#
# ┌───────────────────────────────────────────────────────────────────────────────────────────────┐
# │ ⚠️ GET `BOARD` RIGHT OR THE DONGLE BOOTS INTO A BRICK-LOOKING SILENCE. Cost us an afternoon    │
# │    on 2026-07-26; the failure gives you NO error message anywhere. Read this before changing   │
# │    BOARD or flashing a different dongle.                                                       │
# └───────────────────────────────────────────────────────────────────────────────────────────────┘
# Our hardware is a **Raytac MDBT50Q-CX** (USB-C), NOT a Nordic PCA10059 — exactly the part
# CAPTURE-HOST-2026-06-29-BRIEF §5 specifies, with the Zephyr target it already names:
# `raytac_mdbt50q_cx_40_dongle/nrf52840`. Building the identical sample for `nrf52840dongle` instead
# produces an image that flashes perfectly and then dies instantly, because the two boards configure
# the nRF52840 power regulator differently:
#     nordic/nrf52840dongle : &reg0 status="okay"     &reg1 regulator-initial-mode = NRF5X_REG_MODE_DCDC
#     raytac/mdbt50q_cx_40  : &reg0 status="disabled" &reg1 regulator-initial-mode = <0>   (LDO)
# The PCA10059 populates DC/DC inductors; the Raytac module does not. A Nordic-board image switches the
# regulator to DC/DC on hardware that cannot support it, the rail collapses, and the CPU is gone before
# it can light an LED or bring up USB. (Independently corroborated by Raytac's Amazon reviews:
# "requires disabling DCDC to work".)
#
# WHAT THE FAILURE LOOKS LIKE — none of it points at the regulator, which is why it burns a day:
#   • `nrfutil … dfu usb-serial` reports "Device programmed". The write genuinely succeeded.
#   • The dongle then goes COMPLETELY silent on USB — no app, and no bootloader either.
#   • Key deduction, and the one that saves you: silence means control DID transfer to the app. A
#     bootloader REJECTING an image stays in DFU and re-enumerates as 1915:521f. Total silence means the
#     app was entered and died. So stop suspecting the packaging/offset and start suspecting the board.
#   • Reproduces with stock `blinky` too, so it is never your Kconfig overlay.
# ALREADY RULED OUT — do not re-test these:
#   • Flash offset (0x1000, correct on BOTH boards) · nrfutil invocation (matches Zephyr's board doc) ·
#     the tuning overlay below · missing 32.768 kHz LFXO (K32SRC_RC=y does NOT help) · dead hardware.
#
# RESULT once BOARD is correct (verified on rig-x870 2026-07-26): enumerates as `2fe3:000b Zephyr USBD
# BT HCI`, BlueZ binds it, `hciconfig` shows ACL MTU 251 (the DLE tuning live in the controller), and a
# real scan returned 20 devices with the Verity at -22 dBm.
#
# ⚠️ THE FLASHED CONTROLLER HAS NO PUBLIC BD ADDRESS. `hciconfig` prints 00:00:00:00:00:00; BlueZ
# assigns a STATIC RANDOM address instead (ours: C3:02:4E:77:2B:D2, stable across reboots). Read the
# address to pin in config.yaml from `bluetoothctl list`, NEVER from `hciconfig`. It also becomes the
# BlueZ DEFAULT controller, so anything not explicitly adapter-pinned silently moves to it.
# NOTE it is an LE-ONLY controller (no BR/EDR) — fine for Vigil, every sensor is BLE.
#
# Usage:
#   bash flash-nrf52840-hci.sh            # build + flash (prompts before the DFU write)
#   bash flash-nrf52840-hci.sh --build    # build only, no flash
#   bash flash-nrf52840-hci.sh --verify   # just report what is currently on the dongle
#
# Prereqs (this script checks and tells you what is missing; it installs nothing behind your back):
#   • west + a Zephyr workspace + the Zephyr SDK   → https://docs.zephyrproject.org/latest/develop/getting_started/
#   • nrfutil with the nrf5sdk-tools command       → see NRFUTIL_HINT below
#   • membership of `dialout` for /dev/ttyACM*     → sudo usermod -aG dialout "$USER"  (then log out/in)
set -uo pipefail

# Toolchain bootstrap — the layout provisioned on rig-x870 2026-07-26. All three are overridable, and
# anything already on PATH/in the environment wins, so a system-wide Zephyr install is not disturbed.
# Zephyr 4.4.1 pairs with SDK 1.0.1 (zephyr/SDK_VERSION). Note the SDK's GNU toolchains must sit at
# <sdk>/gnu/<triple>/ — the standalone toolchain tarball does NOT extract there, and the resulting
# "Unable to find x86_64-zephyr-elf or any other architecture" is the least obvious failure in this file.
ZEPHYR_TOOLS_VENV="${ZEPHYR_TOOLS_VENV:-$HOME/zephyr-tools}"          # west + ninja
ZEPHYR_SDK_INSTALL_DIR="${ZEPHYR_SDK_INSTALL_DIR:-$HOME/zephyr-sdk-1.0.1}"
SDK_HOSTTOOLS="$ZEPHYR_SDK_INSTALL_DIR/hosttools/sysroots/x86_64-pokysdk-linux/usr/bin"   # dtc, gperf…
export ZEPHYR_SDK_INSTALL_DIR
[ -d "$ZEPHYR_TOOLS_VENV/bin" ] && PATH="$ZEPHYR_TOOLS_VENV/bin:$PATH"
[ -d "$SDK_HOSTTOOLS" ]        && PATH="$SDK_HOSTTOOLS:$PATH"
[ -x "$HOME/.local/bin/nrfutil" ] && PATH="$HOME/.local/bin:$PATH"
export PATH

ZEPHYR_BASE_DEFAULT="${ZEPHYR_BASE:-$HOME/zephyrproject/zephyr}"
BOARD="${BOARD:-raytac_mdbt50q_cx_40_dongle/nrf52840}"   # ← our hardware. See the BOARD warning above
                                                        #   before changing this to nrf52840dongle.
BUILD_DIR="${BUILD_DIR:-$HOME/.cache/tepna/nrf52840-hci-build}"
CONF_OUT="$BUILD_DIR/vigil-hci.conf"
PKG_OUT="$BUILD_DIR/vigil_hci_dfu.zip"

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

NRFUTIL_HINT='  curl -L https://developer.nordicsemi.com/.pc-tools/nrfutil/x64-linux/nrfutil -o ~/.local/bin/nrfutil
  chmod +x ~/.local/bin/nrfutil && nrfutil install nrf5sdk-tools'

# ── the Kconfig fragment — the part that actually matters ──────────────────────────────────────────
# STOCK `hci_usb` IS NOT ENOUGH. Its defaults hold ~1-2 links and drop them after 10-20 s; the brief
# calls this out explicitly ("Not plug-and-play, and 'many links' needs *tuning*, not just flashing").
# Every value below is sized from capture-host/config.yaml's actual streams, not copied from a tutorial.
write_conf() {
  mkdir -p "$BUILD_DIR"
  cat > "$CONF_OUT" <<'CONF'
# Vigil overlay for Zephyr samples/bluetooth/hci_usb — sized for capture-host/config.yaml.
# Generated by capture-host/deploy/flash-nrf52840-hci.sh. Edit there, not here.

# NOTE: hci_usb is a CONTROLLER-ONLY build (CONFIG_BT_HCI_RAW=y) — Zephyr's host stack is not compiled,
# BlueZ is the host. So host-side symbols are correctly ABSENT from the generated .config and must not be
# set here: BT_MAX_PAIRED (subsys/bluetooth/host/Kconfig) and BT_BUF_CMD_TX_COUNT both drop out. Bonding
# state lives on the Linux side; `bonding.py` is unaffected. Verified against a real 4.4.1 build 2026-07-26.

# 4 configured sensors (Verity Sense, O2Ring-S, Polar H10, COOSPO 808S) + headroom for a reconnecting
# device that has not yet released its old link. Stock default is far lower and is THE cap people hit.
CONFIG_BT_MAX_CONN=6

# Data Length Extension. The H10 streams ECG at ~130 Hz and the Verity PPG+ACC+GYRO+MAG concurrently;
# without DLE every notification fragments into 27-byte packets and the controller runs out of air time
# before it runs out of connection slots. This is the single highest-value line in the file.
CONFIG_BT_CTLR_DATA_LENGTH_MAX=251
CONFIG_BT_BUF_ACL_RX_SIZE=255
CONFIG_BT_BUF_ACL_TX_SIZE=251

# ACL/event buffer counts. Under-sized buffers are why stock hci_usb "drops links after 10-20 s": the
# controller stalls, the host stops crediting, BlueZ times the link out. Scale with BT_MAX_CONN.
CONFIG_BT_BUF_ACL_TX_COUNT=12
CONFIG_BT_BUF_EVT_RX_COUNT=16
CONFIG_BT_CTLR_RX_BUFFERS=9

# 2M PHY — halves air time per packet, which is what actually buys concurrent-stream headroom.
CONFIG_BT_CTLR_PHY_2M=y

# link_rssi.py polls RSSI every 25 s (config.yaml `link.rssi_interval_sec`). WITHOUT this the Zephyr
# controller rejects HCI Read RSSI and the LINK.csv sidecar silently goes blank — losing the only record
# of the body-attenuation signal the briefs call the #1 reliability lever. Easy to forget; costs nothing.
CONFIG_BT_CTLR_CONN_RSSI=y

# Encryption/bonding — bonding.py bonds every sensor. Explicit so a defconfig change cannot drop it.
CONFIG_BT_CTLR_LE_ENC=y
CONF
  ok "wrote $CONF_OUT"
}

# ── what is on the dongle right now ────────────────────────────────────────────────────────────────
verify() {
  say "current state"
  local found=0
  # 1915 = Nordic (stock app fw or Open-bootloader DFU mode); 2fe3 = Zephyr project VID (post-flash).
  while read -r _ _ _ dev id rest; do
    case "$id" in
      1915:*) found=1; printf '  %-12s %s  %s\n' "${id%:*}:${id#*:}" "NORDIC (stock fw or DFU)" "$rest" ;;
      2fe3:*) found=1; printf '  %-12s %s  %s\n' "${id%:*}:${id#*:}" "ZEPHYR (flashed)" "$rest" ;;
    esac
    : "$dev"
  done < <(lsusb | sed 's/ID //')
  [ "$found" = 1 ] || warn "no Nordic (1915:*) or Zephyr (2fe3:*) device on USB — is the dongle plugged in?"

  if command -v hciconfig >/dev/null 2>&1; then
    echo; echo "  HCI adapters (a flashed dongle appears HERE; a stock one does NOT):"
    hciconfig 2>/dev/null | sed 's/^/    /'
  fi
  if ls /dev/ttyACM* >/dev/null 2>&1; then
    # shellcheck disable=SC2012  # SC2012 warns about filenames with whitespace/newlines. These are
    # KERNEL-created device nodes matching /dev/ttyACM[0-9]+ — the name is generated by the cdc_acm
    # driver from a counter, so the class of name that breaks `ls` parsing cannot occur here.
    echo "  serial (stock CDC fw / DFU bootloader): $(ls /dev/ttyACM* | tr '\n' ' ')"
    # shellcheck disable=SC2012  # same: kernel-generated device-node names, no whitespace possible.
    [ -r "$(ls /dev/ttyACM* | head -1)" ] || warn "not readable — you are not in \`dialout\`. sudo usermod -aG dialout $USER, then log out/in."
  fi
}

case "${1:-}" in --verify) verify; exit 0 ;; esac

# ── prereqs ────────────────────────────────────────────────────────────────────────────────────────
say "1/5  prerequisites"
command -v west    >/dev/null 2>&1 || die $'west not found. Install the Zephyr toolchain first:\n  https://docs.zephyrproject.org/latest/develop/getting_started/'
ok "west $(west --version 2>/dev/null | head -1)"
[ -d "$ZEPHYR_BASE_DEFAULT" ] || die "no Zephyr tree at $ZEPHYR_BASE_DEFAULT (set ZEPHYR_BASE=/path/to/zephyr)"
SAMPLE="$ZEPHYR_BASE_DEFAULT/samples/bluetooth/hci_usb"
[ -d "$SAMPLE" ] || die "hci_usb sample not found at $SAMPLE"
ok "zephyr $ZEPHYR_BASE_DEFAULT"
command -v nrfutil >/dev/null 2>&1 || die $'nrfutil not found. Install it:\n'"$NRFUTIL_HINT"
nrfutil nrf5sdk-tools --version >/dev/null 2>&1 || die $'nrfutil lacks the nrf5sdk-tools command:\n  nrfutil install nrf5sdk-tools'
ok "nrfutil + nrf5sdk-tools"

# ── build ──────────────────────────────────────────────────────────────────────────────────────────
say "2/5  Kconfig overlay"
write_conf

say "3/5  build  ($BOARD)"
west build -b "$BOARD" "$SAMPLE" -d "$BUILD_DIR/build" --pristine=auto -- \
  -DEXTRA_CONF_FILE="$CONF_OUT" || die "build failed"
HEX="$BUILD_DIR/build/zephyr/zephyr.hex"
[ -f "$HEX" ] || die "build reported success but $HEX is missing"
ok "built $HEX"

# Confirm the tuning SURVIVED into the real config — a typo'd or dropped symbol fails silently otherwise,
# and you would only find out from a 3 a.m. dropped link. Kconfig prunes symbols whose deps are unmet.
say "4/5  verify the tuning landed"
GENCONF="$BUILD_DIR/build/zephyr/.config"
tune_fail=0
for sym in BT_MAX_CONN=6 BT_CTLR_DATA_LENGTH_MAX=251 BT_CTLR_PHY_2M=y BT_CTLR_CONN_RSSI=y; do
  if grep -qx "CONFIG_$sym" "$GENCONF" 2>/dev/null; then ok "CONFIG_$sym"
  else warn "CONFIG_$sym did NOT survive Kconfig — check deps in $GENCONF"; tune_fail=1; fi
done
[ "$tune_fail" = 0 ] || warn "build is flashable but NOT fully tuned — expect the stock multi-link behaviour"

case "${1:-}" in --build) echo; ok "build-only: stopping before DFU. Package+flash with step 5 below."; exit 0 ;; esac

# ── flash ──────────────────────────────────────────────────────────────────────────────────────────
say "5/5  DFU flash"
cat <<'EOS'
  Put the dongle in DFU mode NOW:
    press the small RESET button (it presses SIDEWAYS, next to the USB connector)
    → the red LED breathes/pulses, and the dongle re-enumerates under a different 1915:* PID
EOS
verify
echo
read -r -p "  Dongle in DFU mode and ready to flash? [y/N] " reply
case "$reply" in [yY]*) ;; *) echo "  aborted — nothing was written."; exit 0 ;; esac

# shellcheck disable=SC2012  # kernel-generated /dev/ttyACM[0-9]+ names; no whitespace is possible.
PORT="${PORT:-$(ls /dev/ttyACM* 2>/dev/null | head -1)}"
[ -n "$PORT" ] || die "no /dev/ttyACM* found — the dongle is not in DFU mode (or you lack dialout)"
[ -w "$PORT" ] || die "$PORT is not writable — you are not in \`dialout\`. sudo usermod -aG dialout $USER, then log out/in."

nrfutil nrf5sdk-tools pkg generate --hw-version 52 --sd-req 0x00 \
  --application "$HEX" --application-version 1 "$PKG_OUT" || die "pkg generate failed"
ok "packaged $PKG_OUT"

nrfutil nrf5sdk-tools dfu usb-serial -pkg "$PKG_OUT" -p "$PORT" || die "DFU failed — still in DFU mode? try the RESET button again"
ok "flashed"

say "post-flash check"
sleep 3
verify
cat <<'EOS'

  Expected: USB ID moves 1915:* → 2fe3:000b, and a NEW hciN appears.
  If the dongle goes SILENT on USB instead (no app AND no bootloader), you almost certainly built for
  the wrong BOARD — see the regulator/DCDC warning at the top of this file. It is not bricked; press
  RESET to get 1915:521f back and rebuild with BOARD=raytac_mdbt50q_cx_40_dongle/nrf52840.

  Next, to actually USE it:
    1. udev already covers it — systemd/99-tepna-btdongle.rules matches 1915:* AND 2fe3:* vendor-wide,
       so autosuspend is off on the flashed dongle with no rule edit.
    2. Re-pin capture-host/config.yaml:
         adapter:            <address from `bluetoothctl list`, NOT `hciconfig`>
       ⚠️ This controller has NO public address — `hciconfig` prints 00:00:00:00:00:00 and BlueZ
       assigns a static random one. Pinning the zeros silently fails to resolve and capture falls back
       to the BlueZ default, which is the exact unpinned-radio state the 07-24 wedge taught us to avoid.
         watchdog.usb_path:  <its bus-port — `readlink -f /sys/class/bluetooth/hciN`>
       Both are MAC/port pinned, not index pinned — hci indices re-enumerate across reboots.
    3. Re-bond every sensor that needs it: bonds live PER ADAPTER, so a new radio starts with none.
       Only PMD devices need one (run_polar bonds only when needs_pmd) — the O2Ring-S uses run_oxyii
       which does NOT bond, and an HR-only strap like the COOSPO does not either.
         python3 capture-host/bonding.py bond <address> --adapter <new controller address>
EOS
