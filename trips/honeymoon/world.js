// A metre-scale world: measured terrain, aerial surfaces and mapped structures.
import * as THREE from './vendor/three.module.js';
import { addRoadside } from './roadside.js';
import { gradeTerrain, normalAt, groundHeight, minorRoadSurfaces } from './road-grade.js';
import { addAmbient } from './ambient.js';
import { scheduleAmbient } from './ambient-plan.js';
import { roadSupports } from './road-supports.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const hash=s=>{let v=2166136261;for(const c of String(s))v=Math.imul(v^c.charCodeAt(0),16777619);return v>>>0;};
export async function createRoad(canvas,opts={}) {
  let W=opts.width||480,H=opts.height||270;
  canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  const renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,preserveDrawingBuffer:true});
  renderer.setSize(W,H);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#aac8dc');scene.fog=new THREE.FogExp2('#b7c6cb',.000045);
  scene.add(new THREE.HemisphereLight(0xe7f0ff,0x71664f,2.0));
  const sun=new THREE.DirectionalLight(0xfff0d7,2.0);sun.position.set(-6000,10000,4000);scene.add(sun);
  const camera=new THREE.PerspectiveCamera(64,W/H,.25,45000);
  const baseIDX=await fetch('data/index.json').then(r=>r.json());
  const journey=await fetch('journey.json').then(r=>r.ok?r.json():null);
  const IDX=journey?{...baseIDX,total:journey.total,stops:journey.stops}:baseIDX,LEN=IDX.total;
  const sources=journey?.sources||{'':{total:LEN,stops:IDX.stops}},segments=journey?.segments||[{source:'',start:0,end:LEN,at:0,length:LEN}];
  const locations=await fetch('data/locations.json').then(r=>r.ok?r.json():[]);
  function locate(s){s=clamp(s,0,LEN-.001);let part=segments[0];for(const segment of segments){if(segment.at>s)break;part=segment;}return {source:part.source,distance:part.start+s-part.at};}
  const worldURL=(source,file)=>(source?source+'/':'')+'world/'+file;
  function captionAt(s){const journeyDistance=s,loc=locate(s),source=sources[loc.source];if(loc.source){let nearest=source.stops[0];for(const mark of source.stops)if(Math.abs(mark.at-loc.distance)<Math.abs(nearest.at-loc.distance))nearest=mark;return Math.abs(nearest.at-loc.distance)<650&&!/· start|· return/.test(nearest.name)?nearest.name:(source.captions?.find(c=>loc.distance>=c.from&&loc.distance<c.to)?.name||source.name);}
    s=loc.distance;let nearest=baseIDX.stops[0];for(const stop of baseIDX.stops)if(Math.abs(stop.at-s)<Math.abs(nearest.at-s))nearest=stop;
    const radius=/Death Valley|Grand Canyon|Bryce Canyon|Mesa Verde/.test(nearest.name)?14000:/Zion|Glen Canyon|Monument Valley/.test(nearest.name)?6500:/Las Vegas|Albuquerque|Lubbock/.test(nearest.name)?10000:4000;
    if(Math.abs(nearest.at-s)<=radius)return nearest.name;let local=null,distance=4500;for(const place of locations){const delta=Math.abs(place[0]-s);if(delta<distance){distance=delta;local=place[1];}}if(local)return local;
    const next=IDX.stops.find(stop=>stop.at>journeyDistance)||IDX.stops.at(-1),previous=IDX.stops[Math.max(0,IDX.stops.indexOf(next)-1)];return previous.name.split(',')[0]+' → '+next.name.split(',')[0];
  }
  const chunks=new Map(),pending=new Map(),failures=new Map(),T={now:0},ambientSeed=opts.ambientSeed??Math.floor(Math.random()*4294967296);
  const ambientEvents=new Map();
  for(const event of scheduleAmbient(LEN,ambientSeed)){const {source,distance}=locate(event.at);if(!ambientEvents.has(source))ambientEvents.set(source,[]);ambientEvents.get(source).push({...event,s:distance});}
  const textureLoader=new THREE.TextureLoader();let active=null,look=0,draws=0,lastRender='';
  const regional=await fetch('regional/art/world-kit.json').then(r=>r.ok?r.json():null).catch(()=>null),regionalTextures=new Map();
  if(regional)await Promise.all([...new Set([...Object.values(regional.surfaces),...Object.values(regional.trees)].map(p=>p.file))].map(async file=>{try{const texture=await textureLoader.loadAsync(file);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;regionalTextures.set(file,texture);}catch{}}));
  const rocks=new Map();await Promise.all(['sandstone','limestone','granite'].map(async name=>{try{const texture=await textureLoader.loadAsync('materials/art/'+name+'.png');texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;rocks.set(name,texture);}catch{}}));
  const material=(color,extra={})=>new THREE.MeshLambertMaterial({color,...extra});
  const asphalt=material('#555554',{polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  // Paint stays above the asphalt's depth bias, including at grazing angles.
  const roadPaint=color=>material(color,{polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3});
  const dirt=material('#a7987a'),paint=roadPaint('#e1d0a0'),white=roadPaint('#d7d6c9');
  function elevation(g,a,x,y){let fx=clamp((x-g.x0)/g.cell,0,g.w-1.001),fy=clamp((y-g.y0)/g.cell,0,g.h-1.001),ix=Math.floor(fx),iy=Math.floor(fy);fx-=ix;fy-=iy;const k=iy*g.w+ix;return ((a[k]*(1-fx)+a[k+1]*fx)*(1-fy)+(a[k+g.w]*(1-fx)+a[k+g.w+1]*fx)*fy)*g.scale+g.offset;}
  function terrain(g,a,texture,cut,d,source){
    const textureBounds=g.textureBounds||g,cuts=Array.isArray(cut)?cut:cut?[cut]:[];
    const vertices=new Float32Array(g.w*g.h*3),uv=new Float32Array(g.w*g.h*2),indices=[];
    for(let y=0;y<g.h;y++)for(let x=0;x<g.w;x++){const k=y*g.w+x;vertices[k*3]=g.x0+x*g.cell;vertices[k*3+1]=a[k]*g.scale+g.offset;vertices[k*3+2]=-(g.y0+y*g.cell);uv[k*2]=(g.x0+x*g.cell-textureBounds.x0)/((textureBounds.w-1)*textureBounds.cell);uv[k*2+1]=(g.y0+y*g.cell-textureBounds.y0)/((textureBounds.h-1)*textureBounds.cell);if(x<g.w-1&&y<g.h-1){const px=g.x0+(x+.5)*g.cell,py=g.y0+(y+.5)*g.cell;if(cuts.some(c=>px>c.x0&&px<c.x0+(c.w-1)*c.cell&&py>c.y0&&py<c.y0+(c.h-1)*c.cell))continue;indices.push(k,k+1,k+g.w,k+1,k+g.w+1,k+g.w);}}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(vertices,3));geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    const mat=material('#ffffff',{map:texture});
    const at=sources[source].themeAt??(d.s0+d.len/2),rock=rocks.get(at<570000?'granite':at>1470000&&at<2090000?'limestone':'sandstone');
    if(rock){mat.onBeforeCompile=shader=>{shader.uniforms.cliffTexture={value:rock};shader.uniforms.worldOrigin={value:new THREE.Vector3(d.origin[0],0,-d.origin[1])};
      shader.vertexShader='varying vec3 terrainPoint; varying vec3 terrainNormal; uniform vec3 worldOrigin;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nterrainPoint=position+worldOrigin; terrainNormal=normal;');
      shader.fragmentShader='varying vec3 terrainPoint; varying vec3 terrainNormal; uniform sampler2D cliffTexture;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
        vec3 axis=abs(normalize(terrainNormal));
        float steep=1.0-smoothstep(0.4,0.85,axis.y);
        vec3 stoneA=texture2D(cliffTexture,terrainPoint.xy/vec2(28.0,22.0)).rgb;
        vec3 stoneB=texture2D(cliffTexture,terrainPoint.zy/vec2(28.0,22.0)).rgb;
        vec3 stone=mix(stoneA,stoneB,axis.x/max(0.001,axis.x+axis.z));
        float lightness=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));
        vec3 tint=clamp(diffuseColor.rgb/max(lightness,0.025),vec3(0.6),vec3(1.5));
        diffuseColor.rgb=mix(diffuseColor.rgb,stone*tint*0.82,steep*0.9);
      `);
    };mat.customProgramCacheKey=()=>'cliff-material';}
    // Tile the same geometry so the camera can cull terrain outside its view.
    // Shared-grid normals keep illumination continuous across tile boundaries.
    const tiles=new THREE.Group(),normals=geo.attributes.normal.array,tileSize=64;
    for(let row=0;row<g.h-1;row+=tileSize)for(let col=0;col<g.w-1;col+=tileSize){
      const tw=Math.min(tileSize,g.w-1-col)+1,th=Math.min(tileSize,g.h-1-row)+1;
      const p=new Float32Array(tw*th*3),n=new Float32Array(tw*th*3),t=new Float32Array(tw*th*2),ix=[];
      for(let y=0;y<th;y++){
        const start=(row+y)*g.w+col;p.set(vertices.subarray(start*3,(start+tw)*3),y*tw*3);n.set(normals.subarray(start*3,(start+tw)*3),y*tw*3);t.set(uv.subarray(start*2,(start+tw)*2),y*tw*2);
        if(y===th-1)continue;
        for(let x=0;x<tw-1;x++){const px=g.x0+(col+x+.5)*g.cell,py=g.y0+(row+y+.5)*g.cell;if(cuts.some(c=>px>c.x0&&px<c.x0+(c.w-1)*c.cell&&py>c.y0&&py<c.y0+(c.h-1)*c.cell))continue;const k=y*tw+x;ix.push(k,k+1,k+tw,k+1,k+tw+1,k+tw);}
      }
      if(!ix.length)continue;
      const tile=new THREE.BufferGeometry();tile.setAttribute('position',new THREE.BufferAttribute(p,3));tile.setAttribute('normal',new THREE.BufferAttribute(n,3));tile.setAttribute('uv',new THREE.BufferAttribute(t,2));tile.setIndex(ix);tile.computeBoundingSphere();tiles.add(new THREE.Mesh(tile,mat));
    }
    geo.dispose();return tiles;
  }
  function mesh(vertices,mat,uv){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));if(uv)geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();return new THREE.Mesh(geo,mat);}
  function quad(out,a,b,c,d){out.push(...a,...c,...b,...a,...d,...c);}
  function strip(out,points,width,offset=0,lift=0){for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],na=normalAt(points,i),nb=normalAt(points,i+1),l=offset-width/2,r=offset+width/2;quad(out,[a[0]+na[0]*l,a[2]+lift,-a[1]-na[1]*l],[b[0]+nb[0]*l,b[2]+lift,-b[1]-nb[1]*l],[b[0]+nb[0]*r,b[2]+lift,-b[1]-nb[1]*r],[a[0]+na[0]*r,a[2]+lift,-a[1]-na[1]*r]);}}
  function roadMeshes(d,group,groundAt){const minorSurfaces=minorRoadSurfaces(d.roads),paved=[],unpaved=[],lines=[],edges=[],tunnelWalls=[],tunnelFloor=[],rails=[],bridges=[],banks=[];
    const supports=roadSupports(d.roads,groundAt);
    for(const [faces,out]of [[supports.earth,banks],[supports.concrete,bridges],[supports.rails,rails]])for(const face of faces)quad(out,...face.map(p=>[p[0],p[2],-p[1]]));
    for(const r of d.roads){const small=/footway|path|steps|cycleway|track/.test(r.kind);
      if(minorSurfaces.has(r)){for(const polygon of minorSurfaces.get(r))for(let i=1;i<polygon.length-1;i++)for(const p of [polygon[0],polygon[i+1],polygon[i]])unpaved.push(p[0],p[2]+.13,-p[1]);}
      else strip(r.tunnel?tunnelFloor:small?unpaved:paved,r.points,r.width+(r.tunnel?1.5:0),0,.13);
      if(!small&&r.width>6&&!/service|residential/.test(r.kind)){if(!r.oneway){strip(lines,r.points,.11,-.1,.19);strip(lines,r.points,.11,.1,.19);}if(r.width>8){strip(edges,r.points,.13,r.width/2-.25,.19);strip(edges,r.points,.13,-r.width/2+.25,.19);}}
      if(r.tunnel||r.bridge)for(let i=0;i<r.points.length-1;i++){const a=r.points[i],b=r.points[i+1],dx=b[0]-a[0],dy=b[1]-a[1],n=Math.hypot(dx,dy)||1,nx=dy/n,ny=-dx/n;
        if(r.tunnel){const ring=[[-1,0],[-1,2],...Array.from({length:9},(_,j)=>[-Math.cos(j*Math.PI/8),2+Math.sin(j*Math.PI/8)*3.7]),[1,0]],radius=r.width/2+.6,na=normalAt(r.points,i),nb=normalAt(r.points,i+1);
          for(let j=0;j<ring.length-1;j++){const [u,h]=ring[j],[v,k]=ring[j+1];quad(tunnelWalls,[a[0]+na[0]*u*radius,a[2]+h,-a[1]-na[1]*u*radius],[b[0]+nb[0]*u*radius,b[2]+h,-b[1]-nb[1]*u*radius],[b[0]+nb[0]*v*radius,b[2]+k,-b[1]-nb[1]*v*radius],[a[0]+na[0]*v*radius,a[2]+k,-a[1]-na[1]*v*radius]);}}
        if(r.bridge){
          const na=normalAt(r.points,i),nb=normalAt(r.points,i+1),corner=(p,n,side,z)=>[p[0]+n[0]*side*r.width/2,p[2]+z,-p[1]-n[1]*side*r.width/2];
          quad(bridges,corner(a,na,-1,-.8),corner(b,nb,-1,-.8),corner(b,nb,1,-.8),corner(a,na,1,-.8));
          for(const sign of [-1,1]){quad(bridges,corner(a,na,sign,-.8),corner(b,nb,sign,-.8),corner(b,nb,sign,.1),corner(a,na,sign,.1));quad(rails,corner(a,na,sign,.5),corner(b,nb,sign,.5),corner(b,nb,sign,.9),corner(a,na,sign,.9));}
        }
      }
      if(r.bridge){let distance=0,next=16;
        for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
          for(;next<distance+length;next+=32){const t=(next-distance)/length,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t,top=a[2]+(b[2]-a[2])*t-.8,base=groundAt(x,y)-.5;
            if(top-base<2||d.roads.some(other=>other!==r&&other.points.some(p=>p[2]<top-1&&Math.hypot(p[0]-x,p[1]-y)<other.width/2+5)))continue;
            // Representative piers leave the mapped roads below unobstructed.
            const half=Math.min(1.2,r.width*.1),corners=[[x-half,y-half],[x+half,y-half],[x+half,y+half],[x-half,y+half]];
            for(let j=0;j<4;j++){const p=corners[j],q=corners[(j+1)%4];quad(bridges,[p[0],base,-p[1]],[q[0],base,-q[1]],[q[0],top,-q[1]],[p[0],top,-p[1]]);}
          }distance+=length;
        }
      }
    }
    for(const [v,m] of [[banks,material('#998972',{side:THREE.DoubleSide})],[paved,asphalt],[unpaved,dirt],[lines,paint],[edges,white],[tunnelWalls,new THREE.MeshBasicMaterial({color:'#796b58',map:rocks.get('limestone'),side:THREE.DoubleSide})],[tunnelFloor,new THREE.MeshBasicMaterial({color:'#393734'})],[rails,material('#a8a49a',{side:THREE.DoubleSide})],[bridges,material('#9b998d',{side:THREE.DoubleSide})]])if(v.length){let uv;if(v===tunnelWalls){uv=[];for(let i=0;i<v.length;i+=3)uv.push((v[i]+v[i+2]+d.origin[0]-d.origin[1])/7,v[i+1]/5);}group.add(mesh(v,m,uv));}
  }
  async function waterways(d,group,source){
    if(!d.waterwaysFile)return;
    const response=await fetch(worldURL(source,d.waterwaysFile));if(!response.ok)throw Error(d.waterwaysFile);
    const {waterways}=await response.json(),roads=waterways.map(r=>({...r,kind:'path'})),surfaces=minorRoadSurfaces([...d.roads,...roads]),vertices=[];
    for(const road of roads)for(const polygon of surfaces.get(road)||[])for(let i=1;i<polygon.length-1;i++)for(const p of [polygon[0],polygon[i+1],polygon[i]])vertices.push(p[0],p[2],-p[1]);
    if(vertices.length)group.add(mesh(vertices,material('#719698',{side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1})));
  }
  function roofProfile(b) {
    const p=b.points.slice(0,-1);let longest=0,ux=1,uy=0;
    for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length],dx=q[0]-p[i][0],dy=q[1]-p[i][1],len=Math.hypot(dx,dy);if(len>longest){longest=len;ux=dx/len;uy=dy/len;}}
    const across=p.map(v=>-uy*v[0]+ux*v[1]),min=Math.min(...across),max=Math.max(...across),center=(min+max)/2;
    const rise=/gabled|hipped/.test(b.roof)&&!b.holes.length?Math.min(b.height*.35,b.roofHeight||Math.max(.8,(max-min)*.18)):0;
    return {rise,eaves:b.base+b.height-rise,axis:v=>-uy*v[0]+ux*v[1]-center,top:v=>b.base+b.height-rise*Math.min(1,Math.abs(-uy*v[0]+ux*v[1]-center)/Math.max(.1,(max-min)/2))};
  }
  function buildingMeshes(d,group,groundAt){
    const walls=[],roofs=[],foundations=[],wallColors=[],roofColors=[],roofUV=[];
    for(const b of d.buildings){const p=b.points.slice(0,-1);if(p.length<3)continue;const profile=roofProfile(b),seed=hash(b.id),c=new THREE.Color(b.color||['#b8a68b','#c4b8a1','#ae8c75','#b6aca0','#a79c8b'][seed%5]),rc=new THREE.Color(b.roofColor||['#756b5d','#786955','#9b8f7d','#705f50'][seed%4]);const base=b.base-.25,top=profile.eaves;
      for(let i=0;i<p.length;i++){const a=p[i],z=p[(i+1)%p.length];const start=walls.length;quad(walls,[a[0],base,-a[1]],[z[0],base,-z[1]],[z[0],top,-z[1]],[a[0],top,-a[1]]);
        const length=Math.hypot(z[0]-a[0],z[1]-a[1]),parts=Math.max(1,Math.ceil(length/5));
        for(let j=0;j<parts;j++){const u=j/parts,v=(j+1)/parts,x=a[0]+(z[0]-a[0])*u,y=a[1]+(z[1]-a[1])*u,xx=a[0]+(z[0]-a[0])*v,yy=a[1]+(z[1]-a[1])*v,low=Math.min(base,groundAt(x,y)-.5),end=Math.min(base,groundAt(xx,yy)-.5);if(low<base-.1||end<base-.1)quad(foundations,[x,low,-y],[xx,end,-yy],[xx,base,-yy],[x,base,-y]);}
        if(profile.rise){const aa=profile.axis(a),zz=profile.axis(z),poly=[a];if(aa*zz<0){const t=aa/(aa-zz);poly.push([a[0]+(z[0]-a[0])*t,a[1]+(z[1]-a[1])*t]);}poly.push(z);for(let j=0;j<poly.length-1;j++){const v=poly[j],w=poly[j+1];quad(walls,[v[0],top,-v[1]],[w[0],top,-w[1]],[w[0],profile.top(w),-w[1]],[v[0],profile.top(v),-v[1]]);}}
        for(let j=start;j<walls.length;j+=3)wallColors.push(c.r,c.g,c.b);
      }
      const clip=sign=>{const result=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],va=profile.axis(a)*sign,vb=profile.axis(b)*sign;if(va>=0)result.push(a);if(va*vb<0){const t=va/(va-vb);result.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}return result;};
      for(const ring of profile.rise?[clip(1),clip(-1)]:[p]){if(ring.length<3)continue;const contour=ring.map(v=>new THREE.Vector2(...v)),holes=(b.holes||[]).map(h=>h.slice(0,-1).map(v=>new THREE.Vector2(...v))),flat=[...contour,...holes.flat()];
        for(const face of THREE.ShapeUtils.triangulateShape(contour,holes))for(const j of face){const v=flat[j];roofs.push(v.x,profile.rise?profile.top([v.x,v.y]):top,-v.y);roofColors.push(rc.r,rc.g,rc.b);roofUV.push((v.x-d.near.x0)/((d.near.w-1)*d.near.cell),(v.y-d.near.y0)/((d.near.h-1)*d.near.cell));}}
    }
    for(const [v,c] of [[walls,wallColors],[roofs,roofColors]])if(v.length){const m=mesh(v,material('#ffffff',{vertexColors:true,side:THREE.DoubleSide}));m.geometry.setAttribute('color',new THREE.Float32BufferAttribute(c,3));group.add(m);}
    if(foundations.length)group.add(mesh(foundations,material('#797767',{side:THREE.DoubleSide})));
  }
  function lodgeDetails(d,group) {
    for(const b of d.buildings){if(b.landmark!=='giant-steps-lodge')continue;
      const a=b.points[b.facadeEdge],q=b.points[b.facadeEdge+1],dx=q[0]-a[0],dy=q[1]-a[1],len=Math.hypot(dx,dy),sign=Math.sign(b.points.slice(0,-1).reduce((sum,p,i)=>sum+p[0]*b.points[i+1][1]-p[1]*b.points[i+1][0],0)),nx=dy/len*sign,ny=-dx/len*sign;
      const point=(t,h,off=.04)=>[a[0]+dx*t+nx*off,b.base+h,-a[1]-dy*t-ny*off];
      const windows=[],trim=[],count=Math.max(2,Math.round(len/4));
      for(const h of [1.4,4.7])for(let i=0;i<count;i++){const t=(i+.5)/count,half=Math.min(.8/len,.35/count);quad(trim,point(t-half-.08/len,h-.1),point(t+half+.08/len,h-.1),point(t+half+.08/len,h+1.8),point(t-half-.08/len,h+1.8));quad(windows,point(t-half,h,.065),point(t+half,h,.065),point(t+half,h+1.65,.065),point(t-half,h+1.65,.065));}
      group.add(mesh(trim,material('#536051',{side:THREE.DoubleSide})),mesh(windows,material('#4b5b59',{side:THREE.DoubleSide})));
      const label=document.createElement('canvas');label.width=192;label.height=48;const g=label.getContext('2d');g.fillStyle='#a0997b';g.fillRect(0,0,192,48);g.fillStyle='#c49557';g.font='bold 19px monospace';g.textAlign='center';g.fillText('GIANT STEPS',96,21);g.fillText('LODGE',96,41);
      const texture=new THREE.CanvasTexture(label);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;const vertices=[],width=Math.min(7,len*.7),left=.5-width/len/2,right=.5+width/len/2;quad(vertices,point(left,6.7,.08),point(right,6.7,.08),point(right,8.4,.08),point(left,8.4,.08));
      const signMaterial=material('#ffffff',{map:texture,side:THREE.DoubleSide});signMaterial.userData.ownedMap=true;group.add(mesh(vertices,signMaterial,[0,0,1,1,1,0,0,0,0,1,1,1]));
    }
  }
  function landmarkMeshes(d,group){for(const l of d.landmarks||[]){if(l.kind!=='watchtower')continue;const geometry=new THREE.CylinderGeometry(l.radius*.93,l.radius,l.height,32,8),uv=geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*5,uv.getY(i)*5);const tower=new THREE.Mesh(geometry,material('#a58b66',{map:rocks.get('limestone')}));tower.position.set(l.center[0],l.base+l.height/2,-l.center[1]);group.add(tower);const windows=[];for(const height of [6,11,16,19])for(let i=0;i<8;i++){const angle=i*Math.PI/4+(height%3)*.11,nx=Math.sin(angle),ny=Math.cos(angle),radius=l.radius*(1-.07*height/l.height)+.025,x=l.center[0]+nx*radius,y=l.center[1]+ny*radius,tangent=[ny*.4,-nx*.4];quad(windows,[x-tangent[0],l.base+height,-y+tangent[1]],[x+tangent[0],l.base+height,-y-tangent[1]],[x+tangent[0],l.base+height+1,-y-tangent[1]],[x-tangent[0],l.base+height+1,-y+tangent[1]]);}group.add(mesh(windows,material('#302b25',{side:THREE.DoubleSide})));}}
  function themeAt(s){let theme=regional?.themes[0]?.id;for(const t of regional?.themes||[])if(t.from<=s)theme=t.id;return theme;}
  function regionalFacades(d,group,source){if(!regional)return;const theme=themeAt(sources[source].themeAt??(d.s0+d.len/2)),surfaces=Object.entries(regional.surfaces).filter(([,p])=>p.theme===theme),batches=new Map();
    for(const b of d.buildings){if(b.landmark)continue;let role=/house|apartment/.test(b.kind)?'house':/industrial|farm|shed/.test(b.kind)?'industrial':b.kind==='motel'?'motel':/church|civic/.test(b.kind)?'civic':'shop';let choices=surfaces.filter(([,p])=>p.role===role);if(!choices.length)choices=surfaces;if(!choices.length)continue;
      const profile=roofProfile(b),base=b.base-.2,top=profile.eaves;
      for(let edge=0;edge<b.points.length-1;edge++){const a=b.points[edge],z=b.points[edge+1],len=Math.hypot(z[0]-a[0],z[1]-a[1]);if(len<.2)continue;const seed=hash(b.id+':'+edge),skin=choices[seed%choices.length][1];if(!regionalTextures.has(skin.file))continue;let batch=batches.get(skin.file);if(!batch){batch={vertices:[],uv:[]};batches.set(skin.file,batch);}
        const count=Math.max(1,Math.round(len/skin.width)),stories=Math.max(1,Math.round((top-base)/4));
        for(let j=0;j<count;j++)for(let floor=0;floor<stories;floor++){const t0=j/count,t1=(j+1)/count,p=[a[0]+(z[0]-a[0])*t0,a[1]+(z[1]-a[1])*t0],q=[a[0]+(z[0]-a[0])*t1,a[1]+(z[1]-a[1])*t1],h0=base+(top-base)*floor/stories,h1=base+(top-base)*(floor+1)/stories;
          quad(batch.vertices,[p[0],h0,-p[1]],[q[0],h0,-q[1]],[q[0],h1,-q[1]],[p[0],h1,-p[1]]);
          const [ax,ay,aw,ah]=skin.rect,[tw,th]=skin.size,u0=(ax+.5)/tw,u1=(ax+aw-.5)/tw,v0=1-(ay+ah*(floor>0?.6:1)-.5)/th,v1=1-(ay+.5)/th;
          batch.uv.push(u0,v0,u1,v1,u1,v0,u0,v0,u0,v1,u1,v1);
        }
      }
    }
    for(const [file,b]of batches)group.add(mesh(b.vertices,material('#ffffff',{map:regionalTextures.get(file),side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),b.uv));
  }
  async function vegetation(d,group,source,groundAt){if(!regional)return;const response=await fetch(worldURL(source,`v${String(d.c).padStart(4,'0')}.json`));if(!response.ok)return;const data=await response.json();let theme=themeAt(sources[source].themeAt??(d.s0+d.len/2));if((d.near.min+d.near.max)/2>1750&&d.s0>900000&&d.s0<2900000)theme='redrock';
    let choices=Object.entries(regional.trees).filter(([,p])=>(p.regions||[p.theme]).includes(theme)&&regionalTextures.has(p.file));if(!choices.length)return;const batches=new Map(),dummy=new THREE.Object3D();
    for(const t of data.trees){let zone;for(const z of sources[source].vegetation||[])if(t[2]>=z.minElevation)zone=z;const pool=zone?Object.entries(regional.trees).filter(([name,asset])=>zone.trees.includes(name)&&regionalTextures.has(asset.file)):choices;if(!pool.length)continue;const [name,asset]=pool[t[4]%pool.length],scale=zone?.scale||1,key=name+':'+scale;let batch=batches.get(key);if(!batch){batch={asset:{...asset,height:asset.height*scale},trees:[]};batches.set(key,batch);}batch.trees.push(t);}
    for(const {asset,trees}of batches.values()){const mat=new THREE.MeshLambertMaterial({map:regionalTextures.get(asset.file),alphaTest:.6,side:THREE.DoubleSide,color:'#eeeece'}),geometry=new THREE.PlaneGeometry(1,1);geometry.translate(0,.5,0);const instances=new THREE.InstancedMesh(geometry,mat,trees.length*2);let i=0;
      for(const t of trees){const h=asset.height*t[3],w=h*asset.aspect;for(let side=0;side<2;side++){dummy.position.set(t[0],groundAt(t[0],t[1])-.2,-t[1]);dummy.rotation.set(0,t[4]/65536*Math.PI+side*Math.PI/2,0);dummy.scale.set(w,h,1);dummy.updateMatrix();instances.setMatrixAt(i++,dummy.matrix);}}instances.computeBoundingSphere();group.add(instances);
    }group.userData.trees=data.trees.length;
  }
  async function appearance(d,group,source) {
    const response=await fetch(worldURL(source,`a${String(d.c).padStart(4,'0')}.json`));if(!response.ok)return;
    const a=await response.json();if(!a.faces.length)return;const byId=new Map(d.buildings.map(b=>[b.id,b]));
    const textures=await Promise.all(a.atlases.map(name=>textureLoader.loadAsync(worldURL(source,name))));
    for(let page=0;page<textures.length;page++) {const vertices=[],uv=[];for(const f of a.faces){if(f.page!==page)continue;const b=byId.get(f.building);if(!b||b.landmark)continue;const p=b.points[f.edge],q=b.points[f.edge+1];if(!q)continue;const dx=q[0]-p[0],dy=q[1]-p[1],len=Math.hypot(dx,dy)||1;
      const x=p[0],y=p[1],z=q[0],w=q[1],base=b.base-.01,top=roofProfile(b).eaves;
      quad(vertices,[x,base,-y],[z,base,-w],[z,top,-w],[x,top,-y]);
      const [ax,ay,aw,ah]=f.rect,u0=(ax+.5)/a.size,u1=(ax+aw-.5)/a.size,v0=1-(ay+ah-.5)/a.size,v1=1-(ay+ah*(1-(top-b.base)/b.height)+.5)/a.size;
      uv.push(u0,v0,u1,v1,u1,v0,u0,v0,u0,v1,u1,v1);
    }const tex=textures[page];tex.colorSpace=THREE.SRGBColorSpace;tex.minFilter=THREE.LinearFilter;tex.generateMipmaps=false;
      const m=mesh(vertices,new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}),uv);m.material.userData.ownedMap=true;group.add(m);
    }group.userData.observedWalls=a.faces.length;
  }
  async function load(source,c){const key=source+':'+c;if(c<0||c>=Math.ceil(sources[source].total/10000)||chunks.has(key)||pending.has(key)||(failures.get(key)||0)>Date.now()-15000)return;
    const work=(async()=>{try{const response=await fetch(worldURL(source,`c${String(c).padStart(4,'0')}.json`));if(!response.ok)throw Error(`World chunk ${key}: ${response.status}`);const d=await response.json();
      const values=await Promise.all([d.near,d.far].map(async g=>{const [buffer,texture]=await Promise.all([fetch(worldURL(source,g.file)).then(r=>{if(!r.ok)throw Error(g.file);return r.arrayBuffer();}),textureLoader.loadAsync(worldURL(source,g.image))]);return {a:new Uint16Array(buffer),texture};}));
      const group=new THREE.Group(),graded=gradeTerrain(d.roads,values[0].a,d.near),patches=[];
      group.add(terrain(d.far,values[1].a,values[1].texture,d.near,d,source),terrain(d.near,graded,values[0].texture,d.details,d,source));
      for(const g of d.details||[]){
        const response=await fetch(worldURL(source,g.file));if(!response.ok)throw Error(g.file);
        const a=gradeTerrain(d.roads,new Uint16Array(await response.arrayBuffer()),g);patches.push({g,a});
        group.add(terrain(g,a,values[0].texture,null,d,source));
      }
      const groundAt=(x,y)=>{for(const {g,a}of patches){const h=groundHeight(g,a,x,y);if(Number.isFinite(h))return h;}const h=groundHeight(d.near,graded,x,y);return Number.isFinite(h)?h:elevation(d.near,graded,x,y);};
      roadMeshes(d,group,groundAt);buildingMeshes(d,group,groundAt);landmarkMeshes(d,group);lodgeDetails(d,group);regionalFacades(d,group,source);
      group.visible=false;scene.add(group);
      await Promise.all([waterways(d,group,source),appearance(d,group,source),vegetation(d,group,source,groundAt),addRoadside(d,group,worldURL(source,`r${String(d.c).padStart(4,'0')}.json`),groundAt)].map(p=>p.catch(e=>console.warn(e.message))));
      const animateAmbient=addAmbient(d,group,groundAt,ambientEvents.get(source)||[]);chunks.set(key,{d,group,values,source,animateAmbient});failures.delete(key);
    }catch(e){failures.set(key,Date.now());console.warn(e.message);}finally{pending.delete(key);}})();pending.set(key,work);
  }
  function streamAround(s){const keep=new Set();for(const at of [s,s+1200,s-1200]){const loc=locate(((at%LEN)+LEN)%LEN),c=Math.floor(loc.distance/10000);for(const n of [c,c+1,c-1]){keep.add(loc.source+':'+n);load(loc.source,n);}}
    for(const [key,v]of chunks)if(!keep.has(key)){scene.remove(v.group);const materials=new Set();v.group.traverse(o=>{o.geometry?.dispose();if(o.material)materials.add(o.material);});for(const m of materials){if(m.userData.ownedMap)m.map.dispose();if(![asphalt,dirt,paint,white].includes(m))m.dispose();}for(const v2 of v.values)v2.texture.dispose();chunks.delete(key);}
  }
  function dataAt(s){const loc=locate(s);return chunks.get(loc.source+':'+Math.floor(loc.distance/10000));}
  function routeAt(d,s){const ps=d.route;let lo=0,hi=ps.length-1;while(lo<hi-1){const m=(lo+hi)>>1;if(ps[m][0]>s)hi=m;else lo=m;}const a=ps[lo],b=ps[hi],t=clamp((s-a[0])/(b[0]-a[0]||1),0,1);return [s,...[1,2,3,4].map(i=>a[i]+(b[i]-a[i])*t),a[5],a[6]];}
  function render(s){const ch=dataAt(s);if(!ch)return;const key=s+':'+look+':'+ch.source+':'+ch.d.c;if(key===lastRender&&active===ch)return;lastRender=key;s=locate(s).distance;const d=ch.d;if(active!==ch){if(active)active.group.visible=false;ch.group.visible=true;active=ch;}
    const p=routeAt(d,s),before=routeAt(d,Math.max(0,s-3)),after=routeAt(d,Math.min(sources[ch.source].total,s+9));let dx=after[1]-before[1],dy=after[2]-before[2],n=Math.hypot(dx,dy)||1;dx/=n;dy/=n;
    const lane=Math.min(p[4]/4,2.6),x=p[1]+dy*lane,y=p[2]-dx*lane;
    let gaze=look;
    if(!look&&sources[ch.source].views?.length){let nearest=null,delta=400;for(const view of sources[ch.source].views||[]){const ds=Math.abs(view.at-s);if(ds<delta){nearest=view;delta=ds;}}if(nearest){let vx=nearest.xy[0]-d.origin[0]-x,vy=nearest.xy[1]-d.origin[1]-y;
      if(/Point|View|Overlook|Hermits|Badwater|Natural Bridge|Tower House|Sun Temple/.test(nearest.name)){
        const key=ch.source+':'+d.c;if(nearest.gazeKey!==key){const ox=nearest.xy[0]-d.origin[0],oy=nearest.xy[1]-d.origin[1],base=elevation(d.near,ch.values[0].a,ox,oy);let best=40,vector=null;
          for(let i=0;i<32;i++){const ax=Math.sin(i*Math.PI/16),ay=Math.cos(i*Math.PI/16);let drop=0;for(const [range,weight]of [[200,.2],[600,.35],[1200,.45]]){const tx=ox+ax*range,ty=oy+ay*range,g=d.near,inside=tx>=g.x0&&ty>=g.y0&&tx<=g.x0+(g.w-1)*g.cell&&ty<=g.y0+(g.h-1)*g.cell;drop+=(base-elevation(inside?g:d.far,ch.values[inside?0:1].a,tx,ty))*weight;}if(drop>best){best=drop;vector=[ax,ay];}}
          nearest.gazeKey=key;nearest.gazeVector=vector;
        }if(nearest.gazeVector){[vx,vy]=nearest.gazeVector;vx*=100;vy*=100;}
      }
      if(Math.hypot(vx,vy)>12)gaze=clamp(Math.atan2(vx*dy-vy*dx,vx*dx+vy*dy)*180/Math.PI,-110,110)*(1-delta/400);
    }}
    camera.position.set(x,p[3]+1.8,-y);const angle=gaze*Math.PI/180,fx=dx*Math.cos(angle)+dy*Math.sin(angle),fy=dy*Math.cos(angle)-dx*Math.sin(angle);const slope=clamp((after[3]-before[3])/Math.max(1,after[0]-before[0]),-.5,.5);camera.lookAt(x+fx*80,p[3]+1.8+slope*80*Math.cos(angle)-1.5,-y-fy*80);
    ch.animateAmbient(s,T.now);
    renderer.render(scene,camera);ctx.drawImage(renderer.domElement,0,0);draws++;
  }
  const ready=s=>!!dataAt(s),placeAt=s=>({here:captionAt(s),area:''});
  function resize(width,height){if(width===W&&height===H)return;W=width;H=height;canvas.width=W;canvas.height=H;ctx.imageSmoothingEnabled=false;renderer.setSize(W,H);camera.aspect=W/H;camera.updateProjectionMatrix();lastRender='';}
  function drawLocalMap(g,s,size){g.fillStyle='#ded5bc';g.fillRect(0,0,size,size);const ch=dataAt(s);if(!ch)return;const p=routeAt(ch.d,locate(s).distance);g.strokeStyle='#777';for(const r of ch.d.roads){g.beginPath();r.points.forEach((v,i)=>g[i?'lineTo':'moveTo'](size/2+(v[0]-p[1])/15,size/2-(v[1]-p[2])/15));g.stroke();}g.fillStyle='#b34f32';g.fillRect(size/2-2,size/2-2,4,4);}
  function mapState(s){const chunk=dataAt(s);if(!chunk)return null;const d=chunk.d,at=locate(s).distance,p=routeAt(d,at),a=routeAt(d,Math.max(0,at-3)),b=routeAt(d,Math.min(sources[chunk.source].total,at+9));return {position:[d.origin[0]+p[1],d.origin[1]+p[2]],direction:[b[1]-a[1],b[2]-a[2]],chunk};}
  return {get W(){return W;},get H(){return H;},resize,IDX,LEN,settleFrames:1,KITJ:{pictures:{}},T,chunks,locate,captionAt,streamAround,ready,render,placeAt,drawLocalMap,mapState,roadAt:s=>{const ch=dataAt(s),p=ch&&routeAt(ch.d,locate(s).distance);return {road:p?.[6]||'',elev:p?.[3]};},setLook:deg=>look=deg,stats:()=>({source:active?.source,draws,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,buildings:active?.d.buildings.length||0,observedWalls:active?.group.userData.observedWalls||0,trees:active?.group.userData.trees||0,roadside:active?.group.userData.roadside||0,ambient:active?.group.userData.ambient||[],detailPatches:active?.d.details?.length||0,relief:active?[active.d.near.min,active.d.near.max]:[],failures:[...failures.keys()]}),dispose:()=>renderer.dispose()};
}
