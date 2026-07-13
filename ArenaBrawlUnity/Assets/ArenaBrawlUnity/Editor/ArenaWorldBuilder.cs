using System.Collections.Generic;
using ArenaBrawl.UnityGame;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace ArenaBrawl.UnityGame.EditorTools
{
    public static class ArenaWorldBuilder
    {
        private const string Root = "Assets/ArenaBrawlUnity";
        private static readonly List<Transform> PlayerSpawns = new List<Transform>();
        private static readonly List<Transform> VehicleSpawns = new List<Transform>();
        private static readonly List<Transform> LootSpawns = new List<Transform>();
        private static readonly List<Transform> EventAnchors = new List<Transform>();

        [MenuItem("Arena Brawl/Build Low Poly World")]
        public static void BuildLowPolyWorld()
        {
            CreateFolders();
            PlayerSpawns.Clear();
            VehicleSpawns.Clear();
            LootSpawns.Clear();
            EventAnchors.Clear();
            Random.InitState(1626);

            var materials = CreateMaterials();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "ArenaBrawlWorld";

            ConfigureRenderSettings(materials);

            var world = new GameObject("ArenaBrawlWorld");
            var metadata = world.AddComponent<ArenaWorldMetadata>();

            var terrain = new GameObject("Terrain");
            terrain.transform.SetParent(world.transform);

            CreateZoneGround("CityZone_Ground", new Vector3(-70f, 0f, 30f), new Vector3(112f, 1f, 112f), materials["CityGrass"], terrain.transform);
            CreateZoneGround("ForestZone_Ground", new Vector3(65f, 0f, 42f), new Vector3(124f, 1f, 116f), materials["ForestGrass"], terrain.transform);
            CreateZoneGround("BeachZone_Sand", new Vector3(0f, 0f, -86f), new Vector3(245f, 1f, 82f), materials["Sand"], terrain.transform);
            CreateZoneGround("Central_Concrete_Plaza", new Vector3(0f, 0.04f, 0f), new Vector3(46f, 0.25f, 46f), materials["Concrete"], terrain.transform);

            BuildCity(world.transform, materials);
            BuildForest(world.transform, materials);
            BuildBeach(world.transform, materials);
            BuildArenaConnectors(world.transform, materials);
            BuildMapBounds(world.transform, materials);
            CreateSpawns(world.transform, materials);
            CreateLightingRig(world.transform);
            CreatePreviewPlayer(world.transform, materials);

            metadata.playerSpawns = PlayerSpawns.ToArray();
            metadata.vehicleSpawns = VehicleSpawns.ToArray();
            metadata.lootSpawns = LootSpawns.ToArray();
            metadata.eventAnchors = EventAnchors.ToArray();

            EditorSceneManager.SaveScene(scene, $"{Root}/Scenes/ArenaBrawlWorld.unity");
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Debug.Log("Arena Brawl low-poly world generated at Assets/ArenaBrawlUnity/Scenes/ArenaBrawlWorld.unity");
        }

        private static void CreateFolders()
        {
            CreateFolder("Assets", "ArenaBrawlUnity");
            CreateFolder(Root, "Scenes");
            CreateFolder(Root, "Materials");
            CreateFolder(Root, "Prefabs");
            CreateFolder(Root, "Scripts");
        }

        private static void CreateFolder(string parent, string child)
        {
            if (!AssetDatabase.IsValidFolder($"{parent}/{child}"))
            {
                AssetDatabase.CreateFolder(parent, child);
            }
        }

        private static Dictionary<string, Material> CreateMaterials()
        {
            return new Dictionary<string, Material>
            {
                ["CityGrass"] = CreateMaterial("CityGrass", new Color(0.25f, 0.38f, 0.22f)),
                ["ForestGrass"] = CreateMaterial("ForestGrass", new Color(0.18f, 0.47f, 0.22f)),
                ["Sand"] = CreateMaterial("Sand", new Color(0.85f, 0.68f, 0.36f)),
                ["Concrete"] = CreateMaterial("Concrete", new Color(0.48f, 0.5f, 0.52f)),
                ["DarkConcrete"] = CreateMaterial("DarkConcrete", new Color(0.25f, 0.27f, 0.3f)),
                ["Asphalt"] = CreateMaterial("Asphalt", new Color(0.08f, 0.09f, 0.1f)),
                ["RoadLine"] = CreateMaterial("RoadLine", new Color(1f, 0.86f, 0.28f)),
                ["Wall"] = CreateMaterial("Wall", new Color(0.36f, 0.43f, 0.53f)),
                ["Roof"] = CreateMaterial("Roof", new Color(0.63f, 0.18f, 0.15f)),
                ["Glass"] = CreateMaterial("Glass", new Color(0.26f, 0.62f, 0.78f), 0.75f),
                ["Wood"] = CreateMaterial("Wood", new Color(0.37f, 0.2f, 0.08f)),
                ["Foliage"] = CreateMaterial("Foliage", new Color(0.14f, 0.55f, 0.16f)),
                ["FoliageLight"] = CreateMaterial("FoliageLight", new Color(0.35f, 0.74f, 0.24f)),
                ["Cliff"] = CreateMaterial("Cliff", new Color(0.45f, 0.4f, 0.34f)),
                ["Water"] = CreateMaterial("Water", new Color(0.08f, 0.42f, 0.75f, 0.76f), 0.45f, true),
                ["Foam"] = CreateMaterial("Foam", new Color(0.88f, 0.96f, 1f)),
                ["VehicleRed"] = CreateMaterial("VehicleRed", new Color(0.9f, 0.18f, 0.1f)),
                ["VehicleBlue"] = CreateMaterial("VehicleBlue", new Color(0.1f, 0.36f, 0.88f)),
                ["VehicleGreen"] = CreateMaterial("VehicleGreen", new Color(0.14f, 0.5f, 0.18f)),
                ["Metal"] = CreateMaterial("Metal", new Color(0.12f, 0.13f, 0.15f), 0.65f),
                ["Spawn"] = CreateMaterial("Spawn", new Color(0.1f, 0.95f, 0.65f)),
                ["Loot"] = CreateMaterial("Loot", new Color(1f, 0.78f, 0.14f))
            };
        }

        private static Material CreateMaterial(string name, Color color, float smoothness = 0.18f, bool transparent = false)
        {
            var path = $"{Root}/Materials/{name}.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(FindLitShader());
                AssetDatabase.CreateAsset(material, path);
            }

            SetColor(material, color);
            SetFloat(material, "_Smoothness", smoothness);
            SetFloat(material, "_Metallic", 0f);

            if (transparent)
            {
                material.SetOverrideTag("RenderType", "Transparent");
                SetFloat(material, "_Surface", 1f);
                SetFloat(material, "_AlphaClip", 0f);
                material.renderQueue = (int)RenderQueue.Transparent;
                material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            }

            EditorUtility.SetDirty(material);
            return material;
        }

        private static Shader FindLitShader()
        {
            return Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
        }

        private static void SetColor(Material material, Color color)
        {
            if (material.HasProperty("_BaseColor"))
            {
                material.SetColor("_BaseColor", color);
            }
            else
            {
                material.color = color;
            }
        }

        private static void SetFloat(Material material, string property, float value)
        {
            if (material.HasProperty(property))
            {
                material.SetFloat(property, value);
            }
        }

        private static void ConfigureRenderSettings(IReadOnlyDictionary<string, Material> materials)
        {
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.006f;
            RenderSettings.fogColor = new Color(0.62f, 0.79f, 0.9f);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.5f, 0.56f, 0.64f);
            RenderSettings.skybox = null;
        }

        private static void CreateZoneGround(string name, Vector3 position, Vector3 scale, Material material, Transform parent)
        {
            var ground = CreateBox(name, position, scale, material, parent);
            ground.isStatic = true;
            ground.layer = 0;
        }

        private static void BuildCity(Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var city = new GameObject("Zone_City");
            city.transform.SetParent(parent);

            CreateRoad("City_Road_Main_NS", new Vector3(-70f, 0.58f, 30f), new Vector3(14f, 0.14f, 108f), city.transform, materials);
            CreateRoad("City_Road_Main_EW", new Vector3(-70f, 0.6f, 30f), new Vector3(104f, 0.14f, 14f), city.transform, materials);
            CreateRoad("City_Road_Ring_North", new Vector3(-70f, 0.62f, 76f), new Vector3(82f, 0.14f, 10f), city.transform, materials);
            CreateRoad("City_Road_Ring_South", new Vector3(-70f, 0.62f, -16f), new Vector3(82f, 0.14f, 10f), city.transform, materials);

            for (var row = 0; row < 3; row++)
            {
                for (var col = 0; col < 4; col++)
                {
                    var x = -114f + col * 29f + Random.Range(-2.5f, 2.5f);
                    var z = -8f + row * 34f + Random.Range(-2.5f, 2.5f);
                    var height = Random.Range(12f, 31f);
                    CreateBuilding($"City_Building_{row}_{col}", new Vector3(x, 0.65f, z), new Vector3(Random.Range(11f, 17f), height, Random.Range(10f, 18f)), city.transform, materials);
                }
            }

            for (var i = 0; i < 7; i++)
            {
                var position = new Vector3(-35f - i * 10f, 0.7f, 84f + Random.Range(-3f, 3f));
                CreateHouse($"City_House_{i}", position, city.transform, materials);
            }

            for (var i = 0; i < 14; i++)
            {
                var side = i % 2 == 0 ? -1f : 1f;
                var z = -20f + i * 8f;
                CreateStreetLight($"City_StreetLight_{i}", new Vector3(-60f + side * 11f, 0.8f, z), city.transform, materials);
            }

            CreateCar("Vehicle_Car_Red", new Vector3(-83f, 1f, 29f), Quaternion.Euler(0f, 90f, 0f), city.transform, materials["VehicleRed"], materials);
            CreateCar("Vehicle_Car_Blue", new Vector3(-56f, 1f, -7f), Quaternion.Euler(0f, -35f, 0f), city.transform, materials["VehicleBlue"], materials);
            CreateBike("Vehicle_Moto_City", new Vector3(-43f, 0.9f, 54f), Quaternion.Euler(0f, 20f, 0f), city.transform, materials);

            CreateRampSet("City_Skate_Ramps", new Vector3(-24f, 0.7f, 8f), city.transform, materials);
            AddMarker("VehicleSpawn_City_Car", new Vector3(-83f, 1.1f, 29f), city.transform, VehicleSpawns);
            AddMarker("VehicleSpawn_City_Moto", new Vector3(-43f, 1.1f, 54f), city.transform, VehicleSpawns);
        }

        private static void BuildForest(Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var forest = new GameObject("Zone_Forest");
            forest.transform.SetParent(parent);

            CreateMountainMesh("Forest_Mountain_Ridge", new Vector3(70f, 0.62f, 104f), 96f, 40f, forest.transform, materials["Cliff"]);
            CreateMountainMesh("Forest_Mountain_West", new Vector3(16f, 0.62f, 52f), 42f, 23f, forest.transform, materials["Cliff"]);
            CreateMountainMesh("Forest_Mountain_East", new Vector3(114f, 0.62f, 26f), 44f, 25f, forest.transform, materials["Cliff"]);

            for (var i = 0; i < 58; i++)
            {
                var x = Random.Range(10f, 125f);
                var z = Random.Range(-6f, 96f);
                if (Vector3.Distance(new Vector3(x, 0f, z), new Vector3(65f, 0f, 42f)) < 13f)
                {
                    continue;
                }

                var scale = Random.Range(0.75f, 1.45f);
                CreateTree($"Forest_Tree_{i}", new Vector3(x, 0.75f, z), scale, forest.transform, materials);
            }

            CreateTreeHouse("Forest_TreeHouse_A", new Vector3(41f, 0.75f, 62f), forest.transform, materials);
            CreateTreeHouse("Forest_TreeHouse_B", new Vector3(95f, 0.75f, 30f), forest.transform, materials);
            CreateBridge("Forest_RopeBridge", new Vector3(68f, 11f, 47f), new Vector3(34f, 1.2f, 4f), forest.transform, materials);
            CreateCannon("Forest_Cannon", new Vector3(72f, 1f, 8f), Quaternion.Euler(0f, -20f, 0f), forest.transform, materials);
            CreatePlane("Vehicle_Plane_Forest", new Vector3(112f, 2.2f, -7f), Quaternion.Euler(0f, -30f, 0f), forest.transform, materials);

            for (var i = 0; i < 20; i++)
            {
                CreateRock($"Forest_Rock_{i}", new Vector3(Random.Range(5f, 128f), 0.8f, Random.Range(-2f, 100f)), Random.Range(0.8f, 2.4f), forest.transform, materials);
            }

            AddMarker("VehicleSpawn_Forest_Plane", new Vector3(112f, 1.1f, -7f), forest.transform, VehicleSpawns);
            AddMarker("EventAnchor_Forest_Storm", new Vector3(66f, 1f, 70f), forest.transform, EventAnchors);
        }

        private static void BuildBeach(Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var beach = new GameObject("Zone_Beach");
            beach.transform.SetParent(parent);

            var water = CreateBox("Beach_Water_ColliderSurface", new Vector3(0f, 0.45f, -132f), new Vector3(255f, 0.4f, 58f), materials["Water"], beach.transform);
            water.GetComponent<BoxCollider>().isTrigger = false;

            for (var i = 0; i < 5; i++)
            {
                CreateWave($"Beach_Wave_{i}", new Vector3(-95f + i * 47f, 1.1f, -107f - Random.Range(0f, 15f)), beach.transform, materials);
            }

            CreateDock("Beach_Dock", new Vector3(-34f, 0.9f, -99f), beach.transform, materials);
            CreateJetski("Vehicle_Jetski_Beach", new Vector3(-20f, 1.2f, -117f), Quaternion.Euler(0f, 18f, 0f), beach.transform, materials);
            CreateCar("Vehicle_Quadricycle_Beach", new Vector3(30f, 1f, -82f), Quaternion.Euler(0f, -50f, 0f), beach.transform, materials["VehicleGreen"], materials);
            CreatePlane("Vehicle_Plane_Beach", new Vector3(76f, 2.2f, -70f), Quaternion.Euler(0f, 14f, 0f), beach.transform, materials);

            for (var i = 0; i < 26; i++)
            {
                CreatePalm($"Beach_Palm_{i}", new Vector3(Random.Range(-115f, 115f), 0.75f, Random.Range(-100f, -51f)), Random.Range(0.75f, 1.4f), beach.transform, materials);
            }

            for (var i = 0; i < 22; i++)
            {
                CreateRock($"Beach_Rock_{i}", new Vector3(Random.Range(-120f, 120f), 0.8f, Random.Range(-112f, -42f)), Random.Range(0.55f, 1.6f), beach.transform, materials);
            }

            AddMarker("VehicleSpawn_Beach_Jetski", new Vector3(-20f, 1.2f, -117f), beach.transform, VehicleSpawns);
            AddMarker("VehicleSpawn_Beach_Quad", new Vector3(30f, 1.1f, -82f), beach.transform, VehicleSpawns);
            AddMarker("EventAnchor_Beach_Tsunami", new Vector3(0f, 1.2f, -144f), beach.transform, EventAnchors);
        }

        private static void BuildArenaConnectors(Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var connectors = new GameObject("Arena_Connectors");
            connectors.transform.SetParent(parent);

            CreateRoad("Connector_City_To_Plaza", new Vector3(-35f, 0.74f, 15f), new Vector3(70f, 0.16f, 10f), connectors.transform, materials);
            CreateRoad("Connector_Plaza_To_Forest", new Vector3(43f, 0.74f, 16f), new Vector3(80f, 0.16f, 10f), connectors.transform, materials);
            CreateRoad("Connector_Plaza_To_Beach", new Vector3(0f, 0.74f, -45f), new Vector3(12f, 0.16f, 92f), connectors.transform, materials);

            CreateBox("Central_Cover_Block_A", new Vector3(-12f, 2f, 5f), new Vector3(4f, 4f, 11f), materials["DarkConcrete"], connectors.transform);
            CreateBox("Central_Cover_Block_B", new Vector3(12f, 2f, -8f), new Vector3(5f, 4f, 9f), materials["DarkConcrete"], connectors.transform);
            CreateRampSet("Central_Combat_Ramps", new Vector3(0f, 0.9f, 20f), connectors.transform, materials);
        }

        private static void BuildMapBounds(Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var bounds = new GameObject("Map_Collision_Bounds");
            bounds.transform.SetParent(parent);

            CreateBox("Bounds_North", new Vector3(0f, 7f, 124f), new Vector3(260f, 14f, 5f), materials["Wall"], bounds.transform);
            CreateBox("Bounds_South", new Vector3(0f, 7f, -158f), new Vector3(260f, 14f, 5f), materials["Wall"], bounds.transform);
            CreateBox("Bounds_West", new Vector3(-132f, 7f, -15f), new Vector3(5f, 14f, 285f), materials["Wall"], bounds.transform);
            CreateBox("Bounds_East", new Vector3(132f, 7f, -15f), new Vector3(5f, 14f, 285f), materials["Wall"], bounds.transform);
        }

        private static void CreateSpawns(Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var spawns = new GameObject("Spawns_And_Loot");
            spawns.transform.SetParent(parent);

            var spawnPositions = new[]
            {
                new Vector3(-95f, 1.1f, 62f),
                new Vector3(-88f, 1.1f, -20f),
                new Vector3(52f, 1.1f, 72f),
                new Vector3(102f, 1.1f, 18f),
                new Vector3(-64f, 1.1f, -84f),
                new Vector3(72f, 1.1f, -78f),
                new Vector3(-12f, 1.1f, 22f),
                new Vector3(16f, 1.1f, -18f)
            };

            for (var i = 0; i < spawnPositions.Length; i++)
            {
                AddMarker($"PlayerSpawn_{i + 1:00}", spawnPositions[i], spawns.transform, PlayerSpawns, materials["Spawn"], 1.4f);
            }

            for (var i = 0; i < 18; i++)
            {
                var x = Random.Range(-110f, 110f);
                var z = Random.Range(-104f, 98f);
                AddMarker($"LootSpawn_{i + 1:00}", new Vector3(x, 1.05f, z), spawns.transform, LootSpawns, materials["Loot"], 0.85f);
            }
        }

        private static void CreateLightingRig(Transform parent)
        {
            var lightObject = new GameObject("Sun_Dynamic");
            lightObject.transform.SetParent(parent);
            lightObject.transform.rotation = Quaternion.Euler(45f, -35f, 0f);

            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.15f;
            light.shadows = LightShadows.Soft;
            light.shadowStrength = 0.55f;

            var cycle = lightObject.AddComponent<ArenaLightingCycle>();
            var serialized = new SerializedObject(cycle);
            serialized.FindProperty("sun").objectReferenceValue = light;
            serialized.ApplyModifiedPropertiesWithoutUndo();

            var cameraLight = new GameObject("Soft_Fill_Light");
            cameraLight.transform.SetParent(parent);
            cameraLight.transform.position = new Vector3(0f, 40f, -80f);
            var fill = cameraLight.AddComponent<Light>();
            fill.type = LightType.Point;
            fill.range = 170f;
            fill.intensity = 1.8f;
            fill.color = new Color(0.45f, 0.58f, 0.75f);
        }

        private static void CreatePreviewPlayer(Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var player = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            player.name = "Preview_Player_Controller";
            player.transform.SetParent(parent);
            player.transform.position = new Vector3(0f, 3.2f, 10f);
            player.transform.localScale = new Vector3(0.7f, 1.05f, 0.7f);
            player.GetComponent<Renderer>().sharedMaterial = materials["VehicleBlue"];
            Object.DestroyImmediate(player.GetComponent<CapsuleCollider>());

            var controller = player.AddComponent<CharacterController>();
            controller.height = 2f;
            controller.radius = 0.42f;
            controller.center = new Vector3(0f, 1f, 0f);
            controller.stepOffset = 0.45f;
            controller.slopeLimit = 50f;

            var pivot = new GameObject("CameraPivot");
            pivot.transform.SetParent(player.transform, false);
            pivot.transform.localPosition = new Vector3(0f, 1.55f, 0f);

            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            cameraObject.transform.SetParent(pivot.transform, false);
            cameraObject.transform.localPosition = new Vector3(0f, 1.4f, -5.5f);
            var camera = cameraObject.AddComponent<Camera>();
            camera.fieldOfView = 68f;
            camera.farClipPlane = 500f;
            cameraObject.AddComponent<AudioListener>();

            var preview = player.AddComponent<ArenaPreviewController>();
            var serialized = new SerializedObject(preview);
            serialized.FindProperty("cameraPivot").objectReferenceValue = pivot.transform;
            serialized.FindProperty("playerCamera").objectReferenceValue = camera;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void CreateRoad(string name, Vector3 position, Vector3 scale, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            CreateBox(name, position, scale, materials["Asphalt"], parent);
            if (scale.x > scale.z)
            {
                CreateBox($"{name}_Line", position + Vector3.up * 0.09f, new Vector3(scale.x * 0.9f, 0.04f, 0.45f), materials["RoadLine"], parent, false);
            }
            else
            {
                CreateBox($"{name}_Line", position + Vector3.up * 0.09f, new Vector3(0.45f, 0.04f, scale.z * 0.9f), materials["RoadLine"], parent, false);
            }
        }

        private static GameObject CreateBuilding(string name, Vector3 position, Vector3 scale, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;

            CreateBox("Body", new Vector3(0f, scale.y * 0.5f, 0f), scale, materials["Concrete"], root.transform);
            CreateBox("Roof", new Vector3(0f, scale.y + 0.45f, 0f), new Vector3(scale.x * 1.06f, 0.9f, scale.z * 1.06f), materials["DarkConcrete"], root.transform);

            var windowRows = Mathf.Max(2, Mathf.FloorToInt(scale.y / 4.8f));
            for (var row = 0; row < windowRows; row++)
            {
                var y = 3.2f + row * 4f;
                for (var i = -1; i <= 1; i++)
                {
                    CreateBox($"Window_F_{row}_{i}", new Vector3(i * scale.x * 0.24f, y, -scale.z * 0.505f), new Vector3(1.45f, 1.2f, 0.08f), materials["Glass"], root.transform, false);
                    CreateBox($"Window_B_{row}_{i}", new Vector3(i * scale.x * 0.24f, y, scale.z * 0.505f), new Vector3(1.45f, 1.2f, 0.08f), materials["Glass"], root.transform, false);
                }
            }

            return root;
        }

        private static void CreateHouse(string name, Vector3 position, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;

            var sx = Random.Range(8f, 12f);
            var sz = Random.Range(7f, 11f);
            var sy = Random.Range(5f, 7f);
            CreateBox("House_Body", new Vector3(0f, sy * 0.5f, 0f), new Vector3(sx, sy, sz), materials["Wall"], root.transform);
            CreateRoof("House_Roof", new Vector3(0f, sy + 1.1f, 0f), new Vector3(sx * 1.18f, 2.2f, sz * 1.22f), materials["Roof"], root.transform);
            CreateBox("Door", new Vector3(0f, 1.4f, -sz * 0.51f), new Vector3(1.4f, 2.8f, 0.12f), materials["Wood"], root.transform, false);
            CreateBox("Window_L", new Vector3(-sx * 0.25f, 2.9f, -sz * 0.52f), new Vector3(1.2f, 1.1f, 0.1f), materials["Glass"], root.transform, false);
            CreateBox("Window_R", new Vector3(sx * 0.25f, 2.9f, -sz * 0.52f), new Vector3(1.2f, 1.1f, 0.1f), materials["Glass"], root.transform, false);
        }

        private static void CreateRoof(string name, Vector3 localPosition, Vector3 scale, Material material, Transform parent)
        {
            var roof = new GameObject(name);
            roof.transform.SetParent(parent, false);
            roof.transform.localPosition = localPosition;

            var meshFilter = roof.AddComponent<MeshFilter>();
            var meshRenderer = roof.AddComponent<MeshRenderer>();
            meshRenderer.sharedMaterial = material;

            var hx = scale.x * 0.5f;
            var hz = scale.z * 0.5f;
            var hy = scale.y * 0.5f;
            var vertices = new[]
            {
                new Vector3(-hx, -hy, -hz),
                new Vector3(hx, -hy, -hz),
                new Vector3(hx, -hy, hz),
                new Vector3(-hx, -hy, hz),
                new Vector3(0f, hy, -hz),
                new Vector3(0f, hy, hz)
            };
            var triangles = new[]
            {
                0, 4, 1,
                3, 2, 5,
                0, 3, 5,
                0, 5, 4,
                1, 4, 5,
                1, 5, 2,
                0, 1, 2,
                0, 2, 3
            };

            var mesh = new Mesh { name = $"{name}_Mesh", vertices = vertices, triangles = triangles };
            mesh.RecalculateNormals();
            meshFilter.sharedMesh = mesh;
            var collider = roof.AddComponent<MeshCollider>();
            collider.sharedMesh = mesh;
        }

        private static void CreateTree(string name, Vector3 position, float scale, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;
            root.transform.localScale = Vector3.one * scale;

            CreateCylinder("Trunk", new Vector3(0f, 3.5f, 0f), 0.7f, 7f, materials["Wood"], root.transform);
            CreateCone("Leaves_Low", new Vector3(0f, 7.2f, 0f), 3.5f, 4.3f, materials["Foliage"], root.transform);
            CreateCone("Leaves_High", new Vector3(0f, 9.8f, 0f), 2.7f, 3.7f, materials["FoliageLight"], root.transform);
        }

        private static void CreatePalm(string name, Vector3 position, float scale, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;
            root.transform.localScale = Vector3.one * scale;
            CreateCylinder("Palm_Trunk", new Vector3(0f, 4.5f, 0f), 0.45f, 9f, materials["Wood"], root.transform);

            for (var i = 0; i < 6; i++)
            {
                var leaf = CreateBox($"Palm_Leaf_{i}", new Vector3(0f, 9.3f, 0f), new Vector3(0.55f, 0.25f, 5f), materials["FoliageLight"], root.transform, false);
                leaf.transform.localRotation = Quaternion.Euler(20f, i * 60f, 0f);
                leaf.transform.localPosition += leaf.transform.localRotation * new Vector3(0f, 0f, 2.2f);
            }
        }

        private static void CreateTreeHouse(string name, Vector3 position, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;

            CreateTree("Treehouse_Tree", Vector3.zero, 1.45f, root.transform, materials);
            CreateBox("Treehouse_Platform", new Vector3(0f, 9.5f, 0f), new Vector3(11f, 0.7f, 9f), materials["Wood"], root.transform);
            CreateHouse("Treehouse_Cabin", new Vector3(0f, 9.9f, 0f), root.transform, materials);
            CreateBox("Treehouse_Ladder", new Vector3(-5.8f, 5.5f, -4f), new Vector3(0.45f, 10f, 0.45f), materials["Wood"], root.transform);
        }

        private static void CreateBridge(string name, Vector3 position, Vector3 scale, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var bridge = new GameObject(name);
            bridge.transform.SetParent(parent);
            bridge.transform.localPosition = position;
            CreateBox("Bridge_Walkway", Vector3.zero, scale, materials["Wood"], bridge.transform);
            CreateBox("Bridge_Rail_L", new Vector3(0f, 1.2f, -scale.z * 0.55f), new Vector3(scale.x, 1.8f, 0.25f), materials["Wood"], bridge.transform);
            CreateBox("Bridge_Rail_R", new Vector3(0f, 1.2f, scale.z * 0.55f), new Vector3(scale.x, 1.8f, 0.25f), materials["Wood"], bridge.transform);
        }

        private static void CreateCar(string name, Vector3 position, Quaternion rotation, Transform parent, Material bodyMaterial, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;
            root.transform.rotation = rotation;
            CreateBox("Car_Body", new Vector3(0f, 1.1f, 0f), new Vector3(4.6f, 1.4f, 7f), bodyMaterial, root.transform);
            CreateBox("Car_Cabin", new Vector3(0f, 2.2f, -0.8f), new Vector3(3.6f, 1.5f, 3.2f), materials["Glass"], root.transform);
            CreateBox("Car_Hood", new Vector3(0f, 1.8f, 2.65f), new Vector3(4.2f, 0.55f, 2.3f), bodyMaterial, root.transform);
            CreateWheelSet(root.transform, materials);
        }

        private static void CreateBike(string name, Vector3 position, Quaternion rotation, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;
            root.transform.rotation = rotation;
            CreateBox("Bike_Frame", new Vector3(0f, 1.4f, 0f), new Vector3(1.1f, 0.65f, 4f), materials["VehicleGreen"], root.transform);
            CreateBox("Bike_Seat", new Vector3(0f, 2f, -0.5f), new Vector3(1.2f, 0.35f, 1.6f), materials["Metal"], root.transform);
            CreateCylinder("Bike_Wheel_F", new Vector3(0f, 0.8f, 1.9f), 0.9f, 0.35f, materials["Metal"], root.transform, Quaternion.Euler(90f, 0f, 0f));
            CreateCylinder("Bike_Wheel_B", new Vector3(0f, 0.8f, -1.9f), 0.9f, 0.35f, materials["Metal"], root.transform, Quaternion.Euler(90f, 0f, 0f));
        }

        private static void CreatePlane(string name, Vector3 position, Quaternion rotation, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;
            root.transform.rotation = rotation;
            CreateBox("Plane_Body", new Vector3(0f, 1.2f, 0f), new Vector3(3.2f, 2.2f, 12f), materials["VehicleGreen"], root.transform);
            CreateBox("Plane_Wing", new Vector3(0f, 1.1f, 0.4f), new Vector3(16f, 0.35f, 3f), materials["VehicleGreen"], root.transform);
            CreateBox("Plane_Tail", new Vector3(0f, 2.4f, -5f), new Vector3(5.6f, 0.28f, 2f), materials["VehicleGreen"], root.transform);
            CreateBox("Plane_Nose", new Vector3(0f, 1.2f, 6.25f), new Vector3(2.1f, 1.5f, 1f), materials["Metal"], root.transform);
        }

        private static void CreateJetski(string name, Vector3 position, Quaternion rotation, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;
            root.transform.rotation = rotation;
            CreateBox("Jetski_Hull", new Vector3(0f, 0.8f, 0f), new Vector3(2.4f, 0.75f, 4.8f), materials["VehicleBlue"], root.transform);
            CreateBox("Jetski_Seat", new Vector3(0f, 1.35f, -0.5f), new Vector3(1.2f, 0.55f, 2f), materials["Metal"], root.transform);
            CreateBox("Jetski_Handle", new Vector3(0f, 1.9f, 1.1f), new Vector3(2.2f, 0.25f, 0.25f), materials["Metal"], root.transform);
        }

        private static void CreateCannon(string name, Vector3 position, Quaternion rotation, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;
            root.transform.rotation = rotation;
            CreateCylinder("Cannon_Barrel", new Vector3(0f, 2.2f, 0f), 0.8f, 4.8f, materials["Metal"], root.transform, Quaternion.Euler(72f, 0f, 0f));
            CreateBox("Cannon_Base", new Vector3(0f, 0.7f, 0f), new Vector3(3.2f, 1.2f, 3.2f), materials["Wood"], root.transform);
            CreateCylinder("Cannon_Wheel_L", new Vector3(-1.9f, 0.8f, 0f), 0.75f, 0.35f, materials["Wood"], root.transform, Quaternion.Euler(0f, 0f, 90f));
            CreateCylinder("Cannon_Wheel_R", new Vector3(1.9f, 0.8f, 0f), 0.75f, 0.35f, materials["Wood"], root.transform, Quaternion.Euler(0f, 0f, 90f));
        }

        private static void CreateDock(string name, Vector3 position, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var dock = new GameObject(name);
            dock.transform.SetParent(parent);
            dock.transform.localPosition = position;
            CreateBox("Dock_Planks", Vector3.zero, new Vector3(34f, 0.55f, 7f), materials["Wood"], dock.transform);
            for (var i = 0; i < 8; i++)
            {
                CreateCylinder($"Dock_Post_{i}", new Vector3(-16f + i * 4.6f, -1.6f, -3.2f), 0.28f, 4f, materials["Wood"], dock.transform);
                CreateCylinder($"Dock_Post_B_{i}", new Vector3(-16f + i * 4.6f, -1.6f, 3.2f), 0.28f, 4f, materials["Wood"], dock.transform);
            }
        }

        private static void CreateWave(string name, Vector3 position, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var wave = new GameObject(name);
            wave.transform.SetParent(parent);
            wave.transform.localPosition = position;
            CreateBox("Wave_Base", new Vector3(0f, 0f, 0f), new Vector3(28f, 1.1f, 1.6f), materials["Water"], wave.transform, false);
            CreateBox("Wave_Foam", new Vector3(0f, 0.85f, -0.5f), new Vector3(26f, 0.28f, 0.42f), materials["Foam"], wave.transform, false);
        }

        private static void CreateRock(string name, Vector3 position, float scale, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var rock = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            rock.name = name;
            rock.transform.SetParent(parent);
            rock.transform.localPosition = position;
            rock.transform.localScale = new Vector3(scale * 1.4f, scale * 0.8f, scale);
            rock.transform.rotation = Random.rotationUniform;
            rock.GetComponent<Renderer>().sharedMaterial = materials["Cliff"];
            rock.isStatic = true;
        }

        private static void CreateRampSet(string name, Vector3 position, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;
            var left = CreateBox("Ramp_Left", new Vector3(-5f, 1f, 0f), new Vector3(8f, 0.7f, 12f), materials["Concrete"], root.transform);
            left.transform.localRotation = Quaternion.Euler(0f, 0f, -12f);
            var right = CreateBox("Ramp_Right", new Vector3(5f, 1f, 0f), new Vector3(8f, 0.7f, 12f), materials["Concrete"], root.transform);
            right.transform.localRotation = Quaternion.Euler(0f, 0f, 12f);
            CreateBox("Ramp_Cover", new Vector3(0f, 2.2f, 0f), new Vector3(3f, 2.8f, 11f), materials["DarkConcrete"], root.transform);
        }

        private static void CreateStreetLight(string name, Vector3 position, Transform parent, IReadOnlyDictionary<string, Material> materials)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;
            CreateCylinder("Pole", new Vector3(0f, 3f, 0f), 0.14f, 6f, materials["Metal"], root.transform);
            CreateBox("Arm", new Vector3(0.9f, 6f, 0f), new Vector3(1.8f, 0.12f, 0.12f), materials["Metal"], root.transform);
            var light = CreateBox("Lamp", new Vector3(1.8f, 5.8f, 0f), new Vector3(0.55f, 0.25f, 0.55f), materials["Loot"], root.transform, false);
            var point = light.AddComponent<Light>();
            point.type = LightType.Point;
            point.color = new Color(1f, 0.78f, 0.35f);
            point.range = 12f;
            point.intensity = 1.6f;
        }

        private static void CreateWheelSet(Transform root, IReadOnlyDictionary<string, Material> materials)
        {
            CreateCylinder("Wheel_FL", new Vector3(-2.4f, 0.58f, 2.25f), 0.72f, 0.46f, materials["Metal"], root, Quaternion.Euler(0f, 0f, 90f));
            CreateCylinder("Wheel_FR", new Vector3(2.4f, 0.58f, 2.25f), 0.72f, 0.46f, materials["Metal"], root, Quaternion.Euler(0f, 0f, 90f));
            CreateCylinder("Wheel_BL", new Vector3(-2.4f, 0.58f, -2.25f), 0.72f, 0.46f, materials["Metal"], root, Quaternion.Euler(0f, 0f, 90f));
            CreateCylinder("Wheel_BR", new Vector3(2.4f, 0.58f, -2.25f), 0.72f, 0.46f, materials["Metal"], root, Quaternion.Euler(0f, 0f, 90f));
        }

        private static void CreateMountainMesh(string name, Vector3 position, float size, float height, Transform parent, Material material)
        {
            const int cells = 8;
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            var half = size * 0.5f;

            for (var z = 0; z <= cells; z++)
            {
                for (var x = 0; x <= cells; x++)
                {
                    var px = Mathf.Lerp(-half, half, x / (float)cells);
                    var pz = Mathf.Lerp(-half, half, z / (float)cells);
                    var dist = new Vector2(px / half, pz / half).magnitude;
                    var ridge = Mathf.Clamp01(1f - dist);
                    var py = Mathf.Pow(ridge, 1.8f) * height + Random.Range(-1.2f, 1.2f);
                    vertices.Add(new Vector3(px, py, pz));
                }
            }

            for (var z = 0; z < cells; z++)
            {
                for (var x = 0; x < cells; x++)
                {
                    var i = z * (cells + 1) + x;
                    triangles.Add(i);
                    triangles.Add(i + cells + 1);
                    triangles.Add(i + 1);
                    triangles.Add(i + 1);
                    triangles.Add(i + cells + 1);
                    triangles.Add(i + cells + 2);
                }
            }

            var mesh = new Mesh { name = $"{name}_Mesh" };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();

            var root = new GameObject(name);
            root.transform.SetParent(parent);
            root.transform.localPosition = position;
            var filter = root.AddComponent<MeshFilter>();
            var renderer = root.AddComponent<MeshRenderer>();
            filter.sharedMesh = mesh;
            renderer.sharedMaterial = material;
            var collider = root.AddComponent<MeshCollider>();
            collider.sharedMesh = mesh;
            root.isStatic = true;
        }

        private static GameObject CreateBox(string name, Vector3 localPosition, Vector3 scale, Material material, Transform parent, bool collider = true)
        {
            var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
            box.name = name;
            box.transform.SetParent(parent, false);
            box.transform.localPosition = localPosition;
            box.transform.localScale = scale;
            box.GetComponent<Renderer>().sharedMaterial = material;

            if (!collider)
            {
                Object.DestroyImmediate(box.GetComponent<BoxCollider>());
            }

            box.isStatic = true;
            return box;
        }

        private static GameObject CreateCylinder(string name, Vector3 localPosition, float radius, float height, Material material, Transform parent, Quaternion? localRotation = null)
        {
            var cylinder = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            cylinder.name = name;
            cylinder.transform.SetParent(parent, false);
            cylinder.transform.localPosition = localPosition;
            cylinder.transform.localScale = new Vector3(radius, height * 0.5f, radius);
            cylinder.transform.localRotation = localRotation ?? Quaternion.identity;
            cylinder.GetComponent<Renderer>().sharedMaterial = material;
            cylinder.isStatic = true;
            return cylinder;
        }

        private static GameObject CreateCone(string name, Vector3 localPosition, float radius, float height, Material material, Transform parent)
        {
            var cone = new GameObject(name);
            cone.transform.SetParent(parent, false);
            cone.transform.localPosition = localPosition;

            var mesh = new Mesh { name = $"{name}_Mesh" };
            const int sides = 8;
            var vertices = new List<Vector3> { new Vector3(0f, height * 0.5f, 0f), new Vector3(0f, -height * 0.5f, 0f) };
            for (var i = 0; i < sides; i++)
            {
                var angle = i / (float)sides * Mathf.PI * 2f;
                vertices.Add(new Vector3(Mathf.Cos(angle) * radius, -height * 0.5f, Mathf.Sin(angle) * radius));
            }

            var triangles = new List<int>();
            for (var i = 0; i < sides; i++)
            {
                var current = 2 + i;
                var next = 2 + (i + 1) % sides;
                triangles.Add(0);
                triangles.Add(current);
                triangles.Add(next);
                triangles.Add(1);
                triangles.Add(next);
                triangles.Add(current);
            }

            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();

            var filter = cone.AddComponent<MeshFilter>();
            var renderer = cone.AddComponent<MeshRenderer>();
            filter.sharedMesh = mesh;
            renderer.sharedMaterial = material;
            var collider = cone.AddComponent<MeshCollider>();
            collider.sharedMesh = mesh;
            cone.isStatic = true;
            return cone;
        }

        private static Transform AddMarker(string name, Vector3 position, Transform parent, List<Transform> list, Material material = null, float radius = 0.5f)
        {
            GameObject marker;
            if (material != null)
            {
                marker = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                marker.transform.localScale = new Vector3(radius, 0.08f, radius);
                marker.GetComponent<Renderer>().sharedMaterial = material;
                Object.DestroyImmediate(marker.GetComponent<CapsuleCollider>());
            }
            else
            {
                marker = new GameObject(name);
            }

            marker.name = name;
            marker.transform.SetParent(parent);
            marker.transform.position = position;
            list.Add(marker.transform);
            return marker.transform;
        }
    }
}
