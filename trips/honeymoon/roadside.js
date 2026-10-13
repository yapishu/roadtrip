// Simple forms at mapped positions: roadside furniture and off-season ski lifts.
import * as THREE from './vendor/three.module.js';

export async function addRoadside(d,group,url) {
  const response=await fetch(url);
  if(!response.ok)return;
  const {features}=await response.json(),batches=new Map(),wires=new Map();
  const wood='#827057',metal='#66716c',steel='#8f9288',pale='#d6d0b8',dark='#46524c';
  const position=p=>new THREE.Vector3(p[0],p[2],-p[1]);
  function batch(color,p,line=false){const map=line?wires:batches,key=color+':'+Math.floor(p[0]/300)+':'+Math.floor(p[1]/300);if(!map.has(key))map.set(key,{color,vertices:[]});return map.get(key).vertices;}
  function triangle(v,a,b,c){v.push(...a.toArray(),...b.toArray(),...c.toArray());}
  function beam(a,b,width,color,depth=width){
    const p=position(a),q=position(b),axis=q.clone().sub(p).normalize(),side=new THREE.Vector3().crossVectors(axis,Math.abs(axis.y)>.95?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0)).normalize().multiplyScalar(width/2),normal=new THREE.Vector3().crossVectors(axis,side).normalize().multiplyScalar(depth/2);
    const corners=center=>[center.clone().add(side).add(normal),center.clone().sub(side).add(normal),center.clone().sub(side).sub(normal),center.clone().add(side).sub(normal)],aa=corners(p),bb=corners(q),v=batch(color,a);
    for(let i=0;i<4;i++){const j=(i+1)%4;triangle(v,aa[i],bb[i],bb[j]);triangle(v,aa[i],bb[j],aa[j]);}
    triangle(v,aa[0],aa[2],aa[1]);triangle(v,aa[0],aa[3],aa[2]);triangle(v,bb[0],bb[1],bb[2]);triangle(v,bb[0],bb[2],bb[3]);
  }
  function line(a,b,color){batch(color,a,true).push(...position(a).toArray(),...position(b).toArray());}
  const above=(p,h)=>[p[0],p[1],p[2]+h];
  const offset=(p,x,y,z)=>[p[0]+x,p[1]+y,p[2]+z];
  function across(p,angle,width,height,thick,color){const x=Math.cos(angle)*width/2,y=-Math.sin(angle)*width/2;beam(offset(p,-x,-y,height),offset(p,x,y,height),thick,color);}
  function dimension(f,defaultHeight){const raw=f.tags.height,n=parseFloat(raw);return Number.isFinite(n)?Math.max(.3,Math.min(45,n*(/ft|feet|'/.test(raw)?.3048:1))):defaultHeight;}
  function posts(points,spacing,callback){let carry=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<.01)continue;for(let at=carry;at<=length;at+=spacing){const t=at/length;callback(a.map((v,k)=>v+(b[k]-v)*t),Math.atan2(b[0]-a[0],b[1]-a[1]));}carry=(carry-length)%spacing;if(carry<0)carry+=spacing;}}
  for(const f of features){
    const p=f.points[0],angle=f.facingRoad||0,kind=f.kind;
    if(kind==='pole'||kind==='tower'){
      const height=dimension(f,kind==='tower'?22:8.5);
      if(kind==='tower'){for(const sign of [-1,1])beam(offset(p,sign*2,0,0),offset(p,sign*.6,0,height),.22,steel);for(let h=2;h<height;h+=4)beam(offset(p,-1.8,0,h),offset(p,1.5,0,h+3),.12,steel);}
      else beam(p,above(p,height),.2,wood);
      across(p,angle,kind==='tower'?8:2.5,height-.5,.15,kind==='tower'?steel:wood);
    }else if(kind==='lamp'){
      const height=dimension(f,7),head=offset(p,Math.sin(angle)*1.4,Math.cos(angle)*1.4,height);
      beam(p,above(p,height-.3),.12,metal);beam(above(p,height-.3),head,.12,metal);beam(offset(head,-.3,0,0),offset(head,.3,0,0),.24,pale);
    }else if(kind==='signal'){
      beam(p,above(p,3.5),.12,metal);beam(above(p,2.65),above(p,3.45),.3,dark,.22);
      for(const [h,color]of [[3.25,'#a2644f'],[3.0,'#c1a667'],[2.78,'#70866a']])beam(offset(p,Math.sin(angle)*.14,Math.cos(angle)*.14,h-.04),offset(p,Math.sin(angle)*.14,Math.cos(angle)*.14,h+.04),.12,color);
    }else if(['stop','give_way','bus_stop'].includes(kind)){
      beam(p,above(p,2.5),.08,metal);
      const center=position(above(p,2.15)),vertices=batch(kind==='stop'?'#a15d49':kind==='give_way'?'#c4b8a0':'#819b9a',p),sides=kind==='stop'?8:kind==='give_way'?3:4,radius=kind==='bus_stop'?.3:.38;
      const corner=i=>{const theta=(i+.5)/sides*Math.PI*2;return center.clone().add(new THREE.Vector3(Math.cos(angle)*Math.sin(theta)*radius,Math.cos(theta)*radius,Math.sin(angle)*Math.sin(theta)*radius));};
      for(let i=0;i<sides;i++)triangle(vertices,center,corner(i),corner(i+1));
    }else if(kind==='bench'){
      const x=Math.cos(angle),y=-Math.sin(angle);for(const sign of [-1,1])beam(offset(p,x*sign*.6,y*sign*.6,0),offset(p,x*sign*.6,y*sign*.6,.48),.1,metal);
      across(p,angle,1.7,.5,.24,wood);across(offset(p,-Math.sin(angle)*.18,-Math.cos(angle)*.18,0),angle,1.7,.84,.24,wood);
    }else if(kind==='hydrant'){
      beam(p,above(p,.75),.21,'#a86545');across(p,angle,.5,.53,.12,'#a86545');
    }else if(kind==='bin'){
      beam(p,above(p,.8),.48,metal);
    }else if(kind==='boulder'){
      const v=batch('#958d77',p),a=position(offset(p,-.8,-.6,0)),b=position(offset(p,.8,-.5,0)),c=position(offset(p,.5,.7,0)),e=position(offset(p,-.6,.7,0)),top=position(offset(p,.1,.1,1));for(const [u,w]of [[a,b],[b,c],[c,e],[e,a]])triangle(v,u,w,top);
    }else if(['fence','wall','hedge','guard_rail'].includes(kind)){
      const height=dimension(f,kind==='guard_rail'?.8:kind==='hedge'?1.6:1.25),color=kind==='hedge'?'#778068':kind==='wall'?'#a09980':kind==='guard_rail'?steel:wood;
      if(kind==='fence'||kind==='guard_rail')posts(f.points,kind==='fence'?6:4,q=>beam(q,above(q,height),.12,color));
      for(let i=1;i<f.points.length;i++){
        const a=f.points[i-1],b=f.points[i];
        if(kind==='wall'||kind==='hedge')beam(above(a,height/2),above(b,height/2),kind==='wall'?.35:.9,color,height);
        else for(const h of kind==='guard_rail'?[height]:[height*.45,height*.9])beam(above(a,h),above(b,h),kind==='guard_rail'?.18:.08,color);
      }
    }else if(kind==='rail'){
      for(let i=1;i<f.points.length;i++){
        const a=f.points[i-1],b=f.points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)||1;
        for(const sign of [-1,1])beam(offset(a,dy/length*.72*sign,-dx/length*.72*sign,.1),offset(b,dy/length*.72*sign,-dx/length*.72*sign,.1),.08,steel);
      }posts(f.points,2.5,(q,a)=>across(q,a,2.1,.03,.12,wood));
    }else if(kind==='chair_lift'){
      const height=dimension(f,10);
      posts(f.points,100,(q,a)=>{beam(q,above(q,height),.4,metal);across(q,a,6,height,.25,metal);});
      for(let i=1;i<f.points.length;i++){
        const a=f.points[i-1],b=f.points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
        for(const sign of [-1,1])line(offset(a,dy/len*2.5*sign,-dx/len*2.5*sign,height-.15),offset(b,dy/len*2.5*sign,-dx/len*2.5*sign,height-.15),dark);
      }
      posts(f.points,42,(q,a)=>{for(const side of [-1,1]){const chair=offset(q,Math.cos(a)*2.5*side,-Math.sin(a)*2.5*side,0);beam(above(chair,height-.15),above(chair,height-2.5),.055,metal);across(chair,a,2,height-2.5,.14,dark);across(chair,a,2,height-1.8,.08,metal);}});
    }else if(kind==='line'||kind==='minor_line'){
      const height=dimension(f,kind==='line'?21:8);
      for(let i=1;i<f.points.length;i++){const a=f.points[i-1],b=f.points[i],mid=a.map((v,k)=>(v+b[k])/2);mid[2]-=Math.min(2,Math.hypot(b[0]-a[0],b[1]-a[1])*.015);line(above(a,height),above(mid,height),metal);line(above(mid,height),above(b,height),metal);}
    }
  }
  const materials=new Map();
  for(const {color,vertices}of batches.values()){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();if(!materials.has(color))materials.set(color,new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide}));group.add(new THREE.Mesh(geometry,materials.get(color)));
  }
  for(const {color,vertices}of wires.values()){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeBoundingSphere();group.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color})));}
  group.userData.roadside=features.length;
}
