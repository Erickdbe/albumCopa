import * as THREE from "three";
import { attachMeshyModel } from "./meshy-assets.js";
import { attachSketchbookVehicle } from "./sketchbook-assets.js";

const materials = {
  dark: new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.65, metalness: 0.45 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x69727c, roughness: 0.42, metalness: 0.7 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x77b4d2, roughness: 0.15, metalness: 0.15, transparent: true, opacity: 0.72 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.95 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x694327, roughness: 0.88 }),
  watercraft: new THREE.MeshStandardMaterial({ color: 0x2f9fd2, roughness: 0.4, metalness: 0.18 })
};

function mat(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.28, ...options });
}

function box(group, size, position, material, rotation = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function cylinder(group, radius, length, position, material, rotation = [0, 0, Math.PI / 2], sides = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, sides), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function addWheel(group, x, y, z, radius = 0.5, width = 0.32) {
  const wheel = cylinder(group, radius, width, [x, y, z], materials.tire, [0, 0, Math.PI / 2], 14);
  cylinder(wheel, radius * 0.42, width + 0.02, [0, 0, 0], materials.metal, [0, 0, 0], 12);
  return wheel;
}

function buildCar(color) {
  const group = new THREE.Group();
  const body = mat(color);
  box(group, [2.2, 0.62, 4.1], [0, 0.75, 0], body);
  box(group, [1.85, 0.78, 2.05], [0, 1.42, 0.18], materials.glass);
  box(group, [1.9, 0.22, 0.75], [0, 1.12, -1.62], body);
  group.userData.wheels = [[-1.02,0.48,-1.35],[1.02,0.48,-1.35],[-1.02,0.48,1.35],[1.02,0.48,1.35]].map((p)=>addWheel(group,...p));
  box(group,[0.36,0.2,0.08],[-0.62,0.8,-2.08],mat(0xffefb0,{emissive:0x554411}));
  box(group,[0.36,0.2,0.08],[0.62,0.8,-2.08],mat(0xffefb0,{emissive:0x554411}));
  group.userData.cameraOffset=new THREE.Vector3(0,3.05,7.4);group.userData.lookHeight=1.15;group.userData.radius=2.25;
  return group;
}

function buildMotorcycle(color) {
  const group=new THREE.Group(),body=mat(color);
  group.userData.wheels=[addWheel(group,0,0.55,-1.15,0.58,0.22),addWheel(group,0,0.55,1.15,0.58,0.22)];
  box(group,[0.42,0.48,1.55],[0,0.95,0.05],body,[0.08,0,0]);
  box(group,[0.5,0.16,0.8],[0,1.2,0.55],materials.dark);
  box(group,[0.12,1.1,0.12],[0,1.15,-0.88],materials.metal,[0.22,0,0]);
  box(group,[1.0,0.1,0.1],[0,1.6,-1.05],materials.metal);
  group.userData.cameraOffset=new THREE.Vector3(0,2.65,5.6);group.userData.lookHeight=1.05;group.userData.radius=1.35;
  return group;
}

function buildQuad(color) {
  const group=new THREE.Group(),body=mat(color);
  box(group,[1.55,0.48,2.35],[0,0.82,0],body);
  box(group,[0.72,0.24,0.9],[0,1.15,0.35],materials.dark);
  group.userData.wheels=[[-0.9,0.5,-0.8],[0.9,0.5,-0.8],[-0.9,0.5,0.8],[0.9,0.5,0.8]].map((p)=>addWheel(group,...p,0.5,0.38));
  box(group,[1.15,0.1,0.1],[0,1.5,-0.62],materials.metal);
  group.userData.cameraOffset=new THREE.Vector3(0,2.75,6.1);group.userData.lookHeight=1.1;group.userData.radius=1.45;
  return group;
}

function buildJetski(color) {
  const group=new THREE.Group(),body=mat(color||0x2f9fd2);
  const hull=new THREE.Mesh(new THREE.CapsuleGeometry(0.72,2.5,5,12),body);hull.rotation.x=Math.PI/2;hull.scale.y=0.52;hull.position.y=0.55;group.add(hull);
  box(group,[0.62,0.5,1.05],[0,1.02,0.25],materials.dark,[0.12,0,0]);
  box(group,[1.05,0.09,0.09],[0,1.55,-0.28],materials.metal);
  group.userData.cameraOffset=new THREE.Vector3(0,2.55,6.4);group.userData.lookHeight=1;group.userData.radius=1.65;
  return group;
}

function buildPlane(color) {
  const group=new THREE.Group(),body=mat(color||0xc84b42);
  const fuselage=new THREE.Mesh(new THREE.CapsuleGeometry(0.62,4.5,6,12),body);fuselage.rotation.x=Math.PI/2;group.add(fuselage);
  box(group,[7.2,0.18,1.3],[0,0,-0.15],body);
  box(group,[2.7,0.14,0.85],[0,0.3,2.0],body);
  box(group,[0.15,1.45,0.9],[0,0.75,2.1],body);
  cylinder(group,0.68,0.2,[0,0,-2.85],materials.dark,[Math.PI/2,0,0],6);
  const propeller=new THREE.Group();propeller.position.set(0,0,-3.02);group.add(propeller);
  box(propeller,[0.16,2.25,0.08],[0,0,0],materials.dark);
  box(propeller,[2.25,0.16,0.08],[0,0,0],materials.dark);
  group.userData.propeller=propeller;
  box(group,[0.95,0.52,0.9],[0,0.55,-0.6],materials.glass);
  cylinder(group,0.055,2.1,[-0.42,-0.18,-1.45],materials.dark,[Math.PI/2,0,0]);
  cylinder(group,0.055,2.1,[0.42,-0.18,-1.45],materials.dark,[Math.PI/2,0,0]);
  group.userData.cameraOffset=new THREE.Vector3(0,4.6,12.5);group.userData.lookHeight=1.05;group.userData.radius=3.7;group.userData.muzzleOffset=new THREE.Vector3(0,-0.15,-2.6);
  return group;
}

function buildCannon() {
  const group=new THREE.Group();
  addWheel(group,-0.95,0.72,0.35,0.82,0.28);addWheel(group,0.95,0.72,0.35,0.82,0.28);
  box(group,[2.3,0.32,2.5],[0,0.65,0.35],materials.wood);
  const barrel=cylinder(group,0.33,3.8,[0,1.35,-1.05],materials.dark,[Math.PI/2,0,0],14);barrel.rotation.x=Math.PI/2-0.18;
  cylinder(group,0.48,0.55,[0,1.08,0.35],materials.metal,[0,0,Math.PI/2],14);
  group.userData.cameraOffset=new THREE.Vector3(0,3.35,7.2);group.userData.lookHeight=1.35;group.userData.radius=2.15;group.userData.muzzleOffset=new THREE.Vector3(0,1.65,-2.9);
  return group;
}

export function buildVehicleModel(vehicle) {
  let model;
  if(vehicle.type==="car")model=buildCar(vehicle.id.includes("blue")?0x3476c7:0xc7463f);
  else if(vehicle.type==="motorcycle")model=buildMotorcycle(0xe2b532);
  else if(vehicle.type==="quad")model=buildQuad(0x4b8a43);
  else if(vehicle.type==="jetski")model=buildJetski(0x27a2d1);
  else if(vehicle.type==="helicopter")model=buildPlane(0x6f7f8f);
  else if(vehicle.type==="plane")model=buildPlane(vehicle.id.includes("forest")?0x3d7043:0xd65d43);
  else model=buildCannon();
  model.userData.vehicleId=vehicle.id;
  model.traverse((child)=>{if(child.isMesh)child.userData.vehicleId=vehicle.id;});
  model.position.set(vehicle.x,vehicle.y,vehicle.z);
  model.rotation.y=vehicle.yaw||0;
  if(vehicle.type==="car")attachSketchbookVehicle(model,"car",{targetSize:4.45,rotation:[0,Math.PI,0]});
  else if(vehicle.type==="motorcycle")attachMeshyModel(model,"vehicle-thunder",{targetSize:2.5,align:"x-to-z"});
  else if(vehicle.type==="helicopter")attachSketchbookVehicle(model,"helicopter",{targetSize:7.2,offset:new THREE.Vector3(0,0.12,0)});
  else if(vehicle.type==="plane")attachSketchbookVehicle(model,"plane",{targetSize:7.5,offset:new THREE.Vector3(0,0.05,0)});
  return model;
}

export function createExplosion(scene, position, color = 0xff7a2f) {
  const group=new THREE.Group();group.position.copy(position);scene.add(group);
  const fire=new THREE.Mesh(new THREE.IcosahedronGeometry(1.4,1),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.9}));group.add(fire);
  const smoke=new THREE.Mesh(new THREE.IcosahedronGeometry(1.9,1),new THREE.MeshStandardMaterial({color:0x3d4145,transparent:true,opacity:0.7}));smoke.position.y=1.2;group.add(smoke);
  const start=performance.now();
  (function animate(){const t=(performance.now()-start)/1100;group.scale.setScalar(1+t*2.5);group.position.y+=0.018;fire.material.opacity=Math.max(0,1-t*1.8);smoke.material.opacity=Math.max(0,0.7-t*0.65);if(t<1)requestAnimationFrame(animate);else scene.remove(group);})();
}

export function createCannonProjectile(scene, origin, direction, onDone) {
  const ball=new THREE.Mesh(new THREE.SphereGeometry(0.3,10,8),materials.dark);ball.position.copy(origin);scene.add(ball);
  const velocity=direction.clone().multiplyScalar(38).add(new THREE.Vector3(0,8,0));let elapsed=0;
  function step(){const delta=1/60;elapsed+=delta;velocity.y-=14*delta;ball.position.addScaledVector(velocity,delta);if(elapsed<3&&ball.position.y>-1)requestAnimationFrame(step);else{const point=ball.position.clone();scene.remove(ball);onDone?.(point);}}
  requestAnimationFrame(step);
}

export function createAirBomb(scene, origin, target, durationMs = 1200, onDone) {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.18, 0.58, 5, 10),
    new THREE.MeshStandardMaterial({ color: 0x25282c, roughness: 0.48, metalness: 0.72 })
  );
  shell.rotation.x = Math.PI / 2;
  group.add(shell);
  box(group, [0.62, 0.05, 0.2], [0, 0, 0.3], materials.metal);
  box(group, [0.2, 0.05, 0.62], [0, 0, 0.3], materials.metal);
  group.position.copy(origin);
  scene.add(group);
  const startedAt = performance.now();
  const flightMs = Math.max(300, Number(durationMs) || 1200);

  function step(now) {
    const t = THREE.MathUtils.clamp((now - startedAt) / flightMs, 0, 1);
    group.position.x = THREE.MathUtils.lerp(origin.x, target.x, t);
    group.position.z = THREE.MathUtils.lerp(origin.z, target.z, t);
    group.position.y = THREE.MathUtils.lerp(origin.y, target.y, t * t);
    group.rotation.x += 0.13;
    if (t < 1) requestAnimationFrame(step);
    else {
      scene.remove(group);
      onDone?.(target.clone());
    }
  }
  requestAnimationFrame(step);
  return group;
}
