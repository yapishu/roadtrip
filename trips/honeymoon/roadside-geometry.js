// Shared dimensions keep utility spans and barrier terminals on their supports.
export function featureHeight(feature,defaultHeight){
  const raw=feature.tags?.height,n=parseFloat(raw);
  return Number.isFinite(n)?Math.max(.3,Math.min(45,n*(/ft|feet|'/.test(raw)?.3048:1))):defaultHeight;
}
export const supportHeight=feature=>featureHeight(feature,feature.kind==='tower'?22:8.5);
const key=p=>`${Math.round(p[0]*10)}:${Math.round(p[1]*10)}`;
export function utilitySpans(features){
  const supports=new Map(features.filter(f=>f.kind==='pole'||f.kind==='tower').map(f=>[key(f.points[0]),f])),spans=[];
  for(const feature of features){
    if(!['line','minor_line'].includes(feature.kind))continue;
    let previous=null;
    for(let i=0;i<feature.points.length;i++){
      const support=supports.get(key(feature.points[i]));if(!support)continue;
      if(previous){
        const points=feature.points.slice(previous.index,i+1),distances=[0];
        for(let j=1;j<points.length;j++)distances.push(distances.at(-1)+Math.hypot(points[j][0]-points[j-1][0],points[j][1]-points[j-1][1]));
        const length=distances.at(-1),a=previous.support.points[0],b=support.points[0],az=a[2]+supportHeight(previous.support)-.5,bz=b[2]+supportHeight(support)-.5;
        if(length>.1){
          const samples=[...new Set([...distances,...Array.from({length:Math.ceil(length/12)+1},(_,j)=>Math.min(length,j*12)),length])].sort((a,b)=>a-b),wire=[];
          let segment=0;
          for(const at of samples){
            while(segment<points.length-2&&distances[segment+1]<at)segment++;
            const p=points[segment],q=points[segment+1],t=(at-distances[segment])/(distances[segment+1]-distances[segment]||1),u=at/length;
            wire.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,az+(bz-az)*u-4*u*(1-u)*Math.min(3,length*.015)]);
          }
          spans.push({points:wire,supports:[previous.support.id,support.id]});
        }
      }
      previous={index:i,support};
    }
  }
  return spans;
}

export function guardrailRun(points,{height=.8,start=true,end=true}={}){
  const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  const length=distances.at(-1);if(length<.01)return [];
  const ramp=Math.min(8,length/2),samples=[...new Set([...distances,...Array.from({length:Math.ceil(length/2)+1},(_,i)=>Math.min(length,i*2)),length])].sort((a,b)=>a-b),result=[];
  let segment=0;
  for(const at of samples){
    while(segment<points.length-2&&distances[segment+1]<at)segment++;
    const a=points[segment],b=points[segment+1],t=(at-distances[segment])/(distances[segment+1]-distances[segment]||1),u=Math.min(1,start?at/ramp:1,end?(length-at)/ramp:1),lift=-.18+(height+.18)*u*u*(3-2*u);
    result.push({point:a.map((v,i)=>v+(b[i]-v)*t),height:lift,at});
  }
  return result;
}
