#!/usr/bin/env python3
"""Make the lock file (requirements.lock): every Python package the sound step installs, with its exact hash.

What it does:
  - asks pip to resolve requirements.txt without installing anything (pip install --dry-run --report);
  - writes one line per resolved package, direct or indirect, as `name==version --hash=sha256:...`.
Installing from the lock file with `pip install --require-hashes -r requirements.lock` refuses any package whose
file differs from the one recorded here.
A lock file is true for one kind of machine only: the hashes are those of the files pip chooses for the computer
and Python version this script ran on (written at the top of the lock file). On another kind of machine, run this
script again, or install from requirements.txt, which pins the versions but not the hashes.
Needs: pip 23.1 or later, and a network connection.
Run:   .venv/bin/python make_lock.py

Author:  Muhammad Akhtar Shamim
Licence: MIT (see LICENSE)
Created: 2026-11-21
"""
import json
import os
import platform
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REQUIREMENTS = os.path.join(HERE, "requirements.txt")
LOCK = os.path.join(HERE, "requirements.lock")
HEADER = """# requirements.lock: every Python package the sound step installs, each with the hash of its file.
# Made by make_lock.py from requirements.txt; do not edit by hand.
# Author:  Muhammad Akhtar Shamim
# Licence: MIT (see LICENSE)
# True for: {machine}, Python {python}. On another kind of machine run make_lock.py again.
# Install:  pip install --require-hashes -r requirements.lock
"""


def resolve() -> list:
    """Return pip's resolved install list for requirements.txt (nothing is installed)."""
    with tempfile.TemporaryDirectory() as work:
        report = os.path.join(work, "report.json")
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--dry-run", "--ignore-installed",
                        "--report", report, "-r", REQUIREMENTS], check=True)
        with open(report, encoding="utf-8") as f:
            return json.load(f)["install"]


def lock_line(item: dict) -> str:
    """One lock-file line for a resolved package; stops when pip reported no sha256 hash for it."""
    name, version = item["metadata"]["name"], item["metadata"]["version"]
    digest = item["download_info"].get("archive_info", {}).get("hashes", {}).get("sha256")
    if not digest:
        raise SystemExit(f"pip reported no sha256 hash for {name} {version}: the lock file was not written.")
    return f"{name}=={version} --hash=sha256:{digest}"


def main() -> int:
    """Resolve the requirements and write the lock file, sorted by package name."""
    lines = sorted((lock_line(item) for item in resolve()), key=str.lower)
    machine = f"{platform.system()} {platform.machine()}"
    with open(LOCK, "w", encoding="utf-8") as f:
        f.write(HEADER.format(machine=machine, python=platform.python_version()) + "\n".join(lines) + "\n")
    print(f"wrote requirements.lock  {len(lines)} packages  for {machine}, Python {platform.python_version()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
