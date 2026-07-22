using System.Collections.Generic;
using ArenaBrawl.UnityGame;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace ArenaBrawl.UnityGame.EditorTools
{
    public static class SurvivalPhaseOneBuilder
    {
        private const string Root = "Assets/ArenaBrawlUnity";
        private const string SurvivalRoot = Root + "/Survival";
        private const string DefinitionsRoot = SurvivalRoot + "/Definitions";
        private const string PrefabsRoot = SurvivalRoot + "/Prefabs";
        private const string MaterialsRoot = SurvivalRoot + "/Materials";
        private const string WorldScenePath = Root + "/Scenes/ArenaBrawlWorld.unity";
        private const string QuaterniusRoot = "Assets/ThirdParty/Quaternius";

        [MenuItem("Arena Brawl/Build Survival Phase 1")]
        public static void BuildPhaseOne()
        {
            EnsureFolders();
            DeleteNoCraftRetiredAssets();
            AssetDatabase.Refresh();

            if (!System.IO.File.Exists(WorldScenePath))
            {
                ArenaWorldBuilder.BuildLowPolyWorld();
            }

            var definitions = CreateItemDefinitions();
            var lootPrefabs = CreateLootPrefabs(definitions);
            var threatPrefabs = CreateThreatPrefabs();

            var scene = EditorSceneManager.OpenScene(WorldScenePath);
            var metadata = Object.FindObjectOfType<ArenaWorldMetadata>();
            if (metadata == null)
            {
                Debug.LogError("Survival Phase 1 needs ArenaWorldMetadata. Build the low-poly world first.");
                return;
            }

            var player = ConfigurePlayer();
            ConfigureManagers(player);
            ClearPhaseOneRuntimeRoot();

            var runtimeRoot = new GameObject("Survival_Phase1_Runtime");
            SpawnLoot(metadata, lootPrefabs, runtimeRoot.transform);
            SpawnThreats(player, threatPrefabs, runtimeRoot.transform);
            ConfigureVehicles();

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Debug.Log("Arena Brawl Survival Phase 1 built: inventory, loot, zombies, fuel vehicles and HUD are ready.");
        }

        private static void EnsureFolders()
        {
            CreateFolder("Assets", "ArenaBrawlUnity");
            CreateFolder(Root, "Survival");
            CreateFolder(SurvivalRoot, "Definitions");
            CreateFolder(SurvivalRoot, "Prefabs");
            CreateFolder(SurvivalRoot, "Materials");
        }

        private static void CreateFolder(string parent, string child)
        {
            if (!AssetDatabase.IsValidFolder($"{parent}/{child}"))
            {
                AssetDatabase.CreateFolder(parent, child);
            }
        }

        private static void DeleteNoCraftRetiredAssets()
        {
            var retiredIds = new[] { "wood_log", "matchbox" };
            for (var i = 0; i < retiredIds.Length; i++)
            {
                AssetDatabase.DeleteAsset($"{DefinitionsRoot}/{retiredIds[i]}.asset");
                AssetDatabase.DeleteAsset($"{PrefabsRoot}/Loot_{retiredIds[i]}.prefab");
            }
        }

        private static Dictionary<string, SurvivalItemDefinition> CreateItemDefinitions()
        {
            var items = new[]
            {
                new ItemSpec("backpack", "Backpack", SurvivalItemType.Container, 1, 1.8f, "SurvivalPack/FBX/Backpack.fbx") { SlotBonus = 8 },
                new ItemSpec("bandages", "Bandages", SurvivalItemType.Consumable, 5, 0.12f, "SurvivalPack/FBX/Bandages.fbx") { Heal = 18f },
                new ItemSpec("first_aid", "First Aid Kit", SurvivalItemType.Consumable, 2, 0.85f, "SurvivalPack/FBX/FirstAidKit.fbx") { Heal = 55f },
                new ItemSpec("gas_can", "Gas Can", SurvivalItemType.Fuel, 3, 2.2f, "SurvivalPack/FBX/GasCan.fbx") { Fuel = 35f },
                new ItemSpec("water_bottle", "Water Bottle", SurvivalItemType.Consumable, 4, 0.45f, "SurvivalPack/FBX/WaterBottle_1.fbx") { Thirst = 35f },
                new ItemSpec("canned_food", "Canned Food", SurvivalItemType.Consumable, 4, 0.45f, "SurvivalPack/FBX/Can_Closed.fbx") { Hunger = 28f },
                new ItemSpec("knife", "Knife", SurvivalItemType.Weapon, 1, 0.4f, "SurvivalPack/FBX/Knife.fbx") { Damage = 32f, Range = 2.4f, FireRate = 0.55f },
                new ItemSpec("axe", "Axe", SurvivalItemType.Weapon, 1, 1.6f, "SurvivalPack/FBX/Axe.fbx") { Damage = 48f, Range = 2.7f, FireRate = 0.9f },
                new ItemSpec("pistol", "Pistol", SurvivalItemType.Weapon, 1, 1.1f, "SurvivalPack/FBX/Pistol_1.fbx") { Damage = 28f, Range = 72f, FireRate = 0.22f, MagazineSize = 12, AmmoId = "ammo_9mm" },
                new ItemSpec("shotgun", "Shotgun", SurvivalItemType.Weapon, 1, 3.2f, "SurvivalPack/FBX/Shotgun_1.fbx") { Damage = 68f, Range = 42f, FireRate = 0.85f, MagazineSize = 5, AmmoId = "ammo_shells" },
                new ItemSpec("ammo_9mm", "9mm Ammo", SurvivalItemType.Ammo, 60, 0.018f, "") ,
                new ItemSpec("ammo_shells", "Shotgun Shells", SurvivalItemType.Ammo, 24, 0.055f, "")
            };

            var result = new Dictionary<string, SurvivalItemDefinition>();
            for (var i = 0; i < items.Length; i++)
            {
                var definition = CreateOrUpdateItemDefinition(items[i]);
                result[definition.ItemId] = definition;
            }

            return result;
        }

        private static SurvivalItemDefinition CreateOrUpdateItemDefinition(ItemSpec spec)
        {
            var path = $"{DefinitionsRoot}/{spec.Id}.asset";
            var definition = AssetDatabase.LoadAssetAtPath<SurvivalItemDefinition>(path);
            if (definition == null)
            {
                definition = ScriptableObject.CreateInstance<SurvivalItemDefinition>();
                AssetDatabase.CreateAsset(definition, path);
            }

            var serialized = new SerializedObject(definition);
            serialized.FindProperty("itemId").stringValue = spec.Id;
            serialized.FindProperty("displayName").stringValue = spec.Name;
            serialized.FindProperty("itemType").enumValueIndex = (int)spec.Type;
            serialized.FindProperty("maxStack").intValue = spec.MaxStack;
            serialized.FindProperty("weight").floatValue = spec.Weight;
            serialized.FindProperty("worldModel").objectReferenceValue = LoadModel(spec.ModelPath);
            serialized.FindProperty("healAmount").floatValue = spec.Heal;
            serialized.FindProperty("thirstAmount").floatValue = spec.Thirst;
            serialized.FindProperty("hungerAmount").floatValue = spec.Hunger;
            serialized.FindProperty("damage").floatValue = spec.Damage;
            serialized.FindProperty("range").floatValue = spec.Range;
            serialized.FindProperty("fireRate").floatValue = spec.FireRate;
            serialized.FindProperty("magazineSize").intValue = spec.MagazineSize;
            serialized.FindProperty("compatibleAmmoId").stringValue = spec.AmmoId;
            serialized.FindProperty("fuelAmount").floatValue = spec.Fuel;
            serialized.FindProperty("slotBonus").intValue = spec.SlotBonus;
            serialized.ApplyModifiedPropertiesWithoutUndo();

            EditorUtility.SetDirty(definition);
            return definition;
        }

        private static Dictionary<string, GameObject> CreateLootPrefabs(Dictionary<string, SurvivalItemDefinition> definitions)
        {
            var result = new Dictionary<string, GameObject>();
            var material = CreateMaterial("Loot_Interactable", new Color(1f, 0.74f, 0.22f));

            foreach (var pair in definitions)
            {
                var prefabPath = $"{PrefabsRoot}/Loot_{pair.Key}.prefab";
                var root = new GameObject($"Loot_{pair.Key}");
                var pickup = root.AddComponent<SurvivalLootPickup>();
                var collider = root.AddComponent<SphereCollider>();
                collider.radius = 0.72f;
                collider.isTrigger = true;

                var serialized = new SerializedObject(pickup);
                serialized.FindProperty("definition").objectReferenceValue = pair.Value;
                serialized.FindProperty("quantity").intValue = DefaultPickupQuantity(pair.Value);
                serialized.ApplyModifiedPropertiesWithoutUndo();

                CreateLootVisual(pair.Value, material, root.transform);
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
                Object.DestroyImmediate(root);
                result[pair.Key] = prefab;
            }

            return result;
        }

        private static Dictionary<string, GameObject> CreateThreatPrefabs()
        {
            var result = new Dictionary<string, GameObject>();
            var material = CreateMaterial("Threat_Fallback", new Color(0.18f, 0.42f, 0.16f));
            var specs = new[]
            {
                new ThreatSpec("Zombie_Basic", "ZombieApocalypseKit/Characters/FBX/Zombie_Basic.fbx", 100f),
                new ThreatSpec("Zombie_Chubby", "ZombieApocalypseKit/Characters/FBX/Zombie_Chubby.fbx", 135f),
                new ThreatSpec("Zombie_Ribcage", "ZombieApocalypseKit/Characters/FBX/Zombie_Ribcage.fbx", 90f),
                new ThreatSpec("Zombie_Arm", "ZombieApocalypseKit/Characters/FBX/Zombie_Arm.fbx", 75f)
            };

            for (var i = 0; i < specs.Length; i++)
            {
                var root = new GameObject(specs[i].Id);
                var controller = root.AddComponent<CharacterController>();
                controller.height = 2f;
                controller.radius = 0.42f;
                controller.center = new Vector3(0f, 1f, 0f);

                var health = root.AddComponent<SurvivalHealth>();
                var healthSerialized = new SerializedObject(health);
                healthSerialized.FindProperty("maxHealth").floatValue = specs[i].Health;
                healthSerialized.ApplyModifiedPropertiesWithoutUndo();

                root.AddComponent<SurvivalThreatAI>();

                var model = LoadModel(specs[i].ModelPath);
                if (model != null)
                {
                    var visual = (GameObject)PrefabUtility.InstantiatePrefab(model);
                    visual.transform.SetParent(root.transform, false);
                    visual.transform.localScale = Vector3.one * 1.05f;
                    RemoveColliders(visual);
                }
                else
                {
                    var visual = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                    visual.name = "Fallback_Zombie_Visual";
                    visual.transform.SetParent(root.transform, false);
                    visual.transform.localPosition = new Vector3(0f, 1f, 0f);
                    visual.GetComponent<Renderer>().sharedMaterial = material;
                    Object.DestroyImmediate(visual.GetComponent<Collider>());
                }

                var prefab = PrefabUtility.SaveAsPrefabAsset(root, $"{PrefabsRoot}/{specs[i].Id}.prefab");
                Object.DestroyImmediate(root);
                result[specs[i].Id] = prefab;
            }

            return result;
        }

        private static Transform ConfigurePlayer()
        {
            var player = GameObject.Find("Preview_Player_Controller");
            if (player == null)
            {
                player = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                player.name = "Preview_Player_Controller";
                player.transform.position = new Vector3(0f, 3.2f, 10f);
                Object.DestroyImmediate(player.GetComponent<Collider>());
                player.AddComponent<CharacterController>();
                player.AddComponent<ArenaPreviewController>();
            }

            player.tag = "Player";

            var inventory = EnsureComponent<SurvivalInventory>(player);
            var inventorySerialized = new SerializedObject(inventory);
            inventorySerialized.FindProperty("slotCapacity").intValue = 10;
            inventorySerialized.FindProperty("weightCapacity").floatValue = 28f;
            inventorySerialized.ApplyModifiedPropertiesWithoutUndo();

            var health = EnsureComponent<SurvivalHealth>(player);
            var healthSerialized = new SerializedObject(health);
            healthSerialized.FindProperty("maxHealth").floatValue = 100f;
            healthSerialized.FindProperty("destroyOnDeath").boolValue = false;
            healthSerialized.ApplyModifiedPropertiesWithoutUndo();

            var interactor = EnsureComponent<SurvivalPlayerInteractor>(player);
            var weapon = EnsureComponent<SurvivalWeaponController>(player);
            var camera = player.GetComponentInChildren<Camera>();

            if (camera != null)
            {
                var interactorSerialized = new SerializedObject(interactor);
                interactorSerialized.FindProperty("playerCamera").objectReferenceValue = camera;
                interactorSerialized.ApplyModifiedPropertiesWithoutUndo();

                var weaponSerialized = new SerializedObject(weapon);
                weaponSerialized.FindProperty("aimCamera").objectReferenceValue = camera;
                weaponSerialized.ApplyModifiedPropertiesWithoutUndo();
            }

            return player.transform;
        }

        private static void ConfigureManagers(Transform player)
        {
            var systems = GameObject.Find("Survival_Phase1_Systems") ?? new GameObject("Survival_Phase1_Systems");
            var manager = EnsureComponent<SurvivalGameManager>(systems);
            var hud = EnsureComponent<SurvivalHud>(systems);
            var lighting = Object.FindObjectOfType<ArenaLightingCycle>();
            var interactor = player != null ? player.GetComponent<SurvivalPlayerInteractor>() : null;
            var inventory = player != null ? player.GetComponent<SurvivalInventory>() : null;
            var weapon = player != null ? player.GetComponent<SurvivalWeaponController>() : null;
            var health = player != null ? player.GetComponent<SurvivalHealth>() : null;

            var managerSerialized = new SerializedObject(manager);
            managerSerialized.FindProperty("lightingCycle").objectReferenceValue = lighting;
            managerSerialized.FindProperty("player").objectReferenceValue = player;
            managerSerialized.FindProperty("nightAggressionMultiplier").floatValue = 1.75f;
            managerSerialized.ApplyModifiedPropertiesWithoutUndo();

            var hudSerialized = new SerializedObject(hud);
            hudSerialized.FindProperty("player").objectReferenceValue = interactor;
            hudSerialized.FindProperty("inventory").objectReferenceValue = inventory;
            hudSerialized.FindProperty("weaponController").objectReferenceValue = weapon;
            hudSerialized.FindProperty("health").objectReferenceValue = health;
            hudSerialized.FindProperty("gameManager").objectReferenceValue = manager;
            hudSerialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void ClearPhaseOneRuntimeRoot()
        {
            var previous = GameObject.Find("Survival_Phase1_Runtime");
            if (previous != null)
            {
                Object.DestroyImmediate(previous);
            }
        }

        private static void SpawnLoot(ArenaWorldMetadata metadata, Dictionary<string, GameObject> prefabs, Transform parent)
        {
            var root = new GameObject("Loot");
            root.transform.SetParent(parent, false);
            Random.InitState(4507);

            var choices = new[]
            {
                new LootChoice("bandages", 12, 1, 2),
                new LootChoice("first_aid", 4, 1, 1),
                new LootChoice("water_bottle", 10, 1, 2),
                new LootChoice("canned_food", 10, 1, 2),
                new LootChoice("gas_can", 5, 1, 1),
                new LootChoice("ammo_9mm", 8, 8, 18),
                new LootChoice("ammo_shells", 5, 3, 8),
                new LootChoice("knife", 4, 1, 1),
                new LootChoice("axe", 3, 1, 1),
                new LootChoice("pistol", 3, 1, 1),
                new LootChoice("shotgun", 2, 1, 1),
                new LootChoice("backpack", 3, 1, 1)
            };

            for (var i = 0; i < metadata.lootSpawns.Length; i++)
            {
                SpawnLootPickup(ChooseLoot(choices), metadata.lootSpawns[i].position + Vector3.up * 0.65f, prefabs, root.transform, i);
            }

            for (var i = 0; i < 32; i++)
            {
                var zoneRoll = Random.value;
                var center = zoneRoll < 0.45f ? new Vector3(-70f, 0f, 30f) : zoneRoll < 0.82f ? new Vector3(65f, 0f, 42f) : new Vector3(0f, 0f, -86f);
                var extent = zoneRoll < 0.45f ? new Vector2(92f, 88f) : zoneRoll < 0.82f ? new Vector2(108f, 96f) : new Vector2(210f, 58f);
                var position = center + new Vector3(Random.Range(-extent.x * 0.5f, extent.x * 0.5f), 1.15f, Random.Range(-extent.y * 0.5f, extent.y * 0.5f));
                SpawnLootPickup(ChooseLoot(choices), position, prefabs, root.transform, metadata.lootSpawns.Length + i);
            }
        }

        private static void SpawnLootPickup(LootChoice choice, Vector3 position, Dictionary<string, GameObject> prefabs, Transform parent, int index)
        {
            if (!prefabs.TryGetValue(choice.ItemId, out var prefab) || prefab == null)
            {
                return;
            }

            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, parent);
            instance.name = $"Loot_{index:00}_{choice.ItemId}";
            instance.transform.position = position;
            instance.transform.rotation = Quaternion.Euler(0f, Random.Range(0f, 360f), 0f);

            var pickup = instance.GetComponent<SurvivalLootPickup>();
            if (pickup != null)
            {
                var serialized = new SerializedObject(pickup);
                serialized.FindProperty("quantity").intValue = Random.Range(choice.MinQuantity, choice.MaxQuantity + 1);
                serialized.ApplyModifiedPropertiesWithoutUndo();
            }
        }

        private static void SpawnThreats(Transform player, Dictionary<string, GameObject> threatPrefabs, Transform parent)
        {
            var root = new GameObject("Threats");
            root.transform.SetParent(parent, false);
            var positions = new[]
            {
                new Vector3(-104f, 1.3f, 66f),
                new Vector3(-92f, 1.3f, 2f),
                new Vector3(-58f, 1.3f, -14f),
                new Vector3(-34f, 1.3f, 72f),
                new Vector3(28f, 1.3f, 60f),
                new Vector3(48f, 1.3f, 24f),
                new Vector3(76f, 1.3f, 76f),
                new Vector3(108f, 1.3f, 34f),
                new Vector3(-62f, 1.3f, -76f),
                new Vector3(42f, 1.3f, -84f)
            };

            var ids = new[] { "Zombie_Basic", "Zombie_Chubby", "Zombie_Ribcage", "Zombie_Arm" };
            for (var i = 0; i < positions.Length; i++)
            {
                if (!threatPrefabs.TryGetValue(ids[i % ids.Length], out var prefab) || prefab == null)
                {
                    continue;
                }

                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, root.transform);
                instance.name = $"Threat_{i:00}_{ids[i % ids.Length]}";
                instance.transform.position = positions[i];
                instance.transform.rotation = Quaternion.Euler(0f, Random.Range(0f, 360f), 0f);

                var ai = instance.GetComponent<SurvivalThreatAI>();
                if (ai != null)
                {
                    var serialized = new SerializedObject(ai);
                    serialized.FindProperty("target").objectReferenceValue = player;
                    serialized.ApplyModifiedPropertiesWithoutUndo();
                }
            }
        }

        private static void ConfigureVehicles()
        {
            var vehicles = Object.FindObjectsOfType<Transform>();
            for (var i = 0; i < vehicles.Length; i++)
            {
                var vehicle = vehicles[i];
                if (!vehicle.name.StartsWith("Vehicle_") || vehicle.GetComponentInParent<SurvivalVehicle>() != null)
                {
                    continue;
                }

                SetStaticRecursive(vehicle.gameObject, false);
                var body = EnsureComponent<Rigidbody>(vehicle.gameObject);
                body.mass = 1200f;
                body.useGravity = true;
                body.interpolation = RigidbodyInterpolation.Interpolate;

                var survivalVehicle = EnsureComponent<SurvivalVehicle>(vehicle.gameObject);
                var serialized = new SerializedObject(survivalVehicle);
                serialized.FindProperty("maxFuel").floatValue = 100f;
                serialized.FindProperty("fuel").floatValue = Random.Range(0f, 34f);
                serialized.ApplyModifiedPropertiesWithoutUndo();
            }
        }

        private static LootChoice ChooseLoot(IReadOnlyList<LootChoice> choices)
        {
            var total = 0;
            for (var i = 0; i < choices.Count; i++)
            {
                total += choices[i].Weight;
            }

            var roll = Random.Range(0, total);
            for (var i = 0; i < choices.Count; i++)
            {
                roll -= choices[i].Weight;
                if (roll < 0)
                {
                    return choices[i];
                }
            }

            return choices[0];
        }

        private static int DefaultPickupQuantity(SurvivalItemDefinition definition)
        {
            if (definition.ItemType == SurvivalItemType.Ammo)
            {
                return Mathf.Min(definition.MaxStack, 12);
            }

            if (definition.ItemType == SurvivalItemType.Resource)
            {
                return Mathf.Min(definition.MaxStack, 2);
            }

            return 1;
        }

        private static void CreateLootVisual(SurvivalItemDefinition definition, Material fallbackMaterial, Transform parent)
        {
            GameObject visual;
            if (definition.WorldModel != null)
            {
                visual = (GameObject)PrefabUtility.InstantiatePrefab(definition.WorldModel);
                visual.transform.SetParent(parent, false);
                visual.transform.localScale = Vector3.one * 0.65f;
                RemoveColliders(visual);
                return;
            }

            visual = GameObject.CreatePrimitive(definition.ItemType == SurvivalItemType.Ammo ? PrimitiveType.Cylinder : PrimitiveType.Cube);
            visual.name = "Fallback_Visual";
            visual.transform.SetParent(parent, false);
            visual.transform.localPosition = Vector3.zero;
            visual.transform.localScale = definition.ItemType == SurvivalItemType.Ammo ? new Vector3(0.35f, 0.18f, 0.35f) : Vector3.one * 0.45f;
            visual.GetComponent<Renderer>().sharedMaterial = fallbackMaterial;
            Object.DestroyImmediate(visual.GetComponent<Collider>());
        }

        private static GameObject LoadModel(string relativePath)
        {
            if (string.IsNullOrEmpty(relativePath))
            {
                return null;
            }

            return AssetDatabase.LoadAssetAtPath<GameObject>($"{QuaterniusRoot}/{relativePath}");
        }

        private static Material CreateMaterial(string name, Color color)
        {
            var path = $"{MaterialsRoot}/{name}.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
                AssetDatabase.CreateAsset(material, path);
            }

            if (material.HasProperty("_BaseColor"))
            {
                material.SetColor("_BaseColor", color);
            }
            else
            {
                material.color = color;
            }

            EditorUtility.SetDirty(material);
            return material;
        }

        private static T EnsureComponent<T>(GameObject target) where T : Component
        {
            var component = target.GetComponent<T>();
            return component != null ? component : target.AddComponent<T>();
        }

        private static void RemoveColliders(GameObject root)
        {
            var colliders = root.GetComponentsInChildren<Collider>();
            for (var i = 0; i < colliders.Length; i++)
            {
                Object.DestroyImmediate(colliders[i]);
            }
        }

        private static void SetStaticRecursive(GameObject root, bool isStatic)
        {
            root.isStatic = isStatic;
            for (var i = 0; i < root.transform.childCount; i++)
            {
                SetStaticRecursive(root.transform.GetChild(i).gameObject, isStatic);
            }
        }

        private sealed class ItemSpec
        {
            public readonly string Id;
            public readonly string Name;
            public readonly SurvivalItemType Type;
            public readonly int MaxStack;
            public readonly float Weight;
            public readonly string ModelPath;
            public float Heal;
            public float Thirst;
            public float Hunger;
            public float Damage = 10f;
            public float Range = 2f;
            public float FireRate = 0.5f;
            public int MagazineSize;
            public string AmmoId = "";
            public float Fuel;
            public int SlotBonus;

            public ItemSpec(string id, string name, SurvivalItemType type, int maxStack, float weight, string modelPath)
            {
                Id = id;
                Name = name;
                Type = type;
                MaxStack = maxStack;
                Weight = weight;
                ModelPath = modelPath;
            }
        }

        private readonly struct LootChoice
        {
            public readonly string ItemId;
            public readonly int Weight;
            public readonly int MinQuantity;
            public readonly int MaxQuantity;

            public LootChoice(string itemId, int weight, int minQuantity, int maxQuantity)
            {
                ItemId = itemId;
                Weight = weight;
                MinQuantity = minQuantity;
                MaxQuantity = maxQuantity;
            }
        }

        private readonly struct ThreatSpec
        {
            public readonly string Id;
            public readonly string ModelPath;
            public readonly float Health;

            public ThreatSpec(string id, string modelPath, float health)
            {
                Id = id;
                ModelPath = modelPath;
                Health = health;
            }
        }
    }
}
