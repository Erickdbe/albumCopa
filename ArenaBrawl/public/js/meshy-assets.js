import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const MODEL_ROOT = "./assets/models/meshy/";
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(location.pathname.startsWith("/ArenaBrawl/")
  ? "/ArenaBrawl/vendor/three/examples/jsm/libs/draco/gltf/"
  : "/node_modules/three/examples/jsm/libs/draco/gltf/");
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const modelCache = new Map();

const PROCEDURAL_STYLES = {
  "unknown-a": "tree",
  "unknown-b": "tree",
  "unknown-c": "cottage"
};

function addProceduralColors(mesh, style) {
  const geometry = mesh.geometry.clone();
  geometry.computeBoundingBox();
  const position = geometry.attributes.position;
  const bounds = geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();

  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const height = size.y ? (y - bounds.min.y) / size.y : 0;
    const nx = size.x ? Math.abs(x - center.x) / (size.x * 0.5) : 0;
    const nz = size.z ? Math.abs(z - center.z) / (size.z * 0.5) : 0;
    const radius = Math.hypot(nx, nz);
    const variation = Math.sin(x * 91 + y * 47 + z * 73) * 0.035;

    if (style === "tree") {
      const trunk = height < 0.76 && radius < 0.34 + (1 - height) * 0.18;
      color.setHSL(trunk ? 0.085 : 0.29 + variation, trunk ? 0.52 : 0.58, trunk ? 0.25 : 0.31 + height * 0.08);
    } else {
      const garden = height < 0.24 && radius > 0.76;
      const roof = height > 0.54;
      if (garden) color.setHSL(0.29 + variation, 0.55, 0.34);
      else if (roof) color.setHSL(0.015 + variation * 0.2, 0.55, 0.32 + height * 0.08);
      else color.setHSL(0.12 + variation * 0.2, 0.38, 0.7);
    }
    color.toArray(colors, index * 3);
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  mesh.geometry = geometry;
  mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.02 });
}

function prepareModel(scene, assetName) {
  const style = PROCEDURAL_STYLES[assetName];
  scene.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    if (style) {
      addProceduralColors(child, style);
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const prepared = materials.map((source) => {
      const material = source.clone();
      material.emissiveMap = null;
      material.emissive?.set(0x000000);
      material.metalness = Math.min(material.metalness ?? 0.35, 0.62);
      material.roughness = Math.max(material.roughness ?? 0.5, 0.42);
      material.needsUpdate = true;
      return material;
    });
    child.material = Array.isArray(child.material) ? prepared : prepared[0];
  });
  return scene;
}

function loadModel(assetName) {
  if (!modelCache.has(assetName)) {
    const request = gltfLoader.loadAsync(`${MODEL_ROOT}${assetName}/model.gltf`)
      .then((asset) => prepareModel(asset.scene, assetName));
    modelCache.set(assetName, request);
  }
  return modelCache.get(assetName);
}

export async function attachMeshyModel(parent, assetName, options = {}) {
  if (!parent || parent.userData.meshyAsset === assetName) return parent?.userData.meshyVisual || null;
  const placeholders = [...parent.children];
  const loadToken = Symbol(assetName);
  parent.userData.meshyLoadToken = loadToken;

  try {
    const source = await loadModel(assetName);
    if (parent.userData.meshyLoadToken !== loadToken || (!parent.parent && options.requireAttached !== false)) return null;

    const model = source.clone(true);
    const oriented = new THREE.Group();
    oriented.add(model);
    if (options.align === "x-to-z") oriented.rotation.y = Math.PI / 2;
    else if (options.align === "y-to-z") oriented.rotation.x = -Math.PI / 2;

    const bounds = new THREE.Box3().setFromObject(oriented);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    oriented.position.x -= center.x;
    oriented.position.z -= center.z;
    oriented.position.y -= options.anchor === "center" ? center.y : bounds.min.y;

    const visual = new THREE.Group();
    visual.name = `meshy-${assetName}`;
    visual.add(oriented);
    const measured = options.targetHeight ? size.y : Math.max(size.x, size.y, size.z);
    visual.scale.setScalar(measured > 0 ? (options.targetHeight || options.targetSize || 1) / measured : 1);
    if (options.position) visual.position.fromArray(options.position);
    if (options.rotation) visual.rotation.set(...options.rotation);
    parent.add(visual);

    if (options.hideExisting !== false) placeholders.forEach((object) => { object.visible = false; });
    parent.userData.meshyAsset = assetName;
    parent.userData.meshyVisual = visual;
    options.onReady?.(visual);
    return visual;
  } catch (error) {
    console.warn(`Nao foi possivel carregar o asset ${assetName}:`, error);
    return null;
  }
}
