from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess,sys,json,time
root=Path(__file__).resolve().parents[2];trip=root/'trips/honeymoon';python=str(root/'.terrain-venv/bin/python')
limit=int(sys.argv[1])if len(sys.argv)>1 else 432
start=int(sys.argv[2])if len(sys.argv)>2 else 0
chunks=[c for c in range(start,limit)if not (trip/f'world/a{c:04d}.json').exists()]
def run(group):
 if group:subprocess.run([python,'scripts/bake-facades.py','--trip',str(trip),'--chunks',','.join(map(str,group))],cwd=root,check=True)
with ThreadPoolExecutor(max_workers=4)as pool:list(pool.map(run,[chunks[i::4]for i in range(4)]))
