import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

const PACK_ROOTS = {
  city: "./assets/unity-packs/simplepoly-city/",
  guns: "./assets/unity-packs/free-guns/",
  vehicles: "./assets/unity-packs/vehicles/",
  fantasy: "./assets/models/fantasy-mountain/"
};

const CITY_TEXTURES = {
  "Building Sky_big_color01.fbx": "Building Sky_big_color01.png",
  "Building Sky_small_color01.fbx": "Building Sky_small_color01.png",
  "Building_Auto Service.fbx": "Building_Auto Service.png",
  "Building_Bakery.fbx": "Building_Bakery.png",
  "Building_Clothing.fbx": "Building_Clothing.png",
  "Building_Coffee Shop.fbx": "Building_Coffee Shop.png",
  "Building_Factory.fbx": "Building_Factory.png",
  "Building_Fast Food.fbx": "Building_Fast Food.png",
  "Building_Gas Station.fbx": "Building_Gas Station.png",
  "Building_House_01_color01.fbx": "Building_House_01_color01.png",
  "Building_House_02_color01.fbx": "Building_House_02_color01.png",
  "Building_Residential_color01.fbx": "Building_Residential_color01.png",
  "Building_Stadium.fbx": "Building_Stadium.png",
  "Building_Super Market.fbx": "Building_Super Market.png",
  "Natures_Big Tree.fbx": "Natures.png",
  "Natures_Bush_01.fbx": "Natures.png",
  "Natures_Fir Tree.fbx": "Natures.png",
  "Props_Bus Stop.fbx": "Props_Props_01.png",
  "Props_Roof Helipad.fbx": "Props_RoofProps.png",
  "Props_Street Light.fbx": "Props_Props_01.png",
  "Props_Traffic Signal_big.fbx": "Props_TrafficProps.png",
  "Props_Traffic Sign_stop.fbx": "Props_TrafficProps.png",
  "Vehicle_Ambulance.fbx": "Vehicle_Ambulance.png",
  "Vehicle_Bus.fbx": "Vehicle_Bus_1.png",
  "Vehicle_Car.fbx": "Vehicle_Car_1.png",
  "Vehicle_Police Car.fbx": "Vehicle_Police Car.png",
  "Vehicle_Taxi.fbx": "Vehicle_Taxi.png",
  "Vehicle_Truck.fbx": "Vehicle_Truck_1.png"
};

const FREE_GUN_MODELS = {
  sniper_rifle: { file: "Barrett_M82A1.fbx", size: 1.95 },
  assault_rifle: { file: "M16A1.fbx", size: 1.65 },
  smg: { file: "HK_MP5.fbx", size: 1.18 },
  heavy_mg: { file: "Ak47.fbx", size: 1.72 },
  pistol_common: { file: "FN_Five_Seven.fbx", size: 0.7 },
  heavy_pistol: { file: "FN_Five_Seven.fbx", size: 0.76 },
  auto_pistol_weak: { file: "FN_Five_Seven.fbx", size: 0.72 }
};

const VEHICLE_MODELS = {
  car: { file: "HMMWV_brown.fbx", size: 4.5, rotationY: 0 },
  car_blue: { file: "car_blue.fbx", size: 3.25, rotationY: Math.PI },
  motorcycle: { file: "scooter_green.fbx", size: 2.55, rotationY: Math.PI },
  plane: { file: "light_plane_yellow.fbx", size: 7.4, rotationY: Math.PI }
};

const FANTASY_TEXTURES = {
  "Bridge01.fbx": "textures/Bridge01_ALB.png",
  "Bush01.fbx": "textures/Bush01_ALB.png",
  "Flower01.fbx": "textures/Flower01_ALB.png",
  "Flowers01.fbx": "textures/Flower01_ALB.png",
  "Grass01.fbx": "textures/Grass01_ALB.png",
  "Mountain01.fbx": "textures/Rock01_ALB.png",
  "Pebbles01.fbx": "textures/Rock01_ALB.png",
  "Rock01.fbx": "textures/Rock01_ALB.png",
  "Rock02.fbx": "textures/Rock01_ALB.png",
  "Tree01.fbx": "textures/Leaf01_ALB.png"
};

const sourcePromises = new Map();
const texturePromises = new Map();

function encodedAssetUrl(root, file) {
  return `${root}${file.split("/").map(encodeURIComponent).join("/")}`;
}

function packTexture(pack, file) {
  const root = PACK_ROOTS[pack];
  const key = `${pack}:${file}`;
  if (!texturePromises.has(key)) {
    const promise = new THREE.TextureLoader().loadAsync(encodedAssetUrl(root, file)).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = true;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      return texture;
    });
    texturePromises.set(key, promise);
  }
  return texturePromises.get(key);
}

function managerFor(pack) {
  const root = PACK_ROOTS[pack];
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const normalized = decodeURIComponent(url).replace(/\\/g, "/");
    const basename = normalized.split("/").pop();
    if (!basename) return url;
    if (pack === "guns" && /T_PropsGun_BaseColor/i.test(basename)) {
      return encodedAssetUrl(root, "T_PropsFreeGun_BaseColor.png");
    }
    if (pack === "vehicles" && /texture_main\.png/i.test(basename)) {
      return encodedAssetUrl(root, "texture_main.png");
    }
    return encodedAssetUrl(root, basename);
  });
  return manager;
}

async function loadSource(pack, file) {
  const key = `${pack}:${file}`;
  if (!sourcePromises.has(key)) {
    const loader = new FBXLoader(managerFor(pack));
    const promise = loader.loadAsync(encodedAssetUrl(PACK_ROOTS[pack], file)).then((source) => {
      source.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = true;
      });
      return source;
    });
    sourcePromises.set(key, promise);
  }
  return sourcePromises.get(key);
}

async function textureFor(pack, file) {
  if (pack === "guns") return packTexture(pack, "T_PropsFreeGun_BaseColor.png");
  if (pack === "vehicles") return packTexture(pack, "texture_main.png");
  if (pack === "fantasy") {
    const basename = file.split("/").pop();
    return FANTASY_TEXTURES[basename] ? packTexture(pack, FANTASY_TEXTURES[basename]) : null;
  }
  const textureName = CITY_TEXTURES[file];
  return textureName ? packTexture(pack, textureName) : null;
}

function prepareMaterials(model, texture, options) {
  model.traverse((child) => {
    if (!child.isMesh) return;
    const sources = Array.isArray(child.material) ? child.material : [child.material];
    const materials = sources.map((source) => {
      const material = source?.clone?.() || new THREE.MeshStandardMaterial();
      if (texture) material.map = texture;
      material.color?.set(0xffffff);
      material.roughness = options.roughness ?? Math.max(0.55, material.roughness ?? 0.7);
      material.metalness = options.metalness ?? Math.min(0.35, material.metalness ?? 0.08);
      material.side = THREE.FrontSide;
      material.needsUpdate = true;
      return material;
    });
    child.material = Array.isArray(child.material) ? materials : materials[0];
  });
}

function normalizeModel(model, options) {
  model.rotation.set(...(options.rotation || [0, 0, 0]));
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const reference = options.targetHeight ? size.y : Math.max(size.x, size.y, size.z);
  const desired = options.targetHeight || options.targetSize || 1;
  const scale = reference > 0.0001 ? desired / reference : 1;
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(model);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= options.anchor === "center" ? center.y : scaledBounds.min.y;
  if (options.offset) model.position.add(options.offset);
}

export async function attachUnityPackModel(parent, pack, file, options = {}) {
  const existing = options.hideExisting ? [...parent.children] : [];
  const [source, texture] = await Promise.all([loadSource(pack, file), textureFor(pack, file)]);
  if (!parent.parent && !options.allowDetached) return null;
  const model = source.clone(true);
  model.name = `${pack}-${file.replace(/\.[^.]+$/, "")}`;
  prepareMaterials(model, texture, options);
  normalizeModel(model, options);
  parent.add(model);
  existing.forEach((child) => { child.visible = false; });
  parent.userData.unityPackModel = model;
  options.onReady?.(model);
  return model;
}

export function attachCityModel(parent, file, options = {}) {
  return attachUnityPackModel(parent, "city", file, options);
}

export function attachFantasyMountainModel(parent, file, options = {}) {
  const resolvedFile = file.includes("/") ? file : `models/${file}`;
  return attachUnityPackModel(parent, "fantasy", resolvedFile, options);
}

export function attachFreeGunModel(parent, weaponId, options = {}) {
  const descriptor = FREE_GUN_MODELS[weaponId];
  if (!descriptor) return null;
  return attachUnityPackModel(parent, "guns", descriptor.file, {
    targetSize: options.targetSize || descriptor.size,
    rotation: options.rotation || [0, Math.PI / 2, 0],
    anchor: "center",
    roughness: 0.52,
    metalness: 0.28,
    hideExisting: true,
    ...options
  });
}

export function attachLowPolyVehicleModel(parent, vehicleType, options = {}) {
  const descriptor = VEHICLE_MODELS[options.variant || vehicleType];
  if (!descriptor) return null;
  return attachUnityPackModel(parent, "vehicles", descriptor.file, {
    targetSize: options.targetSize || descriptor.size,
    rotation: options.rotation || [0, descriptor.rotationY, 0],
    roughness: 0.62,
    metalness: 0.18,
    hideExisting: true,
    ...options
  });
}

export function hasFreeGunModel(weaponId) {
  return Boolean(FREE_GUN_MODELS[weaponId]);
}
