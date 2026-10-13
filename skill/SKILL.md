---
name: low-poly-roadtrip
description: Build or extend a low-poly, first-person road trip simulator along real roads, with measured 3D terrain, mapped structures, regional scenery, and a browser viewer. Use for a drivable geographic scene or continuous route fly-through, including scenic detours, scenery generation, performance work, and visual verification.
---

# Low-poly Roadtrip

Build a continuous drive through a geographic world. Roads curve and climb through
terrain; canyon walls, ridges, buildings, and vegetation occupy world space. The
result is a static browser application with streamed scene chunks, route controls,
place captions, and an optional terrain map.

This skill uses the `scripts/` and `templates/` directories in the
[roadtrip repository](https://github.com/yapishu/roadtrip). In this checkout, the
repository root is the parent of `skill/`. If the skill is installed separately,
obtain that repository and set `ROADTRIP_REPO` to its absolute path. Set `TRIP` to
a new output directory. Keep each route's data, generated art, and caches together.

## Establish the scene

Extract the start, finish, ordered stops, desired scenery, and intended fidelity
from the request. Distinguish an actual road itinerary from a virtual tour that
may include roads with seasonal vehicle restrictions. Resolve ambiguous stops to
coordinates and inspect the route before a long bake. A park entrance is not an
interior park drive.

Choose a few representative preview sections: a built-up street, open country,
the strongest terrain relief, and an important landmark. Build these first, then
complete the entire requested route. Preview sampling does not replace full route
coverage.

Agree on the look through those previews. Pixel resolution, texture detail,
geometric detail, and the number of scene objects are separate choices. Adding
more things does not require changing an established visual style.

## Build the geographic world

Read [the pipeline reference](references/pipeline.md) for setup, command order,
data contracts, and new-route configuration.

1. Route through the ordered stops. Inspect snapped locations and the final few
   meters of the route. Keep the exact final endpoint even when a sampling
   interval does not divide the route length.
2. Obtain OSM roads, footprints, land cover, water, and place names. For a long
   route, use regional PBF extracts and the bundled [OSM extractor](scripts/extract-osm.py)
   instead of repeatedly requesting large Overpass corridors. Retain relation
   outer rings and holes. Missing data is a coverage problem, not an empty town.
3. Bake near and far elevation meshes with aerial surface imagery. Choose a
   metric projection and providers appropriate to the route. The repository's
   elevation and atlas adapters target the contiguous United States; they need
   replacement for another coverage area.
4. Refine road elevations and reconcile shared road segments. Bridges use
   connected deck profiles; tunnels run between portals. Sampling the ground
   below a bridge or above a tunnel is not a road profile.
5. Bake vegetation and mapped roadside details. Keep measured positions separate
   from inferred species, dimensions, and decorative forms.
6. Assemble optional scenic drives into a continuous itinerary, then rebuild the
   map, captions, and stop distances from that itinerary.

Check completeness through the scene manifests and asset files, not completion
markers or process exit status alone. Resume failed chunks and preserve successful
outputs. For a large run, keep download caches on the machine with enough storage
and bring back only the assets needed for viewing or review.

## Give places their character

Read [the appearance reference](references/appearance.md) when adding regional
materials, vegetation art, observed façades, or landmark forms.

Use real footprints and conservative building heights first. Map regional wall
textures onto those structures; do not let a generated tall building turn a
one-story town into a skyline. Use aerial imagery for ground color and inferred
canopy positions, with simple geometry or transparent sprites for vegetation.

Generate a small representative art batch and inspect it before scaling up.
Describe ordinary regional materials, proportions, and vegetation. Use procedural
geometry for poles, fences, signs, bridge decks, and other repeated objects. Use
image generation where it contributes visible surface or plant variety.

For distinctive landmarks, inspect a small number of authoritative references and
model the recognizable silhouette at the scene's level of detail. For long-route
appearance, automate geotagged imagery collection and geometric matching when the
provider and intended use permit it. Do not manually inspect thousands of street
images or claim inferred decoration is surveyed geometry.

## Render and inspect

Read [the renderer and verification reference](references/renderer-and-qa.md)
before installing the viewer or declaring the scene complete.

Use the generic [viewer asset](assets/viewer.html) and [pixel caption module](assets/caption.js)
as a starting point. Configure the route-dependent policies listed in the pipeline
reference; shared source files contain example-specific geological and regional
choices that are not defaults for every route.

Render into a deliberately small canvas and enlarge it without smoothing when a
pixel look is desired. The camera follows measured road position, heading, and
elevation. Terrain must surround the camera in a canyon, not merely scroll across
the horizon. Test curves, grades, overpasses, tunnel portals, and chunk boundaries
in motion.

Keep touch scrolling scoped to controls and throttle gestures scoped to the
scenery canvas. Verify stop selection with an actual touch gesture in browser
automation. A programmatic selection does not prove a phone picker works.

Optimize measured bottlenecks. Frustum-cull terrain tiles without changing their
vertices or shared normals, instance repeated objects, batch materials, dispose
streamed resources, and avoid redrawing a paused view. An optional frame cap can
reduce work independently of resolution. Triangle counts and desktop timings do
not establish performance on another device.

Inspect generated contact sheets and rendered frames. Automated reports help find
holes and missing assets but cannot establish visual quality alone. Repair the
specific cause, rerun the affected checks, and state any remaining limitations.

## Deliver a reproducible scene

Provide the output path, running URL, controls, data coverage, and known limits.
Retain source attribution and per-image provenance where applicable.

Keep code, small configuration, and suitable art in Git; use LFS or a separate
scene archive for large binary assets. Exclude source-download caches, model
weights, credentials, and generation job caches from the public runtime. Record
the archive checksum and the matching code revision, then restore into a separate
directory and verify the runtime assets. Publish or push to the destination the
user authorizes.
