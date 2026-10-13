"""Fit bridge profiles above crossing traffic and carry rises through shared nodes."""
import heapq
import numpy as np
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter1d

SMALL={'path','footway','cycleway','steps','track'}

def constraints(roads,clearance=5.5):
    lower=[(i,r) for i,r in enumerate(roads) if not r['tunnel'] and r['kind'] not in SMALL and len(r['points'])>1]
    if not lower:return []
    adjacency={};node_distances={};near_nodes={}
    for ri,r in enumerate(roads):
        ps=np.asarray(r['points'],dtype=float);ds=np.r_[0,np.cumsum(np.linalg.norm(np.diff(ps[:,:2],axis=0),axis=1))];node_distances[ri]=[(float(ds[index]),key) for index,key in r['nodes']]
        for (a,u),(b,v) in zip(node_distances[ri],node_distances[ri][1:]):
            adjacency.setdefault(u,{})[v]=abs(b-a);adjacency.setdefault(v,{})[u]=abs(b-a)
    def connected_nearby(ri,at,oi,under):
        for distance,key in node_distances[ri]:
            approach=abs(at-distance)
            if approach>=35:continue
            if key not in near_nodes:
                found={key:0};queue=[(0,key)]
                while queue:
                    walked,node=heapq.heappop(queue)
                    if walked>found[node]:continue
                    for next_node,length in adjacency.get(node,{}).items():
                        total=walked+length
                        if total<35 and total<found.get(next_node,float('inf')):found[next_node]=total;heapq.heappush(queue,(total,next_node))
                near_nodes[key]=found
            if any(approach+near_nodes[key].get(node,float('inf'))+abs(under-distance)<35 for distance,node in node_distances[oi]):return True
        return False
    shapes=[LineString(np.asarray(r['points'])[:,:2]) for _,r in lower]
    tree=STRtree(shapes);result=[]
    for ri,road in enumerate(roads):
        if not road['bridge'] or len(road['points'])<2:continue
        points=np.asarray(road['points'],dtype=float);line=LineString(points[:,:2]);along=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points[:,:2],axis=0),axis=1))];nodes={key for _,key in road['nodes']}
        for j in tree.query(line.buffer(road['width']/2+4),predicate='intersects'):
            oi,other=lower[j]
            if nodes&{key for _,key in other['nodes']}:continue
            if other.get('layer',1 if other['bridge'] else 0)>=road.get('layer',1):continue
            ol=shapes[j]
            if not line.crosses(ol):continue
            op=np.asarray(other['points'],dtype=float);os=np.r_[0,np.cumsum(np.linalg.norm(np.diff(op[:,:2],axis=0),axis=1))]
            # Include the driven lanes, not the outside edge of an adjacent road.
            overlap=line.intersection(ol.buffer(road['width']/2+min(other['width']/4,2.6)+.6,cap_style=2))
            pieces=[overlap] if overlap.geom_type=='LineString' else list(getattr(overlap,'geoms',[]))
            for piece in pieces:
                if piece.geom_type!='LineString' or piece.length<.2:continue
                start,end=sorted([line.project(Point(piece.coords[0])),line.project(Point(piece.coords[-1]))])
                for at in np.unique(np.r_[start,np.arange(start,end,5),end]):
                    point=line.interpolate(float(at));under=ol.project(point);required=float(np.interp(under,os,op[:,2])+clearance);z=float(np.interp(at,along,points[:,2]))
                    if required-z>.08 and not connected_nearby(ri,float(at),oi,float(under)):result.append(dict(road=ri,under=oi,at=float(at),rise=required-z,required=required,xy=[point.x,point.y]))
    return result

def raise_decks(roads):
    """Spread the smallest required rise with at most 4% additional grade."""
    needed=constraints(roads)
    if not needed:return []
    references={};occurrences={};cumulative={};queue=[];deltas={}
    for ri,road in enumerate(roads):
        mapped={index:('node',key) for index,key in road['nodes']};keys=[mapped.get(i,('point',ri,i)) for i in range(len(road['points']))];references[ri]=keys
        points=np.asarray(road['points'],dtype=float);cumulative[ri]=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points[:,:2],axis=0),axis=1))]
        for i,key in enumerate(keys):
            if key[0]=='node':occurrences.setdefault(key,[]).append((ri,i))
    serial=0
    for need in needed:
        ri=need['road'];along=cumulative[ri];index=min(len(along)-2,max(0,int(np.searchsorted(along,need['at'])-1)))
        # Raising both neighboring samples guarantees the interpolated clearance.
        for i in [index,index+1]:
            key=references[ri][i];rise=need['rise']
            if rise>deltas.get(key,0):deltas[key]=rise;serial+=1;heapq.heappush(queue,(-rise,serial,key))
    while queue:
        negative,_,key=heapq.heappop(queue);rise=-negative
        if rise<deltas.get(key,0)-1e-8:continue
        linked=occurrences[key] if key[0]=='node' else [(key[1],key[2])]
        for ri,index in linked:
            for i in [index-1,index+1]:
                if not 0<=i<len(references[ri]):continue
                neighbor=references[ri][i];length=abs(cumulative[ri][i]-cumulative[ri][index]);value=rise-.04*length
                if value>deltas.get(neighbor,0)+1e-8:
                    deltas[neighbor]=value;serial+=1;heapq.heappush(queue,(-value,serial,neighbor))
    for ri,road in enumerate(roads):
        points=np.asarray(road['points'],dtype=float);rise=np.array([deltas.get(key,0) for key in references[ri]])
        if not np.any(rise):continue
        points[:,2]+=rise;road['points']=np.round(points,2).tolist()
    return needed


def move_camera_with_roads(data,before,after):
    """Apply road rises to the established driving profile without resampling terrain."""
    starts=[];ends=[];rises=[]
    for ri,road in enumerate(before):
        if road['kind'] in SMALL:continue
        p=np.asarray(road['points'],dtype=float);new=np.asarray(after[ri]['points'],dtype=float)
        along=np.r_[0,np.cumsum(np.linalg.norm(np.diff(p[:,:2],axis=0),axis=1))];new_along=np.r_[0,np.cumsum(np.linalg.norm(np.diff(new[:,:2],axis=0),axis=1))]
        shifted=np.interp(along/max(.001,along[-1])*new_along[-1],new_along,new[:,2])-p[:,2]
        starts.extend(p[:-1]);ends.extend(p[1:]);rises.extend(np.column_stack([shifted[:-1],shifted[1:]]))
    if not starts:return
    starts=np.asarray(starts);ends=np.asarray(ends);rises=np.asarray(rises);route=data['route'];xy=np.asarray([p[1:3]for p in route]);z=np.asarray([p[3]+.12 for p in route]);delta=ends[:,:2]-starts[:,:2];length2=(delta**2).sum(axis=1)
    _,ids=cKDTree((starts[:,:2]+ends[:,:2])/2).query(xy,k=min(16,len(starts)))
    if ids.ndim==1:ids=ids[:,None]
    tangents=np.gradient(xy,axis=0);tangents/=np.maximum(.001,np.linalg.norm(tangents,axis=1))[:,None]
    offsets=xy[:,None,:]-starts[ids,:2];t=np.clip((offsets*delta[ids]).sum(axis=2)/np.maximum(.001,length2[ids]),0,1);points=starts[ids,:2]+delta[ids]*t[:,:,None]
    distance=np.linalg.norm(points-xy[:,None,:],axis=2);align=abs((delta[ids]*tangents[:,None,:]).sum(axis=2))/np.maximum(.001,np.sqrt(length2[ids]));height=starts[ids,2]+(ends[ids,2]-starts[ids,2])*t
    score=distance+15*(1-align)+np.minimum(20,abs(height-z[:,None])*2)
    selected=np.argmin(score,axis=1);rows=np.arange(len(route));segments=ids[rows,selected];fraction=t[rows,selected];rise=rises[segments,0]+(rises[segments,1]-rises[segments,0])*fraction;rise[distance[rows,selected]>20]=0
    ss=np.asarray([p[0]for p in route]);grid=np.arange(ss[0],ss[-1]+2,2);smooth=gaussian_filter1d(np.interp(grid,ss,rise),1,mode='nearest');rise=np.interp(ss,grid,smooth)
    for p,value in zip(route,rise):p[3]=round(p[3]+float(value),2)
