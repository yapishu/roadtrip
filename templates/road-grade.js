// Grade complete terrain cells against the same ribbon used by the road mesh.
export const vehicleTunnel=road=>!!road.tunnel&&!/footway|path|steps|cycleway|track/.test(road.kind);
export function normalAt(points,i){
  const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)||1;
  return [dy/length,-dx/length];
}

export function* roadTriangles(road){
  const points=road.points,half=road.width/2;
  const corner=(p,n,side)=>[p[0]+n[0]*half*side,p[1]+n[1]*half*side,p[2]];
  for(let i=0;i<points.length-1;i++){
    const p=points[i],q=points[i+1],n=normalAt(points,i),m=normalAt(points,i+1);
    const a=corner(p,n,-1),b=corner(q,m,-1),c=corner(q,m,1),d=corner(p,n,1);
    yield [a,b,c];yield [a,c,d];
  }
}

function intersectsCell(triangle,x,y,cell){
  // X/Y bounds are handled by the grid traversal; test the triangle edge axes.
  const cx=x+cell/2,cy=y+cell/2;
  for(let i=0;i<3;i++){
    const a=triangle[i],b=triangle[(i+1)%3],nx=b[1]-a[1],ny=a[0]-b[0];
    const projections=triangle.map(p=>(p[0]-cx)*nx+(p[1]-cy)*ny);
    const radius=cell/2*(Math.abs(nx)+Math.abs(ny));
    if(Math.min(...projections)>radius+1e-7||Math.max(...projections)<-radius-1e-7)return false;
  }
  return true;
}

export function gradeTerrain(roads,values,g){
  // Floating values allow road cuts below the DEM's encoded minimum without wrapping.
  const out=new Float32Array(values);
  for(const road of roads){
    if(road.bridge||road.tunnel||/footway|path|steps|cycleway/.test(road.kind))continue;
    for(const triangle of roadTriangles(road)){
      const [a,b,c]=triangle,dx=b[0]-a[0],dy=b[1]-a[1],ex=c[0]-a[0],ey=c[1]-a[1],area=dx*ey-dy*ex;
      if(Math.abs(area)<1e-7)continue;
      const zx=((b[2]-a[2])*ey-(c[2]-a[2])*dy)/area,zy=(dx*(c[2]-a[2])-ex*(b[2]-a[2]))/area;
      const x0=Math.max(0,Math.floor((Math.min(...triangle.map(p=>p[0]))-g.x0)/g.cell));
      const x1=Math.min(g.w-2,Math.floor((Math.max(...triangle.map(p=>p[0]))-g.x0)/g.cell));
      const y0=Math.max(0,Math.floor((Math.min(...triangle.map(p=>p[1]))-g.y0)/g.cell));
      const y1=Math.min(g.h-2,Math.floor((Math.max(...triangle.map(p=>p[1]))-g.y0)/g.cell));
      for(let row=y0;row<=y1;row++)for(let col=x0;col<=x1;col++){
        const x=g.x0+col*g.cell,y=g.y0+row*g.cell;
        if(!intersectsCell(triangle,x,y,g.cell))continue;
        // All four corners below this plane keep both terrain triangles below
        // every point of the road, including narrow strips between grid vertices.
        for(const [ox,oy]of [[0,0],[1,0],[0,1],[1,1]]){
          const ceiling=a[2]+zx*(x+ox*g.cell-a[0])+zy*(y+oy*g.cell-a[1])-.35;
          const k=(row+oy)*g.w+col+ox;
          out[k]=Math.min(out[k],(ceiling-g.offset)/g.scale);
        }
      }
    }
  }
  return out;
}

export function groundHeight(g,a,x,y){
  const fx=(x-g.x0)/g.cell,fy=(y-g.y0)/g.cell,ix=Math.floor(fx),iy=Math.floor(fy);
  if(ix<0||iy<0||ix>=g.w-1||iy>=g.h-1)return NaN;
  const u=fx-ix,v=fy-iy,k=iy*g.w+ix;
  return (u+v<=1?a[k]*(1-u-v)+a[k+1]*u+a[k+g.w]*v:a[k+g.w+1]*(u+v-1)+a[k+1]*(1-v)+a[k+g.w]*(1-u))*g.scale+g.offset;
}

const minorRoad=road=>/footway|path|steps|cycleway|track/.test(road.kind);
const bounds=polygon=>({x0:Math.min(...polygon.map(p=>p[0])),x1:Math.max(...polygon.map(p=>p[0])),y0:Math.min(...polygon.map(p=>p[1])),y1:Math.max(...polygon.map(p=>p[1]))});
const area=polygon=>polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-p[1]*q[0];},0)/2;
function subtractTriangle(polygon,triangle){
  const pieces=[],sign=Math.sign(area(triangle));let inside=polygon;
  for(let edge=0;edge<3&&inside.length>=3;edge++){
    const a=triangle[edge],b=triangle[(edge+1)%3],next=[],outside=[];
    const distance=p=>sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
    for(let i=0;i<inside.length;i++){
      const p=inside[i],q=inside[(i+1)%inside.length],dp=distance(p),dq=distance(q),pin=dp>=0,qin=dq>=0;
      (pin?next:outside).push(p);
      if(pin!==qin){const t=dp/(dp-dq),intersection=p.map((v,k)=>v+(q[k]-v)*t);next.push(intersection);outside.push(intersection);}
    }
    if(outside.length>=3&&Math.abs(area(outside))>1e-7)pieces.push(outside);
    inside=next;
  }
  return pieces;
}

export function minorRoadSurfaces(roads){
  // Dirt paths meet the edge of paved junctions. Their independently sampled
  // elevations must not form a raised triangle across the asphalt.
  const cells=new Map(),size=100;
  const keys=b=>{const result=[];for(let y=Math.floor(b.y0/size);y<=Math.floor(b.y1/size);y++)for(let x=Math.floor(b.x0/size);x<=Math.floor(b.x1/size);x++)result.push(`${x}:${y}`);return result;};
  for(const road of roads){
    if(minorRoad(road)||road.bridge||road.tunnel)continue;
    for(const triangle of roadTriangles(road)){
      if(Math.abs(area(triangle))<1e-7)continue;
      const entry={triangle,bounds:bounds(triangle)};
      for(const key of keys(entry.bounds)){if(!cells.has(key))cells.set(key,[]);cells.get(key).push(entry);}
    }
  }
  const result=new Map();
  for(const road of roads){
    if(!minorRoad(road)||road.bridge||road.tunnel)continue;
    const surfaces=[];
    for(const triangle of roadTriangles(road)){
      const box=bounds(triangle),candidates=new Set(keys(box).flatMap(key=>cells.get(key)||[]));let pieces=[triangle];
      for(const candidate of candidates){
        const b=candidate.bounds;if(b.x0>box.x1||b.x1<box.x0||b.y0>box.y1||b.y1<box.y0)continue;
        pieces=pieces.flatMap(p=>subtractTriangle(p,candidate.triangle));if(!pieces.length)break;
      }
      surfaces.push(...pieces);
    }
    result.set(road,surfaces);
  }
  return result;
}
