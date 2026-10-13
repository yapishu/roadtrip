import * as THREE from './vendor/three.module.js';
import {planAmbient} from './ambient-plan.js';

export function addAmbient(d,group,groundAt,events){
  const encounters=planAmbient(d,groundAt,events),actors=[];
  const fur='#887355',pale='#c3b293',dark='#484b43',materials=new Map();
  function material(color){if(!materials.has(color))materials.set(color,new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide}));return materials.get(color);}
  const box=new THREE.BoxGeometry(1,1,1);
  function part(parent,mat,x,y,z,sx,sy,sz){const mesh=new THREE.Mesh(box,material(mat));mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);parent.add(mesh);return mesh;}
  function wing(parent,side){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([.2,0,0,-.3,0,0,-.45,.2,side*1.65,.2,0,0,-.45,.2,side*1.65,.1,.2,side*1.4],3));
    geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,material(dark));parent.add(mesh);return mesh;
  }
  for(const encounter of encounters){
    const root=new THREE.Group();root.name='ambient-'+encounter.kind;root.position.set(encounter.x,encounter.z,-encounter.y);group.add(root);
    if(encounter.kind==='birds'){
      const birds=[];
      for(let i=0;i<encounter.count;i++){
        const bird=new THREE.Group();part(bird,dark,0,0,0,.65,.12,.18);const left=wing(bird,1),right=wing(bird,-1);root.add(bird);birds.push({bird,left,right});
      }
      actors.push({encounter,root,birds});
    }else{
      root.rotation.y=encounter.angle;const deer=encounter.kind==='deer',head=new THREE.Group();
      if(deer){
        part(root,fur,0,1,0,1.4,.62,.48);
        for(const x of [-.48,.5])for(const z of [-.17,.17])part(root,fur,x,.4,z,.13,.8,.12);
        part(root,pale,-.74,1.1,0,.16,.3,.25);head.position.set(.6,1.25,0);
        part(head,fur,.03,.14,0,.28,.62,.3).rotation.z=.25;
        part(head,fur,.22,.47,0,.48,.28,.28);part(head,dark,.47,.43,0,.12,.14,.23);
        for(const z of [-.17,.17])part(head,fur,.06,.76,z,.13,.32,.12).rotation.x=z;
      }else{
        part(root,fur,0,.29,0,.7,.46,.36);part(root,pale,-.36,.3,0,.2,.2,.2);
        for(const x of [-.21,.25])for(const z of [-.14,.14])part(root,fur,x,.09,z,.22,.18,.14);
        head.position.set(.26,.48,0);part(head,fur,.08,.03,0,.29,.26,.25);
        for(const z of [-.1,.1])part(head,fur,0,.31,z,.09,.46,.08).rotation.z=-.2;
      }
      root.add(head);actors.push({encounter,root,head});
    }
  }
  // Materials with no actors do not enter the scene's disposal traversal.
  if(!actors.length)box.dispose();
  group.userData.ambient=encounters;
  return (s,time)=>{
    for(const actor of actors){
      const {encounter:e,root}=actor;root.visible=Math.abs(e.s-s)<420;if(!root.visible)continue;
      if(actor.birds){
        for(const [i,{bird,left,right}]of actor.birds.entries()){
          const a=time*.13+e.phase+i*.75,r=24+i*5;
          bird.position.set(Math.cos(a)*r,Math.sin(a*.7+i)*3+i*2,Math.sin(a)*r);
          bird.rotation.set(0,-a-Math.PI/2,.12);const flap=Math.sin(time*2.2+i)*.16;
          left.rotation.x=flap;right.rotation.x=-flap;
        }
      }else{
        actor.head.rotation.z=-.2+Math.sin(time*.45+e.phase)*.18;
        actor.head.rotation.y=Math.sin(time*.23+e.phase)*.22;
      }
    }
  };
}
