# Rendering, verification, and delivery

## Scene contract

The browser streams one active 10 km dataset with adjacent sections prefetched.
Chunk size is a storage boundary; animation interpolates continuously between
road samples. World coordinates are projected meters relative to each chunk's
`origin`, with north mapped to negative Three.js Z.

`pixel-viewport.js` sizes the scene against physical display pixels, including
device pixel ratio. It uses an integer magnification and crops partial edge blocks.
Resize the renderer's buffer and camera in place so rotation retains loaded chunks.

The current DEM encoding covers -500 to 6053.5 meters. Change the encoding and
metadata together if the route's elevations exceed that range; do not allow
unsigned integer conversion to wrap mountain heights.

| Asset | Runtime meaning |
| --- | --- |
| `data/index.json` | Main-route total, stops, units, title, and credits |
| `data/locations.json` | Place captions along the main route |
| `journey.json` | Global itinerary assembled from route sources |
| `world/index.json` | Expected chunk count, ready list, source metadata, bake errors |
| `world/cNNNN.json` | Origin, terrain grids, camera route, mapped roads and buildings |
| `world/cNNNN-{near,far}.bin` | Little-endian uint16 DEM; height = value × scale + offset |
| `world/cNNNN-{near,far}.jpg` | Aerial textures aligned to terrain bounds |
| `world/cNNNN-detail-*.bin` | Optional finer patches at road cuts |
| `world/vNNNN.json` | Vegetation placements and variation seeds |
| `world/rNNNN.json` | Roadside objects and line geometry |
| `world/wNNNN.json` | Optional mapped river and stream ribbons |
| `world/aNNNN.json`, `cNNNN-walls-*.jpg` | Optional observed façade mapping and atlases |
| `regional/art/world-kit.json`, `world/` | Regional surfaces and plant sprites |
| `map/atlas.json`, `map/terrain.bin` | Projected route, terrain, boundaries, and stops for the map |

Park/detour sources use the same `world/` contract under their source directory.
Keep source-local route distances separate from global itinerary distances.

## Camera and terrain

Use the baked road elevation for the camera and road mesh. Smooth camera heading
and pitch enough to avoid sample jitter while retaining actual curves and grades.
Keep the car in the correct lane for the country. Test a short final interval and
loop boundaries; array indexing that assumes every interval is full length can
truncate the destination.

Near terrain provides canyon walls, slopes beside the road, and local occlusion.
Far terrain provides ridgelines. Cut holes in the coarse mesh where detail patches
replace it, and align boundaries so one grid does not cover or tear the other.
Use shared normals and UVs across rendering tiles to avoid visible seams.

Grade every terrain cell intersecting the road ribbon below the road surface.
Lowering only nearby grid points lets triangles cross narrow roads between those
points. Test the rendered triangle interpolation across the entire road width,
including curves and grades. Sample the graded surface for vegetation, roadside
objects, and foundations so road cuts do not leave them floating.

Road paint needs a depth bias above the asphalt's own bias. If markings only
appear immediately ahead, inspect depth fighting at grazing angles before
increasing draw distance. Overpasses need solid deck undersides and supports;
thin road strips and floating railings are visible from below. Place supports so
they do not obstruct another mapped road. Tunnels need interior surfaces and
portal clearance. Buildings on slopes need foundations down to ground.

Sparse birds and wildlife provide invented ambient detail. Keep encounters stable
while chunks stream, vary them between sessions, and place animals outside roads
and buildings on gentle ground. Freeze ambient animation when the drive is idle.

## Controls and map

The starter viewer provides a seek bar, playback controls, speed control, a
scrollable stop dialog, captions, and a map. Titles and credits come from
`data/index.json`. URL parameters include `km`, `paused`, `speed` in km/h, `fps`,
`scale` for an integer display-pixel scale, and `loop=0` for a nonlooping drive.

The bundled pixel caption font covers Latin letters and a small punctuation set.
Choose a suitable font or extend its glyphs for other writing systems.

For touch, constrain `touch-action: none` and throttle handling to the scenery
canvas. Let the stop list use native vertical scrolling with sufficiently large
buttons. Keep controls visible while a dialog is open. Map wheel/touch gestures
must not also accelerate the drive. Check narrow portrait viewports for overflow,
control overlap, and caption wrapping.

Use the same projected position and heading for the camera and map marker. The
map can use coarser terrain and simplified route lines than the 3D world. Rebuild
it from the final itinerary so added detours appear. The renderer's map styling,
vehicle marker, and label density are design choices, not geographic facts.

## Performance without changing the look

Measure representative city, open-road, and high-relief scenes. Record triangles,
draw calls, texture counts, frame times, loading behavior, and memory over multiple
chunk transitions. State the browser/device used.

Useful optimizations, in order of the measured problem:

- Split existing terrain triangles into cullable tiles; copy shared grid normals
  and UVs so the visible image remains the same.
- Instance vegetation and repeated objects; batch façades into texture atlases
  and small objects into spatial/material groups.
- Dispose geometries, owned textures, and materials as chunks leave the stream.
  Shared materials should be disposed once, not once per terrain tile.
- Cache an unchanged camera pose so a paused scene does not redraw WebGL.
- Cap frame submission independently of simulation time. Compare distance traveled
  under different caps; motion must not slow with the rendering rate.

Compare rendered images before and after changes that should be visually neutral.
Lower resolution, reduced vegetation density, simplified geometry, and shorter
visibility distance alter the look; make those explicit quality choices. A lower
triangle count is evidence of less submitted geometry, not proof of a particular
frame rate on an untested device.

## Verification that proves the requested route works

Use the repository checks as mechanisms, and adapt their target selection to the
new scene. `scripts/check-world.mjs` includes example-route kilometer probes;
`scripts/check-viewer.mjs` includes an example stop/source assertion. Replace those
targets with stops, distances, and source IDs from the new itinerary before use.
`scripts/check.mjs` targets the separate road-strip renderer and is not a 3D-world
acceptance check.

Perform these complementary checks:

1. **Data completeness:** Every expected world chunk and referenced binary/image
   exists. Grid byte lengths equal width × height × two. Expected and ready chunk
   sets match, including all scenic sources. Report collection gaps separately.
2. **Route geometry:** Check ordered stops, source entry/exit coordinates, final
   endpoint, elevation discontinuities, and grade outliers. Investigate high grades
   against source terrain; an arbitrary grade cap hides errors and real slopes.
3. **Visual coverage:** Render every named stop, representative interiors of each
   scenic drive, and difficult cuts, bridges, tunnels, and joins. Inspect the images
   and at least a few moving sequences. Look for terrain holes, under-road sky,
   floating buildings, missing decks, wrong regional scale, and repeated/cropped art.
4. **Interaction:** On a touch viewport, open the picker, swipe the list, select a
   stop, and verify the actual route source and position. Test map gestures, seek,
   pause/resume, control hiding, and the end-to-start loop. Check runtime errors.
5. **Loading/performance:** Seek across distant sources, cross chunk boundaries in
   motion, revisit unloaded sections, and test pause and frame caps. Check resource
   growth rather than only the first screenshot.

Playwright's Chromium touch emulation can exercise a real swipe via a CDP session
using `Input.dispatchTouchEvent` with touchStart, a series of touchMove events,
and touchEnd. Assert scroll offset changes before tapping the desired button.
Use screenshots or DOM inspection to confirm the view, not only a successful
automation call. Run the focused road-profile tests when changing height logic:

```sh
.terrain-venv/bin/python -m unittest discover -s tests -p test_road_profiles.py
node --test tests/comfy.test.mjs
```

The generation tests apply when changing generation code. Do not regenerate art
or rebake unrelated data simply to repeat checks that already passed.

## Runtime package and checkpoints

Deliver `index.html`, its imported JS/CSS/font modules, the Three.js modules and
license, route metadata, all referenced `world/` datasets, regional art/materials,
and map assets. Include current attribution and derived-image provenance.
Exclude private `.cache/`, `.comfy/`, model weights, and credentials. Generated raw
art can be retained in a build archive without being served as runtime content.

Keep code and suitable assets in Git. Use LFS or a separate archive for large
terrain and texture files. Create archives from an explicit file manifest and
record a checksum, code revision, source dates, asset counts, and restore command.
The repository's `restore-scene.mjs` selects a fixed example trip path; adapt its
trip prefix for a new scene instead of restoring into the wrong directory.

Restore into a separate temporary directory, compare the restored runtime files
or checksums, and open the restored viewer. Retain a known working checkpoint
before a large route or art change. Keep public hosting, LAN serving, and the
location of heavy build caches explicit in the handoff.

Check shared bridge and tunnel nodes with `scripts/check-road-junctions.py`. Sample both deck joins and the roads below: approach banks, abutments, and piers must leave underpasses clear. Inspect canyon road-class summaries and rendered river/road relationships as part of the scenic-route pass.
