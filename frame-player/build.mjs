import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scene = process.env.SOURCE_DIR || fileURLToPath(new URL('../trips/honeymoon/', import.meta.url));
await fs.mkdir('src', { recursive: true });
for (const name of await fs.readdir(scene)) {
  if (!name.endsWith('.js')) continue;
  let text = await fs.readFile(path.join(scene, name), 'utf8');
  const required = name === 'world.js' ? ['new THREE.WebGLRenderer(', 'return {get W()'] : name === 'vegetation.js' ? ['new THREE.InstancedMesh(geometry,material,plants.length*2)', 'mesh.setMatrixAt(i,dummy.matrix);'] : [];
  for (const pattern of required) if (!text.includes(pattern)) throw Error(name + ': update the native export adapter for this source shape: ' + pattern);
  text = text.replaceAll("'./vendor/three.module.js'", "'three'");
  if (name === "vegetation.js") {
    text = text.replace("const mesh=new THREE.InstancedMesh(geometry,material,plants.length*2);let i=0;", "const pieces=[];material.vertexColors=true;");
    text = text.replace("mesh.setMatrixAt(i,dummy.matrix);", "const piece=geometry.toNonIndexed();piece.applyMatrix4(dummy.matrix);");
    text = text.replace("mesh.setColorAt(i++,color);", "const colors=new Float32Array(piece.attributes.position.count*3);for(let k=0;k<colors.length;k+=3){colors[k]=color.r;colors[k+1]=color.g;colors[k+2]=color.b;}piece.setAttribute(\"color\",new THREE.BufferAttribute(colors,3));pieces.push(piece);");
    text = text.replace("mesh.computeBoundingSphere();group.add(mesh);", "if(pieces.length){const merged=new THREE.BufferGeometry();for(const attr of [\"position\",\"normal\",\"uv\",\"color\"]){const size=pieces[0].attributes[attr].itemSize;const array=new Float32Array(pieces.reduce((n,p)=>n+p.attributes[attr].array.length,0));let at=0;for(const p of pieces){array.set(p.attributes[attr].array,at);at+=p.attributes[attr].array.length;}merged.setAttribute(attr,new THREE.BufferAttribute(array,size));}merged.computeBoundingSphere();group.add(new THREE.Mesh(merged,material));}geometry.dispose();for(const p of pieces)p.dispose();");
  }
  await fs.writeFile(path.join('src', name), text);
}
console.log("Prepared the scene generator for native export");
