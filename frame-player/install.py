#!/usr/bin/env python3
"""Incrementally install and verify the native bundle through key-authenticated SSH."""

import argparse, hashlib, json, pathlib, shlex, subprocess, tarfile, time

ROOT = pathlib.Path(__file__).resolve().parent
p = argparse.ArgumentParser()
p.add_argument("--host", default="10.10.8.52")
p.add_argument("--key", default=str(pathlib.Path.home() / ".ssh/ginza_bot_ed25519"))
p.add_argument("--bundle", type=pathlib.Path, default=ROOT / "native-bundle")
p.add_argument("--watch", action="store_true")
p.add_argument("--assets-only", action="store_true")
p.add_argument("--apk-only", action="store_true")
a = p.parse_args()
ssh = [
    "ssh",
    "-i",
    a.key,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "UserKnownHostsFile=" + str(ROOT / "known_hosts"),
    "root@" + a.host,
]
dest = "/sdcard/Android/data/in.scogg.frame/files/native"


def remote(command, **kw):
    return subprocess.run(ssh + [command], check=True, **kw)


def install_apk():
    with (ROOT / "android/frame-native.apk").open("rb") as f:
        remote("cat > /data/local/tmp/frame-native.apk", stdin=f)
    remote(
        "pm install -r /data/local/tmp/frame-native.apk && am force-stop in.scogg.frame && am start -n in.scogg.frame/.Home"
    )


if a.apk_only:
    install_apk()
    raise SystemExit(0)
remote("mkdir -p " + dest)
existing = remote(
    "cd "
    + dest
    + ' && busybox find . -type f ! -name "*.partial" -exec busybox sha256sum {} \\;',
    stdout=subprocess.PIPE,
    text=True,
).stdout
verified = {
    line.split("  ", 1)[1].removeprefix("./"): line.split("  ", 1)[0]
    for line in existing.splitlines()
    if "  " in line
}
while True:
    files = [
        f
        for f in a.bundle.rglob("*")
        if f.is_file()
        and not f.name.endswith(".tmp")
        and (f.suffix in (".gz", ".png") or f.name == "journey.json")
    ]
    files.sort(key=lambda f: (f.suffix == ".gz", f.as_posix()))
    changed = []
    for f in files:
        name = f.relative_to(a.bundle).as_posix()
        digest = hashlib.sha256(f.read_bytes()).hexdigest()
        if verified.get(name) != digest:
            changed.append((f, name, digest))
    for offset in range(0, len(changed), 8):
        batch = changed[offset : offset + 8]
        commands = []
        for f, name, digest in batch:
            partial = shlex.quote(name + ".partial")
            final = shlex.quote(name)
            commands.append(
                'test "$(busybox sha256sum '
                + partial
                + ' | busybox cut -d " " -f 1)" = '
                + digest
                + " && mv "
                + partial
                + " "
                + final
            )
        command = "cd " + dest + " && busybox tar xf - && " + " && ".join(commands)
        proc = subprocess.Popen(ssh + [command], stdin=subprocess.PIPE)
        try:
            with tarfile.open(
                fileobj=proc.stdin, mode="w|", format=tarfile.GNU_FORMAT
            ) as archive:
                for f, name, digest in batch:
                    archive.add(f, arcname=name + ".partial", recursive=False)
            proc.stdin.close()
            if proc.wait() != 0:
                raise RuntimeError("Device asset verification failed")
        except BaseException:
            proc.kill()
            raise
        for f, name, digest in batch:
            verified[name] = digest
        print("Verified", len(verified), "files; latest", batch[-1][1], flush=True)
    jobs = json.loads((a.bundle / "jobs.json").read_text())
    complete = all("chunks/" + j["id"] + ".frm.gz" in verified for j in jobs)
    if complete:
        break
    if not a.watch:
        raise RuntimeError(
            "Scene bundle is incomplete; compile it first or use --watch"
        )
    time.sleep(5)
manifest = {name: digest for name, digest in sorted(verified.items())}
(a.bundle / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
if not a.assets_only:
    install_apk()
remote("sync")
print("Installed and SHA-256 verified the complete local route.", flush=True)
