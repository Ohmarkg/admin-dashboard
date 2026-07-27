#!/usr/bin/env python3
"""
Insert summary tables into attendance export workbooks (ExcelJS output).

For each .xlsx in a directory (one workbook = one month):
  • Every sheet EXCEPT the unique-attendees tab gets:
      - Sign-in count (row count under Name/Major/Class Year)
      - Major distribution (count + %)
      - Class year distribution (count + %)
    Summaries are inserted above the existing header + data (nothing removed).

  • The unique-attendees tab gets two blocks above the table:
      1) By sign-ins — tallies from all event sheets combined (same person can
         appear multiple times).
      2) By unique attendees — tallies from that sheet only (one row per person).

Usage:
  pip install -r scripts/requirements-attendance-tools.txt
  python scripts/add_attendance_summaries.py /path/to/folder/with/xlsx

Options:
  --dry-run   Print per-file stats; do not write.
  --force     Write even if summaries appear to be present already.

Requires: openpyxl>=3.1
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from attendance_excel_lib import is_aggregate_output_filename, process_workbook_file


def main() -> int:
    p = argparse.ArgumentParser(description="Add attendance summary tables to export .xlsx files.")
    p.add_argument("directory", type=Path, help="Folder containing .xlsx workbooks")
    p.add_argument("--dry-run", action="store_true", help="Print stats only; do not modify files")
    p.add_argument("--force", action="store_true", help="Write even if summaries look present")
    args = p.parse_args()
    d = args.directory.expanduser().resolve()
    if not d.is_dir():
        print(f"Not a directory: {d}", file=sys.stderr)
        return 1

    files = sorted([x for x in d.glob("*.xlsx") if x.is_file() and not x.name.startswith("~$")])
    files = [x for x in files if not is_aggregate_output_filename(x.name)]
    if not files:
        print(f"No .xlsx files in {d}", file=sys.stderr)
        return 1

    ok = 0
    errors = 0
    for f in files:
        try:
            if process_workbook_file(f, dry_run=args.dry_run, force=args.force):
                ok += 1
        except Exception as e:
            errors += 1
            print(f"  Error {f.name}: {e}", file=sys.stderr)
    print(f"Done. Succeeded for {ok}/{len(files)} file(s).")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
