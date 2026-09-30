"""Generate golden test fixtures from the CLI's own Python code.

The web app's protocol core is a port of the CLI (gp200.py). These fixtures
pin the port to the CLI's exact behavior: each case is a raw device dump fed
through the CLI's own build_prst_from_dump + normalize_export_dynamic_fields
and export file naming, and the JS tests assert byte-identical results.

Usage (from this repo's root):
    python tools/make_golden.py <path to GP-200-Patch-Manager checkout>

Writes tests/fixtures/golden/*.bin|*.prst, golden.json, and skeleton.prst.
Re-run whenever the CLI's export logic changes, and commit the result.
No MIDI hardware or MIDI library is needed: `mido` is stubbed out, since
only pure byte-manipulation functions are called.
"""
import base64
import hashlib
import importlib.util
import json
import subprocess
import sys
import types
from pathlib import Path

if len(sys.argv) != 2:
    sys.exit(__doc__)
cli_root = Path(sys.argv[1]).resolve()
out_dir = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "golden"
out_dir.mkdir(parents=True, exist_ok=True)

sys.modules["mido"] = types.ModuleType("mido")  # pure functions only; never used
spec = importlib.util.spec_from_file_location("gp200", cli_root / "gp200.py")
gp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gp)

skeleton = bytes(gp._validate_skeleton(base64.b64decode(gp._EMBEDDED_SKELETON_B64), "embedded"))
(out_dir.parent / "skeleton.prst").write_bytes(skeleton)
base_dump = skeleton[gp.CONTENT_FILE_START:gp.CHECKSUM_OFF]  # 1182 bytes, same as the CLI's tests


def dump_with(edits=(), name=None, length=None):
    d = bytearray(base_dump)
    if name is not None:
        d[28:44] = name.ljust(16, b"\x00")[:16]
    for file_off, value in edits:
        d[file_off - gp.CONTENT_FILE_START] = value
    if length is not None:
        d = d[:length] if length <= len(d) else d + bytes(length - len(d))
    return bytes(d)


def set_model(d, block, code):
    d = bytearray(d)
    base = gp.DUMP_EFFECT_BLOCK_START + block * gp.DUMP_EFFECT_BLOCK_SIZE + gp.DUMP_EFFECT_MODEL_OFFSET
    d[base:base + 4] = code.to_bytes(4, "little")
    return bytes(d)


tail_edits = [(1120 + q * 12 + k, 0x40 + q + k) for q in range(8) for k in (5, 6, 7, 10, 11)]
cases = {
    "plain": (0, dump_with(name=b"Clean Tone")),
    # Every byte normalize_export_dynamic_fields should zero, set non-zero --
    # plus the slot-mirror bytes 0x34/0x90 it must LEAVE alone.
    "dynamic_fields": (145, dump_with(
        edits=[(0x2E, 0x91), (0x3E, 0x07), (0x40, 0x09), (0x43, 0xB7), (0x9F, 0x36),
               (0x34, 0x91), (0x90, 0x91)] + tail_edits,
        name=b"Blue Sparkle")),
    "empty_name": (5, dump_with(name=b"")),
    "unsafe_chars": (63, dump_with(name=b' a/b:c*d?"e<f>|. ')),
    "only_dots": (100, dump_with(name=b"...")),
    "non_ascii": (200, dump_with(name=b"Amp \xe4\xb8\xad\x80x")),
    "whitespace_ctrl": (255, dump_with(name=b"\x1c\tTab Name\x0b\x1f")),
    "short_dump": (30, dump_with(name=b"Short", length=1000)),
    "long_dump": (31, dump_with(name=b"Long", length=1190)),
    "ir_nam": (40, set_model(set_model(set_model(dump_with(name=b"IR+NAM"),
                                                 2, 0x0A100003), 4, 0x0F000001), 5, 0x0F000007)),
}

manifest = {"cli_commit": None, "cases": []}
try:
    manifest["cli_commit"] = subprocess.run(
        ["git", "-C", str(cli_root), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True).stdout.strip()
except Exception:
    pass

for case, (slot, dump) in cases.items():
    label = gp.slot_to_label(slot)
    name = gp.extract_name_field(dump) or label
    prst = gp.normalize_export_dynamic_fields(gp.build_prst_from_dump(dump, name, skeleton))
    (out_dir / f"{case}.dump.bin").write_bytes(dump)
    (out_dir / f"{case}.prst").write_bytes(prst)
    manifest["cases"].append({
        "case": case,
        "slot": slot,
        "label": label,
        "display_name": gp.extract_name_field(dump),
        "file_name": f"{label}_{gp.safe_filename(name)}.prst",
        "ir_nam": gp.find_ir_nam_dependencies(dump),
        "prst_sha256": hashlib.sha256(prst).hexdigest(),
    })

(out_dir / "golden.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                                     encoding="utf-8")
print(f"wrote {len(cases)} golden cases to {out_dir} (CLI commit {manifest['cli_commit']})")
