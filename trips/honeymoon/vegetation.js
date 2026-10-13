// Regional vegetation and aerially inferred urban planting share spatial batches.
import * as THREE from './vendor/three.module.js';

export function addVegetation(data,group,groundAt,assets,textures,theme,zones=[]){
  const choices=Object.entries(assets).filter(([,asset])=>(asset.regions||[asset.theme]).includes(theme)&&textures.has(asset.file));
  const batches=new Map(),dummy=new THREE.Object3D(),color=new THREE.Color();
  function add(name,asset,x,y,width,height,seed,urban=false){
    if(!asset||!textures.has(asset.file))return;
    const key=name+':'+Math.floor(x/1024)+':'+Math.floor(y/1024);let batch=batches.get(key);
    if(!batch){batch={asset,plants:[]};batches.set(key,batch);}
    batch.plants.push({x,y,width,height,seed,urban});
  }
  for(const t of data.trees){
    let zone;for(const candidate of zones)if(t[2]>=candidate.minElevation)zone=candidate;
    const pool=zone?Object.entries(assets).filter(([name,asset])=>zone.trees.includes(name)&&textures.has(asset.file)):choices;
    if(!pool.length)continue;const [name,asset]=pool[t[4]%pool.length],height=asset.height*t[3]*(zone?.scale||1);
    add(name,asset,t[0],t[1],height*asset.aspect,height,t[4]);
  }
  for(const plant of data.plants||[]){
    let zone;const elevation=groundAt(plant.x,plant.y);for(const candidate of zones)if(elevation>=candidate.minElevation)zone=candidate;
    if(zone?.minElevation>0&&plant.kind==='tree'){
      const pool=zone.trees.filter(name=>assets[name]&&textures.has(assets[name].file));if(!pool.length)continue;
      const name=pool[plant.seed%pool.length],asset=assets[name],height=asset.height*(zone.scale||1)*Math.min(1.3,Math.max(.7,plant.height/8));
      add(name,asset,plant.x,plant.y,height*asset.aspect,height,plant.seed,true);
    }else{
      const name=plant.kind==='shrub'?'urban-shrub':plant.seed%2?'urban-tree-olive':'urban-tree-leafy';
      add(name,assets[name],plant.x,plant.y,plant.width,plant.height,plant.seed,true);
    }
  }
  for(const {asset,plants}of batches.values()){
    const material=new THREE.MeshLambertMaterial({map:textures.get(asset.file),alphaTest:.6,side:THREE.DoubleSide,color:'#eeeece'}),geometry=new THREE.PlaneGeometry(1,1);geometry.translate(0,.5,0);
    const mesh=new THREE.InstancedMesh(geometry,material,plants.length*2);let i=0;
    for(const p of plants)for(let side=0;side<2;side++){
      dummy.position.set(p.x,groundAt(p.x,p.y)-(p.urban ? .12 : .2),-p.y);dummy.rotation.set(0,(p.seed%65536)/65536*Math.PI+side*Math.PI/2,0);dummy.scale.set(p.width,p.height,1);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
      const shade=p.urban ? .91+(p.seed%101)/1100:1;color.setRGB(shade,shade,shade);mesh.setColorAt(i++,color);
    }
    mesh.computeBoundingSphere();group.add(mesh);
  }
  const plants=data.plants||[];group.userData.trees=data.trees.length+plants.filter(p=>p.kind==='tree').length;group.userData.shrubs=plants.filter(p=>p.kind==='shrub').length;group.userData.urbanPlants=plants.length;
}
