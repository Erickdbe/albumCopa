import * as THREE from "three";

const MAT = {
  dark: new THREE.MeshStandardMaterial({ color: 0x171a1f, roughness: 0.55, metalness: 0.5 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x454b52, roughness: 0.35, metalness: 0.75 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x89939d, roughness: 0.3, metalness: 0.8 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6f4227, roughness: 0.85 }),
  woodLight: new THREE.MeshStandardMaterial({ color: 0xa56b37, roughness: 0.8 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.9 }),
  red: new THREE.MeshStandardMaterial({ color: 0x9e2f35, roughness: 0.65 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xd5a62e, roughness: 0.35, metalness: 0.55 }),
  blade: new THREE.MeshStandardMaterial({ color: 0xc6d0d8, roughness: 0.22, metalness: 0.9 })
};

function material(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.3 });
}

function box(parent, size, position, mat = MAT.dark, rotation = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, radius, length, position, mat = MAT.metal, rotation = [Math.PI / 2, 0, 0], sides = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, sides), mat);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

function tube(parent, curve, radius, mat, segments = 18) {
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 7, false), mat);
  parent.add(mesh);
  return mesh;
}

function line(parent, points, color = 0xd9dde2) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const object = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
  parent.add(object);
  return object;
}

function addIronSights(group, rearZ, frontZ, height = 0.14) {
  box(group, [0.025, height, 0.035], [-0.055, height / 2 + 0.08, rearZ], MAT.dark);
  box(group, [0.025, height, 0.035], [0.055, height / 2 + 0.08, rearZ], MAT.dark);
  box(group, [0.022, height * 0.85, 0.03], [0, height / 2 + 0.07, frontZ], MAT.dark);
}

function addPistol(group, variant) {
  const isHeavy = variant === "heavy_pistol";
  const isAuto = variant === "auto_pistol_weak";
  const slideMat = isHeavy ? MAT.steel : isAuto ? MAT.red : MAT.metal;
  const length = isHeavy ? 0.62 : isAuto ? 0.5 : 0.46;
  box(group, [isHeavy ? 0.16 : 0.13, 0.14, length], [0, 0.02, -length * 0.42], slideMat);
  box(group, [0.12, 0.32, 0.15], [0, -0.19, -0.02], MAT.grip, [-0.18, 0, 0]);
  cylinder(group, isHeavy ? 0.035 : 0.025, length * 0.72, [0, 0.02, -length * 0.82], MAT.dark);
  box(group, [0.15, 0.025, 0.07], [0, 0.1, 0.03], MAT.dark);
  box(group, [0.025, 0.075, 0.025], [0, 0.135, -length + 0.05], MAT.dark);
  if (isAuto) box(group, [0.14, 0.05, 0.18], [0, -0.03, -0.48], MAT.dark);
  group.userData.muzzlePosition = new THREE.Vector3(0, 0.02, -length - 0.18);
}

function addRevolver(group) {
  box(group, [0.14, 0.17, 0.34], [0, 0, -0.08], MAT.steel);
  cylinder(group, 0.115, 0.18, [0, -0.01, -0.22], MAT.metal, [0, 0, Math.PI / 2], 12);
  cylinder(group, 0.035, 0.5, [0, 0.035, -0.47], MAT.dark);
  box(group, [0.12, 0.34, 0.14], [0, -0.22, 0.04], MAT.wood, [-0.2, 0, 0]);
  box(group, [0.04, 0.08, 0.08], [0, 0.13, 0.06], MAT.dark, [-0.35, 0, 0]);
  addIronSights(group, 0.02, -0.68, 0.07);
  group.userData.muzzlePosition = new THREE.Vector3(0, 0.035, -0.72);
}

function addAssaultRifle(group) {
  box(group, [0.2, 0.22, 0.62], [0, 0, -0.15], MAT.metal);
  box(group, [0.18, 0.2, 0.42], [0, 0, 0.34], MAT.wood);
  box(group, [0.15, 0.18, 0.34], [0, -0.01, 0.72], MAT.wood, [0.08, 0, 0]);
  cylinder(group, 0.04, 0.74, [0, 0.02, -0.82], MAT.dark);
  cylinder(group, 0.06, 0.18, [0, 0.02, -1.25], MAT.dark);
  box(group, [0.13, 0.38, 0.18], [0, -0.27, -0.1], MAT.dark, [-0.18, 0, 0]);
  box(group, [0.12, 0.27, 0.14], [0, -0.23, 0.24], MAT.grip, [-0.2, 0, 0]);
  addIronSights(group, 0.18, -1.1);
  group.userData.muzzlePosition = new THREE.Vector3(0, 0.02, -1.37);
}

function addSmg(group) {
  box(group, [0.23, 0.28, 0.48], [0, 0, -0.13], MAT.dark);
  box(group, [0.17, 0.12, 0.3], [0, 0.03, 0.25], MAT.metal);
  cylinder(group, 0.045, 0.38, [0, 0.02, -0.55], MAT.metal);
  box(group, [0.13, 0.5, 0.13], [0, -0.34, -0.18], MAT.metal, [0.12, 0, 0]);
  box(group, [0.13, 0.28, 0.13], [0, -0.24, 0.18], MAT.grip, [-0.2, 0, 0]);
  box(group, [0.04, 0.28, 0.04], [0.18, 0.04, 0.39], MAT.metal, [0, 0, -0.45]);
  box(group, [0.04, 0.28, 0.04], [-0.18, 0.04, 0.39], MAT.metal, [0, 0, 0.45]);
  addIronSights(group, 0.16, -0.68, 0.1);
  group.userData.muzzlePosition = new THREE.Vector3(0, 0.02, -0.78);
}

function addSniper(group) {
  box(group, [0.18, 0.2, 0.82], [0, 0, -0.05], MAT.wood);
  box(group, [0.2, 0.22, 0.48], [0, -0.01, 0.57], MAT.woodLight);
  box(group, [0.18, 0.18, 0.42], [0, -0.01, 0.98], MAT.wood, [0.06, 0, 0]);
  cylinder(group, 0.038, 1.28, [0, 0.04, -1.08], MAT.dark, [Math.PI / 2, 0, 0], 12);
  cylinder(group, 0.06, 0.2, [0, 0.04, -1.82], MAT.dark);
  box(group, [0.12, 0.3, 0.13], [0, -0.23, 0.22], MAT.grip, [-0.16, 0, 0]);
  cylinder(group, 0.085, 0.72, [0, 0.24, -0.13], MAT.dark, [Math.PI / 2, 0, 0], 14);
  cylinder(group, 0.11, 0.08, [0, 0.24, -0.51], MAT.metal);
  cylinder(group, 0.1, 0.08, [0, 0.24, 0.25], MAT.metal);
  box(group, [0.025, 0.38, 0.04], [-0.1, -0.22, -0.75], MAT.dark, [0, 0, -0.22]);
  box(group, [0.025, 0.38, 0.04], [0.1, -0.22, -0.75], MAT.dark, [0, 0, 0.22]);
  group.userData.muzzlePosition = new THREE.Vector3(0, 0.04, -1.94);
}

function addHeavy(group) {
  box(group, [0.3, 0.34, 0.72], [0, 0, -0.05], MAT.dark);
  box(group, [0.22, 0.26, 0.5], [0, 0, 0.53], MAT.metal);
  cylinder(group, 0.055, 0.92, [0, 0.02, -0.82], MAT.dark);
  cylinder(group, 0.075, 0.16, [0, 0.02, -1.36], MAT.metal);
  cylinder(group, 0.22, 0.18, [0, -0.23, -0.08], MAT.metal, [0, 0, Math.PI / 2], 16);
  box(group, [0.13, 0.34, 0.15], [0, -0.3, 0.31], MAT.grip, [-0.18, 0, 0]);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 7, 16, Math.PI), MAT.metal);
  handle.position.set(0, 0.25, -0.05);
  handle.rotation.z = Math.PI;
  group.add(handle);
  addIronSights(group, 0.22, -1.18, 0.11);
  group.userData.muzzlePosition = new THREE.Vector3(0, 0.02, -1.46);
}

function addShotgun(group) {
  box(group, [0.2, 0.22, 0.52], [0, 0, 0.08], MAT.wood);
  box(group, [0.18, 0.2, 0.38], [0, -0.01, 0.48], MAT.woodLight);
  cylinder(group, 0.055, 0.92, [-0.065, 0.04, -0.62], MAT.dark);
  cylinder(group, 0.055, 0.92, [0.065, 0.04, -0.62], MAT.dark);
  box(group, [0.24, 0.22, 0.32], [0, -0.03, -0.44], MAT.woodLight);
  box(group, [0.13, 0.28, 0.14], [0, -0.23, 0.26], MAT.grip, [-0.18, 0, 0]);
  addIronSights(group, 0.24, -1.08, 0.07);
  group.userData.muzzlePosition = new THREE.Vector3(0, 0.04, -1.12);
}

function addKnife(group) {
  box(group, [0.13, 0.16, 0.38], [0, 0, 0.16], MAT.grip);
  box(group, [0.34, 0.06, 0.08], [0, 0, -0.05], MAT.gold);
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.08, 0);
  bladeShape.lineTo(-0.055, -0.78);
  bladeShape.lineTo(0.08, -0.58);
  bladeShape.lineTo(0.08, 0);
  bladeShape.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.035, bevelEnabled: false }), MAT.blade);
  blade.rotation.set(Math.PI / 2, 0, 0);
  blade.position.set(-0.018, 0.02, -0.06);
  group.add(blade);
  group.userData.muzzlePosition = new THREE.Vector3(0, 0, -0.75);
}

function addBow(group) {
  box(group, [0.1, 0.34, 0.1], [0, 0, 0], MAT.woodLight);
  const upper = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0.14, 0), new THREE.Vector3(0.2, 0.48, 0), new THREE.Vector3(0.08, 0.82, 0)
  );
  const lower = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, -0.14, 0), new THREE.Vector3(0.2, -0.48, 0), new THREE.Vector3(0.08, -0.82, 0)
  );
  tube(group, upper, 0.035, MAT.wood, 20);
  tube(group, lower, 0.035, MAT.wood, 20);
  const bowString = line(group, [
    new THREE.Vector3(0.08, 0.82, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.08, -0.82, 0)
  ]);
  const arrow = cylinder(group, 0.018, 1.28, [0, 0, -0.5], MAT.woodLight);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.15, 6), MAT.blade);
  tip.rotation.x = -Math.PI / 2;
  tip.position.set(0, 0, -1.2);
  group.add(tip);
  box(group, [0.22, 0.02, 0.08], [0, 0, 0.13], MAT.red);
  group.userData.bowString = bowString;
  group.userData.chargeParts = [arrow, tip];
  group.userData.chargeBaseZ = [-0.5, -1.2];
  group.userData.muzzlePosition = new THREE.Vector3(0, 0, -1.28);
}

function addCrossbow(group) {
  box(group, [0.16, 0.18, 0.92], [0, 0, -0.1], MAT.wood);
  box(group, [0.18, 0.22, 0.46], [0, -0.01, 0.55], MAT.woodLight);
  box(group, [1.0, 0.08, 0.1], [0, 0.04, -0.48], MAT.wood, [0, 0.12, 0]);
  box(group, [1.0, 0.08, 0.1], [0, 0.04, -0.48], MAT.wood, [0, -0.12, 0]);
  line(group, [new THREE.Vector3(-0.49, 0.04, -0.42), new THREE.Vector3(0, 0.04, -0.16), new THREE.Vector3(0.49, 0.04, -0.42)]);
  cylinder(group, 0.018, 1.0, [0, 0.08, -0.54], MAT.woodLight);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), MAT.blade);
  tip.rotation.x = -Math.PI / 2;
  tip.position.set(0, 0.08, -1.1);
  group.add(tip);
  box(group, [0.13, 0.3, 0.14], [0, -0.23, 0.24], MAT.grip, [-0.18, 0, 0]);
  addIronSights(group, 0.22, -0.85, 0.08);
  group.userData.muzzlePosition = new THREE.Vector3(0, 0.08, -1.18);
}

export function buildWeaponModel(weaponId, accentColor = "#5c6b48") {
  const group = new THREE.Group();
  group.userData.accentMaterial = material(accentColor);

  switch (weaponId) {
    case "sniper_rifle": addSniper(group); break;
    case "bow": addBow(group); break;
    case "crossbow": addCrossbow(group); break;
    case "smg": addSmg(group); break;
    case "assault_rifle": addAssaultRifle(group); break;
    case "heavy_mg": addHeavy(group); break;
    case "mini_shotgun": addShotgun(group); break;
    case "revolver": addRevolver(group); break;
    case "knife": addKnife(group); break;
    case "heavy_pistol":
    case "auto_pistol_weak":
    case "pistol_common": addPistol(group, weaponId); break;
    default: addAssaultRifle(group);
  }

  const isBow = weaponId === "bow";
  const isKnife = weaponId === "knife";
  group.userData.hipPosition = new THREE.Vector3(isBow ? 0.36 : 0.3, isKnife ? -0.34 : -0.27, isBow ? -0.72 : -0.62);
  group.userData.aimPosition = new THREE.Vector3(0, isBow ? -0.03 : -0.12, isBow ? -0.76 : -0.68);
  group.position.copy(group.userData.hipPosition);
  group.rotation.set(isKnife ? -0.18 : 0, isKnife ? -0.2 : 0, isKnife ? 0.2 : 0);
  return group;
}

export function setBowChargeVisual(group, charge) {
  if (!group?.userData?.bowString) return;
  const amount = THREE.MathUtils.clamp(charge, 0, 1);
  const centerZ = amount * 0.3;
  const positions = group.userData.bowString.geometry.attributes.position;
  positions.setXYZ(1, 0, 0, centerZ);
  positions.needsUpdate = true;
  group.userData.chargeParts.forEach((part, index) => {
    part.position.z = group.userData.chargeBaseZ[index] + centerZ;
  });
}
