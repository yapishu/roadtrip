import concurrent.futures as cf
import json, math, pathlib, socket, time, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).parent / "scene"
ROOT.mkdir(exist_ok=True)
# Use the working address while preserving HTTPS hostname verification.
resolve = socket.getaddrinfo
socket.getaddrinfo = lambda host, port, *a, **k: resolve(
    "173.174.34.185" if host == "disband-kilogram.scogg.in" else host, port, *a, **k
)
count = 0
total = 0


def get(rel, optional=False):
    global count, total
    file = ROOT / rel
    if file.is_file():
        return file.read_bytes()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(
                "https://disband-kilogram.scogg.in/" + rel, timeout=30
            ) as r:
                data = r.read()
            if rel.endswith(".json"):
                json.loads(data)
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
            count += 1
            total += len(data)
            if count % 100 == 0:
                print(count, round(total / 1024**2), "MiB", flush=True)
            return data
        except urllib.error.HTTPError as e:
            if optional and e.code == 404:
                return None
            if attempt == 3:
                raise
        except Exception:
            if attempt == 3:
                raise
        time.sleep(attempt + 1)


def js(rel, optional=False):
    data = get(rel, optional)
    return json.loads(data) if data else None


def section(item):
    source, c = item
    base = (source + "/" if source else "") + "world/"
    stem = f"{c:04d}"
    d = js(base + "c" + stem + ".json")
    for g in [d["near"], d["far"], *d.get("details", [])]:
        get(base + g["file"])
        if "image" in g:
            get(base + g["image"])
    for key in ["waterwaysFile"]:
        if d.get(key):
            get(base + d[key])
    for prefix in ["a", "r", "v"]:
        obj = js(base + prefix + stem + ".json", True)
        if obj:
            for name in obj.get("atlases", []):
                get(base + name)
    return source, c


journey = js("journey.json")
js("data/index.json")
js("data/locations.json")
kit = js("regional/art/world-kit.json")
files = {p["file"] for group in ["surfaces", "trees"] for p in kit[group].values()}
files |= {f"materials/art/{n}.png" for n in ["granite", "sandstone", "limestone"]}
with cf.ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(get, sorted(files)))
    sections = [
        (s, c)
        for s, v in journey["sources"].items()
        for c in range(math.ceil(v["total"] / 10000))
    ]
    print("sections", len(sections), flush=True)
    for i, result in enumerate(pool.map(section, sections)):
        if i % 25 == 0:
            print("section", i, result, flush=True)
print("COMPLETE", count, total, flush=True)
