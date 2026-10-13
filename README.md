# Scoggin Roadtrip

A looping, low-resolution drive from Milpitas, California to Denton, Texas, with scenic drives through the national parks along the way. The browser renders mapped roads and buildings, measured terrain, regional vegetation, and a small terrain atlas with a white sedan marking your position.

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

The drive loops by default. Move the pointer or tap to reveal the seek bar, stop selector, playback button, and speed control. Scroll over the scenery to change speed; Space pauses. The map stays visible: click it or press M to expand, scroll over it to zoom, and drag to pan. Its follow button recenters on the car; Esc folds it away.

URL options include `?km=2442.611&paused=1` for a fixed position and `?speed=96.56` for the starting speed in km/h. The caption names the current place. Controls fade when idle.

## Scene and tools

- `trips/honeymoon/` contains the runnable scene, route, regional art, terrain, and park drives.
- `templates/` contains the renderer, map, viewer components, and Three.js distribution.
- `scripts/` contains routing, scenery generation, geospatial baking, and visual checks.
- `tests/` contains focused checks for road profiles and generation workflows.

The scene archive includes the rendered world assets and all components required to restore the drive. Checkpoint records live in `checkpoints/`. Source downloads and generation caches stay outside Git. Public assets carry their source metadata; build scripts retain the generation and projection steps. [Pixel Path tooling](references/pixel-path.md) describes the art pipeline and its local model setup.

## Credits and licenses

Code uses the MIT license; see [LICENSE](LICENSE). Geographic data and artwork retain their source terms. Roads and building footprints come from OpenStreetMap contributors (ODbL), routing from OSRM, elevation and aerial imagery from USGS, and the terrain atlas from Mapzen/AWS terrain tiles. State boundaries come from the US Census Bureau. Observed building façades retain Google Street View attribution and panorama references in their metadata. Generated regional surfaces and vegetation use SDXL and Pixel Art XL; model sources and licenses are listed in [local diffusion](references/local-diffusion.md). Three.js includes its license in `templates/vendor/`.
