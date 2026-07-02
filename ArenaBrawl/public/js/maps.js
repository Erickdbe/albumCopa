import * as THREE from "three";
import { ARENA_HALF, MAP_META } from "./config.js";

// Cada obstaculo tem uma "caixa" de colisao (minX/maxX/minZ/maxZ) e uma altura (topY).
// solid=true bloqueia o jogador enquanto ele nao estiver alto o suficiente para ficar em cima
// (usado em paredes, troncos, carros). solid=false e uma plataforma pisavel (telhado, degrau,
// ponte) que nunca bloqueia horizontalmente, so oferece uma nova altura de piso.
function box(minX, maxX, minZ, maxZ, topY, solid) {
  return { minX, maxX, minZ, maxZ, topY, solid };
}

function addMesh(scene, geometry, color, x, y, z, rotY = 0) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addSolidBox(scene, obstacles, x, z, w, h, d, color, baseY = 0) {
  addMesh(scene, new THREE.BoxGeometry(w, h, d), color, x, baseY + h / 2, z);
  obstacles.push(box(x - w / 2, x + w / 2, z - d / 2, z + d / 2, baseY + h, true));
}

// Predio/cabana com escada externa (degraus) e telhado pisavel.
function addClimbableBuilding(scene, obstacles, opts) {
  const { x, z, w, d, h, wallColor, roofColor, stairSide = "south" } = opts;
  addSolidBox(scene, obstacles, x, z, w, h, d, wallColor);
  addMesh(scene, new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4), roofColor, x, h + 0.15, z);
  obstacles.push(box(x - w / 2 - 0.2, x + w / 2 + 0.2, z - d / 2 - 0.2, z + d / 2 + 0.2, h + 0.3, false));

  const steps = 5;
  const stepH = h / steps;
  for (let i = 0; i < steps; i++) {
    const stepY = stepH * i;
    let sx = x, sz = z;
    const offset = (d / 2 + 0.5) + i * 0.55;
    if (stairSide === "south") sz = z + offset;
    else if (stairSide === "north") sz = z - offset;
    else if (stairSide === "east") sx = x + offset;
    else sx = x - offset;
    addMesh(scene, new THREE.BoxGeometry(1.4, 0.3, 1.1), wallColor, sx, stepY + stepH / 2, sz);
    obstacles.push(box(sx - 0.7, sx + 0.7, sz - 0.55, sz + 0.55, stepY + stepH, false));
  }
}

function addTower(scene, obstacles, x, z, topSize, height, legColor, topColor) {
  const legOffset = topSize / 2 - 0.3;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    addSolidBox(scene, obstacles, x + sx * legOffset, z + sz * legOffset, 0.35, height, 0.35, legColor);
  });
  addMesh(scene, new THREE.BoxGeometry(topSize, 0.3, topSize), topColor, x, height + 0.15, z);
  obstacles.push(box(x - topSize / 2, x + topSize / 2, z - topSize / 2, z + topSize / 2, height + 0.3, false));

  const steps = Math.round(height / 0.55);
  for (let i = 0; i < steps; i++) {
    const stepY = (height / steps) * i;
    const sz = z + legOffset + 0.9 + i * 0.5;
    addMesh(scene, new THREE.BoxGeometry(1.1, 0.25, 0.9), legColor, x, stepY + 0.2, sz);
    obstacles.push(box(x - 0.55, x + 0.55, sz - 0.45, sz + 0.45, stepY + 0.35, false));
  }
}

function addRamp(scene, obstacles, x, z, length, width, height, axis, color) {
  const steps = Math.max(3, Math.round(height / 0.35));
  for (let i = 0; i < steps; i++) {
    const stepY = (height / steps) * i;
    const offset = (i - steps / 2) * (length / steps);
    const sx = axis === "x" ? x + offset : x;
    const sz = axis === "z" ? z + offset : z;
    const w = axis === "x" ? length / steps + 0.2 : width;
    const d = axis === "z" ? length / steps + 0.2 : width;
    addMesh(scene, new THREE.BoxGeometry(w, 0.3, d), color, sx, stepY + 0.15, sz);
    obstacles.push(box(sx - w / 2, sx + w / 2, sz - d / 2, sz + d / 2, stepY + 0.3, false));
  }
}

function addBoundaryWalls(scene, obstacles, color = 0x2b2f36, height = 6) {
  const half = ARENA_HALF;
  addSolidBox(scene, obstacles, 0, -half, half * 2, height, 1, color);
  addSolidBox(scene, obstacles, 0, half, half * 2, height, 1, color);
  addSolidBox(scene, obstacles, -half, 0, 1, height, half * 2, color);
  addSolidBox(scene, obstacles, half, 0, 1, height, half * 2, color);
}

function addGround(scene, color) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
    new THREE.MeshStandardMaterial({ color })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function buildPraia(scene) {
  const meta = MAP_META.praia;
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(meta.sky, 45, 100);
  addGround(scene, meta.ground);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ color: 0x2f8fd6, transparent: true, opacity: 0.85 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.15, ARENA_HALF + 12);
  scene.add(sea);

  const obstacles = [];
  addBoundaryWalls(scene, obstacles, 0x8a7a52);

  // duna central com rampas de acesso
  addSolidBox(scene, obstacles, 0, 0, 10, 1.4, 10, 0xdcc878);
  addRamp(scene, obstacles, 0, -7.5, 5, 3, 1.4, "z", 0xdcc878);
  addRamp(scene, obstacles, 7.5, 0, 5, 3, 1.4, "x", 0xdcc878);

  // barracas de praia (cobertura triangular simplificada)
  [[-16, -6], [16, 6], [-6, 16]].forEach(([x, z]) => {
    addMesh(scene, new THREE.ConeGeometry(2.6, 2.2, 4), 0xe85d5d, x, 1.1, z, Math.PI / 4);
    obstacles.push(box(x - 1.5, x + 1.5, z - 1.5, z + 1.5, 0.9, true));
  });

  // coqueiros
  [[-20, 10], [20, -10], [-10, -20], [10, 20], [0, -16]].forEach(([x, z]) => {
    addSolidBox(scene, obstacles, x, z, 0.7, 4.5, 0.7, 0x8a6a44);
    addMesh(scene, new THREE.SphereGeometry(1.6, 8, 6), 0x3f9e44, x, 5, z);
  });

  // pedras e caixas (cobertura baixa)
  [[-22, -22], [22, 22], [-22, 22], [22, -22]].forEach(([x, z]) => {
    addSolidBox(scene, obstacles, x, z, 2.4, 1.5, 2.4, 0x8b8b8b);
  });
  [[-8, 8], [8, -8]].forEach(([x, z]) => {
    addSolidBox(scene, obstacles, x, z, 1.4, 1.1, 1.4, 0xb08a4f);
  });

  // barcos encalhados
  addMesh(scene, new THREE.BoxGeometry(5, 1.2, 1.8), 0x7a4b2b, -14, 0.6, -14, 0.3);
  obstacles.push(box(-17, -11, -16, -12, 1.2, true));

  // casas de praia com telhado acessivel
  addClimbableBuilding(scene, obstacles, { x: -18, z: 4, w: 6, d: 6, h: 3.2, wallColor: 0xf0e0b0, roofColor: 0xb5493f, stairSide: "east" });
  addClimbableBuilding(scene, obstacles, { x: 18, z: -4, w: 6, d: 6, h: 3.2, wallColor: 0xf0e0b0, roofColor: 0x3f6cb5, stairSide: "west" });

  // ponte de madeira ligando a duna a casa
  for (let i = 0; i < 6; i++) {
    const z = 6 + i * 1.4;
    addMesh(scene, new THREE.BoxGeometry(2.2, 0.25, 1.3), 0x8a6a3f, 6, 0.15, z);
    obstacles.push(box(4.9, 7.1, z - 0.65, z + 0.65, 0.3, false));
  }

  return obstacles;
}

function buildCidade(scene) {
  const meta = MAP_META.cidade;
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(meta.sky, 45, 100);
  addGround(scene, meta.ground);

  const obstacles = [];
  addBoundaryWalls(scene, obstacles, 0x24272c);

  const road = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, 8), new THREE.MeshStandardMaterial({ color: 0x3a3d42 }));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  scene.add(road);
  const road2 = road.clone();
  road2.rotation.z = Math.PI / 2;
  scene.add(road2);

  addClimbableBuilding(scene, obstacles, { x: -20, z: -20, w: 8, d: 8, h: 4.5, wallColor: 0x9aa0a8, roofColor: 0x555b62, stairSide: "east" });
  addClimbableBuilding(scene, obstacles, { x: 20, z: 20, w: 8, d: 8, h: 4.5, wallColor: 0x9aa0a8, roofColor: 0x555b62, stairSide: "west" });
  addClimbableBuilding(scene, obstacles, { x: -20, z: 20, w: 7, d: 7, h: 3.4, wallColor: 0xb59a72, roofColor: 0x6b4c30, stairSide: "north" });
  addClimbableBuilding(scene, obstacles, { x: 20, z: -20, w: 7, d: 7, h: 3.4, wallColor: 0xb59a72, roofColor: 0x6b4c30, stairSide: "south" });

  // predio central alto com acesso
  addClimbableBuilding(scene, obstacles, { x: 0, z: 0, w: 6, d: 6, h: 5.5, wallColor: 0x7d858d, roofColor: 0x40444a, stairSide: "south" });

  // carros como cobertura
  [[-10, -6], [10, 6], [-6, 10], [6, -10], [0, -14], [0, 14]].forEach(([x, z], i) => {
    addSolidBox(scene, obstacles, x, z, 3.6, 1.3, 1.7, i % 2 ? 0xd6483f : 0x3f6cd6);
  });

  // muros baixos / becos estreitos
  addSolidBox(scene, obstacles, -12, 0, 0.6, 1.6, 10, 0x5a5f66);
  addSolidBox(scene, obstacles, 12, 0, 0.6, 1.6, 10, 0x5a5f66);
  addSolidBox(scene, obstacles, 0, -8, 10, 2.4, 0.6, 0x5a5f66);
  addSolidBox(scene, obstacles, 0, 8, 10, 2.4, 0.6, 0x5a5f66);

  return obstacles;
}

function buildFloresta(scene) {
  const meta = MAP_META.floresta;
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(meta.sky, 35, 90);
  addGround(scene, meta.ground);

  const obstacles = [];
  addBoundaryWalls(scene, obstacles, 0x2c3a28);

  const trees = [
    [-24, -10], [24, 10], [-10, 24], [10, -24], [-16, 16], [16, -16],
    [-6, -20], [6, 20], [-20, 6], [20, -6]
  ];
  trees.forEach(([x, z]) => {
    addSolidBox(scene, obstacles, x, z, 1.0, 5.5, 1.0, 0x6b4c30);
    addMesh(scene, new THREE.ConeGeometry(2.6, 4.5, 7), 0x2f6b34, x, 7, z);
  });

  // pedras e troncos caidos (troncos = plataforma baixa pisavel)
  [[-8, -4], [8, 4], [-4, 8]].forEach(([x, z]) => {
    addSolidBox(scene, obstacles, x, z, 2, 1.3, 2, 0x777a72);
  });
  [[4, -8, "x"], [-4, 8, "z"]].forEach(([x, z, axis]) => {
    const w = axis === "x" ? 5 : 1;
    const d = axis === "z" ? 5 : 1;
    addMesh(scene, new THREE.BoxGeometry(w, 0.6, d), 0x6b4c30, x, 0.3, z);
    obstacles.push(box(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0.6, false));
  });

  // cabanas com telhado acessivel
  addClimbableBuilding(scene, obstacles, { x: -18, z: -2, w: 5.5, d: 5.5, h: 3, wallColor: 0x7a5a38, roofColor: 0x4a3620, stairSide: "east" });
  addClimbableBuilding(scene, obstacles, { x: 18, z: 2, w: 5.5, d: 5.5, h: 3, wallColor: 0x7a5a38, roofColor: 0x4a3620, stairSide: "west" });

  // torres de madeira (perfeitas para sniper)
  addTower(scene, obstacles, 0, -18, 4, 5.5, 0x5a4128, 0x3c2c18);
  addTower(scene, obstacles, 0, 18, 4, 5.5, 0x5a4128, 0x3c2c18);

  // pontes pequenas
  for (let i = 0; i < 5; i++) {
    const x = -3 + i * 1.5;
    addMesh(scene, new THREE.BoxGeometry(1.6, 0.25, 2.4), 0x6b4c30, x, 0.15, 0);
    obstacles.push(box(x - 0.8, x + 0.8, -1.2, 1.2, 0.3, false));
  }

  return obstacles;
}

const BUILDERS = { praia: buildPraia, cidade: buildCidade, floresta: buildFloresta };

export function buildMap(mapId, scene) {
  const builder = BUILDERS[mapId] || BUILDERS.praia;
  return builder(scene);
}
