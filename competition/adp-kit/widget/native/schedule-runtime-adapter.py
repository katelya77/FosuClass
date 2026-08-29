"""Compatibility entrypoint; the canonical ADP source is RuntimeSafe V3."""

from pathlib import Path
from runpy import run_path


main = run_path(str(Path(__file__).with_name("schedule-runtime-safe-v3-adapter.py")))["main"]
