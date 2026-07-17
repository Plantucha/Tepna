# tepna-capture — clockcfg tests
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import clockcfg


def test_dur_to_sec_handles_pretty_and_raw():
    assert clockcfg._dur_to_sec("32s") == 32
    assert clockcfg._dur_to_sec("34min 8s") == 2048
    assert clockcfg._dur_to_sec("5s") == 5
    assert clockcfg._dur_to_sec("2048000000") == 2048        # raw microseconds
    assert clockcfg._dur_to_sec("") is None
    assert clockcfg._dur_to_sec(None) is None


def test_valid_servers_rejects_shell_metachars():
    got = clockcfg._valid_servers(["192.168.0.123", "bad;rm -rf", "pool.ntp.org", "", "a b"])
    assert got == ["192.168.0.123", "pool.ntp.org"]


def test_kv_parse():
    d = clockcfg._kv("NTP=yes\nNTPSynchronized=yes\nTimezone=America/New_York\n")
    assert d["NTP"] == "yes" and d["Timezone"] == "America/New_York"
