<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
Invoke the USB-autosuspend script through bash in ExecStart. Every shell script in this repo is tracked mode 644 and run as `bash <script>`, so naming it directly made systemd fail the unit with 203/EXEC on first install — it reported `enabled` while the wedge defence stayed disarmed. Going through the interpreter also survives a checkout on a filesystem that drops exec bits.
