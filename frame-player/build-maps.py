"""Package the original offline terrain atlas and pixel caption glyphs."""

import json, os, pathlib, re, shutil, struct

root = pathlib.Path(__file__).resolve().parent
source = pathlib.Path(os.environ.get("SOURCE_DIR", root.parent / "trips/honeymoon"))
assets = root / "android/native-assets"
assets.mkdir(exist_ok=True)
atlas = json.loads((source / "map/atlas.json").read_text())
route = atlas.pop("route")
(assets / "atlas.json").write_text(json.dumps(atlas, separators=(",", ":")))
(assets / "map-route.bin").write_bytes(
    b"".join(struct.pack("<ddd", *point) for point in route)
)
shutil.copyfile(source / "map/terrain.bin", assets / "terrain.bin")
font = {}
for match in re.finditer(
    r"""(?:([A-Z0-9])|'([^']*)'|"([^"]*)"):\s*r\('([.# ]+)'\)""",
    (source / "caption.js").read_text(),
):
    font[next(v for v in match.groups()[:3] if v is not None)] = match.group(4).split()
(assets / "caption-font.json").write_text(json.dumps(font))
print("Packaged terrain atlas and pixel caption glyphs")
