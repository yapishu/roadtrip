#!/usr/bin/env python3
"""Check native streaming against every interval of the repository itinerary."""

import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
binary = root / "tmp/itinerary-check"
binary.parent.mkdir(exist_ok=True)
subprocess.run(
    [
        os.environ.get("CXX", "c++"),
        "-std=c++17",
        "-O2",
        str(root / "tests/itinerary-check.cpp"),
        "-o",
        str(binary),
    ],
    check=True,
)
subprocess.run(
    [str(binary), str(root.parent / "trips/honeymoon/journey.json")], check=True
)
