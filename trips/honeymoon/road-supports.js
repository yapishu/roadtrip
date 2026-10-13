// Earth approaches, retaining faces and continuous barrier runs at mapped roads.
import {normalAt, roadTriangles, subtractTriangle} from './road-grade.js';
import {guardrailRun} from './roadside-geometry.js';
const distance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
const orient=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const gap=(a,b,c,d)=>orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0?0:Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b));
export function roadSupports(roads,groundAt,route=[]){
  const earth=[],concrete=[],rails=[],runs=[],cells=new Map(),size=80;
  const keys=(a,b,radius)=>{const result=[];for(let y=Math.floor((Math.min(a[1],b[1])-radius)/size);y<=Math.floor((Math.max(a[1],b[1])+radius)/size);y++)for(let x=Math.floor((Math.min(a[0],b[0])-radius)/size);x<=Math.floor((Math.max(a[0],b[0])+radius)/size);x++)result.push(`${x}:${y}`);return result;};
  const obstacles=[...roads];
  if(route.length>1){
    const center=route.map(p=>[p[1],p[2],p[3]+.12]);
    const points=center.map((p,i)=>{const n=normalAt(center,i),lane=Math.min(route[i][4]/4,2.6);return [p[0]+n[0]*lane,p[1]+n[1]*lane,p[2]];});
    obstacles.push({points,width:3.4,kind:'driving-clearance'});
  }
  for(const road of obstacles){
    const triangles=[...roadTriangles({...road,width:road.width+1})];
    for(let i=1;i<road.points.length;i++){const entry={road,a:road.points[i-1],b:road.points[i],triangles:triangles.slice((i-1)*2,i*2)};for(const key of keys(entry.a,entry.b,road.width/2+1)){if(!cells.has(key))cells.set(key,[]);cells.get(key).push(entry);}}
  }
  const nearby=(a,b,radius)=>new Set(keys(a,b,radius).flatMap(key=>cells.get(key)||[]));
  const clear=(road,a,b,radius,belowOnly=false)=>{for(const entry of nearby(a,b,radius)){if(entry.road===road||entry.road.tunnel)continue;if(belowOnly?Math.max(entry.a[2],entry.b[2])>=Math.min(a[2],b[2])-1:Math.min(entry.a[2],entry.b[2])>Math.max(a[2],b[2])+1)continue;if(gap(a,b,entry.a,entry.b)<radius+entry.road.width/2+.5)return false;}return true;};
  const face=(out,a,b,c,d)=>out.push([a,b,c,d]);
  function bank(road,a,b,c,d){
    let polygons=[[a,b,c,d]];
    for(const entry of nearby(a,b,8)){
      if(entry.road===road||entry.road.tunnel||Math.min(entry.a[2],entry.b[2])>Math.max(a[2],b[2])+1)continue;
      if(gap(a,b,entry.a,entry.b)>8+entry.road.width/2)continue;
      for(const triangle of entry.triangles)polygons=polygons.flatMap(poly=>subtractTriangle(poly,triangle));
    }
    for(const poly of polygons)for(let i=1;i<poly.length-1;i++)face(earth,poly[0],poly[i],poly[i+1],poly[i+1]);
  }
  function edgePieces(road,a,b){
    let intervals=[[0,1]];
    for(const entry of nearby(a,b,1)){
      if(entry.road===road||Math.min(entry.a[2],entry.b[2])>Math.max(a[2],b[2])+1.5||Math.max(entry.a[2],entry.b[2])<Math.min(a[2],b[2])-1.5)continue;
      for(const triangle of entry.triangles){
        const sign=Math.sign(orient(triangle[0],triangle[1],triangle[2]));if(!sign)continue;
        let lo=0,hi=1;
        for(let i=0;i<3&&lo<hi;i++){
          const p=triangle[i],q=triangle[(i+1)%3],da=sign*orient(p,q,a),db=sign*orient(p,q,b);
          if(da<0&&db<0){hi=-1;break;}
          if(da<0)lo=Math.max(lo,da/(da-db));else if(db<0)hi=Math.min(hi,da/(da-db));
        }
        if(hi-lo<1e-6)continue;
        intervals=intervals.flatMap(([start,end])=>hi<=start||lo>=end?[[start,end]]:[[start,Math.min(end,lo)],[Math.max(start,hi),end]].filter(([x,y])=>y-x>1e-6));
      }
    }
    return intervals.map(range=>range.map(t=>a.map((v,i)=>v+(b[i]-v)*t)));
  }
  function addRun(run,pieces){
    for(const [a,b]of pieces){
      if(run.length&&Math.hypot(...a.map((v,i)=>v-run.at(-1)[i]))>.05){runs.push([...run]);run.length=0;}
      if(!run.length)run.push(a);run.push(b);
    }
    if(!pieces.length&&run.length){runs.push([...run]);run.length=0;}
  }
  for(const road of roads){
    if(road.tunnel||/footway|path|steps|cycleway|track/.test(road.kind))continue;
    const half=road.width/2,edges=[[],[]],barriers=[[],[]];
    for(let i=0;i<road.points.length;i++){
      const p=road.points[i],n=normalAt(road.points,i);
      for(const [j,side]of [-1,1].entries())edges[j].push([p[0]+n[0]*half*side,p[1]+n[1]*half*side,p[2]+.08]);
    }
    if(road.bridge){
      for(const i of [0,road.points.length-1]){
        const a=[...edges[0][i]],b=[...edges[1][i]];a[2]-=.88;b[2]-=.88;
        if(!clear(road,a,b,1,true))continue;
        const ga=groundAt(a[0],a[1]),gb=groundAt(b[0],b[1]);
        if(Math.min(a[2]-ga,b[2]-gb)<.8)continue;
        face(concrete,[a[0],a[1],ga-.3],[b[0],b[1],gb-.3],b,a);
      }
      for(const points of edges){
        const run=[];
        for(let i=1;i<points.length;i++){
          const pieces=edgePieces(road,points[i-1],points[i]);
          for(const [a,b]of pieces)face(concrete,[a[0],a[1],a[2]-.88],[b[0],b[1],b[2]-.88],[b[0],b[1],b[2]+.02],[a[0],a[1],a[2]+.02]);
          addRun(run,pieces);
        }
        if(run.length)runs.push(run);
      }
      continue;
    }
    for(const [j,side]of [-1,1].entries()){
      for(let i=1;i<edges[j].length;i++){
        const a=edges[j][i-1],b=edges[j][i],n=normalAt(road.points,i-1),m=normalAt(road.points,i),ga=groundAt(a[0],a[1]),gb=groundAt(b[0],b[1]),height=Math.max(a[2]-ga,b[2]-gb);
        if(height>=1.2){
          const width=Math.min(6,Math.max(1.5,height*.8)),c=[b[0]+m[0]*width*side,b[1]+m[1]*width*side],d=[a[0]+n[0]*width*side,a[1]+n[1]*width*side];
          c[2]=Math.min(b[2],groundAt(c[0],c[1])-.1);d[2]=Math.min(a[2],groundAt(d[0],d[1])-.1);bank(road,a,b,c,d);
        }
        const run=barriers[j];addRun(run,height>2?edgePieces(road,a,b):[]);
        if(i===edges[j].length-1&&run.length){runs.push([...run]);run.length=0;}
      }
    }
  }
  // Shared road endpoints keep a full-height barrier across OSM way boundaries.
  const endpoints=new Map(),key=p=>`${Math.round(p[0])}:${Math.round(p[1])}:${Math.round(p[2])}`;
  for(const run of runs)for(const p of [run[0],run.at(-1)])endpoints.set(key(p),(endpoints.get(key(p))||0)+1);
  for(const points of runs){
    const run=guardrailRun(points,{start:endpoints.get(key(points[0]))===1,end:endpoints.get(key(points.at(-1)))===1});
    for(let i=1;i<run.length;i++){
      const a=run[i-1],b=run[i],p=a.point,q=b.point;
      face(rails,[p[0],p[1],p[2]+a.height-.22],[q[0],q[1],q[2]+b.height-.22],[q[0],q[1],q[2]+b.height],[p[0],p[1],p[2]+a.height]);
    }
    for(const {point:p,height,at}of run){
      if(height<.12||Math.abs(at/4-Math.round(at/4))>1e-6)continue;
      const corners=[[-.06,-.06],[.06,-.06],[.06,.06],[-.06,.06]];
      for(let j=0;j<4;j++){const u=corners[j],v=corners[(j+1)%4];face(rails,[p[0]+u[0],p[1]+u[1],p[2]],[p[0]+v[0],p[1]+v[1],p[2]],[p[0]+v[0],p[1]+v[1],p[2]+height],[p[0]+u[0],p[1]+u[1],p[2]+height]);}
    }
  }
  return {earth,concrete,rails};
}
