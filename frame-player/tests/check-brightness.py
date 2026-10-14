#!/usr/bin/env python3
"""Check the frame's overnight power and brightness schedule boundaries."""

import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
java = Path(os.environ.get("JAVA_HOME", root / "tooling/jdk")) / "bin"
classes = root / "tmp/brightness-tests"
classes.mkdir(parents=True, exist_ok=True)
subprocess.run(
    [
        java / "javac",
        "-cp",
        root / "tooling/platform/android-34-ext12/android.jar",
        "-d",
        classes,
        root / "android/src/in/scogg/frame/Brightness.java",
        root / "android/src/in/scogg/frame/Solar.java",
        root / "android/src/in/scogg/frame/RootAdb.java",
        root / "tests/BrightnessCheck.java",
    ],
    check=True,
)
subprocess.run(
    [java / "java", "-cp", classes, "in.scogg.frame.BrightnessCheck"], check=True
)
