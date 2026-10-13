#!/usr/bin/env python3
"""Collect geotagged route panoramas and depth maps through coverage tiles.

Reference images, attribution and metadata remain in the trip's private cache.
The sampler is dense beside mapped buildings and sparse on open road. Requests
resume from verified cache files; absent coverage is recorded rather than invented.
"""
import argparse
import concurrent.futures
import importlib
import json
import math
from pathlib import Path
import threading
import time
import numpy as np
from streetlevel import streetview
from PIL import Image


def compute_depth_map(header, planes, indices):
    """Intersect panorama rays with their labelled planes in NumPy."""
    w,h=header['width'],header['height'];labels=np.asarray(indices).reshape(h,w)
    normals=np.array([p['n'] for p in planes]);distances=np.array([p['d'] for p in planes])
    theta=(h-np.arange(h)-.5)/h*np.pi;phi=(w-np.arange(w)-.5)/w*2*np.pi+np.pi/2
    n=normals[labels]
    denominator=n[:,:,0]*np.sin(theta[:,None])*np.cos(phi[None,:])+n[:,:,1]*np.sin(theta[:,None])*np.sin(phi[None,:])+n[:,:,2]*np.cos(theta[:,None])
    with np.errstate(divide='ignore',invalid='ignore'):depth=np.abs(distances[labels]/denominator)
    depth[labels==0]=-1
    return dict(width=w,height=h,data=depth[:,::-1].copy().ravel())


def cumulative(ll):
    q=np.radians(ll);d=np.diff(q,axis=0)
    a=np.sin(d[:,1]/2)**2+np.cos(q[:-1,1])*np.cos(q[1:,1])*np.sin(d[:,0]/2)**2
    return np.r_[0,np.cumsum(6371000*2*np.arctan2(np.sqrt(a),np.sqrt(1-a)))]


def save(path,value):
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,separators=(',',':')));tmp.replace(path)


def main():
    importlib.import_module('streetlevel.streetview.depth').compute_depth_map=compute_depth_map
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--trip',required=True,type=Path)
    ap.add_argument('--stops-only',action='store_true')
    ap.add_argument('--workers',type=int,default=2)
    ap.add_argument('--open-step',type=int,default=300)
    ap.add_argument('--town-step',type=int,default=35)
    ap.add_argument('--zoom',type=int,default=2)
    a=ap.parse_args();trip=a.trip.resolve();root=trip/'.cache/streetview'
    for name in ['coverage','panoramas','depth','metadata','queries']: (root/name).mkdir(parents=True,exist_ok=True)
    r=json.loads((trip/'route.json').read_text());line=np.array(r['line']);cum=cumulative(line)
    samples={round(stop['at'],1) for stop in r['stops']}
    if not a.stops_only:
        samples.update(np.arange(0,cum[-1],a.open_step).tolist())
        for p in sorted((trip/'data').glob('c[0-9]*.json')):
            d=json.loads(p.read_text())
            for front in d['fronts']:
                start=d['s0']+front[0];end=start+front[1]
                samples.update(np.arange(max(0,math.floor((start-50)/a.town_step)*a.town_step),min(cum[-1],end+50),a.town_step).tolist())
    stops=[round(stop['at'],1) for stop in r['stops']]
    near_stops={s for s in samples if min(abs(s-t) for t in stops)<1500}
    ordered=stops+sorted(near_stops-set(stops))+sorted(samples-near_stops-set(stops))
    locks={};guard=threading.Lock();records=[]
    def lock(key):
        with guard:
            if key not in locks: locks[key]=threading.Lock()
            return locks[key]
    def collect(s):
        query=root/'queries'/f'{s:.1f}.json'
        if query.exists(): return json.loads(query.read_text())
        lon=float(np.interp(s,cum,line[:,0]));lat=float(np.interp(s,cum,line[:,1]))
        n=2**17;x=int((lon+180)/360*n);y=int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)
        cache=root/'coverage'/f'{x}-{y}.json'
        with lock(str(cache)):
            if cache.exists(): candidates=json.loads(cache.read_text())
            else:
                ps=streetview.get_coverage_tile(x,y)
                candidates=[dict(id=p.id,lat=p.lat,lon=p.lon,heading=p.heading,elevation=p.elevation) for p in ps]
                save(cache,candidates);time.sleep(.1)
        distance=lambda p:math.hypot((p['lat']-lat)*111320,(p['lon']-lon)*111320*math.cos(math.radians(lat)))
        candidates.sort(key=distance)
        result=dict(s=s,lat=lat,lon=lon,status='no-coverage')
        if candidates and distance(candidates[0])<90:
            found=candidates[0];pid=found['id'];meta=root/'metadata'/(pid+'.json');image=root/'panoramas'/(pid+'.jpg')
            with lock(pid):
                if not (meta.exists() and image.exists()):
                    p=streetview.find_panorama_by_id(pid,download_depth=True)
                    if not p: raise ValueError(f'Panorama metadata absent: {pid}')
                    im=streetview.get_panorama(p,zoom=a.zoom)
                    if im.width<500 or im.height<250: raise ValueError(f'Panorama too small: {pid}')
                    temp=image.with_suffix('.tmp.jpg');im.save(temp,'JPEG',quality=90);temp.replace(image)
                    depth_file=None
                    if p.depth is not None:
                        depth_file='depth/'+pid+'.npz'
                        np.savez_compressed(root/depth_file,depth=p.depth.data.astype('float32'))
                    save(meta,dict(id=pid,lat=p.lat,lon=p.lon,elevation=p.elevation,
                        heading=p.heading,pitch=p.pitch,roll=p.roll,date=str(p.date),
                        image='panoramas/'+pid+'.jpg',size=list(im.size),depth=depth_file,
                        attribution=p.copyright_message,source=p.source,url=p.permalink(),
                        address=[str(v) for v in p.address or []]))
                data=json.loads(meta.read_text())
            result.update(status='ready',id=pid,distance=round(distance(found),2),metadata='metadata/'+pid+'.json')
        save(query,result)
        return result
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
        futures={pool.submit(collect,float(s)):s for s in ordered}
        for i,f in enumerate(concurrent.futures.as_completed(futures),1):
            s=futures[f]
            try: result=f.result()
            except Exception as e: result=dict(s=float(s),status='error',error=str(e))
            records.append(result)
            if i<=len(stops) or i%25==0 or result['status']=='error':
                ready=sum(v['status']=='ready' for v in records)
                print(f'{i}/{len(ordered)} samples, {ready} ready; km {s/1000:.3f}: {result["status"]} {result.get("error","")}',flush=True)
            if i%25==0: save(root/'progress.json',dict(done=i,total=len(ordered),ready=ready))
    records.sort(key=lambda x:x['s'])
    save(root/('stops.json' if a.stops_only else 'index.json'),dict(samples=records,
        source='Google Street View',referenceUse='Route appearance and geometry references',zoom=a.zoom))
    print(f'Finished: {sum(r["status"]=="ready" for r in records)} of {len(records)} route samples have imagery',flush=True)


if __name__=='__main__': main()
