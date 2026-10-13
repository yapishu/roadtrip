# Scoggin Roadtrip

A looping, low-resolution drive from Milpitas, California to Denton, Texas, with scenic drives through the national parks along the way. The browser renders mapped roads and buildings, measured terrain, regional vegetation, and a small terrain atlas with a white sedan marking your position.

To build a different route, use the reusable [Low-poly Roadtrip skill](skill/SKILL.md). It includes the geographic and art workflows, a generic viewer, an OSM extraction helper, and verification guidance.

## Run the drive

The repository contains the viewer, generated art, route, and build tools. Git LFS holds image assets. The complete terrain scene is checkpointed as a separate archive; restore that archive into the checkout before running the viewer.

```sh
git lfs install
git clone https://github.com/yapishu/roadtrip.git
cd roadtrip
git lfs pull
node scripts/restore-scene.mjs /path/to/scoggin-roadtrip-scene.tar.zst
node scripts/viewer.mjs --trip trips/honeymoon --serve 8088 --host 0.0.0.0
```

Open `http://localhost:8088/`, or use the serving computer’s address from another device on the same network. Node 18+ serves the viewer. The browser needs WebGL 2. The trip folder also works on a static web server.

The drive loops by default. Move the pointer or tap to reveal the seek bar, stop picker, playback button, and speed control. The stop picker scrolls with a finger. The itinerary runs from Fresno into Kings Canyon, through Sequoia and Three Rivers on CA-198, then along CA-65 through Lindsay and Porterville to Bakersfield. It continues through Kern River Canyon and Walker Pass, with Brian Head Resort before Panguitch. Scroll over the scenery to change speed; Space pauses. The map stays visible: click it or press M to expand, scroll over it to zoom, and drag to pan. Its follow button recenters on the car; Esc folds it away.

URL options include `?km=2442.611&paused=1` for a fixed position and `?speed=96.56` for the starting speed in km/h. The caption names the current place. Controls fade when idle.

The scene automatically uses whole-number scaling against the display's physical pixels, keeping the chunky look through resizing and rotation. A 1280×800 display renders at 320×200 and scales by 4. Use `?scale=2` for 2× pixels. When the screen dimensions do not divide evenly, a partial pixel block is cropped at the edge.

For a modest Android picture frame, start with `?fps=30`. This caps rendering at 30 frames per second while preserving the same pixel resolution, models, and driving speed. Terrain outside the camera view is culled, and a paused scene performs no WebGL redraws. Performance on the target frame needs an on-device check; reducing the cap further with `?fps=20` is available.

## Scene and tools

- `trips/honeymoon/` contains the runnable scene, route, regional art, terrain, and park drives.
- `templates/` contains the renderer, map, viewer components, and Three.js distribution.
- `scripts/` contains routing, scenery generation, geospatial baking, and visual checks.
- `tests/` contains focused checks for road profiles and generation workflows.

The scene archive includes the rendered world assets and all components required to restore the drive. Checkpoint records live in `checkpoints/`. Source downloads and generation caches stay outside Git. Public assets carry their source metadata; build scripts retain the generation and projection steps. [Pixel Path tooling](references/pixel-path.md) describes the art pipeline and its local model setup.

Small flocks of birds circle overhead, and deer or hares occasionally appear beside rural roads. Encounters are spaced roughly 5–10 miles apart, with longer gaps when locations are unsuitable. Most are birds; four-legged animals are much rarer. These invented encounters vary between sessions and pause with the drive.

Mapped roadside details include signs, lamps, utility lines, fences, railways, picnic tables, information boards, and off-season ski lifts. Canyon rivers follow mapped centerlines. Structures have foundations, connected bridge approaches, supporting earth banks, and abutments; unmeasured dimensions and small architectural details use representative forms. `node scripts/check-viewer.mjs http://localhost:8088/` exercises finger scrolling, stop selection, the frame cap, idle rendering, and looping. `scripts/check-world.mjs` records views at named stops, scenic interiors, and selected road profiles.

Town buildings retain mapped footprints, floors, roof directions, courtyards, and separate building parts. Houses have roof edges; commercial blocks have parapets and street-facing storefronts; offices use regular window bays; mapped canopies stand on open supports. Masonry, glazing, trim, and small roof equipment are representative details. Building references in `trips/honeymoon/building-references.json` distinguish documented floor counts from estimated metre heights. `scripts/refine-buildings.py --trip trips/honeymoon` refreshes building data while preserving terrain, roads, and camera profiles.

Reviewed wall skins contain wall surfaces rather than whole buildings or scenery. They fit compatible frontages without stretching, with raised window trim and entry canopies on selected houses. The review manifest is `trips/honeymoon/regional/art/wall-surfaces.json`; the wall kit retains each generator's attribution. Small path underpasses do not receive vehicle-sized tunnel shells.

## Credits and licenses

Code uses the MIT license; see [LICENSE](LICENSE). Geographic data and artwork retain their source terms. Roads and building footprints come from OpenStreetMap contributors (ODbL), routing from OSRM, elevation and aerial imagery from USGS, and the terrain atlas from Mapzen/AWS terrain tiles. State boundaries come from the US Census Bureau. Observed building façades retain Google Street View attribution and panorama references in their metadata. Generated regional surfaces and vegetation use SDXL, Pixel Art XL, and OpenAI ImageGen; asset metadata identifies the generator, and local model sources and licenses are listed in [local diffusion](references/local-diffusion.md). Three.js includes its license in `templates/vendor/`.
