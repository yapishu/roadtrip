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
}
trip = a.source.resolve()
journey = json.loads((trip / "journey.json").read_text())
worlds = {trip / segment["source"] / "world" for segment in journey["segments"]}
required = {trip / "world.js", trip / "map/atlas.json", trip / "map/terrain.bin"}
for segment in journey["segments"]:
    world = trip / segment["source"] / "world"
    for chunk in range(
        int(segment["start"] / 10000), int((segment["end"] - 0.001) / 10000) + 1
    ):
        file = world / f"c{chunk:04d}.json"
        if not file.is_file():
            raise SystemExit(
                f"Missing local scene asset: {file}. Restore the scene archive into {trip} before building."
            )
        data = json.loads(file.read_text())
        for grid in [data["near"], data["far"], *data.get("details", [])]:
            required.add(world / grid["file"])
            if grid.get("image"):
                required.add(world / grid["image"])
        if data.get("waterwaysFile"):
            required.add(world / data["waterwaysFile"])
for file in sorted(required):
    if not file.is_file():
        raise SystemExit(
            f"Missing local scene asset: {file}. Restore the scene archive into {trip} before building."
        )
subprocess.run(["node", "build.mjs"], env=env, check=True)
digest = hashlib.sha256()
inputs = {
    ROOT / "export-native.mjs",
    ROOT / "build.mjs",
    ROOT / "package-lock.json",
    *trip.glob("*.js"),
    *trip.glob("*.json"),
}
for directory in [
    *worlds,
    *(trip / name for name in ["data", "regional", "materials", "map"]),
]:
    inputs.update(file for file in directory.rglob("*") if file.is_file())
for file in sorted(inputs):
    name = (
        "trip/" + file.relative_to(trip).as_posix()
        if file.is_relative_to(trip)
        else "compiler/" + file.name
    )
    digest.update(name.encode() + b"\0")
    with file.open("rb") as stream:
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
