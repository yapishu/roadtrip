// Invented, sparse encounters; mapped roads and buildings constrain placement.
function random(seed){let n=2166136261;for(const c of String(seed))n=Math.imul(n^c.charCodeAt(0),16777619);return ()=>{n+=0x6D2B79F5;let t=Math.imul(n^n>>>15,1|n);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
export function scheduleAmbient(length,seed){
  const rng=random(`${seed}:encounter-spacing`),mile=1609.344,events=[];
  for(let at=(5+rng()*5)*mile;at<length;at+=(5+rng()*5)*mile){
    events.push({at,seed:`${seed}:encounter:${events.length}`});
  }
  return events;
}
export function roadClearance(roads,x,y){
  let nearest=Infinity;
  for(const road of roads)for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));
    nearest=Math.min(nearest,Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t)-road.width/2);
  }
  return nearest;
}
function builtUp(buildings,x,y,radius){return buildings.some(b=>{
  const xs=b.points.map(p=>p[0]),ys=b.points.map(p=>p[1]);
  return x>Math.min(...xs)-radius&&x<Math.max(...xs)+radius&&y>Math.min(...ys)-radius&&y<Math.max(...ys)+radius;
});}
function routeAt(points,s){
  let i=0;while(i<points.length-2&&points[i+1][0]<s)i++;
  const a=points[i],b=points[i+1],t=(s-a[0])/(b[0]-a[0]||1);
  if(t<0||t>1)return null;
  const length=Math.hypot(b[1]-a[1],b[2]-a[2])||1;
  return {x:a[1]+(b[1]-a[1])*t,y:a[2]+(b[2]-a[2])*t,z:a[3]+(b[3]-a[3])*t,dx:(b[1]-a[1])/length,dy:(b[2]-a[2])/length,width:a[4],structure:a[7]||a[8]};
}
export function planAmbient(d,groundAt,events){
  const result=[],start=d.route[0][0],end=d.route.at(-1)[0];
  for(const event of events){
    const s=event.s;if(s<start||s>end)continue;
    const rng=random(event.seed),choice=rng(),p=routeAt(d.route,s);
    if(!p||p.structure)continue;
    const phase=rng()*Math.PI*2;
    if(choice<.82){
      const heights=Array.from({length:8},(_,i)=>groundAt(p.x+Math.cos(i*Math.PI/4)*45,p.y+Math.sin(i*Math.PI/4)*45)).filter(Number.isFinite);
      result.push({kind:'birds',s,x:p.x,y:p.y,z:Math.max(p.z,...heights)+28+rng()*20,phase,count:2+Math.floor(rng()*3)});
    }else if(!builtUp(d.buildings,p.x,p.y,85)){
      const side=rng()<.5?-1:1,offset=(p.width/2+9+rng()*10)*side,x=p.x+p.dy*offset,y=p.y-p.dx*offset,z=groundAt(x,y);
      if(!Number.isFinite(z)||Math.abs(z-p.z)>7||roadClearance(d.roads,x,y)<6||builtUp(d.buildings,x,y,12))continue;
      // Keep feet on a quiet patch of ground and away from cliffs and cut walls.
      const nearby=[[-2,0],[2,0],[0,-2],[0,2]].map(([dx,dy])=>groundAt(x+dx,y+dy));
      if(nearby.some(h=>!Number.isFinite(h)||Math.abs(h-z)>.5))continue;
      result.push({kind:rng()<.7?'deer':'hare',s,x,y,z,phase,angle:Math.atan2(-p.dy,p.dx)+side*.35});
    }
  }
  return result;
}
