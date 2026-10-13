#!/usr/bin/env python3
"""Build continuous bridge decks and sample the driving path on road segments."""
import argparse,json
from pathlib import Path
import numpy as np
import networkx as nx
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter1d,median_filter
from shapely.geometry import LineString,Point
from shapely.strtree import STRtree

def lower_crossing_roads(roads):
 """Remove deck-height terrain samples from roads passing below a bridge."""
 bridges=[r for r in roads if r['bridge']and len(r['points'])>1]
 if not bridges:return
 ground_nodes={}
 for r in roads:
  if r['bridge']or r['tunnel']:continue
  for index,key in r['nodes']:ground_nodes.setdefault(key,[]).append((r,index))
 def endpoint_height(road,index):
  keys=[key for i,key in road['nodes']if i==index]
  heights=[r['points'][i][2]for key in keys for r,i in ground_nodes[key]if r is not road]
  return min(heights)if heights else None
 shapes=[LineString(np.asarray(r['points'])[:,:2]).buffer(r['width']/2+1)for r in bridges];tree=STRtree(shapes);bridge_nodes=[{key for _,key in r['nodes']}for r in bridges]
 for road in roads:
  if road['bridge']or road['tunnel']or len(road['points'])<2:continue
  points=np.asarray(road['points'],dtype=float);line=LineString(points[:,:2]);nodes={key for _,key in road['nodes']};along=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points[:,:2],axis=0),axis=1))];changed=False
  for j in tree.query(line,predicate='intersects'):
   if nodes&bridge_nodes[j]:continue
   crossing=line.intersection(shapes[j]);pieces=[crossing]if crossing.geom_type=='LineString'else list(getattr(crossing,'geoms',[]))
   for piece in pieces:
    if piece.geom_type!='LineString'or piece.length<1:continue
    ends=sorted([line.project(Point(piece.coords[0])),line.project(Point(piece.coords[-1]))]);start=max(0,ends[0]-25);end=min(line.length,ends[1]+25)
    anchors=list(np.interp([start,end],along,points[:,2]))
    if start==0:anchors[0]=endpoint_height(road,0)
    if end==line.length:anchors[1]=endpoint_height(road,len(points)-1)
    if None in anchors:continue
    mask=(along>=start)&(along<=end);expected=np.interp(along[mask],[start,end],anchors)
    if not mask.any()or np.max(points[mask,2]-expected)<.6:continue
    points[mask,2]=np.minimum(points[mask,2],expected);changed=True
  if changed:road['points']=np.round(points,2).tolist()

def connect_decks(roads):
 """Solve structure grades on shared OSM nodes, including mid-deck ramp junctions."""
 lower_crossing_roads(roads)
 occurrences={}
 for ri,road in enumerate(roads):
  for index,key in road['nodes']:
   occurrences.setdefault(key,[]).append((ri,index))
 corrections={};settled={}
 for flag in ['bridge','tunnel']:
  selected={i for i,r in enumerate(roads)if r[flag]}
  graph=nx.Graph();sections=[]
  for ri in selected:
   road=roads[ri];points=np.asarray(road['points']);along=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points[:,:2],axis=0),axis=1))]
   nodes=[(index,key)for index,key in road['nodes']if index in (0,len(points)-1)or len({r for r,_ in occurrences[key]})>1]
   for (a,u),(b,v)in zip(nodes,nodes[1:]):
    if a==b or u==v:continue
    weight=1/max(1,along[b]-along[a]);graph.add_edge(u,v,weight=graph.get_edge_data(u,v,{}).get('weight',0)+weight);sections.append((ri,a,b,u,v))
  heights={}
  for component in nx.connected_components(graph):
   boundary=[key for key in component if graph.degree(key)==1 or key in settled]
   if len(boundary)<2:boundary=list(set(boundary)|{key for key in component if any(not roads[ri]['bridge']and not roads[ri]['tunnel']for ri,_ in occurrences[key])})
   if not boundary:boundary=[min(component)]
   for key in boundary:
    if key in settled:heights[key]=settled[key];continue
    approaches=[]
    for ri,index in occurrences[key]:
     road=roads[ri]
     if road['bridge']or road['tunnel']:continue
     points=np.asarray(road['points']);along=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points[:,:2],axis=0),axis=1))];along-=along[index]
     if index==len(points)-1:along=-along
     fit=(along>=20)&(along<=80)
     if flag=='tunnel'and fit.sum()>=3:
      slope,intercept=np.polyfit(along[fit],points[fit,2],1)
      if abs(slope)<.2:approaches.append(float(intercept));continue
     approaches.append(float(points[index,2]))
    heights[key]=float(np.median(approaches or [roads[ri]['points'][index][2]for ri,index in occurrences[key]if ri in selected]))
   interior=sorted(component-set(boundary));lookup={key:i for i,key in enumerate(interior)}
   if interior:
    matrix=np.zeros((len(interior),len(interior)));rhs=np.zeros(len(interior))
    for key in interior:
     row=lookup[key]
     for other,props in graph[key].items():
      weight=props['weight'];matrix[row,row]+=weight
      if other in lookup:matrix[row,lookup[other]]-=weight
      else:rhs[row]+=weight*heights[other]
    heights.update(zip(interior,np.linalg.solve(matrix,rhs)))
  settled.update(heights)
  for ri,a,b,u,v in sections:
   if u not in heights or v not in heights:continue
   points=np.asarray(roads[ri]['points'],dtype=float);along=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points[a:b+1,:2],axis=0),axis=1))]
   points[a:b+1,2]=np.interp(along,[0,along[-1]],[heights[u],heights[v]]);roads[ri]['points']=np.round(points,2).tolist()
  for key,height in heights.items():
   for ri,index in occurrences[key]:
    if roads[ri]['bridge']or roads[ri]['tunnel']:continue
    corrections.setdefault(ri,{})[index]=height
 for ri,anchors in corrections.items():
  points=np.asarray(roads[ri]['points'],dtype=float);along=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points[:,:2],axis=0),axis=1))];controls={}
  marks=sorted((along[index],height-points[index,2])for index,height in anchors.items())
  for j,(at,delta)in enumerate(marks):
   radius=min(200,max(30,abs(delta)/.04));left=marks[j-1][0]if j else 0;right=marks[j+1][0]if j+1<len(marks)else along[-1]
   if at-radius>left:controls[at-radius]=0
   if at+radius<right:controls[at+radius]=0
   controls[at]=delta
  controls.setdefault(0,0);controls.setdefault(along[-1],0);keys=sorted(controls)
  points[:,2]+=np.interp(along,keys,[controls[k]for k in keys]);roads[ri]['points']=np.round(points,2).tolist()

def refine(d,connect=True,align_roads=True):
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
 for road in roads if align_roads else []:
  if road['bridge']or road['tunnel']:continue
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
