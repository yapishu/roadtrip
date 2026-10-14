import os, pathlib, subprocess, zipfile, shutil

ROOT = pathlib.Path(__file__).parent
os.chdir(ROOT)
(ROOT / "tmp").mkdir(exist_ok=True)
(ROOT / "android/res").mkdir(exist_ok=True)
JAVA = pathlib.Path(os.environ.get("JAVA_HOME", str(ROOT / "tooling/jdk")))
BUILD = ROOT / "tooling/build-tools/android-14"
PLATFORM = ROOT / "tooling/platform/android-34-ext12/android.jar"
NDK = pathlib.Path(
    os.environ.get("ANDROID_NDK_HOME", str(ROOT / "tooling/android-ndk-r25c"))
)
env = {
    **os.environ,
    "TMPDIR": str(ROOT / "tmp"),
    "JAVA_HOME": str(JAVA),
    "JAVA_TOOL_OPTIONS": "-Djava.io.tmpdir=" + str(ROOT / "tmp"),
}


def run(args):
    subprocess.run([str(a) for a in args], check=True, env=env)


classes = ROOT / "android/native-classes"
shutil.rmtree(classes, ignore_errors=True)
classes.mkdir()
dex = ROOT / "android/native-dex"
shutil.rmtree(dex, ignore_errors=True)
dex.mkdir()
names = [
    "Home",
    "Boot",
    "Keeper",
    "RootAdb",
    "NativeArt",
    "Brightness",
    "Solar",
    "LocalMap",
    "PixelCaption",
]
run(
    [
        JAVA / "bin/javac",
        "-source",
        "8",
        "-target",
        "8",
        "-bootclasspath",
        PLATFORM,
        "-d",
        classes,
        *[ROOT / f"android/src/in/scogg/frame/{n}.java" for n in names],
    ]
)
run(
    [
        BUILD / "d8",
        "--min-api",
        "19",
        "--lib",
        PLATFORM,
        "--output",
        dex,
        *classes.rglob("*.class"),
    ]
)
run(["python3", "build-maps.py"])
libraries = []
for abi, target in [
    ("armeabi-v7a", "armv7a-linux-androideabi19"),
    ("arm64-v8a", "aarch64-linux-android21"),
]:
    file = ROOT / f"android/lib/{abi}/libframe.so"
    file.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            NDK / f"toolchains/llvm/prebuilt/linux-x86_64/bin/{target}-clang++",
            "-std=c++17",
            "-O3",
            "-fPIC",
            "-shared",
            "-static-libstdc++",
            "-Wl,--gc-sections",
            "-o",
            file,
            "native/player.cpp",
            *sorted((ROOT / "native/meshoptimizer").glob("*.cpp")),
            "-lGLESv2",
            "-landroid",
            "-llog",
            "-latomic",
            "-lz",
        ]
    )
    run(
        [
            NDK / "toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip",
            "--strip-unneeded",
            file,
        ]
    )
    libraries.append((file, f"lib/{abi}/libframe.so"))
(ROOT / "android/native-assets").mkdir(exist_ok=True)
shutil.copyfile(
    ROOT / "native/meshoptimizer/LICENSE.md",
    ROOT / "android/native-assets/MESHOPTIMIZER-LICENSE.txt",
)
run(
    [
        BUILD / "aapt",
        "package",
        "-f",
        "-M",
        "android/AndroidManifest.xml",
        "-S",
        "android/res",
        "-A",
        "android/native-assets",
        "-I",
        PLATFORM,
        "-F",
        "android/native-unsigned.apk",
    ]
)
with zipfile.ZipFile("android/native-unsigned.apk", "a", zipfile.ZIP_DEFLATED) as z:
    z.write(dex / "classes.dex", "classes.dex")
    for file, name in libraries:
        z.write(file, name)
run(
    [
        BUILD / "zipalign",
        "-f",
        "4",
        "android/native-unsigned.apk",
        "android/native-aligned.apk",
    ]
)
run(
    [
        BUILD / "apksigner",
        "sign",
        "--ks",
        "android/frame.keystore",
        "--ks-pass",
        "file:"
        + os.environ.get(
            "FRAME_KEYSTORE_PASSWORD_FILE", str(ROOT / "android/keystore-password")
        ),
        "--out",
        "android/frame-native.apk",
        "android/native-aligned.apk",
    ]
)
print("Built android/frame-native.apk")
