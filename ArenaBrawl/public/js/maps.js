import * as THREE from "three";
import { MAP_HALF_SIZES, MAP_META } from "./config.js";
import { attachMeshyModel } from "./meshy-assets.js";

const textureLoader = new THREE.TextureLoader();
const groundTextureCache = new Map();

function getGroundTexture(url, repeat) {
  const cacheKey = `${url}:${repeat}`;
  if (groundTextureCache.has(cacheKey)) return groundTextureCache.get(cacheKey);

  const texture = textureLoader.load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  groundTextureCache.set(cacheKey, texture);
  return texture;
}

function collisionBox(x, z, w, d, topY, solid = true) {
  return {
    minX: x - w / 2, maxX: x + w / 2,
    minZ: z - d / 2, maxZ: z + d / 2,
    topY, solid, active: true
  };
}

function makeMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.78, ...options });
}

function addMesh(world, geometry, color, x, y, z, options = {}) {
  const mesh = new THREE.Mesh(geometry, makeMaterial(color, options.material));
  mesh.position.set(x, y, z);
  mesh.rotation.set(options.rotX || 0, options.rotY || 0, options.rotZ || 0);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  world.root.add(mesh);
  return mesh;
}

function registerDestructible(world, id, mesh, kind, obstacle = null) {
  mesh.userData.destructibleId = id;
  mesh.traverse((child) => { child.userData.destructibleId = id; });
  world.destructibles.set(id, {
    id, mesh, kind, obstacle, destroyed: false, falling: false,
    velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
    linkedMeshes: [], linkedObstacles: []
  });
  return mesh;
}

function addSolidBox(world, x, z, w, h, d, color, baseY = 0, destructible = null) {
  const mesh = addMesh(world, new THREE.BoxGeometry(w, h, d), color, x, baseY + h / 2, z);
  const obstacle = collisionBox(x, z, w, d, baseY + h, true);
  world.obstacles.push(obstacle);
  if (destructible) registerDestructible(world, destructible.id, mesh, destructible.kind, obstacle);
  return mesh;
}

function addPlatform(world, x, y, z, w, d, color) {
  const mesh = addMesh(world, new THREE.BoxGeometry(w, 0.28, d), color, x, y, z);
  const obstacle = collisionBox(x, z, w, d, y + 0.14, false);
  world.obstacles.push(obstacle);
  return { mesh, obstacle };
}

function addRamp(world, x, z, length, width, height, axis, color, baseY = 0) {
  const steps = Math.max(4, Math.round(height / 0.42));
  for (let i = 0; i < steps; i++) {
    const stepY = baseY + (height / steps) * i;
    const offset = (i - steps / 2) * (length / steps);
    const sx = axis === "x" ? x + offset : x;
    const sz = axis === "z" ? z + offset : z;
    const w = axis === "x" ? length / steps + 0.2 : width;
    const d = axis === "z" ? length / steps + 0.2 : width;
    addPlatform(world, sx, stepY + 0.16, sz, w, d, color);
  }
}

function addBoundary(world, color) {
  const half = world.half;
  addSolidBox(world, 0, -half, half * 2, 8, 1, color);
  addSolidBox(world, 0, half, half * 2, 8, 1, color);
  addSolidBox(world, -half, 0, 1, 8, half * 2, color);
  addSolidBox(world, half, 0, 1, 8, half * 2, color);
}

function addGround(world, color, textureUrl = null, tileSize = 28) {
  const material = textureUrl
    ? { map: getGroundTexture(textureUrl, (world.half * 2) / tileSize) }
    : undefined;
  const ground = addMesh(
    world,
    new THREE.PlaneGeometry(world.half * 2, world.half * 2),
    color, 0, -0.03, 0,
    { rotX: -Math.PI / 2, castShadow: false, material }
  );
  ground.receiveShadow = true;
}

function addClimbableBuilding(world, options) {
  const { x, z, w, d, h, wallColor, roofColor, stairSide = "south", destructiblePrefix = "" } = options;
  const id = destructiblePrefix ? `${destructiblePrefix}-core` : null;
  addSolidBox(world, x, z, w, h, d, wallColor, 0, id ? { id, kind: "building" } : null);
  const roof = addPlatform(world, x, h + 0.18, z, w + 0.5, d + 0.5, roofColor);
  if (id) {
    roof.mesh.userData.destructibleId = id;
    const core = world.destructibles.get(id);
    core.linkedMeshes.push(roof.mesh);
    core.linkedObstacles.push(roof.obstacle);
  }

  const steps = Math.max(6, Math.round(h / 0.55));
  for (let i = 0; i < steps; i++) {
    const stepY = (h / steps) * i;
    const offset = d / 2 + 0.7 + i * 0.55;
    let sx = x, sz = z;
    if (stairSide === "south") sz += offset;
    else if (stairSide === "north") sz -= offset;
    else if (stairSide === "east") sx += offset;
    else sx -= offset;
    addPlatform(world, sx, stepY + 0.18, sz, 1.5, 1.05, wallColor);
  }

  if (destructiblePrefix) {
    const pieces = [
      [-w * 0.28, h * 0.72, d / 2 + 0.05, 0], [w * 0.28, h * 0.72, d / 2 + 0.05, 0],
      [-w * 0.28, h * 0.35, -d / 2 - 0.05, 0], [w * 0.28, h * 0.35, -d / 2 - 0.05, 0]
    ];
    pieces.forEach(([ox, y, oz], index) => {
      const panel = addMesh(world, new THREE.BoxGeometry(w * 0.42, h * 0.28, 0.18), index % 2 ? 0x737b84 : 0x8c949d, x + ox, y, z + oz);
      registerDestructible(world, `${destructiblePrefix}-panel-${index}`, panel, "building-piece");
    });
  }
}

function addTree(world, x, z, scale = 1, large = false) {
  const height = (large ? 11 : 6.5) * scale;
  const radius = (large ? 1.35 : 0.7) * scale;
  const trunk = addMesh(world, new THREE.CylinderGeometry(radius * 0.75, radius, height, 9), 0x654326, x, height / 2, z);
  world.obstacles.push(collisionBox(x, z, radius * 1.5, radius * 1.5, height, true));
  const crown = addMesh(world, new THREE.IcosahedronGeometry((large ? 4.5 : 2.7) * scale, 1), large ? 0x285f31 : 0x34743a, x, height + 1.8 * scale, z);
  world.animated.trees.push({ trunk, crown, phase: (x * 0.13 + z * 0.07) % Math.PI });
  return { trunk, crown, height, radius };
}

function addTreeHouse(world, x, z, rotation = 0) {
  const tree = addTree(world, x, z, 1.2, true);
  const level = tree.height * 0.72;
  addPlatform(world, x, level, z, 8.5, 7.5, 0x624025);
  addSolidBox(world, x, z, 5.5, 3.3, 4.5, 0x91623a, level, null);
  addMesh(world, new THREE.ConeGeometry(4.4, 2.5, 4), 0x3f2a1a, x, level + 4.5, z, { rotY: Math.PI / 4 });
  addPlatform(world, x + Math.cos(rotation) * 5.5, level + 0.1, z + Math.sin(rotation) * 5.5, 5.5, 1.4, 0x76502f);
  addRamp(world, x - 5.2, z + 4.5, 10, 1.7, level, "z", 0x76502f);
}

function addMountain(world, x, z, radius, height, color = 0x53604d) {
  const mesh = addMesh(world, new THREE.ConeGeometry(radius, height, 8), color, x, height / 2 - 0.1, z, { rotY: Math.PI / 8 });
  mesh.receiveShadow = true;
  world.obstacles.push(collisionBox(x, z, radius * 1.25, radius * 1.25, height * 0.72, true));
}

function addLampPost(world, id, x, z, rotY = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotY;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 5.8, 9), makeMaterial(0x34383d, { metalness: 0.65 }));
  pole.position.y = 2.9;
  group.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.13, 0.13), makeMaterial(0x34383d));
  arm.position.set(0.65, 5.65, 0);
  group.add(arm);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.35), makeMaterial(0xffe8a0, { emissive: 0x554411 }));
  lamp.position.set(1.3, 5.48, 0);
  group.add(lamp);
  world.root.add(group);
  const obstacle = collisionBox(x, z, 0.45, 0.45, 5.8, true);
  world.obstacles.push(obstacle);
  registerDestructible(world, id, group, "lamp", obstacle);
}

function createWorld(mapId, scene) {
  const root = new THREE.Group();
  root.name = `world-${mapId}`;
  scene.add(root);
  return {
    mapId, scene, root, half: MAP_HALF_SIZES[mapId], obstacles: [], destructibles: new Map(),
    animated: { trees: [], waves: [], sharks: [], debris: [], elapsed: 0 },
    water: null, tsunami: null, tornado: null, event: null
  };
}

function addMeshyLandmark(world, assetName, x, z, options = {}) {
  const anchor = new THREE.Group();
  anchor.position.set(x, options.y || 0, z);
  world.root.add(anchor);
  attachMeshyModel(anchor, assetName, {
    targetHeight: options.height,
    targetSize: options.size,
    rotation: [0, options.rotation || 0, 0],
    hideExisting: false
  });
  if (options.collision) {
    const [width, depth, topY = options.height || 4] = options.collision;
    world.obstacles.push(collisionBox(x, z, width, depth, topY, true));
  }
  return anchor;
}

function buildPraia(scene) {
  const world = createWorld("praia", scene);
  const meta = MAP_META.praia;
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(meta.sky, 80, 210);
  addGround(world, 0xffffff, "./assets/textures/beach-sand.jpg", 32);
  addBoundary(world, 0x89764d);

  world.water = addMesh(world, new THREE.PlaneGeometry(world.half * 2 - 2, 62, 28, 10), 0x238fd0, 0, 0.02, 58, {
    rotX: -Math.PI / 2, castShadow: false,
    material: { transparent: true, opacity: 0.82, metalness: 0.05, roughness: 0.24 }
  });

  for (let i = 0; i < 7; i++) {
    const wave = addMesh(world, new THREE.BoxGeometry(world.half * 1.9, 0.18, 0.8), 0x8edbf2, 0, 0.16, 31 + i * 8, {
      castShadow: false, material: { transparent: true, opacity: 0.58 }
    });
    world.animated.waves.push({ mesh: wave, phase: i * 0.8 });
  }

  for (let i = 0; i < 3; i++) {
    const shark = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 2.2, 5, 10), makeMaterial(0x405662));
    body.rotation.z = Math.PI / 2;
    shark.add(body);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 3), makeMaterial(0x344854));
    fin.position.y = 0.55;
    shark.add(fin);
    world.root.add(shark);
    world.animated.sharks.push({ mesh: shark, radius: 22 + i * 9, speed: 0.18 + i * 0.04, phase: i * 2.1 });
  }

  world.tsunami = addMesh(world, new THREE.BoxGeometry(world.half * 2, 1, 6), 0x3cb9df, 0, -8, world.half - 4, {
    castShadow: false, material: { transparent: true, opacity: 0.78, roughness: 0.18 }
  });
  world.tsunami.visible = false;

  addSolidBox(world, 0, -8, 15, 2.4, 15, 0xd8c16f);
  addRamp(world, 0, -20, 9, 4, 2.4, "z", 0xd8c16f);
  [[-48,-30],[46,-26],[-28,8],[30,4],[-58,18],[56,16],[0,-42]].forEach(([x,z],i)=>{
    addTree(world,x,z,0.72 + (i%3)*0.1,false);
  });
  [[-58,-52],[56,-50],[-22,-58],[25,-60]].forEach(([x,z],i)=>{
    addClimbableBuilding(world,{x,z,w:8,d:7,h:4,wallColor:i%2?0xd7e0d0:0xf1d6a2,roofColor:i%2?0x3975a9:0xb34d42,stairSide:i%2?"west":"east"});
  });
  addMeshyLandmark(world,"house",66,-34,{height:6.4,rotation:-0.45,collision:[8.5,8,6.4]});
  [[-38,14],[38,18],[-62,-2],[62,-5]].forEach(([x,z])=>addSolidBox(world,x,z,3.2,2,3.2,0x888b8c));
  for(let i=0;i<8;i++) addPlatform(world,-12+i*3,0.22,27+i*0.45,3.1,2.2,0x76502f);
  return world;
}

function buildCidade(scene) {
  const world = createWorld("cidade", scene);
  const meta = MAP_META.cidade;
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(meta.sky, 85, 190);
  addGround(world, 0x62676c);
  addBoundary(world, 0x25292e);

  const roadMat = makeMaterial(0x30343a, { roughness: 0.94 });
  [-34,0,34].forEach((x)=>{
    const road=new THREE.Mesh(new THREE.PlaneGeometry(12,world.half*2),roadMat);road.rotation.x=-Math.PI/2;road.position.set(x,0.02,0);world.root.add(road);
  });
  [-34,0,34].forEach((z)=>{
    const road=new THREE.Mesh(new THREE.PlaneGeometry(world.half*2,12),roadMat);road.rotation.x=-Math.PI/2;road.position.set(0,0.025,z);world.root.add(road);
  });

  const buildings=[
    [-55,-53,12,11,8],[-18,-53,13,11,13],[18,-53,13,11,9],[55,-53,12,11,15],
    [-55,-18,12,13,12],[55,-18,12,13,10],[-55,18,12,13,9],[55,18,12,13,14],
    [-55,53,12,11,14],[-18,53,13,11,9],[18,53,13,11,13],[55,53,12,11,10]
  ];
  buildings.forEach(([x,z,w,d,h],i)=>addClimbableBuilding(world,{
    x,z,w,d,h,wallColor:i%3===0?0x89939c:i%3===1?0xa28f78:0x77838d,roofColor:0x353a40,
    stairSide:i%2?"east":"west",destructiblePrefix:`city-building-${i}`
  }));
  addMeshyLandmark(world,"house",-18,-18,{height:8.5,rotation:0.75,collision:[8,8,8.5]});

  let lampIndex=0;
  [-42,-26,-8,8,26,42].forEach((n)=>{
    addLampPost(world,`city-lamp-${lampIndex++}`,n,-7,0);
    addLampPost(world,`city-lamp-${lampIndex++}`,n,7,Math.PI);
    if(Math.abs(n)>10){addLampPost(world,`city-lamp-${lampIndex++}`,-7,n,Math.PI/2);addLampPost(world,`city-lamp-${lampIndex++}`,7,n,-Math.PI/2);}
  });
  [[-17,-17],[17,17],[-17,17],[17,-17]].forEach(([x,z])=>addSolidBox(world,x,z,8,2.3,0.7,0x555b62));
  return world;
}

function buildFloresta(scene) {
  const world = createWorld("floresta", scene);
  const meta = MAP_META.floresta;
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(meta.sky, 72, 205);
  addGround(world, 0xffffff, "./assets/textures/forest-grass.jpg", 30);
  addBoundary(world, 0x283526);

  const mountains=[[-72,-68,20,28],[-35,-79,17,24],[10,-82,19,30],[52,-76,20,27],[77,-48,17,25],[80,5,20,31],[75,55,19,28],[42,79,18,25],[-5,82,20,29],[-52,76,21,31],[-78,45,18,25],[-82,-15,21,30]];
  mountains.forEach(([x,z,r,h],i)=>addMountain(world,x,z,r,h,i%2?0x596653:0x4b5948));

  const reserved=[[0,0],[-42,12],[42,-10],[0,58]];
  for(let gx=-70;gx<=70;gx+=14){
    for(let gz=-65;gz<=65;gz+=13){
      const x=gx+Math.sin(gz*0.31)*4,z=gz+Math.cos(gx*0.27)*4;
      if(reserved.some(([rx,rz])=>Math.hypot(x-rx,z-rz)<14))continue;
      addTree(world,x,z,0.72+((Math.abs(gx+gz)%5)*0.05),false);
    }
  }
  [
    [-58,-38,"unknown-a",10.5,0.2],[57,34,"unknown-b",10,-0.5],[-31,-50,"unknown-b",9.2,0.8],
    [31,50,"unknown-a",11,-0.25],[-64,18,"unknown-a",9.6,0.55],[63,-24,"unknown-b",10.4,-0.8]
  ].forEach(([x,z,asset,height,rotation])=>{
    addMeshyLandmark(world,asset,x,z,{height,rotation,collision:[1.5,1.5,height*0.72]});
  });
  addMeshyLandmark(world,"unknown-c",0,-54,{height:7.2,rotation:0.18,collision:[7.5,7,7.2]});
  addTreeHouse(world,-38,14,0);
  addTreeHouse(world,38,-12,Math.PI);
  addTreeHouse(world,3,48,-Math.PI/2);

  [[-18,-8],[18,8],[-10,24],[12,-28],[0,4]].forEach(([x,z],i)=>addSolidBox(world,x,z,3+i%2,1.8,3+i%2,0x6f746e));
  for(let i=0;i<11;i++)addPlatform(world,-15+i*3,0.2,-2+Math.sin(i)*1.2,3.2,2.1,0x68462a);

  world.tornado = new THREE.Group();
  for(let i=0;i<9;i++){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.1+i*0.35,0.12,6,20),makeMaterial(0xaab7a7,{transparent:true,opacity:0.35}));
    ring.rotation.x=Math.PI/2;ring.position.y=i*1.25;world.tornado.add(ring);
  }
  world.tornado.visible=false;world.root.add(world.tornado);
  return world;
}

function updateDestructibles(world, delta) {
  world.destructibles.forEach((object)=>{
    if (!object.falling) return;
    if (object.kind === "lamp") {
      object.mesh.rotation.z = Math.min(Math.PI / 2, object.mesh.rotation.z + delta * 1.65);
      if (object.mesh.rotation.z >= Math.PI / 2) object.falling = false;
      return;
    }
    object.velocity.y -= 12 * delta;
    object.mesh.position.addScaledVector(object.velocity, delta);
    object.mesh.rotation.x += object.angularVelocity.x * delta;
    object.mesh.rotation.z += object.angularVelocity.z * delta;
    if (object.mesh.position.y < -3) {
      object.mesh.visible = false;
      object.falling = false;
    }
  });
}

function updateWater(world, elapsed, event) {
  world.animated.waves.forEach(({mesh,phase},index)=>{
    mesh.position.y = 0.12 + Math.sin(elapsed*1.8+phase)*0.13;
    mesh.scale.z = 0.8 + Math.sin(elapsed*1.4+phase)*0.22;
    mesh.material.opacity = 0.42 + index*0.025;
  });
  world.animated.sharks.forEach(({mesh,radius,speed,phase})=>{
    const a=elapsed*speed+phase;mesh.position.set(Math.cos(a)*radius,-0.25,57+Math.sin(a)*radius*0.58);mesh.rotation.y=-a;
  });
  if(!event||event.type!=="tsunami"){
    world.tsunami.visible=false;world.water.position.y=0.02;return;
  }
  const progress=Math.max(0,Math.min(1,event.progress||0));
  if(event.phase==="warning"){
    world.tsunami.visible=true;world.tsunami.position.set(0,1+progress*8,world.half-4);world.tsunami.scale.y=1+progress*8;
  }else if(event.phase==="surge"){
    world.tsunami.visible=true;world.tsunami.position.z=world.half-(world.half*2-8)*progress;world.tsunami.position.y=7;world.tsunami.scale.y=13;
  }else if(event.phase==="flooded"){
    world.tsunami.visible=false;world.water.position.y=1.05;
  }else if(event.phase==="drain"){
    world.tsunami.visible=false;world.water.position.y=1.05*(1-progress);
  }
}

function updateForest(world, elapsed, event) {
  world.animated.trees.forEach(({trunk,crown,phase})=>{
    const strength=event?.type==="tornado"&&event.phase==="active"?0.085:0.012;
    trunk.rotation.z=Math.sin(elapsed*1.8+phase)*strength;crown.rotation.z=trunk.rotation.z*1.4;
  });
  if(!event||event.type!=="tornado"||event.phase!=="active"){world.tornado.visible=false;return;}
  world.tornado.visible=true;
  const p=Math.max(0,Math.min(1,event.progress||0));
  world.tornado.position.set(-70+p*140,0,Math.sin(p*Math.PI*3)*30);
  world.tornado.rotation.y=elapsed*2.8;
}

function applyObjectState(world, state) {
  const object=world.destructibles.get(state?.id);
  if(!object||object.destroyed)return;
  if(!state.destroyed&&state.stage<2)return;
  object.destroyed=Boolean(state.destroyed);
  if(object.obstacle)object.obstacle.active=false;
  object.linkedObstacles.forEach((obstacle)=>{obstacle.active=false;});
  object.linkedMeshes.forEach((mesh)=>{mesh.visible=false;});
  if(object.kind==="building"){
    const prefix=object.id.replace(/-core$/,"");
    world.destructibles.forEach((piece)=>{
      if(piece.id.startsWith(`${prefix}-panel-`)&&!piece.falling){piece.falling=true;piece.velocity.set((Math.random()-.5)*3,3,(Math.random()-.5)*3);piece.angularVelocity.set(1.2,0,1.4);}
    });
  }
  object.falling=true;
  object.velocity.set((Math.random()-0.5)*2.5,object.kind==="building-piece"?2.5:0,(Math.random()-0.5)*2.5);
  object.angularVelocity.set((Math.random()-0.5)*2,0,(Math.random()-0.5)*2);
}

function updateWorld(world, delta, event = null) {
  world.animated.elapsed += delta;
  updateDestructibles(world,delta);
  if(world.mapId==="praia")updateWater(world,world.animated.elapsed,event);
  if(world.mapId==="floresta")updateForest(world,world.animated.elapsed,event);
}

const BUILDERS={praia:buildPraia,cidade:buildCidade,floresta:buildFloresta};

export function buildMap(mapId, scene) {
  const world=(BUILDERS[mapId]||BUILDERS.praia)(scene);
  world.update=(delta,event)=>updateWorld(world,delta,event);
  world.applyObjectState=(state)=>applyObjectState(world,state);
  world.destructiblesNear=(x,z,radius)=>[...world.destructibles.values()].filter((object)=>{
    const dx=object.mesh.position.x-x,dz=object.mesh.position.z-z;return !object.destroyed&&Math.hypot(dx,dz)<=radius;
  });
  return world;
}
