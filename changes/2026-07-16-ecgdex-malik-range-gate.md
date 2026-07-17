<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ECGDex]
brief: none
---
Align ECGDex _malikCorrect's RR range gate to 300–2000 ms (matching buildNN and ECGDex's documented window) so the self-vs-device HRV comparison is genuinely apples-to-apples — a device beat in the 2000–2200 band no longer survives on the device side alone and biases dRMSSD/dSDNN.
