"""Keep mapped road junctions in sampled road geometry."""
import numpy as np
from pyproj import Transformer
PROJECT = Transformer.from_crs(4326, 5070, always_xy=True)
UNBUILT = {'proposed', 'construction', 'abandoned', 'razed', 'planned', 'demolished'}

def physical(tags):
    return bool(tags.get('highway')) and tags['highway'] not in UNBUILT and tags.get('area') != 'yes'

def attach(road, geometry, origin, node_ids):
    """Insert mapped vertices and retain their original OSM node IDs."""
    ll = np.array([[p['lon'], p['lat']] for p in geometry])
    xy = np.column_stack(PROJECT.transform(*ll.T)) - origin
    distance = np.r_[0, np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))]
    points = np.asarray(road['points'], dtype=float)
    sampled = np.r_[0, np.cumsum(np.linalg.norm(np.diff(points[:, :2], axis=0), axis=1))]
    if distance[-1] <= 0 or sampled[-1] <= 0:
        return
    sampled *= distance[-1] / sampled[-1]
    distance = np.round(distance, 6)
    sampled = np.round(sampled, 6)
    nearest = np.searchsorted(distance, sampled)
    gap = np.minimum(abs(sampled-distance[np.minimum(nearest,len(distance)-1)]), abs(sampled-distance[np.maximum(nearest-1,0)]))
    along = np.unique(np.r_[sampled[gap>.02], distance])
    height = np.interp(along, sampled, points[:, 2])
    road['points'] = np.round(np.column_stack([np.interp(along, distance, xy[:, 0]),
        np.interp(along, distance, xy[:, 1]), height]), 2).tolist()
    if len(node_ids) != len(distance):
        raise ValueError('Road geometry and mapped node IDs must have equal lengths')
    road['nodes'] = [[int(np.searchsorted(along, s)), node] for s,node in zip(distance,node_ids)]


def merge_samples(current, current_quality, candidate, candidate_quality):
    """Keep the best measured heights when the same way has different sampling."""
    a=np.asarray(current['points'],dtype=float);b=np.asarray(candidate['points'],dtype=float)
    sa=np.r_[0,np.cumsum(np.linalg.norm(np.diff(a[:,:2],axis=0),axis=1))];sb=np.r_[0,np.cumsum(np.linalg.norm(np.diff(b[:,:2],axis=0),axis=1))]
    if len(b)>len(a):
        result={**candidate,'points':b.copy()};target=sb/max(.001,sb[-1])*sa[-1]
        quality=np.interp(target,sa,current_quality);result['points'][:,2]=np.interp(target,sa,a[:,2]);select=np.asarray(candidate_quality)>quality
        result['points'][select,2]=b[select,2];quality[select]=np.asarray(candidate_quality)[select]
    else:
        result={**current,'points':a.copy()};target=sa/max(.001,sa[-1])*sb[-1]
        quality=np.asarray(current_quality).copy();incoming=np.interp(target,sb,candidate_quality);select=incoming>quality
        result['points'][select,2]=np.interp(target,sb,b[:,2])[select];quality[select]=incoming[select]
    return result,quality
