# Frame Art

Native Android GLES 2 player for the honeymoon road scene. The app renders locally at one quarter of the display dimensions, then enlarges with nearest-neighbor filtering. Geometry, aerial textures, buildings, vegetation and road furniture come from the original JavaScript scene generator. Playback needs no browser, HTTP server or internet connection.

## Use the frame

The original terrain minimap floats in the top-right corner and stays visible. Its + button expands the map to show the whole trip for 30 seconds; − collapses it immediately. The expanded map supports dragging to pan and controls for the whole trip, following the car and zooming. Tap the picture to reveal Visit a stop, the route seekbar, Pause / play and Settings. These controls hide six seconds after the last touch. Visit a stop opens a bounded list that scrolls by dragging. While dragging the seekbar, its label previews the nearest location; releasing jumps to that position. The bottom caption uses the original pixel glyphs. Settings provides a daytime brightness slider, Wi-Fi settings, Android settings and scene attribution. The frame launches the road after boot and saves its position once a second. The player service restarts an interrupted activity while playback is enabled.

Default daytime brightness is 5/255 from 6:30 AM to 11 PM in America/Chicago. At 11 PM brightness drops to 1/255. At midnight the LCD powers off while playback continues; at 6:30 AM it powers on at the selected daytime brightness. This fixed local-time schedule follows Central daylight-saving time and applies within 15 seconds, including after a restart. The rooted frame's display-driver power control turns the LCD off independently of Android sleep, and its brightness control enforces low values. Power and brightness transitions are recorded in the app's `files/player.log`. Android's ambient-light sensor does not report a valid reading on this frame, so dimming follows the clock.

## Build and update

From this directory:

```sh
python3 build.py --install
```

This reads `../trips/honeymoon`, compiles the native scene, builds the APK, and updates `10.10.8.52` over SSH. It hashes the generator and all scene inputs to select a build cache. The installer transfers changed files, checks their SHA-256 hashes on the frame, and replaces each file only after verification.

For changes limited to the Android UI or C++ renderer, use `python3 build.py --app-only --install` to update just the APK.

For another complete trip checkout:

```sh
python3 build.py --source /path/to/trip --install --host 10.10.8.52
```

The trip directory is the single source for scene code, route data, terrain, imagery, the map and captions. The default is the repository's `trips/honeymoon/`. A fresh checkout restores its world assets with the repository's `scripts/restore-scene.mjs` before building. Missing assets fail the build with their local path. Scene export reads local files and does not download data. The Android player reads its installed local bundle and APK assets.

The build requires Node with `npm ci`, Python 3, JDK 17 (set `JAVA_HOME` or place it at `tooling/jdk`), Android build tools 34, the Android 34 platform jar, and NDK r25c. `build-native.py` uses the toolchains under `tooling/`; `JAVA_HOME` and `ANDROID_NDK_HOME` select other Java/NDK installations. The APK includes ARMv7 and ARM64 libraries, requires Android 4.4 or later, and is signed with `android/frame.keystore`. Keep that keystore to install subsequent updates over the same app. Its password is read from the ignored `android/keystore-password` file, or from the file selected by `FRAME_KEYSTORE_PASSWORD_FILE`. Signing keys, password files and device trust files stay local.

Outputs are `android/frame-native.apk`, the directory recorded in `bundle-path.txt`, and its `manifest.json`. The APK includes the original offline terrain atlas and caption glyphs. The APK and scene asset directory are separate so a route update does not require installing a multi-gigabyte APK. The app reads assets from its external-files `native/` directory, `/sdcard/Android/data/in.scogg.frame/files/native` on this frame. The SSH installer is specific to this rooted frame; the renderer itself does not require root.

The native adapter supports the current scene geometry and materials. Lighting is baked, the sky is a gradient, and ambient-object motion and scenic camera turns are not reproduced. Captions follow itinerary stops. Changes to those runtime features require changes to the native renderer; this is not a general JavaScript-to-C++ compiler. Unsupported source shapes and material types fail the build.

## Verification

Run the schedule boundary checks with `python3 tests/check-brightness.py`. `VERIFICATION.md` records device rendering, touch controls, restart and display-power checks; selected captures are in `evidence/`. `tests/DisplayCheck.java` exercises the production display-control method on the rooted frame and restores the brightness supplied as its argument.

## SSH and recovery

```sh
ssh -i ~/.ssh/ginza_bot_ed25519 -o IdentitiesOnly=yes \
  -o UserKnownHostsFile=./known_hosts root@10.10.8.52
```

Dropbear uses public-key authentication. The authorized keys are `id_ed25519.pub`, `id_rsa.pub`, and `ginza_bot_ed25519.pub`. Its files reside in `/data/local/frame/`. The app starts SSH using the firmware's existing root ADB daemon on loopback, and retries every 15 seconds. This firmware accepts one TCP ADB connection at a time; disconnect workstation ADB when leaving the device unattended. The host key is pinned in `known_hosts`.

The installation changes app/data storage and reversible Android settings. Keep firmware backups and their verification manifest outside the repository. Bootloader, boot, recovery and system partitions are not modified.

The vendor photo launcher, its update/watchdog components, diagnostic apps and unused browsers are disabled through Package Manager. Android Settings stays enabled. To restore the photo launcher through SSH:

```sh
pm enable com.waophoto.smartframe
pm enable com.android.settings/.UpdateApkService
am start -a android.intent.action.MAIN -c android.intent.category.HOME
```

Scene attribution is available in Settings. The native dependencies retain their license headers in `native/json.hpp` and `native/stb_image.h`. Geometry ordering uses [meshoptimizer](https://github.com/zeux/meshoptimizer), with its MIT license in `native/meshoptimizer/LICENSE.md` and the APK assets. Three.js is used by the build and retains its license in `node_modules/three/LICENSE`.
