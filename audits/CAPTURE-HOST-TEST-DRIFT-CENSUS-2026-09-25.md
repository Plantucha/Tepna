<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# capture-host test/fixture drift census (2026-09-25)

A report only. **No test was edited.** Population: every `test_*` function in `capture-host/tests/test_*.py` on `origin/main` at `9841c341`, **7730 tests**. "Drift" here means a test whose name or docstring states a claim that its body does not assert. Such a test passes before and after the defect it names, which is the shape of residue `2026-09-23-tests-that-assert-the-defect-they-were-written-for`.

## 1 · Result

An AST pass flagged **177** tests on two shapes: **71** with no `assert`, no `pytest.raises`/`warns` and no assert-helper call, and **106** whose name or docstring says *raise(s)* with no raise check. Every flagged test was classed:

| class | n |
|---|---|
| DRIFT — claim not asserted | 8 |
| COVERAGE-ONLY — claim not distinguished | 3 |
| TERMINATION-ONLY — a regression hangs, not fails | 1 |
| UNDECIDABLE | 1 |
| not drift — sentinel assertion | 5 |
| not drift — no-raise claim held by completion | 146 |
| not drift — the "raise" is a collaborator's, and the outcome is asserted | 12 |
| not drift — no claim | 1 |

**8 tests drift**. 3 more are coverage-only, where one claim is split across three names and none of the three is told apart. 1 can only fail by hanging. All of these are in `capture.py`'s watchdog, poller and CPAP-shadow surface, and all have the same shape: *run one tick, assert nothing, name a behaviour*. That behaviour is the one a mutant would remove.

## 2 · Table — every test read individually

| file | test | claim | what is actually asserted | class |
|---|---|---|---|---|
| `test_capture_coverage_100.py`:1025 | `test_the_charger_poller_stays_asleep_unless_both_switches_are_on` | "the poller must return immediately rather than sit in a 2 s loop" | three `_run(...)` calls, no assertion. `asyncio.sleep` is not patched and there is no `wait_for`, so a regression would hang the suite rather than red it | TERMINATION-ONLY — a regression hangs, not fails |
| `test_capture_defense_gaps.py`:165 | `test_startup_defense_check_with_no_adapter_pinned` | "skip the probe entirely" | the monkeypatched probe is `pytest.fail("must not probe …")` | not drift — sentinel assertion |
| `test_capture_runners.py`:244 | `test_adapter_watchdog_runs_a_healthy_check` | "one healthy pass -> no recovery, no crash" (inline comment) | completion only. That no recovery path ran is not observed | DRIFT — claim not asserted |
| `test_capture_runners.py`:2670 | `test_adapter_watchdog_skips_while_paused` | "the watchdog skips its diagnosis for that tick" | completion only. The skip is not observed, and a watchdog that diagnosed anyway would pass | DRIFT — claim not asserted |
| `test_capture_runners.py`:2712 | `test_adapter_watchdog_stops_after_the_power_cycle_cap` | "logs CRITICAL and stops auto-recovering" | completion only. Neither the CRITICAL log nor the stop is asserted (no `caplog`, no cycle count) | DRIFT — claim not asserted |
| `test_capture_runners.py`:2746 | `test_clock_watchdog_skips_while_paused` | "the pull-in-progress skip" (inline comment) | completion only. The skip is not observed | DRIFT — claim not asserted |
| `test_capture_runners.py`:2832 | `test_clock_watchdog_handles_a_busy_slot` | "handles a busy slot" | `_clock_watchdog_error_case` runs one tick and asserts nothing. Busy, transient and hard are three classes with different handling, and none is told apart | COVERAGE-ONLY — claim not distinguished |
| `test_capture_runners.py`:2838 | `test_clock_watchdog_handles_a_transient_error` | "handles a transient error" | as above | COVERAGE-ONLY — claim not distinguished |
| `test_capture_runners.py`:2842 | `test_clock_watchdog_handles_a_hard_error` | "handles a hard error" | as above | COVERAGE-ONLY — claim not distinguished |
| `test_capture_runners.py`:2909 | `test_rssi_poller_skips_while_paused` | "rssi poller skips while paused" | completion only. No poll count is read | DRIFT — claim not asserted |
| `test_capture_runners.py`:3238 | `test_main_pull_closure_without_a_ring_raises` | "raises" in the name | asserts `"no O2Ring" in holder.get("err", "")`: the raise is caught and its message asserted | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_capture_runners.py`:3595 | `test_qc_poller_keeps_the_night_when_the_wear_scan_raises` | "raises" in the name | the wear scan is the raiser. The night's summary is asserted | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_capture_runners.py`:6548 | `test_stop_ends_a_PAUSED_session_even_with_a_real_sleep` | "stop ends a PAUSED session" | `_run_bounded(go(), 6.0)` is `asyncio.wait_for`, so a non-ending session raises `TimeoutError` | not drift — sentinel assertion |
| `test_capture_runners.py`:7915 | `test_an_unmeasured_BRANCH_raises_the_AES_warning` | "raises" in the name | "raises" means emits a warning. `caplog` message asserted | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_coverage_gap_fill.py`:42 | `test_unarchived_nights_keeps_everything_when_the_dest_probe_raises` | "raises" in the name | `os.path.isdir` is the raiser. The return value is asserted | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_coverage_medium_modules.py`:204 | `test_zero_flush_interval_flushes_on_every_write` | "flushes on every write" | `write(w); w.close()`. No flush is observed (no flush counter or file content read before close) | DRIFT — claim not asserted |
| `test_cpap_detect.py`:176 | `test_run_stops_immediately_when_should_stop_true` | "stops immediately" | the injected `sleep` raises `AssertionError("should not sleep")` | not drift — sentinel assertion |
| `test_cpap_edf_sa2.py`:285 | `test_a_header_only_buffer_is_left_alone_rather_than_crashing` | "left alone rather than crashing" | `write_edf(edf)  # must not raise` | not drift — no-raise claim held by completion |
| `test_cpap_events.py`:421 | `test_a_recorder_that_raises_does_not_end_the_stream` | "raises" in the name | the recorder is the raiser. `len(batches) == 1 and c.events == 1` | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_cpap_shadow_runner.py`:285 | `test_poll_cycle_does_not_leak_the_link_on_a_bad_connect_contract` | "does not leak the link" | asserts only that the unpack error propagates and that no `NameError` masks it. The `calls` list that would record a `disconnect` is built and never read, so "does not leak" is not asserted | DRIFT — claim not asserted |
| `test_cpap_shadow_runner.py`:440 | `test_recording_a_failure_can_never_become_a_second_failure` | "can never become a second failure" | `# must not raise` | not drift — no-raise claim held by completion |
| `test_cpap_shadow_runner.py`:465 | `test_NO_HOOK_IS_NOT_AN_ERROR` | "no hook is not an error" | `# must simply return` | not drift — no-raise claim held by completion |
| `test_cpap_shadow_runner.py`:469 | `test_A_HOOK_THAT_RAISES_DOES_NOT_BECOME_A_SECOND_FAILURE` | "does not become a second failure" | `# must not raise` | not drift — no-raise claim held by completion |
| `test_cpap_stream.py`:627 | `test_controller_stop_survives_a_pump_that_errored_and_a_disconnect_that_raises` | "raises" in the name | the pump and the disconnect are the raisers. The clean stop state is asserted | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_cpap_stream.py`:656 | `test_controller_stop_handles_a_task_that_raises_on_cancel` | "raises" in the name | the pump raises on cancel. The clean stop is asserted | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_link_distress_wire.py`:137 | `test_a_FAILING_scan_does_not_cost_the_watchdog_its_poll` | "does not cost the watchdog its poll" | completion only. That the poll ran after the scan exploded is not observed | DRIFT — claim not asserted |
| `test_live_loss_status.py`:63 | `test_a_guard_that_raises_does_not_end_the_status_loop` | "raises" in the name | the guard is the raiser. A `caplog` line and the findings are asserted | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_o2ring.py`:692 | `test_main_auth` | none (`test_main_auth`) | a smoke run of `main auth` | not drift — no claim |
| `test_oxyii_ppg_file_family.py`:229 | `test_FTYPE_ZERO_IS_STILL_ACCEPTED_SO_AN_OLD_CONFIG_KEEPS_BOOTING` | "ftype 0 still accepted" | completion. The paired `ftype: 3` test (line 221) raises from the same guard (`capture.py` `if int(pcfg.get("ftype", 0)) != 0:`), so completion here is meaningful | not drift — no-raise claim held by completion |
| `test_oxyii_storm.py`:165 | `test_the_block_is_json_serialisable` | "json serialisable" | `json.loads(json.dumps(...))` raises on a non-serialisable block | not drift — no-raise claim held by completion |
| `test_polar_psftp_client.py`:294 | `test_set_local_time_sends_an_allowed_query` | "sends an allowed query" | `_run(go())  # must complete`. Whether `FakeClient` rejects a disallowed query, which would make completion the assertion, was not read | UNDECIDABLE |
| `test_presence_wire.py`:315 | `test_the_scan_loop_started_during_shutdown_does_nothing` | "does nothing" | the injected `_scan` raises `AssertionError("scanned instead of refusing to start")` | not drift — sentinel assertion |
| `test_radioclock.py`:708 | `test_the_writers_are_CLOSED_even_when_the_stream_raises` | "raises" in the name | the stream raises. The writers' closed output is asserted | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_rate_intent.py`:202 | `test_a_write_failure_on_the_note_does_not_end_the_recording` | "does not end the recording" | `# must not raise` | not drift — no-raise claim held by completion |
| `test_reconnect_backoff_cap.py`:152 | `test_config_override_raises_the_cap` | "raises" in the name | "raises" means increases. The backoff schedule is asserted | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_recording_truth.py`:254 | `test_a_raising_bond_check_never_kills_the_capture_task` | "never kills the capture task" | `# must simply return, not raise` | not drift — no-raise claim held by completion |
| `test_run_sidecar.py`:384 | `test_a_sidecar_close_that_raises_is_logged_not_swallowed` | "raises" in the name | the sidecar close is the raiser. `caplog` asserted | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_worn_precedence.py`:38 | `test_the_brief_carries_the_table_the_code_renders` | "the brief carries the table" | `pytest.fail(...)` when the rendered table is absent | not drift — sentinel assertion |
| `test_writers.py`:346 | `test_a_writer_whose_flush_raises_is_still_released` | "raises" in the name | flush is the raiser. The writer release is asserted | not drift — the "raise" is a collaborator's, and the outcome is asserted |
| `test_writers_sidecars.py`:290 | `test_close_is_idempotent_across_every_writer` | "close is idempotent" | a double `close()` must not raise | not drift — no-raise claim held by completion |
| `test_writers_sidecars.py`:771 | `test_oxylife_writer_close_is_guarded_and_idempotent` | "close is guarded and idempotent" | double close plus flush-after-close must not raise | not drift — no-raise claim held by completion |

## 3 · Appendix — flagged tests classed by the heuristic, not read individually

The 136 tests below were classed from their AST shape and docstring:

- **Zero-assertion tests whose only claim is "does not raise".** Completion proves that claim.
- **"Raise" matches that say nothing raises** (*"raises nothing"*, *"never raises"*). The test asserts a further outcome, and completion covers the no-raise half.

This rests on the heuristic's sub-label (`no-raise claim` / `no-raise smoke`), not on a per-test read. The drift in section 2 came entirely from tests whose claim was *behavioural*, and those were all read. A row below that hides a behavioural claim behind a no-raise docstring would be missed.

| file | test | class |
|---|---|---|
| `test_accraw_rate_and_ns.py`:31 | `test_a_stream_with_no_device_clock_writes_the_ns_column_BLANK_not_zero` | not drift — no-raise claim held by completion |
| `test_acq_evidence.py`:252 | `test_a_failing_sidecar_write_never_damages_the_capture` | not drift — no-raise claim held by completion |
| `test_acq_evidence_cpap.py`:487 | `test_a_failing_sidecar_write_is_logged_not_raised` | not drift — no-raise claim held by completion |
| `test_acq_evidence_cpap.py`:725 | `test_lost_starts_at_zero_so_no_counters_means_no_fabricated_loss` | not drift — no-raise claim held by completion |
| `test_adapter_hci.py`:206 | `test_no_pinned_radio_and_no_root_records_nothing_and_raises_nothing` | not drift — no-raise claim held by completion |
| `test_as11_clock.py`:148 | `test_sidecar_double_close_is_safe` | not drift — no-raise claim held by completion |
| `test_ble_discovery.py`:191 | `test_no_adapters_at_all_raises_rather_than_reporting_absence` | not drift — no-raise claim held by completion |
| `test_blestats.py`:110 | `test_counting_never_raises_into_the_capture_path` | not drift — no-raise claim held by completion |
| `test_bluez_wedge_wire.py`:241 | `test_AN_UNWRITABLE_JOURNAL_DOES_NOT_ABORT_THE_RECOVERY` | not drift — no-raise claim held by completion |
| `test_bonding.py`:508 | `test_a_btctl_timeout_yields_empty_text_rather_than_raising` | not drift — no-raise claim held by completion |
| `test_capture.py`:52 | `test_import_capture_needs_no_bleak` | not drift — no-raise claim held by completion |
| `test_capture.py`:242 | `test_usb_rebind_survives_a_raising_helper_path` | not drift — no-raise claim held by completion |
| `test_capture_clock_and_health.py`:397 | `test_the_availability_probe_survives_a_raising_helper_path` | not drift — no-raise claim held by completion |
| `test_capture_coverage_100.py`:1601 | `test_registration_tolerates_a_task_list_that_no_longer_holds_the_incumbent` | not drift — no-raise claim held by completion |
| `test_capture_defense_gaps.py`:127 | `test_an_unprobeable_archive_dest_is_silent_rather_than_alarming` | not drift — no-raise claim held by completion |
| `test_capture_defense_gaps.py`:159 | `test_startup_defense_check_survives_an_unreadable_control_file` | not drift — no-raise claim held by completion |
| `test_capture_defense_gaps.py`:172 | `test_startup_defense_check_survives_an_unreadable_proc_status` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:240 | `test_adapter_watchdog_disabled_returns_immediately` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:256 | `test_clock_watchdog_disabled_returns_immediately` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:1440 | `test_connect_swallows_a_disconnect_error_in_teardown` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:1823 | `test_run_polar_feature_read_failure_is_logged` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:1908 | `test_run_polar_battery_read_failure_is_swallowed` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:2104 | `test_pmd_probe_returns_when_the_probe_is_unset` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:2121 | `test_pmd_probe_swallows_a_write_error` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:2204 | `test_run_viatom_start_cmd_write_failure_is_logged` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:2507 | `test_connect_scan_swallows_a_disconnect_error` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:2574 | `test_run_polar_repair_error_is_swallowed` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:2623 | `test_status_loop_swallows_a_write_error` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:2678 | `test_adapter_watchdog_swallows_a_btctl_info_error` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:2691 | `test_adapter_watchdog_logs_recovery_and_survives_a_disconnect_error` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:2847 | `test_host_clock_poller_swallows_a_read_error` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:2880 | `test_rssi_poller_swallows_a_writer_create_error` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:3162 | `test_main_pull_closure_dispatches_and_errors` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:3362 | `test_the_disk_low_alert_names_the_HELD_BACKUP_when_that_is_the_real_cause` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:3390 | `test_storage_poller_swallows_an_error` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:3502 | `test_sd_watchdog_is_a_noop_without_a_configured_watchdog` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:3664 | `test_qc_poller_swallows_an_error` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:3775 | `test_archive_poller_disabled_returns_immediately` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:3936 | `test_archive_poller_swallows_an_error` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:4027 | `test_safe_disconnect_swallows_a_hanging_disconnect` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:4056 | `test_run_polar_ctrl_write_failure_is_not_a_rejection` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:4106 | `test_keep_running_restarts_a_crashing_task` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:4520 | `test_run_viatom_header_only_remove_error_is_swallowed` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:5043 | `test_autopull_survives_an_unreachable_ring` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:5307 | `test_a_control_point_read_that_never_answers_cannot_freeze_the_device_task` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:5317 | `test_an_hr_subscribe_that_never_answers_cannot_freeze_the_device_task` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:6897 | `test_run_oxyii_settings_write_failure_surfaces_in_the_verdict` | not drift — no-raise claim held by completion |
| `test_capture_runners.py`:6928 | `test_run_oxyii_rtc_poll_failure_costs_only_the_reading` | not drift — no-raise claim held by completion |
| `test_clock_offset.py`:403 | `test_paxson_skips_a_pair_of_minima_that_share_a_timestamp` | not drift — no-raise claim held by completion |
| `test_clocksync_sidecar.py`:110 | `test_no_root_means_no_row_and_no_error` | not drift — no-raise claim held by completion |
| `test_coverage_branch_arms.py`:156 | `test_a_client_without_acquire_mtu_still_connects` | not drift — no-raise claim held by completion |
| `test_coverage_gap_fill.py`:21 | `test_pct_of_nothing_is_none_not_an_exception` | not drift — no-raise claim held by completion |
| `test_coverage_medium_modules.py`:28 | `test_stream_writer_fsync_path_and_idempotent_close` | not drift — no-raise claim held by completion |
| `test_coverage_medium_modules.py`:50 | `test_every_sidecar_fsyncs_and_survives_double_close` | not drift — no-raise claim held by completion |
| `test_coverage_medium_modules.py`:188 | `test_a_writer_close_swallows_a_raising_handle` | not drift — no-raise claim held by completion |
| `test_coverage_small_modules.py`:194 | `test_push_survives_a_queue_that_races_empty_or_full` | not drift — no-raise claim held by completion |
| `test_coverage_small_modules.py`:234 | `test_clockcfg_run_times_out_on_a_slow_command` | not drift — no-raise claim held by completion |
| `test_cpap_autostart_wire.py`:76 | `test_an_unwriteable_record_does_not_raise` | not drift — no-raise claim held by completion |
| `test_cpap_autostart_wire.py`:396 | `test_a_falsy_path_is_skipped_and_cannot_kill_the_loop` | not drift — no-raise claim held by completion |
| `test_cpap_boot_catchup.py`:173 | `test_an_UNWRITEABLE_marker_does_not_cost_the_harvest` | not drift — no-raise claim held by completion |
| `test_cpap_boot_catchup.py`:214 | `test_NO_JOURNAL_seeds_nothing_and_does_not_raise` | not drift — no-raise claim held by completion |
| `test_cpap_harvest_io.py`:551 | `test_wpa_up_still_returns_when_the_psk_conf_cannot_be_unlinked` | not drift — no-raise claim held by completion |
| `test_cpap_harvest_io.py`:822 | `test_a_server_that_declares_nothing_usable_reports_zero_not_a_crash` | not drift — no-raise claim held by completion |
| `test_cpap_inventory_adapter.py`:222 | `test_a_None_dest_root_is_UNCONSULTED_and_does_not_raise` | not drift — no-raise claim held by completion |
| `test_cpap_inventory_wire.py`:59 | `test_a_prior_summary_that_is_not_an_object_is_ignored` | not drift — no-raise claim held by completion |
| `test_cpap_job.py`:80 | `test_an_unknown_state_raises_rather_than_being_stored` | not drift — no-raise claim held by completion |
| `test_cpap_job.py`:199 | `test_an_unwritable_ledger_warns_and_does_not_raise` | not drift — no-raise claim held by completion |
| `test_cpap_no_sudo.py`:243 | `test_an_uncreatable_control_dir_warns_and_does_not_raise` | not drift — no-raise claim held by completion |
| `test_cpap_poller.py`:323 | `test_a_barren_pull_is_NOT_ok` | not drift — no-raise claim held by completion |
| `test_cpap_reachable.py`:128 | `test_any_failure_answers_false_rather_than_raising` | not drift — no-raise claim held by completion |
| `test_cpap_spool.py`:231 | `test_a_reserved_round_carrying_more_advances_instead_of_stalling` | not drift — no-raise claim held by completion |
| `test_cpap_stream.py`:1236 | `test_settle_degrades_when_bleak_exposes_no_rebuild` | not drift — no-raise claim held by completion |
| `test_cpap_stream_watch_wiring.py`:107 | `test_an_UNREADABLE_edf_does_not_stop_the_readable_ones` | not drift — no-raise claim held by completion |
| `test_devcaps.py`:105 | `test_recording_never_raises_into_the_capture_path` | not drift — no-raise claim held by completion |
| `test_failover_ladder_characterization.py`:243 | `test_BLUEZ_UNKNOWN_OBJECT_IS_DELIBERATELY_AN_ABSENCE` | not drift — no-raise claim held by completion |
| `test_find_unwired.py`:104 | `test_a_root_with_NO_capture_py_reports_no_keys_rather_than_crashing` | not drift — no-raise claim held by completion |
| `test_link_distress_wire.py`:124 | `test_a_reporting_FAILURE_does_not_undo_the_switch` | not drift — no-raise claim held by completion |
| `test_loss_audit.py`:221 | `test_an_undecodable_byte_does_not_lose_the_night` | not drift — no-raise claim held by completion |
| `test_mmeta.py`:287 | `test_invalidation_of_an_unreadable_meta_does_not_raise` | not drift — no-raise claim held by completion |
| `test_mutation_diff.py`:620 | `test_in_glob_scope_cannot_see_status_by_construction` | not drift — no-raise claim held by completion |
| `test_mutation_triage.py`:206 | `test_no_reachable_mutants_is_zero_share_not_a_division` | not drift — no-raise claim held by completion |
| `test_mutation_triage.py`:251 | `test_a_call_through_a_SUBSCRIPT_or_a_RETURNED_CALLABLE_is_handled_not_crashed` | not drift — no-raise claim held by completion |
| `test_night_report.py`:145 | `test_read_night_treats_every_unreadable_input_as_absent` | not drift — no-raise claim held by completion |
| `test_nightqc.py`:653 | `test_size_of_an_unreadable_path_is_zero` | not drift — no-raise claim held by completion |
| `test_nightqc.py`:3214 | `test_the_poller_joins_a_wear_scan_and_survives_its_failure` | not drift — no-raise claim held by completion |
| `test_no_deprecated_apis.py`:61 | `test_no_datetime_utcnow_anywhere` | not drift — no-raise claim held by completion |
| `test_no_deprecated_apis.py`:85 | `test_no_bare_bleak_adapter_kwarg` | not drift — no-raise claim held by completion |
| `test_o2ring_ppg_gap.py`:255 | `test_a_lossy_link_does_not_drag_the_rate_estimate` | not drift — no-raise claim held by completion |
| `test_optical_worn.py`:94 | `test_min_samples_zero_still_needs_ONE_sample` | not drift — no-raise claim held by completion |
| `test_oxy_inventory.py`:165 | `test_append_survives_a_second_call_into_an_existing_tree` | not drift — no-raise claim held by completion |
| `test_oxy_inventory.py`:175 | `test_the_ledger_round_trips_NON_ASCII` | not drift — no-raise claim held by completion |
| `test_oxy_transfer.py`:665 | `test_both_targets_are_legal_link_transitions_from_PULLING` | not drift — no-raise claim held by completion |
| `test_oxyii.py`:411 | `test_parse_rt_ppg_is_bounded_by_the_buffer_not_the_declared_count` | not drift — no-raise claim held by completion |
| `test_oxyii.py`:748 | `test_AN_OUT_OF_RANGE_TIMESTAMP_DOES_NOT_RAISE` | not drift — no-raise claim held by completion |
| `test_pmd_arrival_writer.py`:809 | `test_two_streams_too_short_to_measure_leave_transport_None` | not drift — no-raise claim held by completion |
| `test_pmd_arrival_writer.py`:1023 | `test_device_stamp_constant_reads_the_FIRST_stamp_and_survives_a_single_one` | not drift — no-raise claim held by completion |
| `test_pmd_delta.py`:169 | `test_a_frame_yielding_nothing_is_not_flagged_truncated` | not drift — no-raise claim held by completion |
| `test_polar_pmd.py`:705 | `test_decode_frame_masks_the_recording_type_bit_off_the_measurement_type` | not drift — no-raise claim held by completion |
| `test_polar_pmd.py`:759 | `test_decode_frame_rejects_a_header_only_frame_at_the_boundary` | not drift — no-raise claim held by completion |
| `test_polar_psftp_client.py`:339 | `test_bt_disconnect_runs_and_swallows_errors` | not drift — no-raise claim held by completion |
| `test_polar_psftp_client.py`:480 | `test_aexit_swallows_stop_notify_and_disconnect_errors` | not drift — no-raise claim held by completion |
| `test_polar_psftp_client.py`:1249 | `test_the_mtu_is_acquired_before_the_frame_size_is_derived` | not drift — no-raise claim held by completion |
| `test_probe_equivalence_diff.py`:204 | `test_a_canary_that_cannot_be_APPLIED_is_also_blind` | not drift — no-raise claim held by completion |
| `test_probe_opcode_sweeps.py`:756 | `test_oxyii_the_report_is_readable_and_survives_unserialisable_values` | not drift — no-raise claim held by completion |
| `test_probe_read_char.py`:98 | `test_read_identity_survives_every_characteristic_failing_but_one` | not drift — no-raise claim held by completion |
| `test_probe_verity_offline.py`:159 | `test_the_link_is_handed_the_full_three_argument_exit` | not drift — no-raise claim held by completion |
| `test_proc_util.py`:91 | `test_kill_never_raises_on_an_already_dead_child` | not drift — no-raise claim held by completion |
| `test_psftp_protocol.py`:120 | `test_truncation_is_detected_at_the_OUTER_record_too` | not drift — no-raise claim held by completion |
| `test_pull_session.py`:749 | `test_a_too_small_mtu_warns_loudly_instead_of_failing_silently` | not drift — no-raise claim held by completion |
| `test_radioclock.py`:638 | `test_flush_and_close_never_raise_on_a_closed_handle` | not drift — no-raise claim held by completion |
| `test_radioclock.py`:646 | `test_a_close_that_FAILS_is_swallowed_because_the_night_is_already_written` | not drift — no-raise claim held by completion |
| `test_radioclock.py`:1195 | `test_run_without_a_re_arm_callback_is_unchanged` | not drift — no-raise claim held by completion |
| `test_rec_to_psl.py`:344 | `test_a_stamp_that_parses_as_text_but_not_as_a_date_yields_no_anchor` | not drift — no-raise claim held by completion |
| `test_resource_orchestration.py`:272 | `test_A_DUP_ALREADY_CLOSED_IS_NOT_AN_ERROR_AND_STILL_RECORDS` | not drift — no-raise claim held by completion |
| `test_resource_orchestration.py`:284 | `test_A_VANISHED_HANDLE_QUEUES_NOTHING_AND_IS_NOT_AN_ERROR` | not drift — no-raise claim held by completion |
| `test_resource_orchestration.py`:454 | `test_THE_DRAIN_IS_A_NO_OP_WHEN_NOTHING_EVER_STARTED` | not drift — no-raise claim held by completion |
| `test_run_polar_live_contract.py`:467 | `test_a_frame_the_decoder_REJECTS_puts_the_REASON_on_the_card` | not drift — no-raise claim held by completion |
| `test_run_sidecar.py`:331 | `test_emit_run_on_a_closed_sidecar_is_a_no_op` | not drift — no-raise claim held by completion |
| `test_scan_coexistence.py`:41 | `test_parse_arrivals_reads_the_semicolon_schema_and_drops_junk` | not drift — no-raise claim held by completion |
| `test_settings_schema.py`:320 | `test_set_nested_walks_every_parent_and_assigns_the_last_key` | not drift — no-raise claim held by completion |
| `test_storage_targets_gaps.py`:86 | `test_under_allowed_root_skips_a_root_it_cannot_compare` | not drift — no-raise claim held by completion |
| `test_system_file_drift.py`:77 | `test_a_json_scalar_is_rejected_not_indexed` | not drift — no-raise claim held by completion |
| `test_timeline.py`:625 | `test_a_row_that_stops_before_the_rssi_column_reads_a_blank_not_a_crash` | not drift — no-raise claim held by completion |
| `test_vigil_sh.py`:127 | `test_start_returns_instead_of_becoming_the_daemons_parent` | not drift — no-raise claim held by completion |
| `test_webmon_daemon_contract.py`:149 | `test_a_deferred_RESTART_fires_the_restart_verb_and_no_other` | not drift — no-raise claim held by completion |
| `test_webmon_endpoints.py`:431 | `test_sse_stream_survives_an_abrupt_client_disconnect` | not drift — no-raise claim held by completion |
| `test_webmon_error_contract.py`:228 | `test_the_config_temp_file_is_written_beside_the_config` | not drift — no-raise claim held by completion |
| `test_webmon_error_contract.py`:781 | `test_every_route_the_monitor_calls_survives_a_bare_config` | not drift — no-raise claim held by completion |
| `test_webmon_settings_contract.py`:57 | `test_the_device_model_selects_its_measured_cost_table` | not drift — no-raise claim held by completion |
| `test_webmon_timeline_contract.py`:115 | `test_a_cached_hit_returns_the_stored_PAYLOAD_not_its_timestamp` | not drift — no-raise claim held by completion |
| `test_wire_replay.py`:117 | `test_the_shipped_parsers_survive_every_recorded_reply` | not drift — no-raise claim held by completion |
| `test_worn_record.py`:152 | `test_record_worn_decision_writes_once_and_then_holds_for_the_cadence` | not drift — no-raise claim held by completion |
| `test_writers_sidecars.py`:303 | `test_flush_after_close_does_not_raise` | not drift — no-raise claim held by completion |
| `test_writers_sidecars.py`:559 | `test_the_flush_clock_survives_more_than_one_flush` | not drift — no-raise claim held by completion |
| `test_writers_sidecars.py`:654 | `test_ring_clock_log_close_is_guarded` | not drift — no-raise claim held by completion |
| `test_writers_sidecars.py`:790 | `test_oxylife_writer_close_swallows_a_raising_handle` | not drift — no-raise claim held by completion |

## 4 · Method, and what was not examined

- **Instrument.** `ast` over each test file. A test is flagged when (a) it contains no `assert` node, no `pytest.raises`/`pytest.warns` call and no call to a local helper that itself asserts or is named `assert*`/`check*`/`expect*`, or (b) its name/docstring matches `raise(s)` with no raise check in the body. Mock-call-only assertions (`assert_called*`) were counted as assertions.
- **Sentinel assertions count.** An injected callable that calls `pytest.fail` or raises `AssertionError` is an assertion, and those tests are classed not drift.
- **Not examined:**
  - Tests that assert *something*, but not the claimed thing. The bound-asserted-at-its-overrun-value case in residue `2026-09-23-tests-that-assert-the-defect-they-were-written-for` is such a test. This census only finds tests that assert *nothing* or no raise. The larger class needs a per-test semantic read.
  - Fixtures and golden files. No `capture-host/tests/fixtures/**` file was compared with the code that should produce it.
  - Tests outside `capture-host/tests/` (for example `tests/dex-tests.js`).
  - Whether each DRIFT test's claim actually holds in code. The census says only that the test does not check it.
- The pytest suite was not run. Rule 0 not run (cloud session).
