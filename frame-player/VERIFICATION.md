# Device verification

Device: Dragon Touch Classic15 Pro, Allwinner A33 / Mali-400 MP, Android 4.4.2, 1366 × 768.

- The native app renders at 342 × 192 with nearest-neighbor enlargement and a 24-bit depth buffer.
- The fixed Kern River test at global 741.350 km draws 255,891 triangles in 168 calls at approximately 28 FPS. Moving city scenes measure 32–35 FPS with a 60 FPS frame limit. Geometry ordering preserves every pixel in the captured before/after comparison.
- Playback crosses the main-route 10 km chunk boundary and renders the Grand Canyon and largest Kern River scene chunks.
- All 507 chunks, 1,064 textures and the itinerary are installed locally and SHA-256 verified (1,572 files, approximately 3.5 GiB).
- The host scene server is stopped; rendering reads local files directly.
- Android brightness and the display driver's `lcdbl` both read 20 after noon; playback is active. See [the noon brightness check](evidence/noon-brightness.txt). Solar reference checks agree with US Naval Observatory Austin sunrise/sunset times within four minutes for summer, winter, October and both daylight-saving transition dates. Schedule tests cover 2026–2028, including leap day and Central DST while the host default timezone is Tokyo, plus both brightness ramps, the 11:59 → 12:00 step from 10 to 20, the 255 brightness limit and all overnight boundaries.
- The running app is tested with simulated Central clock times: 23:59 selects 1; 00:01 and 06:29 read `screen0 lcd off!`; 06:30 powers on at 5; 09:00 selects 10. Each state is checked after 18 seconds. The same native activity remains foreground throughout. Real time and automatic network time are restored afterward; the device timezone is America/Chicago. See [the device transcript](evidence/solar-schedule.txt).
- The service verifies LCD power and brightness every 15 seconds and records transitions in `files/player.log`.
- The playback screenshot contains the place caption and no credit line. Credits are in Settings.
- The three requested SSH public keys match the installed authorized_keys file. Root SSH uses the ginza_bot_ed25519 key for validation.

The opening chunk compiles directly from `trips/honeymoon/` to SHA-256 `34b93d7211b6b4b971bc3c7bdc51b8470f0336faa5b931893ce826f66e50ad3d`, identical to the installed chunk. A network-system-call trace of the export records no network calls. The APK also builds from the repository trip, and missing local world assets fail with restore instructions before export.

Build commands: `python3 build.py` and `python3 build.py --app-only --install`.

- The player recovers after its process is killed. After a device reboot, root SSH and native playback start automatically, resume the saved position and retain the scheduled brightness.

- The terrain atlas stays in the top-right corner while controls are hidden, with no surrounding border or title bar. Screenshots at 8 seconds and 31 seconds verify temporary expansion and automatic collapse.
- The scene picker stays within [463,104]–[903,664] on the 1366 × 768 frame. Dragging scrolls the list from Las Vegas and Grand Canyon stops through Kanab, Brian Head and Bryce.
- A screenshot during an eight-second timeline drag shows the preview at Desert View Watchtower (2,111.6 km) while playback remains near Las Vegas (1,454.8 km), confirming preview before release.
- Bottom captions draw the source caption module's pixel glyphs without antialiasing. The APK packages the source terrain atlas, route, boundaries and elevation grid locally.
- Selecting Kingman from the location list loads the correct scene and updates the caption and car marker. Playback is restored to its pre-test area afterward.

- Display power is verified through the driver; physical darkness is not visually confirmed.
