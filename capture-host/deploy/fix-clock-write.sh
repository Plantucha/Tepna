#!/usr/bin/env bash
# tepna-capture — deploy/fix-clock-write.sh
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo: sudo bash $0"; exit 1; }
install -d /etc/systemd/system/tepna-capture.service.d
cat > /etc/systemd/system/tepna-capture.service.d/clock-control.conf <<'DROPIN'
[Service]
# Option B (2026-07-25): the monitor's clock controls call tepna-clock.sh under sudo, which
# NoNewPrivileges forbids outright. Relaxed in a drop-in so re-running install-services.sh cannot
# silently revert it. Paired with /etc/sudoers.d/tepna, scoping the grant to two root-owned helpers.
NoNewPrivileges=no
# ProtectSystem=strict mounts the ENTIRE hierarchy read-only except /dev, /proc and /sys — inherited by
# every child the service sudo's. Three narrow exemptions, each verified necessary by an actual failure:
#   /etc/chrony, /etc/systemd/timesyncd.conf.d — where the time daemon's servers are configured
#   /run/chrony                                — chronyc creates its REPLY socket here; without it
#                                                `chronyc reload sources` cannot talk to chronyd at all
#                                                (the same helper succeeds from a plain shell).
# The `-` prefix tolerates a path that does not exist on this box — without it systemd refuses to start.
ReadWritePaths=-/etc/chrony -/etc/systemd/timesyncd.conf.d -/run/chrony
DROPIN
systemctl daemon-reload && systemctl restart tepna-capture && sleep 4
echo "  unit: $(systemctl is-active tepna-capture)"
echo "  ReadWritePaths: $(systemctl show tepna-capture -p ReadWritePaths --value)"
echo
echo "  --- sync through the API ---"
curl -s --max-time 20 -X POST http://127.0.0.1:8760/api/clock/sync | head -c 180; echo
echo "  --- ntp through the API ---"
curl -s --max-time 20 -X POST http://127.0.0.1:8760/api/clock -H 'content-type: application/json' \
  -d '{"servers":["192.168.0.123"],"poll_max_sec":2048}' | head -c 200; echo
