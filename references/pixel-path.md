# Pixel Path

A Codex skill that turns real routes into pixel-art fly-throughs. It bakes buildings, land cover, landmarks,
hills and horizon from OpenStreetMap and elevation data, generates scenery on your own GPU, and builds a static
viewer with screenshot and layout checks.

Art uses **ComfyUI + SDXL 1.0 + Pixel Art XL** on a local or LAN GPU. No art API key or subscription is needed.
Map routing and baking require network access to Nominatim, OSRM, Overpass, Terrain Tiles and Wikidata.

## Install for Codex

Link this checkout into the personal skills directory:

```sh
mkdir -p ~/.codex/skills
ln -s /absolute/path/to/pixel-path ~/.codex/skills/pixel-path
```

Start a new Codex session and ask: **“Use $pixel-path to make a pixel road trip from Bath to Bristol.”**
The skill resolves scripts relative to its own `SKILL.md`, so it works from any project directory.

## Local model setup

See [local diffusion](references/local-diffusion.md) for installation, endpoint configuration, model sources
and recovery. Node 18+ runs the asset pipeline without npm installs. Node 20+, Playwright and Chromium enable
browser validation. Check the connection with:

```sh
node scripts/comfy.mjs health
```

The [skill](SKILL.md) covers routing, baking, art planning, generation, cleanup and visual review. Generate a
four-asset trial before a whole route:

```sh
node scripts/trial-art.mjs --trip trips/local-trial
node scripts/comfy.mjs run --trip trips/local-trial
node scripts/clean.mjs --trip trips/local-trial
```

Inspect `trips/local-trial/art/contact.png`. A house, shop, tree and church exercise the major asset types.
The trial only creates an art kit; a fly-through also needs route and bake data.

## Detail and controls

| Level | Typical assets | Use |
| --- | --- | --- |
| Placeholders | Code-drawn stand-ins | Preview a route without GPU generation |
| Sparse | 4 per region | Quick generation |
| Moderate | 14 per region + up to 4 landmarks | Default route kit |
| Detailed | 26 per region + up to 10 landmarks | More architectural variety |

Counts depend on the mapped building mix. Generation time scales with assets and settings; map bake time
scales with distance. Each generated job is cached by workflow, seed and output size.

Scroll/drag or arrow keys change speed and direction, Space pauses, I displays location, and M displays a map.
Serve the output over HTTP with `viewer.mjs --trip TRIP --serve 8080` or any static server.

## Validation

```sh
node --test tests/*.test.mjs
node scripts/check.mjs --trip TRIP --fix
```

The self-check inspects street layout, rejected art and browser frames. It sweeps built-up roads for sky through
walls and gaps, and writes contact sheets and worst frames for visual review. Model output is stochastic:
straight-on facades, clean isolation and consistent scale still need human or agent inspection.

## Credits and licenses

Keep the viewer's credits visible when sharing it.

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. Shared baked map data is a derived database under ODbL.
- Routing: OSRM; geocoding: Nominatim.
- Elevation: [Terrain Tiles (Mapzen/Tilezen on AWS)](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
- Landmarks: Wikidata, CC0.
- Art: [SDXL 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) and [Pixel Art XL](https://huggingface.co/nerijs/pixel-art-xl); see their model licenses.
- Project code: [LICENSE](LICENSE).
