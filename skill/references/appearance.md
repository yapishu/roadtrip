# Regional scenery and recognizable places

## Separate facts from artistic choices

Use mapped footprints, road alignments, and measured terrain as the spatial
foundation. Preserve explicit building height, level, roof, and material tags.
Estimate missing heights conservatively for the building class and region, and
record that they are estimates. Do not fill an extraction gap with invented
buildings.

Run `scripts/refine-buildings.py --trip "$TRIP"` after assembling the journey.
It refreshes only structures, retaining a building baseline in the source cache.
Mapped use and land-use polygons distinguish small commercial footprints from
houses. Building parts replace their portion of an enclosing shell; courtyards
and minimum heights remain open. Optional `building-references.json` entries are
keyed by OSM object ID and retain source URLs and height-estimate labels.

The renderer distinguishes gabled, hipped, pyramidal, skillion, and flat roofs.
Regional storefront artwork belongs on a street-facing ground floor. Upper
floors and side walls use coherent window bays, while open canopies use posts.
Trim, glazing, masonry variation, and rooftop equipment are representative,
not surveyed details. Nearby architecture is detailed; distant structures keep
their mapped silhouettes. Spatial batches allow buildings outside the view to cull.

The scene's character comes from four complementary layers:

| Layer | Source and treatment |
| --- | --- |
| Terrain and ground color | DEM plus aerial imagery; blend appropriate rock texture on steep faces |
| Building form | OSM footprints and roof geometry, with foundations meeting terrain |
| Surface appearance | Regional generated wall atlases, optionally matched observed façades |
| Vegetation and small objects | Aerial canopy inference, mapped points/lines, regional sprites, simple meshes |

Aerial pixels stretched vertically across a cliff can look like dark curtains.
Triplanar rock material helps vertical faces while retaining measured relief and
regional color. Material changes cannot repair missing terrain geometry.

## Plan and generate a regional kit

Use regions based on visible changes in geology, architecture, and vegetation.
Region `from` values are main-route meters, not chunk numbers or kilometers.
Scenic sources can use `journey.sources[source].themeAt` to inherit a main-route
region. Distinct high-elevation vegetation may need a separate region policy.

Write `TRIP/regional/art/plan.json` with `themes`, `landmarks: {}`, and `jobs`.
The runner treats `TRIP/regional` as its trip root:

```json
{
  "themes": [{"id": "foothills", "from": 0}],
  "landmarks": {},
  "jobs": [
    {
      "name": "foothills-house-1",
      "theme": "foothills",
      "role": "house",
      "kind": "texture",
      "style": "surface",
      "width": 384,
      "height": 128,
      "hm": 3.2,
      "seed": 613901,
      "palette": null,
      "prompt": "An ordinary one-story painted timber house wall, straight front elevation, two modest windows and an offset front door. Only the rectangular wall from foundation to eaves. Weathered wood and simple trim.",
      "negative": "perspective, isometric, pitched roof, horizon, landscape, people, cars, lettering"
    },
    {
      "name": "foothills-tree-1",
      "theme": "foothills",
      "role": "tree",
      "kind": "sprite",
      "style": "natural",
      "width": 256,
      "height": 384,
      "hm": 9,
      "seed": 624871,
      "palette": null,
      "prompt": "One entire mature oak, naturally uneven crown, full trunk, all branches inside the image, generous empty white margin, isolated on a featureless white background.",
      "negative": "pot, planter, soil, ground, other trees, forest, cropped crown, clipped branches"
    }
  ]
}
```

Those dimensions are starting values, not required output resolution. Roles used
by the 3D wall mapper include `house`, `shop`, `industrial`, `motel`, and `civic`.
Add enough variation for visible streets; generate a small test batch first.
`surface` and `natural` jobs suppress the pixel LoRA and let the low-resolution
renderer establish the final pixel character. A deliberately illustrated kit can
use the generator's pixel style instead.

```sh
node scripts/comfy.mjs health --url "$COMFY_URL"
node scripts/comfy.mjs run --trip "$TRIP/regional" --url "$COMFY_URL" --only foothills-house-1,foothills-tree-1
# Inspect those outputs before generating the remaining plan.
node scripts/comfy.mjs run --trip "$TRIP/regional" --url "$COMFY_URL"
.terrain-venv/bin/python scripts/prepare-vegetation-art.py --trip "$TRIP"
.terrain-venv/bin/python scripts/build-world-kit.py --trip "$TRIP"
```

`prepare-vegetation-art.py` uses `rembg[cpu]` and its U2Net model. It writes
transparent plants and cutout diagnostics. `build-world-kit.py` packs wall atlases
and plants into `regional/art/world/`, emits `world-kit.json`, and creates
`world-contact.jpg`. Inspect both raw plants and the packed contact sheet: the
wall packer crops surfaces, so the packed result matters.

Reject cropped crowns, scenery baked into cutouts, pots, angled wall faces,
floating fragments, and unsuitable scale. Put unusable job names in `art/drop.txt`
under the regional trip, improve the job prompt, and regenerate selected names.
A successful regeneration clears its exclusion, so review the replacement.

Use one generator per trip, and keep planning, generation, masking, and packing
sequential for that trip. A timeout resumes the recorded job; it is not a reason
to immediately regenerate with a new seed. Limit automatic art repair to two
rounds, then adjust the art approach or leave the rejected object out and explain
the remaining limitation.

Terrain materials are optional repeating textures at
`materials/art/{sandstone,limestone,granite}.png` in the current renderer. Choose
names and material mappings appropriate to the route. Generate seamless close-up
surfaces without a horizon, buildings, objects, or directional perspective.

## Place vegetation and roadside objects

```sh
.terrain-venv/bin/python scripts/bake-vegetation.py --trip "$TRIP"
.terrain-venv/bin/python scripts/bake-roadside.py --trip "$TRIP" --regions "$REGIONS"
```

`REGIONS` is a comma-separated list matching the actual PBF filename prefixes in
`.cache/regions/`. The roadside baker includes main, park, and detour world
datasets. Its initial scan caches source features; `--reuse` repacks those cached
features and does not discover coverage added by a changed route. Rescan when the
route or source coverage changes.

Vegetation placement combines aerial color/texture with mapped tree points and
excludes roads and building interiors. It is a canopy inference, not individual
tree identification. Keep species and heights representative of the region.

Mapped poles, lamps, signs, benches, hydrants, fences, railways, power lines, and
chair lifts use cheap repeated geometry. Resample ground-following lines on steep
terrain, use consistent elevations for wires and supports, and keep props out of
the travel lane. Batch by material and spatial cell so off-camera objects cull.

## Optional observed façades

Use route imagery only when the provider permits the collection and intended
display or distribution. Preserve attribution, capture dates, and source URLs.
Private source caches and permission to publish derived textures are separate
concerns. Regional materials can supply the scene when imagery is unavailable.

The repository collector uses coverage tiles to find panorama IDs, then fetches
panorama metadata, imagery, and depth. Probe that workflow at a few stops before a
long run; a failed coordinate-search endpoint does not establish absent coverage.

```sh
.terrain-venv/bin/python scripts/collect-streetview.py --trip "$TRIP" --stops-only --workers 2
.terrain-venv/bin/python scripts/collect-streetview.py --trip "$TRIP" --workers 2 --open-step 300 --town-step 35
.terrain-venv/bin/python scripts/bake-facades.py --trip "$TRIP" --chunks 0,1
```

Use one collector per trip. It samples densely near mapped fronts and sparsely on
open road, caches coverage and panoramas, and records gaps. Resume errors rather
than launching duplicate writers. Native API behavior and library versions can
change; inspect responses instead of treating every failure as missing imagery.

Façade baking projects wall points into nearby panoramas, checks facing direction
and incidence, and rejects faces whose expected distance disagrees with depth.
Accepted patches form atlases with per-face provenance. A random street photo is
not a building texture. Unobserved walls remain regional surfaces. If maps or
elevations change, regenerate the affected façade projections.

The viewer accepts observed walls only with at least 80% depth agreement and
three texture pixels per metre of height. It excludes canopies, elevated parts,
and reference forms whose dimensions differ from the projected imagery.

## Landmarks

Use mapped position and footprint, then authoritative dimensions and a few
exterior references to choose a simple recognizable form. Distinctive towers,
dams, lodges, and bridges may warrant dedicated meshes. Record sourced dimensions
separately from estimated details. The repository's `bake-landmarks.py` is a
pattern for such corrections, not a catalog to apply to every route.

Inspect the landmark from the actual road position and heading. Correct shape
does not help if the camera misses it, the approach is wrong, or another façade
is pasted across it. Optional look targets can expose a scenic feature while
preserving the forward motion of the drive.
