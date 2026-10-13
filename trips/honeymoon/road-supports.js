// Representative earth banks and abutments beneath mapped elevated roads.
import {normalAt} from './road-grade.js';
const distance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
const orient=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const gap=(a,b,c,d)=>orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0?0:Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b));
export function roadSupports(roads,groundAt){
  const earth=[],concrete=[],rails=[],cells=new Map(),size=80;
  const keys=(a,b,radius)=>{const result=[];for(let y=Math.floor((Math.min(a[1],b[1])-radius)/size);y<=Math.floor((Math.max(a[1],b[1])+radius)/size);y++)for(let x=Math.floor((Math.min(a[0],b[0])-radius)/size);x<=Math.floor((Math.max(a[0],b[0])+radius)/size);x++)result.push(`${x}:${y}`);return result;};
  for(const road of roads)for(let i=1;i<road.points.length;i++){const entry={road,a:road.points[i-1],b:road.points[i]};for(const key of keys(entry.a,entry.b,road.width/2)){if(!cells.has(key))cells.set(key,[]);cells.get(key).push(entry);}}
  const clear=(road,a,b,radius)=>{for(const entry of new Set(keys(a,b,radius).flatMap(key=>cells.get(key)||[]))){if(entry.road===road)continue;if(Math.max(entry.a[2],entry.b[2])>=Math.min(a[2],b[2])-1)continue;if(gap(a,b,entry.a,entry.b)<radius+entry.road.width/2+1)return false;}return true;};
  const face=(out,a,b,c,d)=>out.push([a,b,c,d]);
  for(const road of roads){
    if(road.tunnel||/footway|path|steps|cycleway|track/.test(road.kind))continue;
    const half=road.width/2;
    if(road.bridge){
      for(const i of [0,road.points.length-1]){
        const p=road.points[i],n=normalAt(road.points,i),a=[p[0]-n[0]*half,p[1]-n[1]*half,p[2]-.8],b=[p[0]+n[0]*half,p[1]+n[1]*half,p[2]-.8];
        if(!clear(road,a,b,1))continue;
        const ga=groundAt(a[0],a[1]),gb=groundAt(b[0],b[1]);
        if(Math.min(a[2]-ga,b[2]-gb)<.8)continue;
        face(concrete,[a[0],a[1],ga-.3],[b[0],b[1],gb-.3],b,a);
      }
      continue;
    }
    let along=0;
    for(let i=1;i<road.points.length;i++){
      const p=road.points[i-1],q=road.points[i],n=normalAt(road.points,i-1),m=normalAt(road.points,i);
      const length=Math.hypot(q[0]-p[0],q[1]-p[1]),start=along;along+=length;
      if(!clear(road,p,q,half+6))continue;
      for(const side of [-1,1]){
        const a=[p[0]+n[0]*half*side,p[1]+n[1]*half*side,p[2]+.08],b=[q[0]+m[0]*half*side,q[1]+m[1]*half*side,q[2]+.08];
        const ga=groundAt(a[0],a[1]),gb=groundAt(b[0],b[1]),height=Math.max(a[2]-ga,b[2]-gb);
        if(height<1.2)continue;
        const bank=Math.min(6,Math.max(1.5,height*.8)),c=[b[0]+m[0]*bank*side,b[1]+m[1]*bank*side],d=[a[0]+n[0]*bank*side,a[1]+n[1]*bank*side];
        c[2]=Math.min(b[2],groundAt(c[0],c[1])-.1);d[2]=Math.min(a[2],groundAt(d[0],d[1])-.1);
        face(earth,a,b,c,d);
        if(height>2){
          face(rails,[a[0],a[1],a[2]+.55],[b[0],b[1],b[2]+.55],[b[0],b[1],b[2]+.8],[a[0],a[1],a[2]+.8]);
          for(let at=Math.ceil(start/12)*12;at<along;at+=12){
            const t=(at-start)/(length||1),p=a.map((v,k)=>v+(b[k]-v)*t),corners=[[-.06,-.06],[.06,-.06],[.06,.06],[-.06,.06]];
            for(let j=0;j<4;j++){const u=corners[j],v=corners[(j+1)%4];face(rails,[p[0]+u[0],p[1]+u[1],p[2]],[p[0]+v[0],p[1]+v[1],p[2]],[p[0]+v[0],p[1]+v[1],p[2]+.8],[p[0]+u[0],p[1]+u[1],p[2]+.8]);}
          }
        }
      }
    }
  }
  return {earth,concrete,rails};
}
