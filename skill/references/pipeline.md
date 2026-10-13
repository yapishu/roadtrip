# Geographic pipeline

## Environment and paths

Run commands from a checkout of the roadtrip repository. Use absolute paths for
the repository and trip, especially when running work on another machine.

```sh
export ROADTRIP_REPO=/path/to/roadtrip
export TRIP=/path/to/trips/example-route
cd "$ROADTRIP_REPO"
python3 -m venv .terrain-venv
.terrain-venv/bin/python -m pip install numpy pillow pyproj rasterio scipy shapely osmium networkx requests pyshp
```

The geographic pipeline runs with Python 3.13 and Node 22 in the tested setup.
`rembg[cpu]` is optional for vegetation cutouts; `streetlevel==0.12.12` is the
tested optional panorama adapter. Browser checks use Playwright and Chromium:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

The browser requires WebGL 2. Runtime assets are static; Python, model weights,
and ComfyUI are build-time dependencies. Use the repository's
`references/local-diffusion.md` for the local GPU setup. Probe the actual services
before launching a large batch. Persist dependency versions with a finished build.

## Route and map extraction

```sh
node scripts/route.mjs --out "$TRIP" --from "$START" --via "$STOP" --to "$FINISH"
```

Repeat `--via` for ordered stops; omit it for a direct route. `lat,lon` inputs
resolve ambiguous places. `route.json` stores GeoJSON-order `[lon,lat]` vertices,
total distance in meters, and ordered `{name,at}` stops. Inspect the polyline and
snap distances before baking; road routing can snap a scenic destination to an
undesired entrance or omit a park road.

For long routes, download regional OSM PBF files from an appropriate provider
such as [Geofabrik](https://download.geofabrik.de/), verify its published checksums,
and retain the source date and attribution. Keep files in `TRIP/.cache/regions/`.
The extraction helper accepts explicit files rather than assuming a set of states:

```sh
.terrain-venv/bin/python skill/scripts/extract-osm.py \
  --trip "$TRIP" --pbf /path/to/region-a.osm.pbf --pbf /path/to/region-b.osm.pbf
```

This writes `TRIP/.cache/extracts/merged/cNNNN.json`. The 2.2 km corridor supplies
nearby buildings and road context for the 3D scene; terrain extends farther.
Each file contains `osm`, `landmarks`, and `skyline` buckets with `elements` arrays.
Ways retain geometry and node references. Relations retain outer/inner rings.
Regional overlaps merge by OSM type and ID.

The helper's fixture checks cover sparse route vertices across chunk boundaries,
regional deduplication, relation holes, cache reuse, and missing road coverage:

```sh
.terrain-venv/bin/python -m unittest discover -s skill/scripts -p test_extract_osm.py
```

The optional metadata bake supplies detailed place captions, land summaries, and
building-front sampling for the panorama collector:

```sh
node scripts/bake.mjs --trip "$TRIP" \
  --osm-dir "$TRIP/.cache/extracts/merged" --residential-lawns
```

For a small route, `bake.mjs` can fetch OSM through Overpass itself, but the world
baker still needs the merged extract files. Do not assume the metadata bake's
internal HTTP cache has the world extractor's schema. A metadata bake alone does
not produce the 3D world.

## Terrain and road profiles

```sh
.terrain-venv/bin/python scripts/bake-world.py --trip "$TRIP" --chunks 0,1 --workers 2
.terrain-venv/bin/python scripts/bake-world.py --trip "$TRIP" --workers 3
.terrain-venv/bin/python scripts/refine-road-profiles.py --trip "$TRIP"
.terrain-venv/bin/python scripts/refine-road-terrain.py --trip "$TRIP" --workers 2
.terrain-venv/bin/python scripts/sample-road-elevation.py --trip "$TRIP" --workers 2
.terrain-venv/bin/python scripts/reconcile-world-roads.py --trip "$TRIP"
```

Choose valid representative preview chunks; `0,1` is illustrative. Each chunk
covers 10 km of route storage, not one rendered picture. The world retains route
vertices and roughly 5 m camera samples, a 10 m near DEM, and a 100 m distant DEM.
Targeted 2 m sampling resolves road cuts where suitable source data is available.
Requested sample spacing is not a claim of native survey resolution: retain the
resolution reported by the elevation service.

The current adapters use EPSG:5070, USGS 3DEP elevations, USGS NAIP aerial imagery,
and US Census state boundaries. For another country, choose a suitable metric
CRS, DEM, orthophoto source, and administrative boundaries. Update every producer
and consumer together: world baking, façade projection, roadside extraction,
itinerary views, and the atlas must share the same coordinates. Also configure
driving side, centerline color, and units in both route metadata and rendering.

Do not smooth away real relief to hide a bad road profile. Inspect the mechanism:

- Connect bridge/tunnel way fragments before interpolating deck or portal heights.
- Match the camera to an aligned road segment, not merely the closest point at
  an interchange.
- Refine terrain around narrow cuts where coarse pixels erase the road bench.
- Sample a continuous road profile across patch edges; isolated replacements can
  introduce vertical jumps.
- Reconcile overlapping chunks and route sources after all profile refinements.

Completed world chunks are cached. After changing the route or source contract,
use a new output directory or explicitly invalidate the affected baked outputs;
existence-based caches do not detect every upstream change.

## Scenic drives and replacements

Represent a scenic loop as another trip dataset under `parks/ID/`, or a route
replacement under `detours/ID/`. Each has its own route, extracts, and `world/`.
The name of the directory is a source identifier, not a different renderer.

`build-park-routes.py` consumes `plan.json` with:

| Field | Meaning |
| --- | --- |
| `id`, `name`, `region` | Source identifier, display name, and PBF region name |
| `stop` | Zero-based main-route stop index used for insertion/theme position |
| `anchor` | Main-route entry coordinate, `[lon,lat]` |
| `stops` | Ordered `{name,lat,lon}` points including entry and return/exit |
| `via`, `source` | Descriptive route labels and provenance |
| `replace` | Optional `[start,end]` in main-route meters |
| `endAnchor` | Optional distinct main-route exit coordinate |

The graph traces mapped vehicle-road geometry. Its access policy permits seasonal
roads for virtual touring; adjust that policy for a legal/current driving route.
Inspect route connectivity and every snapped stop. Sparse geometry can require
interpolation when calculating chunk bounds.

```sh
.terrain-venv/bin/python scripts/build-park-routes.py --trip "$TRIP" --region "$REGION" --only "$ID"
.terrain-venv/bin/python scripts/bake-world.py --trip "$TRIP/parks/$ID"
.terrain-venv/bin/python scripts/refine-road-profiles.py --trip "$TRIP/parks/$ID"
.terrain-venv/bin/python scripts/refine-road-terrain.py --trip "$TRIP/parks/$ID"
.terrain-venv/bin/python scripts/sample-road-elevation.py --trip "$TRIP/parks/$ID"
.terrain-venv/bin/python scripts/bake-vegetation.py --trip "$TRIP/parks/$ID"
node scripts/build-journey.mjs "$TRIP"
.terrain-venv/bin/python scripts/reconcile-world-roads.py --trip "$TRIP"
.terrain-venv/bin/python scripts/bake-map.py --trip "$TRIP"
```

Pass each detour as `--trip` too; not every refinement command discovers detours
when given the parent. `sample-road-elevation.py` filters sections by need; its
declared `--chunks` option does not currently filter the worklist.

For a main route without scenic sources, create empty `parks/` and `detours/`
directories before `build-journey.mjs`. Its main input is `data/index.json`; if the
metadata bake is omitted, use `route.json` without `line` as that index.

`journey.json` maps global distance to `{source,start,end,at,length}` segments.
Check source entry/exit coordinates, elevation continuity, stop order, and total
distance. Rebuild the atlas after changing the itinerary. Optional `views` in a
source hold `{name,at,xy}` targets in source meters and the scene CRS for gentle
camera looks toward a landmark.

## New-route viewer configuration

Copy `skill/assets/viewer.html` and `caption.js` into the trip. Copy
`templates/{world.js,roadside.js,minimap.js,minimap.css}` and `templates/vendor/`
alongside them, and copy the trip's `viewer.html` to `index.html`.

Add `title` and a `credits` array of `{name,url}` entries to `data/index.json`.
Supply `data/locations.json` as sorted `[routeMeters,name,importance]` records, or
`[]` when using stop captions only. The generic viewer reads titles, stops, and
credits from the scene rather than embedding a particular journey.

Before using the copied renderer for a different route, replace these policies
with the new scene's data. These are explicit configuration work, not portable
geographic defaults:

| Location | Route-dependent policy to configure |
| --- | --- |
| `world.js` → `captionAt` | Named-place caption radii; use per-stop radii or one sensible radius |
| `world.js` → `terrain` | Fixed distance bands choosing rock textures; use regional geology |
| `world.js` → `vegetation` | Distance/elevation override selecting a named region; use the new region plan |
| `world.js` → `render`, `roadMeshes` | Driving side and centerline material |
| `world.js` → scenic gaze | Name-based overlook handling; select behavior using this scene's view targets |
| `minimap.js` → expanded labels | Fixed example town selection; choose important stops from this itinerary |
| `bake-world.py` → preview priority | Fixed chunk ordering; choose preview chunks from this route |
| `bake-landmarks.py` | Named landmark corrections; implement only landmarks in the new scene |
| `bake-roadside.py` | Default region list; pass `--regions` for the actual PBF files |

Modify the copied runtime modules or make these policies data-driven in the shared
templates. `scripts/viewer.mjs` installs shared templates and overwrites trip
module copies; after local customization, serve the trip directly instead:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory "$TRIP"
```

Use an appropriate bind address for LAN access. Do not use `file://`; the viewer
fetches scene modules and binary assets over HTTP.
