"""Infer planting crowns from metre-scale aerial color and texture."""
import numpy as np
from scipy.ndimage import binary_closing, distance_transform_edt, maximum_filter, uniform_filter
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely import contains_xy


def city_route(data):
    """Find occupied street neighborhoods along the driving corridor."""
    buildings=[np.mean(b['points'],axis=0) for b in data['buildings'] if b['kind']!='canopy']
    if len(buildings)<6:return np.empty((0,2))
    route=np.asarray([p[1:3] for p in data['route'][::20]])
    counts=cKDTree(buildings).query_ball_point(route,105,return_length=True)
    return route[counts>=6]


def crowns(rgb,allowed=None):
    """Return pixel centers and crown radii; smooth lawns stay unplanted."""
    rgb=np.asarray(rgb,dtype=float)/255;r,g,b=rgb.transpose(2,0,1);gray=(r+g+b)/3
    texture=np.sqrt(np.maximum(0,uniform_filter(gray**2,7)-uniform_filter(gray,7)**2))
    green=(g>r*1.055)&(g>b*.98)&(2*g-r-b>.028)&(gray<.67)
    if allowed is not None:green&=allowed
    mask=binary_closing(green,iterations=1)
    radius=distance_transform_edt(mask)
    peaks=(radius==maximum_filter(radius,7))&(radius>=1.4)&(texture>.017)
    ys,xs=np.where(peaks);order=sorted(range(len(xs)),key=lambda i:(-radius[ys[i],xs[i]],ys[i],xs[i]));chosen=[];cells={}
    for i in order:
        x,y=int(xs[i]),int(ys[i]);r=float(np.clip(radius[y,x],1.4,6));cell=(x//12,y//12)
        neighbors=[p for dx in [-1,0,1] for dy in [-1,0,1] for p in cells.get((cell[0]+dx,cell[1]+dy),[])]
        if any(np.hypot(x-p[0],y-p[1])<max(3.5,.8*(r+p[2])) for p in neighbors):continue
        item=(x,y,r);chosen.append(item);cells.setdefault(cell,[]).append(item)
    return chosen


def planting_exclusions(data):
    """Protect full road ribbons and building interiors, including sparse ways."""
    shapes=[]
    for road in data['roads']:
        if len(road['points'])>1:
            shapes.append(LineString([p[:2] for p in road['points']]).buffer(road['width']/2+1.0))
    for building in data['buildings']:
        p=Polygon(building['points'],building.get('holes'))
        if not p.is_valid:p=p.buffer(0)
        shapes.append(p.buffer(.8))
    return unary_union(shapes)


def clear_positions(exclusions,xy):
    if not len(xy):return np.empty(0,dtype=bool)
    xy=np.asarray(xy);return ~contains_xy(exclusions,xy[:,0],xy[:,1])
