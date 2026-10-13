#!/usr/bin/env python3
"""Repair mapped bridge clearance without changing terrain or unrelated roads."""
import argparse,copy,json
from pathlib import Path
import numpy as np
from bridge_clearance import constraints,raise_decks,move_camera_with_roads

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--trip',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);ap.add_argument('--apply',action='store_true');args=ap.parse_args();root=args.trip;args.output.parent.mkdir(parents=True,exist_ok=True)
    paths=sorted((root/'world').glob('c????.json'))+sorted((root/'parks').glob('*/world/c????.json'))+sorted((root/'detours').glob('*/world/c????.json'));canonical={}
    for path in paths:
        d=json.loads(path.read_text());origin=np.asarray(d['origin']);elements=None
        for road in d['roads']:
            points=np.asarray(road['points'],dtype=float);points[:,:2]+=origin
            if road['id'] in canonical and len(canonical[road['id']]['points'])>=len(points):continue
            if elements is None:elements={str(e['type'])+str(e['id']):e.get('tags',{}) for e in json.loads((path.parent.parent/'.cache/extracts/merged'/path.name).read_text())['osm']['elements']}
            layer=elements.get(road['id'],{}).get('layer')
            canonical[road['id']]={**road,'points':points.round(2).tolist(),'layer':float(layer) if layer else (1 if road['bridge'] else 0)}
    roads=list(canonical.values());before=constraints(roads)
    describe=lambda n:dict(bridge=roads[n['road']]['id'],under=roads[n['under']]['id'],rise=round(n['rise'],2),xy=n['xy'])
    report=dict(sections=len(paths),before=[describe(n) for n in before],changedSections=[],changedRoads=[])
    print(len(before),'insufficient-clearance samples on',len({n['road'] for n in before}),'bridges',flush=True)
    if args.apply:
        original={r['id']:np.asarray(r['points']).copy() for r in roads}
        for iteration in range(8):
            fixes=raise_decks(roads);print('Clearance iteration',iteration+1,len(fixes),'samples',flush=True)
            if not fixes:break
        unresolved=constraints(roads);report['unresolved']=[describe(n) for n in unresolved]
        if unresolved:args.output.write_text(json.dumps(report,indent=2));raise RuntimeError('Unresolved bridge clearances; world files remain untouched')
        changed={r['id']:r for r in roads if np.max(abs(np.asarray(r['points'])[:,2]-original[r['id']][:,2]))>.005}
        report['changedRoads']=[dict(id=key,rise=round(float(np.max(np.asarray(r['points'])[:,2]-original[key][:,2])),2)) for key,r in changed.items()]
        for path in paths:
            d=json.loads(path.read_text());origin=np.asarray(d['origin']);affected=False;before_roads=copy.deepcopy(d['roads'])
            for road in d['roads']:
                if road['id'] not in changed:continue
                ref=changed[road['id']];base=original[road['id']];raised=np.asarray(ref['points']);points=np.asarray(road['points'],dtype=float)
                along=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points[:,:2],axis=0),axis=1))];reference=np.r_[0,np.cumsum(np.linalg.norm(np.diff(base[:,:2],axis=0),axis=1))]
                rise=np.interp(along/max(.001,along[-1])*reference[-1],reference,raised[:,2]-base[:,2]);node_rises={key:raised[index,2]-base[index,2] for index,key in ref['nodes']}
                for index,key in road['nodes']:
                    if key in node_rises:rise[index]=node_rises[key]
                points[:,2]+=rise;road.update(points=points.round(2).tolist(),layer=ref['layer']);affected=True
            if not affected:continue
            backup=root/'.cache/clearance-repair'/path.relative_to(root);backup.parent.mkdir(parents=True,exist_ok=True)
            if not backup.exists():backup.write_bytes(path.read_bytes())
            move_camera_with_roads(d,before_roads,d['roads']);path.write_text(json.dumps(d,separators=(',',':')));report['changedSections'].append(str(path.relative_to(root)))
    args.output.write_text(json.dumps(report,indent=2));print('Changed',len(report['changedSections']),'sections',flush=True)
if __name__=='__main__':main()
