---
name: pixel-path
description: Build a pixel-art road trip or first-person fly-through between real places, using OpenStreetMap terrain and buildings plus locally generated SDXL scenery through ComfyUI. Use for a pixel path, pixel road trip, or retro drive along a real route, including regenerating its scenery and checking the viewer.
---

# Pixel Path

Create a static trip folder with a first-person view along the real road. Use the scripts next to this file;
set `SKILL` to the absolute directory containing this `SKILL.md`. Set `TRIP` to an absolute output folder.
Node 18+ runs the pipeline without npm dependencies. The browser checks need Node 20+, Playwright and Chromium.

Art runs on a local or LAN ComfyUI GPU using SDXL base + Pixel Art XL. There is no art account, API key or per-image
charge. Routing and baking still use public map services. For GPU setup, connection settings and recovery, read
[references/local-diffusion.md](references/local-diffusion.md). Check connectivity before starting a large art run:

```sh
node "$SKILL/scripts/comfy.mjs" health
```

## Route, bake and plan

```sh
node "$SKILL/scripts/route.mjs" --out "$TRIP" --from "Bath, England" --to "Bristol, England"
node "$SKILL/scripts/bake.mjs" --trip "$TRIP"
```

Places accept names or `lat,lon`; use `--via` for waypoints. A `NoRoute` error calls for waypoints on the road
network. Use `--default-land desert` when baking an arid route. Set `PIXEL_PATH_USER_AGENT` to an identifying
user agent when available. Run one bake at a time; reruns reuse `TRIP/.cache` and finished chunks.

Routing prints picture counts for each detail level. Use the user's chosen level, or `moderate` by default;
use `sparse` for a quick preview. Explain expected picture count and bake time. Long bakes belong in a background
process whose logs you monitor. Choose one theme for each distinct look (usually one to three).

```sh
node "$SKILL/scripts/plan-art.mjs" --trip "$TRIP" --detail moderate \
  --theme "bath|0|Georgian Bath, England: honey-coloured Bath stone" \
  --theme "bristol|11|Bristol, England: red brick and pastel Victorian terraces" \
  --subject "bath:house=a two-storey Bath stone house with sash windows and a black door" \
  --subject "bath:shop=a Bath stone building with a painted wooden shopfront" \
  --subject "lm-Q2540426=a Bath stone colonnade and the Pump Room front with tall columns"
node "$SKILL/scripts/placeholder-art.mjs" --trip "$TRIP"
```

Themes are `id|starting km|description`. Read the bake's land mix, building types and landmarks before choosing
subjects. A subject is `theme:role=description`; separate alternatives with `|`. Roles include house, terrace,
shop, apartment, tower, civic, church, industrial, farm, tree, bush and street. Landmark subjects use `lm-QID`.
Describe recognizable street-facing shapes and materials rather than relying on a landmark name. Keep real logos,
business names and recognizable people out of prompts. Prompts already specify isolation, margins and view.

Levels are nested: sparse has three facades and a tree per region; moderate has about ten facades, four sprites
and four landmarks overall; detailed adds more variants, sprites and up to ten landmarks. Higher levels reuse
identical generated jobs. `--palette none` disables the shared palette; otherwise cleanup maps colors to it.

## Generate and review

```sh
node "$SKILL/scripts/comfy.mjs" status --trip "$TRIP"
node "$SKILL/scripts/comfy.mjs" run --trip "$TRIP"
node "$SKILL/scripts/clean.mjs" --trip "$TRIP"
```

For a new theme or model setup, generate a few representative assets with `--only NAME,NAME` and inspect them
before filling out a large kit. Jobs run serially at roughly one megapixel, then downsample with nearest-neighbor
to the planned dimensions. Cleanup removes the white backdrop, fills facade holes, hardens alpha, crops and maps
the foreground to the palette. Keep generation, cleanup and checks sequential for a given trip.

Open `TRIP/art/contact.png` with the available image viewer and inspect every asset. Reject angled facades,
multiple subjects, painted scenery, cropped shapes, floating fragments and real branding. Put rejected names in
`art/drop.txt`, one per line, and re-clean to exclude them. Improve their subjects in the plan and regenerate:

```sh
node "$SKILL/scripts/comfy.mjs" run --trip "$TRIP" --regen NAME,NAME
node "$SKILL/scripts/clean.mjs" --trip "$TRIP"
```

A successful regeneration clears that name from `drop.txt`; review the replacement. A plain rerun resumes or
reuses jobs. `--regen` deliberately requests a different seed. After a timeout, rerun **without** `--regen` to
collect the submitted job. Never run two generators for the same trip concurrently.

## Check the result

```sh
node "$SKILL/scripts/check.mjs" --trip "$TRIP" --fix
```

The check installs the viewer, checks layout and dropped assets, renders sample frames and sweeps built-up road
every 75 m while looking ahead and sideways. `--fix` attempts up to two local regeneration rounds. Open
`check/worst-frames.png`, `check/montage.png` and sample `shot-*.png` files, plus the art contact sheet. Look for
sky through walls, street gaps, repeated neighbors, flat cards, misplaced scale and unrecognizable places.

Fix the specific cause and check again. After two unsuccessful art retries, improve the subject or report the
quality limitation instead of looping indefinitely. Do not claim a visual pass without opening the images.
If Playwright/Chromium is unavailable, install it when appropriate or state plainly that the trip was not swept.
A passing script alone does not establish that the art is usable.

## View and hand over

```sh
node "$SKILL/scripts/viewer.mjs" --trip "$TRIP" --serve 8080
```

Open `http://127.0.0.1:8080/`. Scroll/drag or arrow keys change speed; Space pauses; I shows location; M shows a
small map. URL options include `?km=3.2&speed=60&info=1&map=1`. `file://` does not work.

For static hosting, include `index.html`, `road.js`, `layout.js`, `data/` and the public files in `art/`.
Exclude `.cache/`, `art/.comfy/` and `art/raw/`. Publishing requires the user's requested destination.
Keep visible credits: OpenStreetMap contributors (ODbL), OSRM, Terrain Tiles (Mapzen/AWS), Wikidata and the art
models. Shared baked map data remains under ODbL. Model sources and licenses are linked in the local diffusion
reference. Report any remaining visual problems and provide the output path and running viewer URL.
