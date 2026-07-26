#!/usr/bin/env bash
# Tepna Vigil — one-shot deploy for a fresh Ubuntu Server box. Idempotent; safe to re-run.
# Run ON THE BOX as the `vigil` user:  bash deploy-vigil.sh
set -euo pipefail

REPO=https://github.com/Plantucha/Tepna.git
DEST=/opt/tepna
DATA=/srv/tepna
NTP_SERVER=192.168.0.123

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/8  packages"
sudo apt-get update -qq
sudo apt-get install -y -qq bluez python3-venv python3-pip git rsync chrony

say "2/8  code -> $DEST"
sudo mkdir -p "$DEST"; sudo chown "$USER:$USER" "$DEST"
if [ -d "$DEST/.git" ]; then git -C "$DEST" fetch -q origin && git -C "$DEST" checkout -q main && git -C "$DEST" pull -q --ff-only
else git clone -q "$REPO" "$DEST"; fi
echo "   at $(git -C "$DEST" rev-parse --short HEAD)"

say "2b/8  serve the CURRENT bundles"
# The served directory is a COPY, and until 2026-07-26 nothing refreshed it — it was populated by
# hand once and drifted a full day behind. Syncing here means a deploy can never leave the phone
# loading an app that opens, renders and computes with last week's DSP.
bash "$DEST/capture-host/deploy/sync-apps.sh" || echo "   ✗ bundle sync failed (see above)"

say "2c/8  /etc must match the repo"
# Three files are copied by hand into system directories and nothing compared them again. On
# 2026-07-26 the installed udev rule was TWO fixes behind and a hot-plugged adapter spent the evening
# unprotected — with `systemctl status` green the whole time, because the file was present and only
# its CONTENT was old. MANAGED files are installed; the site-templated unit is only reported, because
# the repo's copy names a user this box does not have and installing it would stop capture.
sudo bash "$DEST/capture-host/deploy/check-system-files.sh" --install || true

say "3/8  python venv"
cd "$DEST/capture-host"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install -q --upgrade pip
./.venv/bin/pip install -q -r requirements.txt
echo "   $(./.venv/bin/python -c 'import bleak,yaml,aiohttp;print("bleak+yaml+aiohttp OK")')"

say "4/8  data dirs"
sudo mkdir -p "$DATA/captures" "$DATA/app" /var/log/tepna
sudo chown -R "$USER:$USER" "$DATA" /var/log/tepna

say "5/8  USB autosuspend rules (BOTH radios, so an A/B test is not rigged)"
sudo tee /etc/udev/rules.d/50-tepna-btdongle.rules >/dev/null <<'RULES'
# TP-Link UB500 / RTL8761B — the documented firmware-hang trigger (VIGIL-OVERNIGHT-FINDINGS §P0.1)
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="2357", ATTR{idProduct}=="0604", TEST=="power/control", ATTR{power/control}="on"
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="2357", ATTR{idProduct}=="0604", TEST=="power/autosuspend_delay_ms", ATTR{power/autosuspend_delay_ms}="-1"
# Intel (8260/8265/AX200) — the M900's internal radio. Same treatment, or the A/B comparison is rigged.
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="8087", TEST=="power/control", ATTR{power/control}="on"
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="8087", TEST=="power/autosuspend_delay_ms", ATTR{power/autosuspend_delay_ms}="-1"
RULES
sudo udevadm control --reload
sudo udevadm trigger --action=add --attr-match=idVendor=2357 || true
sudo udevadm trigger --action=add --attr-match=idVendor=8087 || true

say "6/8  chrony -> $NTP_SERVER"
if ! grep -q "^server $NTP_SERVER" /etc/chrony/chrony.conf 2>/dev/null; then
  echo "server $NTP_SERVER iburst prefer" | sudo tee -a /etc/chrony/chrony.conf >/dev/null
fi
sudo systemctl restart chrony
sleep 2; chronyc -n tracking | sed -n '1,3p;/Root dispersion/p;/Leap/p' || true

say "7/8  config"
if [ -f config.yaml ]; then echo "   config.yaml exists — left alone"
else echo "   >>> copy the generated config.yaml here, then re-run <<<"; fi

say "8/8  facts you need"
echo "   adapters:"; hciconfig 2>/dev/null | grep -E '^hci|BD Address' | sed 's/^/     /' || echo "     (none — is the dongle plugged in?)"
echo "   USB BT devices:"; lsusb | grep -iE '2357|8087|bluetooth' | sed 's/^/     /' || true
for d in /sys/bus/usb/devices/*/; do
  if [ -f "$d/idVendor" ] && grep -qE '2357|8087' "$d/idVendor" 2>/dev/null; then
    echo "     $(basename "$d")  vendor=$(cat "$d/idVendor")  power/control=$(cat "$d/power/control" 2>/dev/null)"
    echo "       -> watchdog.usb_path: $(basename "$d")"
  fi
done
echo
echo "   timezone: $(timedatectl show -p Timezone --value)   synced: $(timedatectl show -p NTPSynchronized --value)"
echo "   free on $DATA: $(df -h --output=avail "$DATA" | tail -1 | tr -d ' ')"
echo
echo "NEXT: put config.yaml in $DEST/capture-host/, then smoke-test:"
echo "  cd $DEST/capture-host && ./.venv/bin/python capture.py --config config.yaml"
