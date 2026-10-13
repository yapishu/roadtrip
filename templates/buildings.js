import * as THREE from './vendor/three.module.js';
import { roofProfile, roofPolygons, signedArea, streetIndex, frontage, facadeFloors, skinLayout } from './building-shapes.js';

const hash=s=>{let n=2166136261;for(const c of String(s))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
const quad=(out,a,b,c,d)=>out.push(...a,...b,...c,...a,...c,...d);
const palettes={
  california:['#b9ae97','#b8b5a6','#c4bba8','#a99b88'],
  mojave:['#b8a68d','#c1b7a2','#a49b8e','#b69e85'],
  utah:['#a58a76','#b29c86','#c2b39d','#aa9688'],
  redrock:['#b6987e','#c1ac90','#a99783','#b7a18d'],
  newmexico:['#b39b82','#c2b39e','#b6ac99','#a9907b'],
  texas:['#ad9885','#b7ad9e','#bdab95','#ad8b78']
};
const colorCache=new Map();
function rgb(value){if(!colorCache.has(value)){const c=new THREE.Color(value);colorCache.set(value,[c.r,c.g,c.b]);}return colorCache.get(value);}

export function buildingPlans(d,regional,theme){
  const streets=streetIndex(d.roads),surfaces=Object.values(regional?.surfaces||{}).filter(p=>(p.regions||[p.theme]).includes(theme)),plans=new Map();
  const routeCells=new Map();
  for(const p of d.route){const key=Math.floor(p[1]/400)+':'+Math.floor(p[2]/400);if(!routeCells.has(key))routeCells.set(key,[]);routeCells.get(key).push(p);}
  const nearRoute=(center,radius)=>{
    const cx=Math.floor(center[0]/400),cy=Math.floor(center[1]/400),cells=Math.ceil(radius/400);
    for(let x=cx-cells;x<=cx+cells;x++)for(let y=cy-cells;y<=cy+cells;y++)for(const p of routeCells.get(x+':'+y)||[])
      if(Math.hypot(p[1]-center[0],p[2]-center[1])<radius)return true;
    return false;
  };
  for(const b of d.buildings){
    const role=b.kind==='house'?'house':/industrial|farm|shed/.test(b.kind)?'industrial':b.kind==='motel'?'motel':/church|civic/.test(b.kind)?'civic':'shop';
    const choices=surfaces.filter(p=>p.role===role);
    const points=b.points.slice(0,-1),center=points.reduce((v,p)=>[v[0]+p[0]/points.length,v[1]+p[1]/points.length],[0,0]),radius=Math.max(...points.map(p=>Math.hypot(p[0]-center[0],p[1]-center[1])));
    const detail=nearRoute(center,(b.height>18?1600:350)+Math.min(200,radius));
    const profile=roofProfile(b),fronts=detail?frontage(b,streets):[],skins=new Map();
    for(const edge of fronts){
      const a=b.points[edge],q=b.points[edge+1],length=Math.hypot(q[0]-a[0],q[1]-a[1]);
      const matching=choices.filter(skin=>skinLayout(b,profile,length,skin));
      if(matching.length){const skin=matching[hash(b.id)%matching.length];skins.set(edge,{skin,...skinLayout(b,profile,length,skin)});}
    }
    plans.set(b,{profile,fronts,skins,detail});
  }
  return plans;
}

export function addBuildings(d,group,groundAt,plans,theme,observed=new Set()){
  const batches=new Map(),palette=palettes[theme]||palettes.california;
  for(const b of d.buildings){
    const p=b.points.slice(0,-1);if(p.length<3)continue;
    const {profile,fronts,skins,detail}=plans.get(b),skin=[...skins.values()][0]?.skin,seed=hash(b.id),center=p.reduce((v,q)=>[v[0]+q[0]/p.length,v[1]+q[1]/p.length],[0,0]);
    const key=Math.floor(center[0]/256)+':'+Math.floor(center[1]/256);
    if(!batches.has(key))batches.set(key,{vertices:[],colors:[],surfaces:[]});
    const batch=batches.get(key),vertices=batch.vertices,colors=batch.colors,surfaces=batch.surfaces;
    const face=(points,color,surface=0)=>{const start=vertices.length;quad(vertices,...points);const c=rgb(color);for(let i=start;i<vertices.length;i+=3){colors.push(...c);surfaces.push(surface);}};
    const box=(x,y,z,w,l,h,color)=>{
      const a=[x-w/2,z,-y+l/2],q=[x+w/2,z,-y+l/2],r=[x+w/2,z,-y-l/2],s=[x-w/2,z,-y-l/2],up=v=>[v[0],v[1]+h,v[2]];
      for(const [u,v]of [[a,q],[q,r],[r,s],[s,a]])face([u,v,up(v),up(u)],color);face([up(a),up(q),up(r),up(s)],color);
    };
    const wall=b.color||skin?.wallColor||({brick:'#a38671',concrete:'#b4b2a7',wood:'#aa9d88',stone:'#b2a48b',metal:'#a8ada9'}[b.material])||palette[seed%palette.length];
    const roof=b.roofColor||({metal:'#92968e',roof_tiles:'#936e55',tile:'#936e55'}[b.roofMaterial])||(profile.rise?['#766f63','#827364','#6e716a','#8b7d69'][seed%4]:'#aaa99a');
    const trim=profile.rise?'#c7c1af':'#c5bba7',glass=['#59666a','#566469','#626d6c'][seed%3],reflection=['#7e8e90','#899798','#899594'][seed%3];
    const base=b.base+(b.minHeight||0),top=profile.eaves,canopy=b.kind==='canopy';
    const contour=p.map(q=>new THREE.Vector2(...q)),holes=(b.holes||[]).map(h=>h.slice(0,-1).map(q=>new THREE.Vector2(...q))),flat=[...contour,...holes.flat()];
    const triangles=THREE.ShapeUtils.triangulateShape(contour,holes).map(t=>t.map(i=>[flat[i].x,flat[i].y]));
    for(const triangle of triangles){
      for(const ring of roofPolygons(triangle,profile))for(let i=1;i<ring.length-1;i++)for(const q of [ring[0],ring[i],ring[i+1]]){
        vertices.push(q[0],profile.top(q)-(profile.rise?0:.22),-q[1]);colors.push(...rgb(roof));surfaces.push(1);
      }
      if(canopy||b.minHeight>0)for(const q of triangle){vertices.push(q[0],canopy?top-.35:base,-q[1]);colors.push(...rgb('#9f9c90'));surfaces.push(0);}
    }
    const area=Math.abs(signedArea(b.points));
    const detailed=detail;
    for(const [ringIndex,ring]of [b.points,...(b.holes||[])].entries()){
      const inner=ringIndex>0,ringSign=Math.sign(signedArea(ring))*(inner?-1:1);
      for(let i=0;i<ring.length-1;i++){
        const a=ring[i],q=ring[i+1],dx=q[0]-a[0],dy=q[1]-a[1],length=Math.hypot(dx,dy);if(length<.05)continue;
        const nx=dy/length*ringSign,ny=-dx/length*ringSign;
        const point=(t,h,offset=0)=>[a[0]+dx*t+nx*offset,h,-a[1]-dy*t-ny*offset];
        const panel=(u,v,low,high,color,offset=.025)=>face([point(u,low,offset),point(v,low,offset),point(v,high,offset),point(u,high,offset)],color);
        const raised=(u,v,low,high,color,depth=.13)=>{
          panel(u,v,low,high,color,depth);
          for(const [s,t,h,k]of [[u,v,low,low],[v,v,low,high],[v,u,high,high],[u,u,high,low]])
            face([point(s,h,.025),point(t,k,.025),point(t,k,depth),point(s,h,depth)],color);
        };
        const hood=(middle,width,height,depth,color)=>{
          const u=middle-width/length/2,v=middle+width/length/2;
          face([point(u,height,.04),point(v,height,.04),point(v,height-.13,depth),point(u,height-.13,depth)],color);
          face([point(u,height-.12,.04),point(v,height-.12,.04),point(v,height-.25,depth),point(u,height-.25,depth)],'#827b69');
          face([point(u,height-.25,depth),point(v,height-.25,depth),point(v,height-.13,depth),point(u,height-.13,depth)],trim);
          for(const t of [u,v])face([point(t,height-.12,.04),point(t,height,.04),point(t,height-.13,depth),point(t,height-.25,depth)],trim);
        };
        const edgePoints=profile.splitEdge(a,q);
        for(let j=1;j<edgePoints.length;j++){
          const v=edgePoints[j-1],w=edgePoints[j],vh=profile.top(v),wh=profile.top(w);
          face([[v[0],canopy?vh-.35:base-.05,-v[1]],[w[0],canopy?wh-.35:base-.05,-w[1]],[w[0],wh,-w[1]],[v[0],vh,-v[1]]],wall,b.material==='brick'||(!b.material&&seed%3===0)?2:1);
          if(detailed&&!b.landmark){
            // Coping and fascia have a shallow overhang and a visible underside.
            const off=profile.rise?.22:.10,depth=profile.rise?.13:.16;
            face([[v[0]+nx*off,vh-depth,-v[1]-ny*off],[w[0]+nx*off,wh-depth,-w[1]-ny*off],[w[0]+nx*off,wh,-w[1]-ny*off],[v[0]+nx*off,vh,-v[1]-ny*off]],trim);
            face([[v[0],vh-depth,-v[1]],[w[0],wh-depth,-w[1]],[w[0]+nx*off,wh-depth,-w[1]-ny*off],[v[0]+nx*off,vh-depth,-v[1]-ny*off]],'#837e70');
            face([[v[0],vh,-v[1]],[w[0],wh,-w[1]],[w[0]+nx*off,wh,-w[1]-ny*off],[v[0]+nx*off,vh,-v[1]-ny*off]],trim);
          }
        }
        if(canopy){
          if(!inner){const count=Math.max(1,Math.ceil(length/6));for(let j=0;j<count;j++){const t=j/count,x=a[0]+dx*t,y=a[1]+dy*t,z=groundAt(x,y);box(x,y,z,.25,.25,Math.max(.1,profile.top([x,y])-.35-z),'#a8a499');}}
          continue;
        }
        if(!b.minHeight){
          const count=Math.max(1,Math.ceil(length/5));
          for(let j=0;j<count;j++){
            const u=j/count,v=(j+1)/count,low=Math.min(base-.05,groundAt(a[0]+dx*u,a[1]+dy*u)-.3),end=Math.min(base-.05,groundAt(a[0]+dx*v,a[1]+dy*v)-.3);
            face([point(u,low),point(v,end),point(v,base),point(u,base)],'#8f8c7e');
          }
        }
        if(!detailed||b.landmark||length<2||(!inner&&observed.has(b.id+':'+i)))continue;
        const isFront=!inner&&fronts.includes(i),skinFront=!inner&&skins.get(i);
        const levels=facadeFloors(b,profile),floorHeight=(top-base)/levels;
        if(skinFront){
          const {skin,count}=skinFront;
          for(let tile=0;tile<count;tile++){
            for(const [u,y,v,Y]of skin.openings||[]){
              const left=(tile+u)/count,right=(tile+v)/count,low=base+(1-Y)*floorHeight,high=base+(1-y)*floorHeight,thick=.055;
              raised(left-thick/length,left,low,high,trim);raised(right,right+thick/length,low,high,trim);
              raised(left-thick/length,right+thick/length,low-.07,low,trim,.20);raised(left-thick/length,right+thick/length,high,high+.07,trim);
            }
            if(skin.entryHood)hood((tile+skin.door)/count,1.7,base+floorHeight*.8,.65,roof);
          }
        }
        const industrial=/industrial|farm|shed/.test(b.kind),civic=b.referenceStyle==='civic-stone',curtain=b.referenceStyle==='curtain-wall',spacing=industrial?6:civic?4:b.kind==='house'?3.7:3.2,count=Math.max(1,Math.floor(length/spacing));
        if(civic&&length>10){
          for(let j=1;j<count;j++){
            const t=j/count,x=a[0]+dx*t+nx*.18,y=a[1]+dy*t+ny*.18;
            box(x,y,base+.4,.45,.45,Math.max(1,top-base-1.3),trim);
          }
          panel(0,1,top-.85,top-.25,trim,.18);
        }
        for(let floor=0;floor<levels;floor++){
          const ground=floor===0,low=base+floor*floorHeight;
          if(ground&&skinFront)continue;
          if(ground&&industrial&&!isFront)continue;
          const office=b.kind==='office'||b.height>18;
          const sill=curtain?.12:ground?Math.min(1.05,floorHeight*.3):floorHeight*.18,windowHeight=curtain?floorHeight-.25:Math.min(civic?2.6:office?2.2:1.75,floorHeight*(office?.70:.58)),width=curtain?length/count-.18:Math.min(industrial?2.4:office?2.6:1.5,length/count*(office?.84:.58));
          for(let n=0;n<count;n++){
            const mid=(n+.5)/count,half=width/length/2;
            panel(mid-half-.07/length,mid+half+.07/length,low+sill-.08,low+sill+windowHeight+.08,trim,.035);
            panel(mid-half,mid+half,low+sill,low+sill+windowHeight,glass,.05);
            panel(mid-half,mid+half,low+sill+windowHeight*.6,low+sill+windowHeight,reflection,.052);
            if(width>1.2)panel(mid-.025/length,mid+.025/length,low+sill,low+sill+windowHeight,'#aaa99b',.06);
            panel(mid-half,mid+half,low+sill+windowHeight*.35,low+sill+windowHeight*.35+.04,trim,.06);
          }
          if(!ground&&length>5)panel(0,1,low-.1,low+.06,trim,.04);
        }
        if(isFront&&!skinFront&&b.kind!=='shed'&&length>3){
          const middle=.5,half=Math.min(.6/length,.2),height=Math.min(2.25,floorHeight*.8);
          panel(middle-half-.09/length,middle+half+.09/length,base,base+height+.1,trim,.07);
          panel(middle-half,middle+half,base,base+height,'#424e4d',.09);
          if(b.kind==='house'&&seed%3!==0)hood(middle,1.7,base+height+.15,.7,roof);
          else if(['shop','commercial','motel'].includes(b.kind)&&seed%3===0)hood(middle,Math.min(length*.7,7),base+height+.35,1.0,['#8b7565','#718478','#a28a6c'][seed%3]);
        }
      }
    }
    // Small rooftop equipment is representative; its placement stays inside the footprint.
    if(detailed&&!b.landmark&&!profile.rise&&!canopy&&area>220&&['commercial','office','industrial','shop','civic'].includes(b.kind)){
      const triangle=triangles.reduce((best,t)=>{
        const size=Math.abs((t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]));return size>best.size?{size,t}:best;
      },{size:0,t:null});
      if(triangle.size>35){const [x,y]=triangle.t.reduce((s,v)=>[s[0]+v[0]/3,s[1]+v[1]/3],[0,0]);box(x,y,top-.2,1.5,2,.65,'#8f9890');}
    }
  }
  const material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute float surface; varying float wallSurface; varying vec3 wallPoint; varying vec3 wallNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nwallSurface=surface; wallPoint=position; wallNormal=normal;');
    shader.fragmentShader='varying float wallSurface; varying vec3 wallPoint; varying vec3 wallNormal;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      if(wallSurface>0.5){
        vec2 p=vec2(abs(wallNormal.x)>abs(wallNormal.z)?wallPoint.z:wallPoint.x,wallPoint.y);
        vec2 cell=floor(p/0.32);
        float grain=fract(sin(dot(cell,vec2(12.9898,78.233)))*43758.5453);
        float visibility=1.0-smoothstep(0.25,0.9,max(fwidth(p.x),fwidth(p.y)));
        diffuseColor.rgb*=1.0+(grain-0.5)*0.14*visibility;
        if(wallSurface>1.5){
          vec2 brick=vec2(p.x/0.48+mod(floor(p.y/0.18),2.0)*0.5,p.y/0.18);
          vec2 edge=min(fract(brick),1.0-fract(brick)),width=max(fwidth(brick),vec2(0.01));
          float mortar=1.0-min(smoothstep(0.025,0.025+width.x,edge.x),smoothstep(0.04,0.04+width.y,edge.y));
          diffuseColor.rgb*=1.0-mortar*0.10*visibility;
        }
      }
    `);
  };
  material.customProgramCacheKey=()=>'building-material';
  for(const {vertices,colors,surfaces}of batches.values()){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('surface',new THREE.Float32BufferAttribute(surfaces,1));geometry.computeVertexNormals();geometry.computeBoundingSphere();
    group.add(new THREE.Mesh(geometry,material));
  }
}
