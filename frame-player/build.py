#!/usr/bin/env python3
"""Build the native player and compile authoritative scene sources."""

import argparse, concurrent.futures, hashlib, json, os, pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parent
p = argparse.ArgumentParser()
p.add_argument(
    "--source",
    type=pathlib.Path,
    default=ROOT.parent / "trips/honeymoon",
)
p.add_argument("--scene", type=pathlib.Path, default=ROOT / "scene")
p.add_argument("--workers", type=int, default=4)
p.add_argument("--app-only", action="store_true")
p.add_argument("--install", action="store_true")
p.add_argument("--host", default="10.10.8.52")
a = p.parse_args()
os.chdir(ROOT)
if a.app_only:
    subprocess.run(
        ["python3", "build-native.py"],
        env={
            **os.environ,
            "SCENE_DIR": str(a.scene.resolve()),
            "SOURCE_DIR": str(a.source.resolve()),
        },
        check=True,
    )
    if a.install:
        subprocess.run(
            ["python3", "install.py", "--apk-only", "--host", a.host], check=True
        )
    raise SystemExit(0)
env = {
    **os.environ,
    "SOURCE_DIR": str(a.source.resolve()),
    "SCENE_DIR": str(a.scene.resolve()),
}
subprocess.run(["node", "build.mjs"], env=env, check=True)
digest = hashlib.sha256()
inputs = [
    ROOT / "export-native.mjs",
    ROOT / "build.mjs",
    ROOT / "package-lock.json",
    *sorted(a.source.glob("*.js")),
    *sorted(f for f in a.scene.rglob("*") if f.is_file()),
]
for f in inputs:
    digest.update(
        str(f.relative_to(a.scene) if f.is_relative_to(a.scene) else f.name).encode()
        + b"\0"
    )
    with f.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
key = digest.hexdigest()
bundle = ROOT / "bundles" / key
bundle.mkdir(parents=True, exist_ok=True)
env["NATIVE_SCENE_DIR"] = str(bundle)


def compile_scene(shard):
    with (ROOT / f"compile-{shard}.log").open("w") as log:
        subprocess.run(
            ["node", "--expose-gc", "--max-old-space-size=4000", "export-native.mjs"],
            env={**env, "EXPORT_SHARDS": str(a.workers), "EXPORT_SHARD": str(shard)},
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
        )


with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
    list(pool.map(compile_scene, range(a.workers)))
subprocess.run(["python3", "build-native.py"], env=env, check=True)
manifest = {
    f.relative_to(bundle).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest()
    for f in sorted(bundle.rglob("*"))
    if f.is_file() and f.name != "manifest.json"
}
(bundle / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
(ROOT / "bundle-path.txt").write_text(str(bundle) + "\n")
print("Complete bundle:", bundle, flush=True)
if a.install:
    subprocess.run(
        ["python3", "install.py", "--bundle", str(bundle), "--host", a.host], check=True
    )
