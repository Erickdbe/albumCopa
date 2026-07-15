import * as THREE from "three";

const RIVER_POINTS = [
  new THREE.Vector3(126, 1.32, -62),
  new THREE.Vector3(108, 1.18, -22),
  new THREE.Vector3(93, 0.94, 18),
  new THREE.Vector3(70, 0.72, 62),
  new THREE.Vector3(58, 0.48, 108),
  new THREE.Vector3(34, 0.28, 158),
  new THREE.Vector3(18, 0.16, 210)
];

function waterMaterial({ shallow = 0x36b9d4, deep = 0x075a89, opacity = 0.82, wave = 0.18 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(shallow) },
      uDeep: { value: new THREE.Color(deep) },
      uOpacity: { value: opacity },
      uWave: { value: wave }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWave;
      varying vec3 vWorld;
      varying float vCrest;
      varying vec2 vUv;
      void main() {
        vec3 p = position;
        float waveA = sin((p.x + uTime * 5.4) * 0.095);
        float waveB = cos((p.z - uTime * 4.1) * 0.13);
        float ripple = sin((p.x + p.z + uTime * 8.0) * 0.21) * 0.35;
        vCrest = waveA * 0.48 + waveB * 0.34 + ripple * 0.18;
        p.y += vCrest * uWave;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform float uOpacity;
      uniform float uTime;
      varying vec3 vWorld;
      varying float vCrest;
      varying vec2 vUv;
      void main() {
        vec3 dx = dFdx(vWorld);
        vec3 dy = dFdy(vWorld);
        vec3 normal = normalize(cross(dx, dy));
        if (normal.y < 0.0) normal *= -1.0;
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 2.4);
        float caustic = sin((vWorld.x * 0.34 + uTime * 2.0)) * cos((vWorld.z * 0.29 - uTime * 1.6));
        float depthMix = clamp(0.48 + vCrest * 0.22 + caustic * 0.06, 0.0, 1.0);
        vec3 color = mix(uDeep, uShallow, depthMix);
        color = mix(color, vec3(0.72, 0.92, 1.0), fresnel * 0.46);
        float foam = smoothstep(0.63, 0.94, vCrest + sin((vUv.x + vUv.y + uTime * 0.08) * 32.0) * 0.08);
        color = mix(color, vec3(0.86, 0.97, 1.0), foam * 0.34);
        gl_FragColor = vec4(color, uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function riverGeometry(curve, segments = 96) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const left = [];
  const right = [];
  const tangent = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = curve.getPoint(t);
    curve.getTangent(t, tangent).normalize();
    const width = THREE.MathUtils.lerp(11.5, 19, Math.pow(t, 1.35));
    const perpendicular = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const a = point.clone().addScaledVector(perpendicular, width * 0.5);
    const b = point.clone().addScaledVector(perpendicular, -width * 0.5);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uvs.push(0, t * 8, 1, t * 8);
    left.push(a.clone().setY(a.y + 0.08));
    right.push(b.clone().setY(b.y + 0.08));
    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, left, right };
}

function edgeLine(points) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0xc8f4ff, transparent: true, opacity: 0.48, depthWrite: false })
  );
}

function distanceToSegment(x, z, a, b) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const lengthSq = vx * vx + vz * vz;
  const t = lengthSq > 0 ? THREE.MathUtils.clamp(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0, 1) : 0;
  return Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
}

export function addUnifiedWater(world) {
  const materials = [];
  const oceanMaterial = waterMaterial({ shallow: 0x38c4dc, deep: 0x075680, opacity: 0.86, wave: 0.25 });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(598, 112, 80, 22), oceanMaterial);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, 0.08, 246);
  ocean.receiveShadow = true;
  world.root.add(ocean);
  materials.push(oceanMaterial);

  const lakeMaterial = waterMaterial({ shallow: 0x49cad5, deep: 0x126b8a, opacity: 0.84, wave: 0.13 });
  const lake = new THREE.Mesh(new THREE.CircleGeometry(31, 64), lakeMaterial);
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(126, 1.3, -62);
  world.root.add(lake);
  materials.push(lakeMaterial);

  const curve = new THREE.CatmullRomCurve3(RIVER_POINTS, false, "centripetal", 0.45);
  const ribbon = riverGeometry(curve);
  const riverMaterial = waterMaterial({ shallow: 0x59cbd3, deep: 0x137295, opacity: 0.86, wave: 0.1 });
  const river = new THREE.Mesh(ribbon.geometry, riverMaterial);
  world.root.add(river, edgeLine(ribbon.left), edgeLine(ribbon.right));
  materials.push(riverMaterial);

  const shoreFoam = new THREE.Mesh(
    new THREE.PlaneGeometry(598, 4, 80, 1),
    new THREE.MeshBasicMaterial({ color: 0xdaf7f6, transparent: true, opacity: 0.42, depthWrite: false })
  );
  shoreFoam.rotation.x = -Math.PI / 2;
  shoreFoam.position.set(0, 0.16, 190.5);
  world.root.add(shoreFoam);

  const bridgeZones = [];
  world.registerWaterBridge = (x, z, width, depth) => {
    const bridge = { x, z, width, depth, active: true };
    bridgeZones.push(bridge);
    return bridge;
  };
  world.isWaterAt = (x, z) => {
    if (bridgeZones.some((bridge) => bridge.active !== false && Math.abs(x - bridge.x) <= bridge.width * 0.5 && Math.abs(z - bridge.z) <= bridge.depth * 0.5)) return false;
    if (z >= 190) return true;
    if (Math.hypot(x - 126, z + 62) <= 30.5) return true;
    for (let i = 0; i < RIVER_POINTS.length - 1; i++) {
      const width = THREE.MathUtils.lerp(6, 10, i / (RIVER_POINTS.length - 2));
      if (distanceToSegment(x, z, RIVER_POINTS[i], RIVER_POINTS[i + 1]) <= width) return true;
    }
    return false;
  };
  world.water = ocean;
  world.waterBodies = { ocean, lake, river, curve };
  world.updateWaterWorks = (elapsed) => {
    materials.forEach((material, index) => { material.uniforms.uTime.value = elapsed * (index === 0 ? 1 : 0.78); });
    shoreFoam.material.opacity = 0.34 + Math.sin(elapsed * 1.7) * 0.1;
    shoreFoam.position.z = 190.5 + Math.sin(elapsed * 1.15) * 0.8;
  };
  return world.waterBodies;
}

export const UNIFIED_RIVER_POINTS = RIVER_POINTS.map((point) => ({ x: point.x, z: point.z }));
