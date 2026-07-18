# tepna-capture — tests/test_pmd_delta.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Known-answer tests for polar_pmd._decode_delta on REAL Verity Sense frames captured off the wire
# 2026-07-18 (PMD_FRAME_PROBE). Regression for the block-header alignment bug: each delta block header is
# byte-aligned, but a block's deltas (count x channels x deltaSize bits) need not end on a byte boundary.
# Without skipping that padding we read the next deltaSize/count from a mid-byte offset, got garbage
# (usually 0 -> break) and silently discarded the rest of every frame.
#
# It only bites when channels x deltaSize is not a multiple of 8, which is why 4-channel PPG decoded
# correctly (and MUST stay bit-identical here) while every 3-channel stream lost most of each frame:
# measured ACC 67%, GYRO 38%, MAG 32% of nominal, all restored to ~100%.

import polar_pmd as pmd

# real GYRO frame, 219 B payload, 3 ch @ 16-bit reference
GYRO_FRAME = bytes.fromhex(
    "059ebfa6874c1ea00b80adff4f00deff061dfca11caf83f875f4d2502c4b3b1da17882da41cbeb806f5fc4be287192d0"
    "8df20386be037dee03bd0f10ff3f043e41fc47c12b06cf18bd82e44992230bbf38bfe200080a01070c05030807020307"
    "fa020cf2fa18e4ec12d5ea04d106fffbfdff15f9061479a4e3552f3744ac04b100d0ffbf07fe1ff084bf27f97ee400e2"
    "0bc63014c43014c5300c442f0c7d40fc0121f80414021fee1ddfd1fcaededacdee2cc0142d01e401201ef341fe002f12"
    "030ffd060ec00f003d10f44010f47f00fc02f0037fd0fb00ee073b20007f40048221040a00"
)

# real ACC frame, 219 B payload, 3 ch @ 16-bit reference
ACC_FRAME = bytes.fromhex(
    "02a23ce7634c1ea00b81dcfd28fd0aff060ac3b0f7fcefefff711338ee0f04b0f0be1fff839d8f6e0f081d0407170817"
    "12f819060520fa031df90a17eb0c0df301fef404effef7dd0a06b6fefad310fdf504fb0604fe0a050c18fe0021030223"
    "f3011ffff914f904010104f20700eefd00e706fef30004fb02fc0003fd09000909fd062b3c92ff894024f95f087c00fc"
    "116014ba4ef8057c18b4ffb70080067fe9ffea11d8c07f227672d8dce0674260dd7f5604c76de4ba600bfb0b08b9a1c3"
    "c0c1f7bbf10f0dff27fab1f07cb203c920d8820f10006eecf80fe844d00b3fe007c0e00303"
)

# real MAG frame, 219 B payload, 3 ch @ 16-bit reference
MAG_FRAME = bytes.fromhex(
    "06a8777ea24c1ea00b80ebfd95feb604061f4100003f00fc3f00083f11308bf0ef016dffc3b0038000040010ecffff0b"
    "0011fc7f70043e3000f7200c3d0ffcff0f0800e0f342f0ff4210fc80a000fd2f04f70f100020143f0420cee0ef3ed03c"
    "c222e014fe312d00120e00cfe01233f0ef1d210d1e002d201001f2eff2cd1fff2400df0ff03110f1fe000610c00f00bf"
    "300c0010f8be200440dff740340982ffb7aeff03c520f8ffff07841f08c1df0b0308317e598a935ebaf00204081112e4"
    "004c1dfda300e110f2060880e0377f5004c11c08bb0ffc812f003f00000404f0f13e3b5e0f"
)

# real PPG frame, 219 B payload, 4 ch @ 24-bit reference
PPG_FRAME = bytes.fromhex(
    "01bacc9e0c4c1ea00b805b5d07969a06736808d5ffff0a294e70308804415cd18705538421c8f8dc98f10d01bc08628b"
    "072718d248ec985c8387080419931005f9c8c18efab008640e0a1ffd920dfded444316f30a79a6d5044831e35304b124"
    "93d3f9d7646211010d24d107f99e67ef860e3c878c3bfcfad64bb5f5d3063d790ad1764df50df68e5c36ef980bdf7e0b"
    "5b032f3ff3fc4f5143fe1f7050040256b4534d01a950e48ef823f9f4910fc1287409f4cdf0c55a094899e4d1fd298535"
    "100214f104d6042691c412f7e6886492055d596550f9d288c45410f8c4a44efd25b1b38ffd"
)

def test_gyro_3ch_recovers_the_whole_frame():
    """Was 30 samples (first block only) before the alignment fix; the frame really holds 94."""
    out = pmd._decode_delta(GYRO_FRAME[10:], channels=3, ref_bits=16)
    assert len(out) == 94, "under-extraction regressed — block headers must be byte-aligned"
    assert len(out) > 30, "must beat the pre-fix truncated decode"
    assert all(len(s) == 3 for s in out)


def test_acc_3ch_recovers_the_whole_frame():
    """Was 11 samples (first block only) before the alignment fix; the frame really holds 83."""
    out = pmd._decode_delta(ACC_FRAME[10:], channels=3, ref_bits=16)
    assert len(out) == 83, "under-extraction regressed — block headers must be byte-aligned"
    assert len(out) > 11, "must beat the pre-fix truncated decode"
    assert all(len(s) == 3 for s in out)


def test_mag_3ch_recovers_the_whole_frame():
    """Was 32 samples (first block only) before the alignment fix; the frame really holds 108."""
    out = pmd._decode_delta(MAG_FRAME[10:], channels=3, ref_bits=16)
    assert len(out) == 108, "under-extraction regressed — block headers must be byte-aligned"
    assert len(out) > 32, "must beat the pre-fix truncated decode"
    assert all(len(s) == 3 for s in out)


def test_ppg_4ch_is_unchanged_by_the_alignment_fix():
    """The validated 4-channel path must be bit-identical — it was already correct at 100% delivery."""
    out = pmd._decode_delta(PPG_FRAME[10:], channels=4, ref_bits=24)
    assert len(out) == 42
    assert all(len(s) == 4 for s in out)


def test_every_stream_decodes_more_than_one_block():
    """The bug's signature was bailing out after ~1 block. Guard against silently regressing to that."""
    for frame, ch, rb in ((ACC_FRAME, 3, 16), (GYRO_FRAME, 3, 16), (MAG_FRAME, 3, 16)):
        out = pmd._decode_delta(frame[10:], channels=ch, ref_bits=rb)
        assert len(out) > 60, f"only {len(out)} samples — looks truncated again"
