#!/usr/bin/env python3
"""Build continuous bridge decks and sample the driving path on road segments."""
import argparse,json
from pathlib import Path
import numpy as np
import networkx as nx
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter1d,median_filter

def connect_decks(roads):
 approach_roads=[r for r in roads if not r['tunnel']and r['kind']not in ['path','footway','steps','cycleway']]
 approach_tree=cKDTree([r['points'][k][:2]for r in approach_roads for k in [0,-1]])if approach_roads else None
 for flag in ['bridge','tunnel']:
  selected=[i for i,r in enumerate(roads)if r[flag]]
  if not selected:continue
  ends=np.array([roads[i]['points'][j][:2]for i in selected for j in [0,-1]])
  links=nx.Graph();links.add_nodes_from(range(len(ends)));links.add_edges_from(cKDTree(ends).query_pairs(1.5));groups=list(nx.connected_components(links));node={i:j for j,g in enumerate(groups)for i in g};graph=nx.Graph();edges=[]
  for j,i in enumerate(selected):
   ps=np.array(roads[i]['points']);length=np.linalg.norm(np.diff(ps[:,:2],axis=0),axis=1).sum();u,v=node[j*2],node[j*2+1];graph.add_edge(u,v,weight=1/max(1,length));edges.append((i,u,v))
  for component in nx.connected_components(graph):
   boundary=[n for n in component if graph.degree(n)==1]
   if len(boundary)<2:continue
   heights={n:float(np.median([roads[selected[k//2]]['points'][0 if k%2==0 else -1][2]for k in groups[n]]))for n in boundary}
   if flag=='tunnel':
    for n in boundary:
     portal=ends[next(iter(groups[n]))];candidates=[]
     for index in set(j//2 for j in (approach_tree.query_ball_point(portal,2)if approach_tree else [])):
      adjacent=approach_roads[index]
      ap=np.array(adjacent['points'])
      if np.linalg.norm(ap[0,:2]-portal)<2:reverse=False
      elif np.linalg.norm(ap[-1,:2]-portal)<2:reverse=True;ap=ap[::-1].copy()
      else:continue
      along=np.r_[0,np.cumsum(np.linalg.norm(np.diff(ap[:,:2],axis=0),axis=1))];fit=(along>=20)&(along<=80)
      if fit.sum()<3:continue
      slope,intercept=np.polyfit(along[fit],ap[fit,2],1)
      if abs(slope)>.25:continue
      candidates.append(float(intercept));approach=along<20;end=float(np.interp(20,along,ap[:,2]));ap[approach,2]=intercept+(end-intercept)*along[approach]/20
      adjacent['points']=np.round(ap[::-1]if reverse else ap,2).tolist()
     if candidates:heights[n]=float(np.median(candidates))
   interior=list(component-set(boundary));lookup={n:i for i,n in enumerate(interior)}
   if interior:
    matrix=np.zeros((len(interior),len(interior)));rhs=np.zeros(len(interior))
    for n in interior:
     row=lookup[n]
     for other,props in graph[n].items():
      weight=props['weight'];matrix[row,row]+=weight
      if other in lookup:matrix[row,lookup[other]]-=weight
      else:rhs[row]+=weight*heights[other]
    heights.update(zip(interior,np.linalg.solve(matrix,rhs)))
   for i,u,v in edges:
    if u not in component:continue
    ps=np.array(roads[i]['points']);dist=np.r_[0,np.cumsum(np.linalg.norm(np.diff(ps[:,:2],axis=0),axis=1))];ps[:,2]=np.interp(dist,[0,dist[-1]],[heights[u],heights[v]]);roads[i]['points']=np.round(ps,2).tolist()

def refine(d,connect=True):
 roads=d['roads']
 if connect:connect_decks(roads)
 starts=[];ends=[];owners=[]
 for i,r in enumerate(roads):
  if r['kind']in ['footway','path','cycleway','steps','pedestrian']:continue
  ps=np.array(r['points']);starts.extend(ps[:-1]);ends.extend(ps[1:]);owners.extend([i]*(len(ps)-1))
 if not starts:return d
 starts=np.array(starts);ends=np.array(ends);owners=np.array(owners);delta=ends[:,:2]-starts[:,:2];length2=(delta**2).sum(axis=1)
 route=d['route'];xy=np.array([p[1:3]for p in route]);distances,ids=cKDTree((starts[:,:2]+ends[:,:2])/2).query(xy,k=min(12,len(starts)))
 if ids.ndim==1:ids=ids[:,None]
 tangents=np.gradient(xy,axis=0);tangents/=np.maximum(.001,np.linalg.norm(tangents,axis=1))[:,None]
 offsets=xy[:,None,:]-starts[ids,:2];t=np.clip((offsets*delta[ids]).sum(axis=2)/np.maximum(.001,length2[ids]),0,1);points=starts[ids,:2]+delta[ids]*t[:,:,None]
 distance=np.linalg.norm(points-xy[:,None,:],axis=2);align=abs((delta[ids]*tangents[:,None,:]).sum(axis=2))/np.maximum(.001,np.sqrt(length2[ids]));score=distance+15*(1-align);chosen=np.argmin(score,axis=1);rows=np.arange(len(xy));seg=ids[rows,chosen];fraction=t[rows,chosen];heights=starts[seg,2]+(ends[seg,2]-starts[seg,2])*fraction-.12
 for j,p in enumerate(route):
  if distance[j,chosen[j]]>20:continue
  r=roads[owners[seg[j]]];p[3]=float(heights[j]);p[4]=r['width'];p[5]=r['kind'];p[6]=r['name'];p[7]=int(r['bridge']);p[8]=int(r['tunnel'])
 # Smooth on metre spacing, so irregular map vertices do not change the grade.
 ss=np.array([p[0]for p in route]);z=np.array([p[3]for p in route]);grid=np.arange(ss[0],ss[-1]+2,2);smooth=gaussian_filter1d(median_filter(np.interp(grid,ss,z),size=31,mode="nearest"),2)
 # Interpolate isolated ground/road mismatches over their sound approaches.
 bad=np.flatnonzero(abs(np.diff(smooth)/2)>.25);spans=[]
 for i in bad:
  if spans and i-spans[-1][1]<25:spans[-1][1]=int(i)
  else:spans.append([int(i),int(i)])
 for a,b in spans:
  a=max(0,a-25);b=min(len(grid)-1,b+25)
  while b-a<250 and abs(smooth[b]-smooth[a])/max(2,grid[b]-grid[a])>.2 and (a>0 or b<len(grid)-1):a=max(0,a-5);b=min(len(grid)-1,b+5)
  smooth[a:b+1]=np.interp(grid[a:b+1],[grid[a],grid[b]],[smooth[a],smooth[b]])
 if spans:d['roadElevationRepairs']=[dict(fromMetres=round(float(grid[max(0,a-25)]),1),toMetres=round(float(grid[min(len(grid)-1,b+25)]),1),method='Interpolate isolated terrain/road mismatch between approaches')for a,b in spans]
 for p,h in zip(route,np.interp(ss,grid,smooth)):p[3]=round(float(h),2)
 # Align the traveled road surface with its continuous, terrain-derived profile.
 route_height=np.array([p[3]for p in route]);route_xy=np.array([p[1:3]for p in route]);route_tangent=np.gradient(route_xy,axis=0);route_tangent/=np.maximum(.001,np.linalg.norm(route_tangent,axis=1))[:,None];route_tree=cKDTree(route_xy)
 for road in roads:
  ps=np.array(road['points']);dist,near=route_tree.query(ps[:,:2]);tangent=np.gradient(ps[:,:2],axis=0);tangent/=np.maximum(.001,np.linalg.norm(tangent,axis=1))[:,None];align=abs((tangent*route_tangent[near]).sum(axis=1));match=np.array([route[i][5]==road['kind']and route[i][6]==road['name']for i in near]);select=(dist<3.8)&(align>.85)&match
  if select.any():ps[select,2]=route_height[near[select]]+.12;road['points']=np.round(ps,2).tolist()
 d['roadProfile']='Connected decks and portal approaches; aligned segments with a robust metre-spaced road profile';return d

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--trip',type=Path,required=True);ap.add_argument('--all-parks',action='store_true');a=ap.parse_args();paths=list((a.trip/'world').glob('c[0-9][0-9][0-9][0-9].json'))
 if a.all_parks:paths+=list((a.trip/'parks').glob('*/world/c[0-9][0-9][0-9][0-9].json'))
 count=0
 for path in sorted(paths):
  d=json.loads(path.read_text())
  if d.get('roadProfile')=='Connected decks and portal approaches; aligned segments with a robust metre-spaced road profile':continue
  original=a.trip/'.cache/road-profiles'/path.relative_to(a.trip);original.parent.mkdir(parents=True,exist_ok=True)
  if not original.exists():original.write_bytes(path.read_bytes())
  d=refine(d);temp=path.with_suffix('.profile.tmp');temp.write_text(json.dumps(d,separators=(',',':')));temp.replace(path);count+=1
  if count%25==0:print(count,'road profiles refined',flush=True)
 print(count,'road profiles complete',flush=True)
if __name__=='__main__':main()
