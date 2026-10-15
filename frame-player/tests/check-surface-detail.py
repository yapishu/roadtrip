#!/usr/bin/env python3
"""Verify that exported surface layers retain all triangles in each detail level."""

import argparse
import gzip
import json
from pathlib import Path
import struct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("chunk", type=Path, help="A freshly exported .frm.gz chunk")
args = parser.parse_args()
data = gzip.decompress(args.chunk.read_bytes())
assert data[:4] == b"FRM4", "Unexpected scene format"
material_bytes, mesh_count, route_count = struct.unpack_from("<III", data, 4)
materials = json.loads(data[16 : 16 + material_bytes])
offset = 16 + material_bytes + route_count * 20
surfaces = triangles = 0
for i in range(mesh_count):
    material, vertices, indices, medium, far = struct.unpack_from(
        "<IIIII", data, offset
    )
    offset += 60 + vertices * 20 + indices * 2
    if materials[material]["offset"]:
        assert indices == medium == far, (
            f"Surface mesh {i} loses triangles: {indices}, {medium}, {far}"
        )
        surfaces += 1
        triangles += indices // 3
assert offset == len(data), "Unexpected mesh data length"
assert surfaces > 0, "Select a chunk containing surface layers"
print(
    f"Passed: {surfaces} surface meshes retain all {triangles} triangles at every detail level"
)
