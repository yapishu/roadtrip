// Roof planes and street-facing walls in projected metres.
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
export const signedArea=ring=>ring.slice(0,-1).reduce((sum,p,i)=>sum+p[0]*ring[i+1][1]-p[1]*ring[i+1][0],0)/2;
export const facadeFloors=(b,profile)=>Math.max(1,Math.min(70,Math.round(b.levels?b.levels-(b.minLevel||0):Math.floor((profile.eaves-b.base-(b.minHeight||0)+.35)/3.1))));

export function skinLayout(b,profile,length,skin){
  if(!skin?.height||b.referenceStyle||['office','apartment','canopy'].includes(b.kind))return null;
  const base=b.base+(b.minHeight||0),floorHeight=(profile.eaves-base)/facadeFloors(b,profile),height=b.kind==='house'?floorHeight:Math.min(floorHeight,skin.height);
  if(height<2.2||height>4.5)return null;
  const count=b.kind==='house'?1:Math.max(1,Math.round(length/(skin.width*height/skin.height)));
  const stretch=(length/count/height)/(skin.width/skin.height);
  return stretch>=.78&&stretch<=1.25?{count,base,top:base+height}:null;
}

export function observedWallFits(b,face){
  if(!b||b.landmark||b.referenceStyle||b.part||b.minHeight||b.heightSource!=='mapped'||b.kind==='house'||b.kind==='canopy'||roofProfile(b).rise)return false;
  return face.edge>=0&&face.edge<b.points.length-1&&face.source?.agreement>=.95&&face.rect[3]/b.height>=3;
}

export function clipPlane(polygon,plane){
  const result=[],value=p=>plane[0]*p[0]+plane[1]*p[1]+plane[2];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],va=value(a),vb=value(b);
    if(va>=-1e-8)result.push(a);
    if((va>1e-8&&vb< -1e-8)||(va< -1e-8&&vb>1e-8)){
      const t=va/(va-vb);result.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
    }
  }
  return result;
}

export function roofProfile(b){
  const points=b.points.slice(0,-1);let longest=0,along=[1,0];
  for(let i=0;i<points.length;i++){
    const a=points[i],q=points[(i+1)%points.length],length=Math.hypot(q[0]-a[0],q[1]-a[1]);
    if(length>longest){longest=length;along=[(q[0]-a[0])/length,(q[1]-a[1])/length];}
  }
  let across=[-along[1],along[0]];
  if(b.roofOrientation==='across')[along,across]=[across,along];
  const bearings={N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315};
  const direction=b.roofDirection==null?NaN:(bearings[b.roofDirection]??Number(b.roofDirection));
  if(Number.isFinite(direction)){const angle=direction*Math.PI/180;across=[Math.sin(angle),Math.cos(angle)];along=[across[1],-across[0]];}
  const av=points.map(p=>dot(p,across)),lv=points.map(p=>dot(p,along));
  const min=Math.min(...av),max=Math.max(...av),lo=Math.min(...lv),hi=Math.max(...lv),span=Math.max(.1,max-min);
  const pitched=['gabled','hipped','pyramidal','skillion'].includes(b.roof)&&!b.holes?.length;
  const available=Math.max(.1,b.height-(b.minHeight||0));
  const rise=pitched?(b.roofHeight?Math.min(available-.1,b.roofHeight):Math.min(available*.4,Math.max(.6,Math.min(2.8,span*.16)))):0;
  const eaves=b.base+b.height-rise,planes=[];
  const slope=(axis,k,c)=>[axis[0]*k,axis[1]*k,eaves+c];
  if(!rise)planes.push([0,0,eaves]);
  else if(b.roof==='skillion')planes.push(slope(across,-rise/span,rise*max/span));
  else{
    const k=rise/(span/2);
    planes.push(slope(across,k,-min*k),slope(across,-k,max*k));
    if(b.roof==='hipped'||b.roof==='pyramidal'){
      const endSlope=b.roof==='pyramidal'?rise/Math.max(.1,(hi-lo)/2):k;
      planes.push(slope(along,endSlope,-lo*endSlope),slope(along,-endSlope,hi*endSlope));
    }
  }
  const top=p=>Math.min(...planes.map(v=>dot(v,p)+v[2]));
  const splitEdge=(a,b)=>{
    const cuts=[0,1];
    for(let i=0;i<planes.length;i++)for(let j=i+1;j<planes.length;j++){
      const v=planes[i].map((n,k)=>n-planes[j][k]),va=dot(v,a)+v[2],vb=dot(v,b)+v[2],t=va/(va-vb);
      if(t>1e-7&&t<1-1e-7)cuts.push(t);
    }
    return [...new Set(cuts)].sort((a,b)=>a-b).map(t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
  };
  return {rise,eaves,planes,top,splitEdge};
}

export function roofPolygons(triangle,profile){
  return profile.planes.map((plane,i)=>{
    let ring=triangle;
    for(let j=0;j<profile.planes.length&&ring.length>=3;j++)if(i!==j){
      const other=profile.planes[j];ring=clipPlane(ring,other.map((v,k)=>v-plane[k]));
    }
    return ring;
  }).filter(ring=>ring.length>=3);
}

export function streetIndex(roads){
  const cells=new Map(),size=80;
  for(const road of roads){
    if(road.bridge||road.tunnel||/motorway|_link|track|path|footway|cycleway|steps/.test(road.kind))continue;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i];
      for(let x=Math.floor(Math.min(a[0],b[0])/size);x<=Math.floor(Math.max(a[0],b[0])/size);x++)
        for(let y=Math.floor(Math.min(a[1],b[1])/size);y<=Math.floor(Math.max(a[1],b[1])/size);y++){
          const key=x+':'+y;if(!cells.has(key))cells.set(key,[]);cells.get(key).push([a,b,road.kind]);
        }
    }
  }
  return (x,y)=>{
    const result=[];
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)result.push(...(cells.get((Math.floor(x/size)+i)+':'+(Math.floor(y/size)+j))||[]));
    return result;
  };
}

export function frontage(b,streets){
  const sign=Math.sign(signedArea(b.points)),scores=[];
  for(let i=0;i<b.points.length-1;i++){
    const a=b.points[i],z=b.points[i+1],dx=z[0]-a[0],dy=z[1]-a[1],length=Math.hypot(dx,dy);
    if(length<3)continue;
    const x=(a[0]+z[0])/2,y=(a[1]+z[1])/2,nx=dy/length*sign,ny=-dx/length*sign;
    let best=Infinity;
    for(const [p,q,kind]of streets(x,y)){
      const rx=q[0]-p[0],ry=q[1]-p[1],t=Math.max(0,Math.min(1,((x-p[0])*rx+(y-p[1])*ry)/(rx*rx+ry*ry||1)));
      const vx=p[0]+rx*t-x,vy=p[1]+ry*t-y,distance=Math.hypot(vx,vy),facing=(vx*nx+vy*ny)/Math.max(.1,distance);
      if(distance>100||facing<.35)continue;
      const priority=kind==='service'?3:kind==='residential'?1.2:/trunk|primary|secondary|tertiary/.test(kind)?.8:1;
      const score=distance*priority/Math.max(.4,facing)+12/Math.min(20,length);
      best=Math.min(best,score);
    }
    if(Number.isFinite(best))scores.push({edge:i,score:best});
  }
  scores.sort((a,b)=>a.score-b.score);
  if(!scores.length)return [];
  return scores.filter(v=>v.score<=scores[0].score*1.65+4).slice(0,b.kind==='house'?1:3).map(v=>v.edge);
}
