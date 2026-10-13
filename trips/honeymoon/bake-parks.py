from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json,subprocess,time
root=Path(__file__).resolve().parents[2];trip=root/'trips/honeymoon';python=str(root/'.terrain-venv/bin/python')
def bake(park):
 while not (park/'.cache/extracts/merged/c0000.json').exists():time.sleep(5)
 # Extract creation follows route creation; wait for every route chunk.
 import math
 count=math.ceil(json.loads((park/'route.json').read_text())['total']/10000)
 while not (park/f'.cache/extracts/merged/c{count-1:04d}.json').exists():time.sleep(3)
 subprocess.run([python,'scripts/bake-world.py','--trip',str(park),'--workers','3'],cwd=root,check=True)
 subprocess.run([python,'scripts/bake-vegetation.py','--trip',str(park)],cwd=root,check=True)
 (park/'world/complete').touch()
 print(park.name,'complete',flush=True)
with ThreadPoolExecutor(max_workers=2)as pool:list(pool.map(bake,sorted((trip/'parks').iterdir())))
