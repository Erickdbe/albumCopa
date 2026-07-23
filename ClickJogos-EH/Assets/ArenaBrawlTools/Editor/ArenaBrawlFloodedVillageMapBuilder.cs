#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

[InitializeOnLoad]
public static class ArenaBrawlFloodedVillageMapBuilder
{
    private const string OutputScenePath = "Assets/ArenaBrawlTools/GeneratedScenes/ArenaBrawl_FloodedVillage.unity";
    private const string OutputTerrainPath = "Assets/ArenaBrawlTools/GeneratedScenes/ArenaBrawl_FloodedVillage_Terrain.asset";
    private const string BuiltMarkerPath = "Assets/ArenaBrawlTools/GeneratedScenes/.flooded-village-v11-built";
    private const string SourceShowcaseScenePath = "Assets/Flooded_Grounds/Scenes/PreAsembeld_Buildings.unity";
    private const string SessionKey = "ArenaBrawl.FloodedVillageMapBuilder.v12";

    private const float TerrainSize = 520f;
    private const float HalfSize = TerrainSize * 0.5f;
    private const float TerrainHeight = 46f;
    private const float WaterHeight = 3.05f;
    private const int HeightResolution = 513;
    private const int AlphaResolution = 384;

    private static readonly Dictionary<string, GameObject> PrefabCache = new Dictionary<string, GameObject>();
    private static Terrain ActiveTerrain;

    static ArenaBrawlFloodedVillageMapBuilder()
    {
        EditorApplication.delayCall += AutoBuildOnce;
    }

    [MenuItem("Arena Brawl/Build Flooded Village Survival Map")]
    public static void BuildFromMenu()
    {
        BuildFloodedVillageScene(force: true);
    }

    private static void AutoBuildOnce()
    {
        if (SessionState.GetBool(SessionKey, false) || File.Exists(BuiltMarkerPath))
        {
            return;
        }

        SessionState.SetBool(SessionKey, true);
        Debug.Log("[ArenaBrawlFloodedVillageMapBuilder] Auto-build queued for flooded village scene.");
        BuildFloodedVillageScene(force: false);
    }

    private static void BuildFloodedVillageScene(bool force)
    {
        if (EditorApplication.isCompiling || EditorApplication.isUpdating)
        {
            EditorApplication.delayCall += () => BuildFloodedVillageScene(force);
            return;
        }

        Debug.Log("[ArenaBrawlFloodedVillageMapBuilder] Building flooded village scene...");
        EnsureOutputFolder();
        PrefabCache.Clear();

        if (force)
        {
            AssetDatabase.DeleteAsset(BuiltMarkerPath);
        }

        if (!Application.isBatchMode && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
        {
            Debug.Log("[ArenaBrawlFloodedVillageMapBuilder] Scene generation cancelled before replacing the open scene.");
            return;
        }

        Scene targetScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        targetScene.name = "ArenaBrawl_FloodedVillage";
        SceneManager.SetActiveScene(targetScene);

        Scene sourceScene = EditorSceneManager.OpenScene(SourceShowcaseScenePath, OpenSceneMode.Additive);
        Dictionary<string, GameObject> templates = BuildTemplateLookup(sourceScene);

        GameObject root = new GameObject("ArenaBrawl_FloodedVillage_Map");
        Transform terrainRoot = Group(root.transform, "01_Terrain_Relief_Mud");
        Transform waterRoot = Group(root.transform, "02_Water_Swamp_Puddles");
        Transform pathsRoot = Group(root.transform, "03_Dirt_Paths_Bridges");
        Transform villageRoot = Group(root.transform, "04_Village_Houses");
        Transform mansionRoot = Group(root.transform, "05_Mansion_Hill");
        Transform churchRoot = Group(root.transform, "06_Isolated_Church_Cemetery");
        Transform greenhouseRoot = Group(root.transform, "07_Abandoned_Greenhouse");
        Transform swampRoot = Group(root.transform, "08_Swamp_Docks");
        Transform forestRoot = Group(root.transform, "09_Dense_Forest");
        Transform dressingRoot = Group(root.transform, "10_Props_Fences_Poles");
        Transform atmosphereRoot = Group(root.transform, "11_Lighting_Fog_Camera");

        BuildTerrain(terrainRoot);
        BuildWater(waterRoot);
        BuildPaths(pathsRoot);
        BuildVillage(templates, villageRoot, dressingRoot);
        BuildMansion(templates, mansionRoot, dressingRoot);
        BuildChurch(templates, churchRoot, dressingRoot);
        BuildGreenhouse(templates, greenhouseRoot, dressingRoot);
        BuildSwamp(templates, swampRoot, dressingRoot);
        BuildForest(forestRoot);
        BuildAmbientDressing(dressingRoot);
        BuildAtmosphere(atmosphereRoot);
        BuildGameplayMarkers(root.transform);
        FixSceneMaterials(root);
        ApplyCinematicMaterialTone(root);

        if (sourceScene.IsValid())
        {
            EditorSceneManager.CloseScene(sourceScene, removeScene: true);
        }

        EditorSceneManager.MarkSceneDirty(targetScene);
        EditorSceneManager.SaveScene(targetScene, OutputScenePath);
        File.WriteAllText(BuiltMarkerPath, DateTime.Now.ToString("O"));
        AssetDatabase.ImportAsset(BuiltMarkerPath);
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();

        EditorSceneManager.OpenScene(OutputScenePath, OpenSceneMode.Single);
        FrameGeneratedMap();
        Debug.Log($"[ArenaBrawlFloodedVillageMapBuilder] Generated flooded survival village at {OutputScenePath}");
    }

    private static Transform Group(Transform parent, string name)
    {
        GameObject group = new GameObject(name);
        group.transform.SetParent(parent);
        return group.transform;
    }

    private static void EnsureOutputFolder()
    {
        if (!AssetDatabase.IsValidFolder("Assets/ArenaBrawlTools"))
        {
            AssetDatabase.CreateFolder("Assets", "ArenaBrawlTools");
        }

        if (!AssetDatabase.IsValidFolder("Assets/ArenaBrawlTools/GeneratedScenes"))
        {
            AssetDatabase.CreateFolder("Assets/ArenaBrawlTools", "GeneratedScenes");
        }
    }

    private static Dictionary<string, GameObject> BuildTemplateLookup(Scene sourceScene)
    {
        Dictionary<string, GameObject> templates = new Dictionary<string, GameObject>();
        foreach (GameObject root in sourceScene.GetRootGameObjects())
        {
            AddTemplate(root, templates);
        }

        return templates;
    }

    private static void AddTemplate(GameObject obj, Dictionary<string, GameObject> templates)
    {
        if (!templates.ContainsKey(obj.name))
        {
            templates.Add(obj.name, obj);
        }

        foreach (Transform child in obj.transform)
        {
            AddTemplate(child.gameObject, templates);
        }
    }

    private static GameObject Prefab(string path)
    {
        if (!PrefabCache.TryGetValue(path, out GameObject prefab))
        {
            prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null)
            {
                Debug.LogWarning($"[ArenaBrawlFloodedVillageMapBuilder] Missing prefab: {path}");
            }

            PrefabCache[path] = prefab;
        }

        return prefab;
    }

    private static GameObject SpawnPrefab(Transform parent, string prefabPath, Vector2 xz, float yaw, float scale, string name = null, float yOffset = 0f, bool collidable = true)
    {
        GameObject prefab = Prefab(prefabPath);
        GameObject instance = prefab != null
            ? (GameObject)PrefabUtility.InstantiatePrefab(prefab)
            : GameObject.CreatePrimitive(PrimitiveType.Cube);

        instance.name = name ?? (prefab != null ? prefab.name : "MissingPrefab_Proxy");
        instance.transform.SetParent(parent);
        instance.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
        instance.transform.localScale = Vector3.one * scale;
        AlignToTerrain(instance, xz, yOffset);
        if (collidable)
        {
            EnsureCollider(instance);
        }

        return instance;
    }

    private static GameObject SpawnTemplate(Dictionary<string, GameObject> templates, Transform parent, string templateName, Vector2 xz, float yaw, float scale, string name = null, float yOffset = 0f)
    {
        if (!templates.TryGetValue(templateName, out GameObject template))
        {
            Debug.LogWarning($"[ArenaBrawlFloodedVillageMapBuilder] Missing template in showcase scene: {templateName}");
            GameObject proxy = GameObject.CreatePrimitive(PrimitiveType.Cube);
            proxy.name = name ?? $"{templateName}_Proxy";
            proxy.transform.SetParent(parent);
            proxy.transform.localScale = new Vector3(8f, 6f, 8f) * scale;
            proxy.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            AlignToTerrain(proxy, xz, yOffset);
            return proxy;
        }

        GameObject instance = UnityEngine.Object.Instantiate(template);
        instance.name = name ?? templateName;
        SceneManager.MoveGameObjectToScene(instance, SceneManager.GetActiveScene());
        instance.transform.SetParent(parent);
        instance.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
        instance.transform.localScale = template.transform.localScale * scale;
        AlignToTerrain(instance, xz, yOffset);
        EnsureCollider(instance);
        return instance;
    }

    private static void AlignToTerrain(GameObject instance, Vector2 xz, float yOffset)
    {
        float y = SampleTerrainHeight(xz.x, xz.y) + yOffset;
        instance.transform.position = new Vector3(xz.x, y, xz.y);

        Renderer[] renderers = instance.GetComponentsInChildren<Renderer>();
        if (renderers.Length == 0)
        {
            return;
        }

        Bounds bounds = renderers[0].bounds;
        for (int i = 1; i < renderers.Length; i++)
        {
            bounds.Encapsulate(renderers[i].bounds);
        }

        instance.transform.position += Vector3.up * (y - bounds.min.y);
    }

    private static float SampleTerrainHeight(float x, float z)
    {
        if (ActiveTerrain == null)
        {
            return 0f;
        }

        return ActiveTerrain.SampleHeight(new Vector3(x, 0f, z)) + ActiveTerrain.transform.position.y;
    }

    private static void EnsureCollider(GameObject instance)
    {
        if (instance.GetComponentInChildren<Collider>() != null)
        {
            return;
        }

        foreach (Renderer renderer in instance.GetComponentsInChildren<Renderer>())
        {
            BoxCollider collider = renderer.gameObject.AddComponent<BoxCollider>();
            collider.center = renderer.localBounds.center;
            collider.size = renderer.localBounds.size;
        }
    }

    private static void BuildTerrain(Transform parent)
    {
        AssetDatabase.DeleteAsset(OutputTerrainPath);

        TerrainData terrainData = new TerrainData
        {
            heightmapResolution = HeightResolution,
            alphamapResolution = AlphaResolution,
            size = new Vector3(TerrainSize, TerrainHeight, TerrainSize)
        };

        terrainData.terrainLayers = CreateTerrainLayers();
        terrainData.SetHeights(0, 0, CreateHeights());
        AssetDatabase.CreateAsset(terrainData, OutputTerrainPath);

        GameObject terrainObject = Terrain.CreateTerrainGameObject(terrainData);
        terrainObject.name = "Terrain_Relief_Textured_Mud_Paths";
        terrainObject.transform.position = new Vector3(-HalfSize, 0f, -HalfSize);
        terrainObject.transform.SetParent(parent);

        ActiveTerrain = terrainObject.GetComponent<Terrain>();
        ActiveTerrain.drawInstanced = true;
        ActiveTerrain.heightmapPixelError = 2.8f;
        ActiveTerrain.basemapDistance = 900f;
        ActiveTerrain.detailObjectDistance = 95f;
        ActiveTerrain.treeDistance = 650f;
        ActiveTerrain.Flush();

        TerrainCollider collider = terrainObject.GetComponent<TerrainCollider>();
        if (collider != null)
        {
            collider.terrainData = terrainData;
        }

        terrainData.SetAlphamaps(0, 0, CreateAlphamaps(terrainData.terrainLayers.Length));
        EditorUtility.SetDirty(terrainData);
    }

    private static TerrainLayer[] CreateTerrainLayers()
    {
        return new[]
        {
            CreateLayer("TL_GrassMoss", "Assets/TerrainSampleAssets/Textures/Terrain/Grass_Moss_BaseColor.tif", "Assets/TerrainSampleAssets/Textures/Terrain/Grass_Moss_Normal.tif", new Vector2(17f, 17f)),
            CreateLayer("TL_GrassSoil", "Assets/TerrainSampleAssets/Textures/Terrain/Grass_Soil_BaseColor.tif", "Assets/TerrainSampleAssets/Textures/Terrain/Grass_Soil_Normal.tif", new Vector2(15f, 15f)),
            CreateLayer("TL_Muddy", "Assets/TerrainSampleAssets/Textures/Terrain/Muddy_BaseColor.tif", "Assets/TerrainSampleAssets/Textures/Terrain/Muddy_Normal.tif", new Vector2(11f, 11f)),
            CreateLayer("TL_TidalPools", "Assets/TerrainSampleAssets/Textures/Terrain/Tidal_Pools_BaseColor.tif", "Assets/TerrainSampleAssets/Textures/Terrain/Tidal_Pools_Normal.tif", new Vector2(14f, 14f)),
            CreateLayer("TL_Pebbles", "Assets/TerrainSampleAssets/Textures/Terrain/Pebbles_B_BaseColor.tif", "Assets/TerrainSampleAssets/Textures/Terrain/Pebbles_B_Normal.tif", new Vector2(9f, 9f)),
            CreateLayer("TL_RockSoil", "Assets/TerrainSampleAssets/Textures/Terrain/Soil_Rocks_BaseColor.tif", "Assets/TerrainSampleAssets/Textures/Terrain/Soil_Rocks_Normal.tif", new Vector2(13f, 13f))
        };
    }

    private static TerrainLayer CreateLayer(string name, string diffusePath, string normalPath, Vector2 tileSize)
    {
        string path = $"Assets/ArenaBrawlTools/GeneratedScenes/{name}.terrainlayer";
        AssetDatabase.DeleteAsset(path);

        TerrainLayer layer = new TerrainLayer
        {
            name = name,
            diffuseTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(diffusePath),
            normalMapTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(normalPath),
            tileSize = tileSize,
            metallic = 0f,
            smoothness = name.Contains("Tidal") || name.Contains("Muddy") ? 0.28f : 0.08f
        };

        AssetDatabase.CreateAsset(layer, path);
        return layer;
    }

    private static float[,] CreateHeights()
    {
        float[,] heights = new float[HeightResolution, HeightResolution];

        for (int z = 0; z < HeightResolution; z++)
        {
            for (int x = 0; x < HeightResolution; x++)
            {
                Vector2 pos = GridToWorld(x, z, HeightResolution);
                float h = 0.104f;
                h += Mathf.PerlinNoise(pos.x * 0.010f + 8.1f, pos.y * 0.010f - 13.4f) * 0.034f;
                h += Mathf.PerlinNoise(pos.x * 0.027f - 3.6f, pos.y * 0.025f + 6.5f) * 0.018f;
                h += Mathf.PerlinNoise(pos.x * 0.061f + 21.2f, pos.y * 0.055f - 17.3f) * 0.006f;

                h += Gaussian(pos, new Vector2(0f, 104f), 92f) * 0.106f;
                h += Gaussian(pos, new Vector2(-48f, 148f), 126f) * 0.043f;
                h += Gaussian(pos, new Vector2(126f, 50f), 72f) * 0.044f;
                h += Gaussian(pos, new Vector2(-112f, 122f), 96f) * 0.034f;
                h += Gaussian(pos, new Vector2(204f, -18f), 95f) * 0.030f;
                h += EdgeHill(pos) * 0.070f;

                h -= Gaussian(pos, new Vector2(-152f, -86f), 104f) * 0.082f;
                h -= Gaussian(pos, new Vector2(-198f, -164f), 72f) * 0.056f;
                h -= Gaussian(pos, new Vector2(108f, -116f), 64f) * 0.024f;
                h -= Gaussian(pos, new Vector2(-20f, -86f), 38f) * 0.018f;

                h = Flatten(h, pos, new Vector2(-35f, -48f), 64f, 0.126f);
                h = Flatten(h, pos, new Vector2(0f, 102f), 56f, 0.199f);
                h = Flatten(h, pos, new Vector2(126f, 42f), 45f, 0.155f);
                h = Flatten(h, pos, new Vector2(124f, -112f), 45f, 0.115f);

                float pathDistance = DistanceToPathNetwork(pos);
                if (pathDistance < 9.5f)
                {
                    float t = Mathf.InverseLerp(9.5f, 1.5f, pathDistance);
                    h -= Mathf.SmoothStep(0f, 0.010f, t);
                }

                heights[z, x] = Mathf.Clamp(h, 0.045f, 0.285f);
            }
        }

        return heights;
    }

    private static float[,,] CreateAlphamaps(int layerCount)
    {
        float[,,] maps = new float[AlphaResolution, AlphaResolution, layerCount];

        for (int z = 0; z < AlphaResolution; z++)
        {
            for (int x = 0; x < AlphaResolution; x++)
            {
                Vector2 pos = GridToWorld(x, z, AlphaResolution);
                float path = 1f - Mathf.Clamp01(DistanceToPathNetwork(pos) / 15.5f);
                float narrowPath = 1f - Mathf.Clamp01(DistanceToPathNetwork(pos) / 5.8f);
                float swamp = Mathf.Max(
                    Gaussian(pos, new Vector2(-152f, -86f), 102f),
                    Gaussian(pos, new Vector2(-198f, -164f), 58f));
                swamp = Mathf.Max(swamp, Gaussian(pos, new Vector2(88f, -134f), 46f) * 0.55f);
                float greenhouseWet = Gaussian(pos, new Vector2(122f, -112f), 55f) * 0.58f;
                float mansionRock = Gaussian(pos, new Vector2(0f, 104f), 64f) * 0.42f;
                float churchSoil = Gaussian(pos, new Vector2(126f, 42f), 44f) * 0.48f;
                float villageSoil = Gaussian(pos, new Vector2(-35f, -48f), 72f) * 0.46f;
                float forestMoss = ForestMask(pos) * 0.78f;
                float noise = Mathf.PerlinNoise(pos.x * 0.045f + 2.5f, pos.y * 0.043f - 5.8f);

                float grassMoss = 0.38f + forestMoss + noise * 0.09f;
                float grassSoil = 0.28f + villageSoil * 0.42f + (1f - noise) * 0.06f;
                float muddy = swamp * 1.05f + path * 0.82f + greenhouseWet;
                float tidal = swamp * 0.72f + greenhouseWet * 0.14f;
                float pebbles = narrowPath * 0.66f + churchSoil * 0.20f;
                float rock = mansionRock + churchSoil * 0.22f + EdgeHill(pos) * 0.28f;

                maps[z, x, 0] = grassMoss;
                maps[z, x, 1] = grassSoil;
                maps[z, x, 2] = muddy;
                maps[z, x, 3] = tidal;
                maps[z, x, 4] = pebbles;
                maps[z, x, 5] = rock;

                Normalize(maps, z, x, layerCount);
            }
        }

        return maps;
    }

    private static void Normalize(float[,,] maps, int z, int x, int count)
    {
        float sum = 0f;
        for (int i = 0; i < count; i++)
        {
            sum += maps[z, x, i];
        }

        if (sum <= 0.0001f)
        {
            maps[z, x, 0] = 1f;
            return;
        }

        for (int i = 0; i < count; i++)
        {
            maps[z, x, i] /= sum;
        }
    }

    private static void BuildWater(Transform parent)
    {
        Material water = AssetDatabase.LoadAssetAtPath<Material>("Assets/Flooded_Grounds/Content/Materials/BGR_Water.mat");
        if (water == null)
        {
            water = CreateTransparentMaterial("Generated_DarkWater", new Color(0.18f, 0.32f, 0.34f, 0.58f), 0.48f);
        }

        CreateWaterPatch(parent, "Swamp_Main_Water", new Vector2(-152f, -88f), 94f, 62f, 31, water, 16f);
        CreateWaterPatch(parent, "Swamp_South_Water", new Vector2(-198f, -164f), 54f, 39f, 22, water, -9f);
        CreateWaterPatch(parent, "Swamp_Creek_North", new Vector2(-98f, -50f), 44f, 13f, 18, water, 28f);
        CreateWaterPatch(parent, "Swamp_Creek_Village", new Vector2(-54f, -78f), 38f, 11f, 18, water, -16f);
        CreateWaterPatch(parent, "Greenhouse_Flooded_Puddle", new Vector2(104f, -126f), 42f, 22f, 18, water, 8f);
        CreateWaterPatch(parent, "Greenhouse_Glasshouse_Wetline", new Vector2(148f, -118f), 32f, 14f, 16, water, -13f);
        CreateWaterPatch(parent, "Village_Road_Puddle_A", new Vector2(-42f, -78f), 24f, 9f, 16, water, -18f);
        CreateWaterPatch(parent, "Village_Road_Puddle_B", new Vector2(12f, -30f), 18f, 8f, 15, water, 23f);
        CreateWaterPatch(parent, "Mansion_Low_Puddle", new Vector2(-38f, 44f), 26f, 11f, 16, water, -4f);
    }

    private static void CreateWaterPatch(Transform parent, string name, Vector2 center, float radiusX, float radiusZ, int segments, Material material, float rotation)
    {
        GameObject go = new GameObject(name);
        go.transform.SetParent(parent);
        go.transform.position = new Vector3(center.x, WaterHeight + 0.015f, center.y);
        go.transform.rotation = Quaternion.Euler(0f, rotation, 0f);

        Mesh mesh = new Mesh { name = $"{name}_Mesh" };
        Vector3[] vertices = new Vector3[segments + 1];
        Vector2[] uvs = new Vector2[vertices.Length];
        int[] triangles = new int[segments * 3];
        vertices[0] = Vector3.zero;
        uvs[0] = new Vector2(0.5f, 0.5f);

        for (int i = 0; i < segments; i++)
        {
            float angle = i / (float)segments * Mathf.PI * 2f;
            float ripple = 0.86f + Mathf.PerlinNoise(center.x * 0.02f + i * 0.37f, center.y * 0.02f) * 0.24f;
            vertices[i + 1] = new Vector3(Mathf.Cos(angle) * radiusX * ripple, 0f, Mathf.Sin(angle) * radiusZ * ripple);
            uvs[i + 1] = new Vector2(Mathf.Cos(angle) * 0.5f + 0.5f, Mathf.Sin(angle) * 0.5f + 0.5f);

            triangles[i * 3] = 0;
            triangles[i * 3 + 1] = i + 1;
            triangles[i * 3 + 2] = i == segments - 1 ? 1 : i + 2;
        }

        mesh.vertices = vertices;
        mesh.uv = uvs;
        mesh.triangles = triangles;
        mesh.RecalculateNormals();
        go.AddComponent<MeshFilter>().sharedMesh = mesh;
        go.AddComponent<MeshRenderer>().sharedMaterial = material;
    }

    private static void BuildPaths(Transform parent)
    {
        string woodPath = "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_WoodPath_A.prefab";
        string bridgeA = "Assets/Flooded_Grounds/Prefabs/Buildings/Bridge/BLD_Bridge_A.prefab";
        string bridgeB = "Assets/Flooded_Grounds/Prefabs/Buildings/Bridge/BLD_Bridge_B.prefab";

        SpawnPrefab(parent, bridgeA, new Vector2(-128f, -112f), 20f, 1.18f, "Swamp_Wood_Bridge_A", 0.15f);
        SpawnPrefab(parent, bridgeB, new Vector2(-92f, -84f), 27f, 1.05f, "Swamp_Wood_Bridge_B", 0.14f);

        PlaceAlongLine(parent, woodPath, new Vector2(-188f, -160f), new Vector2(-128f, -112f), 9f, 0.95f, "Entrance_Plank_Path");
        PlaceAlongLine(parent, woodPath, new Vector2(-58f, -108f), new Vector2(-24f, -58f), 9f, 0.88f, "Village_Plank_Wet_Path");
        PlaceAlongLine(parent, woodPath, new Vector2(72f, -102f), new Vector2(128f, -108f), 9f, 0.85f, "Greenhouse_Plank_Path");
    }

    private static void BuildVillage(Dictionary<string, GameObject> templates, Transform parent, Transform dressing)
    {
        SpawnTemplate(templates, parent, "Pref_Cabin1_A", new Vector2(-76f, -62f), 16f, 1.04f, "Village_Cabin_West");
        SpawnTemplate(templates, parent, "Pref_Cabin2_A", new Vector2(-30f, -78f), -10f, 1.02f, "Village_Cabin_South");
        SpawnTemplate(templates, parent, "Pref_Villa1_A", new Vector2(-32f, -34f), 8f, 0.98f, "Village_House_MainStreet");
        SpawnTemplate(templates, parent, "Pref_Villa1_B", new Vector2(-82f, -22f), 34f, 0.98f, "Village_House_Overgrown");
        SpawnTemplate(templates, parent, "Pref_BrickHouse_A", new Vector2(18f, -55f), -28f, 0.96f, "Village_BrickHouse_Damaged");
        SpawnTemplate(templates, parent, "Pref_Villa2_B", new Vector2(34f, -18f), -17f, 0.92f, "Village_TwoStory_East");
        SpawnTemplate(templates, parent, "Pref_Villa1_C", new Vector2(-8f, 2f), 12f, 0.86f, "Village_House_Reclaimed_By_Moss");
        SpawnTemplate(templates, parent, "Pref_BrickHouse_C", new Vector2(-116f, -12f), 58f, 0.86f, "Village_Collapsed_West_House");
        SpawnTemplate(templates, parent, "Pref_Cabin2_B", new Vector2(5f, -108f), 18f, 0.90f, "Village_Roadside_Cabin");
        SpawnTemplate(templates, parent, "Pref_IndBuilding2_A", new Vector2(78f, -26f), -48f, 0.74f, "Village_Workshop_Ruined");
        SpawnTemplate(templates, parent, "Pref_Barn1_A", new Vector2(-112f, -72f), 79f, 0.92f, "Village_Barn_WestEdge");
        SpawnTemplate(templates, parent, "Pref_Barn2_B", new Vector2(64f, -80f), -50f, 0.92f, "Village_Barn_Utility");
        SpawnTemplate(templates, parent, "Outhouse_A", new Vector2(-102f, -34f), 23f, 0.95f, "Village_Outhouse_Backyard");
        SpawnTemplate(templates, parent, "GuardHouse_A", new Vector2(-18f, -116f), 6f, 0.9f, "Entrance_Guardhouse");

        FenceRect(dressing, new Vector2(-62f, -46f), new Vector2(72f, 78f), 0f, "Village_Broken_Fence");
        FenceLine(dressing, new Vector2(-116f, -94f), new Vector2(-80f, -112f), 7.5f, "Barn_Broken_Fence");
        FenceLine(dressing, new Vector2(50f, -104f), new Vector2(88f, -88f), 7.5f, "Utility_Broken_Fence");

        SpawnPrefab(dressing, "Assets/Flooded_Grounds/Prefabs/Props/Prop_Car1_DM.prefab", new Vector2(-6f, -87f), -22f, 1.05f, "Abandoned_Car_MainRoad");
        SpawnPrefab(dressing, "Assets/Flooded_Grounds/Prefabs/Props/Prop_Car_A.prefab", new Vector2(56f, -42f), 42f, 0.96f, "Half_Submerged_Car");

        AddClutter(dressing, new Vector2(-50f, -48f), 34f, 18);
        AddOvergrowthPatch(dressing, new Vector2(-54f, -44f), 58f, 74, 1902);
        AddOvergrowthPatch(dressing, new Vector2(28f, -70f), 48f, 54, 1903);
    }

    private static void BuildMansion(Dictionary<string, GameObject> templates, Transform parent, Transform dressing)
    {
        SpawnTemplate(templates, parent, "Pref_Villa2_D", new Vector2(4f, 104f), 180f, 1.18f, "Mansion_Decayed_Hilltop", 0.15f);
        SpawnTemplate(templates, parent, "Pref_Villa2_C", new Vector2(-42f, 78f), 157f, 0.85f, "Mansion_Servant_Wing", 0.05f);
        SpawnTemplate(templates, parent, "Pref_Villa2_A", new Vector2(42f, 118f), -162f, 0.90f, "Mansion_East_Wing_Abandoned", 0.05f);
        SpawnTemplate(templates, parent, "Pref_BrickHouse_B", new Vector2(-36f, 132f), 166f, 0.74f, "Mansion_Back_Ruins", 0.02f);
        SpawnPrefab(dressing, "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_ExtStairs_A.prefab", new Vector2(2f, 64f), 180f, 1.1f, "Mansion_Muddy_Stairs", 0.05f);
        SpawnPrefab(dressing, "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_ExtStairs_B.prefab", new Vector2(-26f, 70f), 166f, 0.9f, "Mansion_Side_Stairs_Broken", 0.04f);
        SpawnPrefab(dressing, "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_Roundabout_A.prefab", new Vector2(0f, 55f), 0f, 1.0f, "Mansion_Ruined_Roundabout");

        FenceLine(dressing, new Vector2(-55f, 42f), new Vector2(56f, 44f), 7.5f, "Mansion_Front_Fence");
        FenceLine(dressing, new Vector2(-70f, 74f), new Vector2(-82f, 116f), 7.5f, "Mansion_Left_Fence");
        FenceLine(dressing, new Vector2(70f, 74f), new Vector2(82f, 116f), 7.5f, "Mansion_Right_Fence");

        AddClutter(dressing, new Vector2(-14f, 62f), 28f, 14);
        AddOvergrowthPatch(dressing, new Vector2(4f, 86f), 64f, 72, 3104);
        AddRockOutcrop(dressing, new Vector2(-18f, 66f), 58f, 34, 417);
    }

    private static void BuildChurch(Dictionary<string, GameObject> templates, Transform parent, Transform dressing)
    {
        SpawnTemplate(templates, parent, "Pref_Church1_A", new Vector2(130f, 42f), -132f, 1.12f, "Church_Isolated_Old", 0.08f);
        SpawnTemplate(templates, parent, "Pref_Church1_B", new Vector2(164f, 18f), -104f, 0.84f, "Church_Ruined_SideHall", 0.02f);

        string[] graves =
        {
            "Assets/Flooded_Grounds/Prefabs/Props/Prop_Gravestone_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Props/Prop_Gravestone_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Props/Prop_Gravestone_C.prefab",
            "Assets/Flooded_Grounds/Prefabs/Props/Prop_Gravestone_D.prefab",
            "Assets/Flooded_Grounds/Prefabs/Props/Prop_Gravestone_E.prefab"
        };

        for (int row = 0; row < 4; row++)
        {
            for (int col = 0; col < 5; col++)
            {
                Vector2 p = new Vector2(106f + col * 7.5f + ((row % 2) * 1.8f), 72f + row * 6.4f);
                SpawnPrefab(dressing, graves[(row + col) % graves.Length], p, -140f + (col - 2) * 3f, 0.96f, "Church_Cemetery_Grave");
            }
        }

        FenceRect(dressing, new Vector2(126f, 63f), new Vector2(76f, 52f), -8f, "Church_Cemetery_Fence");
        SpawnPrefab(dressing, "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_Fence1_Gate_A.prefab", new Vector2(92f, 58f), -98f, 1.1f, "Church_Cemetery_Gate");
        AddClutter(dressing, new Vector2(132f, 36f), 24f, 10);
        AddOvergrowthPatch(dressing, new Vector2(128f, 54f), 48f, 58, 4428);
        AddTreeCluster(dressing, new Vector2(164f, 54f), 38f, 18, 1452, 0.78f);
    }

    private static void BuildGreenhouse(Dictionary<string, GameObject> templates, Transform parent, Transform dressing)
    {
        SpawnTemplate(templates, parent, "Pref_GreenHouse1_A", new Vector2(124f, -112f), -18f, 1.08f, "Greenhouse_Abandoned_Main");
        SpawnTemplate(templates, parent, "Pref_GreenHouse_B", new Vector2(157f, -118f), -12f, 0.82f, "Greenhouse_Collapsed_Side");
        SpawnTemplate(templates, parent, "Pref_Barn1_B", new Vector2(102f, -151f), 23f, 0.84f, "Greenhouse_Workshop");

        FenceRect(dressing, new Vector2(130f, -118f), new Vector2(104f, 58f), -12f, "Greenhouse_Sagging_Fence");
        AddClutter(dressing, new Vector2(126f, -110f), 34f, 18);

        for (int i = 0; i < 26; i++)
        {
            float a = i * 31.7f * Mathf.Deg2Rad;
            Vector2 p = new Vector2(124f + Mathf.Cos(a) * (20f + i % 4 * 4f), -112f + Mathf.Sin(a) * (14f + i % 5 * 3f));
            SpawnPrefab(dressing, PickGrass(i), p, i * 19f, 1.1f + (i % 3) * 0.16f, "Greenhouse_Overgrowth", yOffset: 0f, collidable: false);
        }

        AddOvergrowthPatch(dressing, new Vector2(138f, -124f), 58f, 86, 7171);
        AddTreeCluster(dressing, new Vector2(166f, -84f), 34f, 14, 1133, 0.72f);
    }

    private static void BuildSwamp(Dictionary<string, GameObject> templates, Transform parent, Transform dressing)
    {
        SpawnPrefab(parent, "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_Docking_A.prefab", new Vector2(-164f, -91f), 23f, 1.15f, "Swamp_Dock_Broken_A", 0.08f);
        SpawnPrefab(parent, "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_Docking_A_DM.prefab", new Vector2(-135f, -70f), 48f, 1.05f, "Swamp_Dock_Collapsed", 0.08f);
        SpawnPrefab(parent, "Assets/Flooded_Grounds/Prefabs/Props/Prop_Boat_A.prefab", new Vector2(-158f, -126f), -22f, 1.0f, "Swamp_Abandoned_Boat", 0.05f);
        SpawnPrefab(parent, "Assets/Flooded_Grounds/Prefabs/Props/Prop_Boat_A_Bobbing.prefab", new Vector2(-188f, -94f), 64f, 0.92f, "Swamp_Bobbing_Boat", 0.04f);

        SpawnTemplate(templates, parent, "Pref_Cabin1_B", new Vector2(-188f, -56f), 42f, 0.9f, "Swamp_Shack_Isolated");
        SpawnTemplate(templates, parent, "Pref_Barn2_A", new Vector2(-146f, -12f), 68f, 0.82f, "Swamp_Barn_Rotting");
        AddClutter(dressing, new Vector2(-155f, -72f), 45f, 22);
        AddOvergrowthPatch(dressing, new Vector2(-154f, -92f), 78f, 96, 9001);
        AddTreeCluster(dressing, new Vector2(-190f, -74f), 58f, 24, 9002, 0.66f);
    }

    private static void BuildForest(Transform parent)
    {
        System.Random random = new System.Random(37291);
        string[] trees =
        {
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Tall_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Tall_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Tall_C.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Small_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Small_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Crinkly_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Crinkly_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Tall_C_Dead.prefab"
        };

        List<Vector2> positions = new List<Vector2>();
        AddForestZone(positions, random, new Rect(-250f, 116f, 500f, 132f), 168);
        AddForestZone(positions, random, new Rect(-250f, -238f, 104f, 332f), 138);
        AddForestZone(positions, random, new Rect(112f, -22f, 126f, 166f), 110);
        AddForestZone(positions, random, new Rect(-138f, 144f, 212f, 84f), 72);
        AddForestZone(positions, random, new Rect(-24f, -242f, 260f, 74f), 82);
        AddForestZone(positions, random, new Rect(-128f, -124f, 242f, 132f), 72);
        AddForestZone(positions, random, new Rect(178f, -202f, 66f, 320f), 64);

        for (int i = 0; i < positions.Count; i++)
        {
            Vector2 p = positions[i];
            if (IsBlockedForLargeVegetation(p))
            {
                continue;
            }

            string prefab = trees[i % trees.Length];
            float scale = 0.68f + Next01(random) * 0.56f;
            if (prefab.Contains("Dead"))
            {
                scale *= 1.15f;
            }
            else if (prefab.Contains("Small"))
            {
                scale *= 0.82f;
            }

            SpawnPrefab(parent, prefab, p, NextRange(random, 0f, 360f), scale, "Dense_Forest_Tree");
        }

        for (int i = 0; i < 820; i++)
        {
            Vector2 p = RandomMapPoint(random);
            float forestMask = ForestMask(p);
            float pathClearance = DistanceToPathNetwork(p);
            if (forestMask < 0.22f && Next01(random) > 0.38f)
            {
                continue;
            }

            if (pathClearance < 3.2f || IsInsideCoreBuildingArea(p))
            {
                continue;
            }

            string prefab = i % 5 == 0 ? PickBush(i) : PickGrass(i);
            float scale = 0.98f + Next01(random) * 1.18f;
            SpawnPrefab(parent, prefab, p, NextRange(random, 0f, 360f), scale, "Ground_Overgrowth", yOffset: 0f, collidable: false);
        }

        for (int i = 0; i < 118; i++)
        {
            Vector2 p = RandomMapPoint(random);
            if (DistanceToPathNetwork(p) < 7f || IsInsideCoreBuildingArea(p))
            {
                continue;
            }

            SpawnPrefab(parent, PickRock(i), p, NextRange(random, 0f, 360f), 0.7f + Next01(random) * 0.7f, "Mossy_Rock");
        }
    }

    private static void AddForestZone(List<Vector2> positions, System.Random random, Rect rect, int count)
    {
        for (int i = 0; i < count; i++)
        {
            positions.Add(new Vector2(NextRange(random, rect.xMin, rect.xMax), NextRange(random, rect.yMin, rect.yMax)));
        }
    }

    private static void BuildAmbientDressing(Transform parent)
    {
        SpawnPrefab(parent, "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_RadioTower_A.prefab", new Vector2(-184f, -112f), -18f, 1.28f, "Radio_Tower_Entrance_Landmark");
        SpawnPrefab(parent, "Assets/Flooded_Grounds/Prefabs/Buildings/LightHouse/LightHouse_A.prefab", new Vector2(-192f, 76f), 31f, 0.78f, "Far_Flooded_Lighthouse");

        PlacePoles(parent, new Vector2(-30f, -190f), new Vector2(-24f, -58f), 28f);
        PlacePoles(parent, new Vector2(-20f, -52f), new Vector2(8f, 56f), 32f);
        PlacePoles(parent, new Vector2(26f, -52f), new Vector2(112f, -105f), 33f);

        SpawnPrefab(parent, "Assets/Flooded_Grounds/Prefabs/Sounds/2D_Wind.prefab", new Vector2(0f, 0f), 0f, 1f, "Ambient_Wind_2D");
        SpawnPrefab(parent, "Assets/Flooded_Grounds/Prefabs/Sounds/3D_WindHowl.prefab", new Vector2(-164f, -92f), 0f, 1f, "Swamp_WindHowl_3D");
        SpawnPrefab(parent, "Assets/Flooded_Grounds/Prefabs/Sounds/3D_LeafRustle.prefab", new Vector2(126f, 42f), 0f, 1f, "Church_LeafRustle_3D");
        SpawnPrefab(parent, "Assets/Flooded_Grounds/Prefabs/Atmospherics/ATM_Leaves_A.prefab", new Vector2(-10f, 42f), 0f, 1.15f, "Falling_Leaves_Village");
        SpawnPrefab(parent, "Assets/Flooded_Grounds/Prefabs/Atmospherics/ATM_Leaves_B.prefab", new Vector2(124f, -108f), 0f, 1.1f, "Falling_Leaves_Greenhouse");
    }

    private static void PlacePoles(Transform parent, Vector2 from, Vector2 to, float spacing)
    {
        Vector2 delta = to - from;
        float length = delta.magnitude;
        int count = Mathf.Max(1, Mathf.FloorToInt(length / spacing));
        Vector2 dir = delta.normalized;
        Vector2 normal = new Vector2(-dir.y, dir.x) * 5.5f;
        float yaw = Mathf.Atan2(dir.x, dir.y) * Mathf.Rad2Deg;

        for (int i = 0; i <= count; i++)
        {
            Vector2 p = Vector2.Lerp(from, to, i / (float)count) + normal * (i % 2 == 0 ? 1f : -0.6f);
            SpawnPrefab(parent, i % 2 == 0
                ? "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_Pole_A.prefab"
                : "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_Pole_B.prefab", p, yaw + 8f * (i % 3), 1.03f, "Old_Utility_Pole");
        }
    }

    private static void BuildAtmosphere(Transform parent)
    {
        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.Linear;
        RenderSettings.fogColor = new Color(0.39f, 0.45f, 0.45f);
        RenderSettings.fogStartDistance = 118f;
        RenderSettings.fogEndDistance = 760f;
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
        RenderSettings.ambientSkyColor = new Color(0.31f, 0.37f, 0.37f);
        RenderSettings.ambientEquatorColor = new Color(0.20f, 0.25f, 0.22f);
        RenderSettings.ambientGroundColor = new Color(0.10f, 0.12f, 0.10f);

        Material sky = AssetDatabase.LoadAssetAtPath<Material>("Assets/Flooded_Grounds/Content/Materials/BGR_Sky1.mat");
        if (sky != null)
        {
            RenderSettings.skybox = sky;
        }

        GameObject sun = new GameObject("Cold_Overcast_Sun");
        sun.transform.SetParent(parent);
        sun.transform.rotation = Quaternion.Euler(38f, -42f, 0f);
        Light light = sun.AddComponent<Light>();
        light.type = LightType.Directional;
        light.color = new Color(0.74f, 0.80f, 0.78f);
        light.intensity = 0.78f;
        light.shadows = LightShadows.Soft;
        light.shadowStrength = 0.66f;

        GameObject fill = new GameObject("Soft_Swamp_Fill_Light");
        fill.transform.SetParent(parent);
        fill.transform.position = new Vector3(-130f, 22f, -120f);
        Light fillLight = fill.AddComponent<Light>();
        fillLight.type = LightType.Point;
        fillLight.range = 95f;
        fillLight.intensity = 0.42f;
        fillLight.color = new Color(0.35f, 0.55f, 0.58f);

        GameObject cameraObject = new GameObject("Cinematic_Overview_Camera");
        cameraObject.transform.SetParent(parent);
        cameraObject.transform.position = new Vector3(-92f, 184f, -244f);
        cameraObject.transform.LookAt(new Vector3(12f, 18f, 28f));
        Camera camera = cameraObject.AddComponent<Camera>();
        camera.fieldOfView = 49f;
        camera.farClipPlane = 900f;
        camera.nearClipPlane = 0.3f;
        camera.clearFlags = CameraClearFlags.Skybox;
        camera.depth = 0;
        cameraObject.tag = "MainCamera";
    }

    private static void BuildGameplayMarkers(Transform root)
    {
        Transform markers = Group(root, "12_Gameplay_Markers");
        AddMarker(markers, "Player_Start_EmptyHands", new Vector2(-32f, -184f));
        AddMarker(markers, "LootZone_Village", new Vector2(-34f, -48f));
        AddMarker(markers, "LootZone_Mansion", new Vector2(4f, 94f));
        AddMarker(markers, "LootZone_Church", new Vector2(126f, 42f));
        AddMarker(markers, "LootZone_Greenhouse", new Vector2(124f, -112f));
        AddMarker(markers, "ZombieSpawn_Swamp", new Vector2(-152f, -70f));
        AddMarker(markers, "ZombieSpawn_DenseForest", new Vector2(150f, 84f));
        AddMarker(markers, "ZombieSpawn_MansionWoods", new Vector2(-44f, 148f));
    }

    private static void AddMarker(Transform parent, string name, Vector2 xz)
    {
        GameObject marker = new GameObject(name);
        marker.transform.SetParent(parent);
        marker.transform.position = new Vector3(xz.x, SampleTerrainHeight(xz.x, xz.y) + 0.25f, xz.y);
    }

    private static void PlaceAlongLine(Transform parent, string prefabPath, Vector2 from, Vector2 to, float spacing, float scale, string name)
    {
        Vector2 delta = to - from;
        float length = delta.magnitude;
        int count = Mathf.Max(1, Mathf.FloorToInt(length / spacing));
        float yaw = Mathf.Atan2(delta.x, delta.y) * Mathf.Rad2Deg;

        for (int i = 0; i <= count; i++)
        {
            Vector2 p = Vector2.Lerp(from, to, i / (float)count);
            SpawnPrefab(parent, prefabPath, p, yaw + (i % 2 == 0 ? 2f : -2f), scale, name, 0.04f);
        }
    }

    private static void FenceRect(Transform parent, Vector2 center, Vector2 size, float yaw, string name)
    {
        float rad = yaw * Mathf.Deg2Rad;
        Vector2 right = new Vector2(Mathf.Cos(rad), -Mathf.Sin(rad));
        Vector2 forward = new Vector2(Mathf.Sin(rad), Mathf.Cos(rad));
        Vector2 hx = right * size.x * 0.5f;
        Vector2 hz = forward * size.y * 0.5f;

        FenceLine(parent, center - hx - hz, center + hx - hz, 7.5f, name);
        FenceLine(parent, center - hx + hz, center + hx + hz, 7.5f, name);
        FenceLine(parent, center - hx - hz, center - hx + hz, 7.5f, name);
        FenceLine(parent, center + hx - hz, center + hx + hz, 7.5f, name);
    }

    private static void FenceLine(Transform parent, Vector2 from, Vector2 to, float spacing, string name)
    {
        string[] fencePieces =
        {
            "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_Fence1_Mid_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_Fence1_Mid_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_Fence1_Mid_C.prefab",
            "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_Fence2_Mid_A_DM.prefab"
        };

        Vector2 delta = to - from;
        float length = delta.magnitude;
        int count = Mathf.Max(1, Mathf.FloorToInt(length / spacing));
        float yaw = Mathf.Atan2(delta.x, delta.y) * Mathf.Rad2Deg + 90f;

        for (int i = 0; i <= count; i++)
        {
            if (i % 6 == 3)
            {
                continue;
            }

            Vector2 p = Vector2.Lerp(from, to, i / (float)count);
            SpawnPrefab(parent, fencePieces[i % fencePieces.Length], p, yaw + (i % 4 - 1.5f) * 2.6f, 1f, name);
        }
    }

    private static void AddClutter(Transform parent, Vector2 center, float radius, int count)
    {
        string[] clutter =
        {
            "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_WoodBoard_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_FlowerBox_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Buildings/Structures1/Struct_FlowerBox_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Props/Prop_Cabinet_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Props/Prop_Chair_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Props/Prop_SmallTable_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Rocks/CobbleRock_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Rocks/CobbleRock_D.prefab"
        };

        for (int i = 0; i < count; i++)
        {
            float angle = i * 137.5f * Mathf.Deg2Rad;
            float r = radius * Mathf.Sqrt(((i * 37) % 100) / 100f);
            Vector2 p = center + new Vector2(Mathf.Cos(angle) * r, Mathf.Sin(angle) * r);
            if (DistanceToPathNetwork(p) < 2.6f)
            {
                p += new Vector2(Mathf.Sin(angle), -Mathf.Cos(angle)) * 5f;
            }

            SpawnPrefab(parent, clutter[i % clutter.Length], p, i * 47f, 0.75f + (i % 4) * 0.12f, "Abandoned_Clutter");
        }
    }

    private static void AddOvergrowthPatch(Transform parent, Vector2 center, float radius, int count, int seed)
    {
        System.Random random = new System.Random(seed);
        for (int i = 0; i < count; i++)
        {
            float angle = NextRange(random, 0f, Mathf.PI * 2f);
            float r = radius * Mathf.Pow(Next01(random), 0.68f);
            Vector2 p = center + new Vector2(Mathf.Cos(angle) * r, Mathf.Sin(angle) * r);
            float pathClearance = DistanceToPathNetwork(p);
            if (pathClearance < 2.4f)
            {
                Vector2 away = (p - center).normalized;
                if (away.sqrMagnitude < 0.001f)
                {
                    away = new Vector2(1f, 0f);
                }

                p += away * (3.2f - pathClearance);
            }

            string prefab = i % 6 == 0 ? PickBush(seed + i) : PickGrass(seed + i);
            float scale = 1.0f + Next01(random) * 1.25f;
            SpawnPrefab(parent, prefab, p, NextRange(random, 0f, 360f), scale, "HandPlaced_Overgrowth", yOffset: 0f, collidable: false);
        }
    }

    private static void AddTreeCluster(Transform parent, Vector2 center, float radius, int count, int seed, float baseScale)
    {
        string[] trees =
        {
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Tall_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Tall_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Tall_C.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Crinkly_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Crinkly_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Trees/TreeCreator_Tall_C_Dead.prefab"
        };

        System.Random random = new System.Random(seed);
        for (int i = 0; i < count; i++)
        {
            float angle = NextRange(random, 0f, Mathf.PI * 2f);
            float r = radius * Mathf.Sqrt(Next01(random));
            Vector2 p = center + new Vector2(Mathf.Cos(angle) * r, Mathf.Sin(angle) * r);
            if (DistanceToPathNetwork(p) < 5.2f || IsInsideCoreBuildingArea(p))
            {
                continue;
            }

            float scale = baseScale + Next01(random) * 0.48f;
            SpawnPrefab(parent, trees[(seed + i) % trees.Length], p, NextRange(random, 0f, 360f), scale, "Silhouette_Tree_Cluster");
        }
    }

    private static void AddRockOutcrop(Transform parent, Vector2 center, float radius, int count, int seed)
    {
        System.Random random = new System.Random(seed);
        for (int i = 0; i < count; i++)
        {
            float angle = NextRange(random, 0f, Mathf.PI * 2f);
            float r = radius * Mathf.Sqrt(Next01(random));
            Vector2 p = center + new Vector2(Mathf.Cos(angle) * r, Mathf.Sin(angle) * r);
            if (DistanceToPathNetwork(p) < 4.5f)
            {
                continue;
            }

            SpawnPrefab(parent, PickRock(seed + i), p, NextRange(random, 0f, 360f), 0.72f + Next01(random) * 0.75f, "Eroded_Hill_Rock");
        }
    }

    private static string PickGrass(int i)
    {
        string[] grass =
        {
            "Assets/Flooded_Grounds/Prefabs/Nature/Grass/Grass_Tall_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Grass/Grass_Tall_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Grass/Grass_Tall_C.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Grass/Grass_Med_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Grass/Grass_Med_B.prefab",
            "Assets/TerrainSampleAssets/Prefabs/Fern_A.prefab",
            "Assets/TerrainSampleAssets/Prefabs/Plant_C.prefab"
        };

        return grass[Mathf.Abs(i) % grass.Length];
    }

    private static string PickBush(int i)
    {
        string[] bushes =
        {
            "Assets/Flooded_Grounds/Prefabs/Nature/Bushes/DecoBush_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Bushes/DecoBush_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Bushes/DecoBush_C.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Bushes/DecoBush_D.prefab",
            "Assets/TerrainSampleAssets/Prefabs/Bush_A.prefab",
            "Assets/TerrainSampleAssets/Prefabs/Bush_B.prefab"
        };

        return bushes[Mathf.Abs(i) % bushes.Length];
    }

    private static string PickRock(int i)
    {
        string[] rocks =
        {
            "Assets/Flooded_Grounds/Prefabs/Nature/Rocks/Rock_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Rocks/Rock_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Rocks/CobbleRock_A.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Rocks/CobbleRock_B.prefab",
            "Assets/Flooded_Grounds/Prefabs/Nature/Rocks/CobbleRock_E.prefab"
        };

        return rocks[Mathf.Abs(i) % rocks.Length];
    }

    private static Vector2 GridToWorld(int x, int z, int resolution)
    {
        float wx = x / (float)(resolution - 1) * TerrainSize - HalfSize;
        float wz = z / (float)(resolution - 1) * TerrainSize - HalfSize;
        return new Vector2(wx, wz);
    }

    private static Vector2 RandomMapPoint(System.Random random)
    {
        return new Vector2(NextRange(random, -245f, 245f), NextRange(random, -245f, 245f));
    }

    private static float DistanceToPathNetwork(Vector2 p)
    {
        float d = float.MaxValue;
        Vector2[][] paths =
        {
            new[] { new Vector2(-32f, -205f), new Vector2(-26f, -124f), new Vector2(-34f, -50f), new Vector2(-8f, 48f), new Vector2(2f, 88f) },
            new[] { new Vector2(-34f, -50f), new Vector2(-100f, -72f), new Vector2(-155f, -88f), new Vector2(-195f, -145f) },
            new[] { new Vector2(-24f, -52f), new Vector2(38f, -38f), new Vector2(88f, -70f), new Vector2(128f, -108f) },
            new[] { new Vector2(10f, 36f), new Vector2(78f, 28f), new Vector2(126f, 42f) },
            new[] { new Vector2(-50f, -90f), new Vector2(-78f, -112f), new Vector2(-124f, -114f) }
        };

        foreach (Vector2[] path in paths)
        {
            for (int i = 0; i < path.Length - 1; i++)
            {
                d = Mathf.Min(d, DistancePointSegment(p, path[i], path[i + 1]));
            }
        }

        return d;
    }

    private static float DistancePointSegment(Vector2 p, Vector2 a, Vector2 b)
    {
        Vector2 ab = b - a;
        float t = Mathf.Clamp01(Vector2.Dot(p - a, ab) / ab.sqrMagnitude);
        return Vector2.Distance(p, a + ab * t);
    }

    private static float Gaussian(Vector2 p, Vector2 center, float radius)
    {
        float d = Vector2.Distance(p, center) / Mathf.Max(0.001f, radius);
        return Mathf.Exp(-d * d * 2.15f);
    }

    private static float Flatten(float currentHeight, Vector2 p, Vector2 center, float radius, float targetHeight)
    {
        float t = Mathf.Clamp01(1f - Vector2.Distance(p, center) / radius);
        t = Mathf.SmoothStep(0f, 1f, t);
        return Mathf.Lerp(currentHeight, targetHeight, t * 0.86f);
    }

    private static float EdgeHill(Vector2 p)
    {
        float edge = Mathf.Max(Mathf.Abs(p.x), Mathf.Abs(p.y));
        return Mathf.SmoothStep(148f, HalfSize, edge);
    }

    private static float ForestMask(Vector2 p)
    {
        float north = Mathf.SmoothStep(68f, 198f, p.y);
        float west = Mathf.SmoothStep(72f, 218f, -p.x);
        float eastChurch = Mathf.SmoothStep(86f, 218f, p.x) * Mathf.SmoothStep(-50f, 94f, p.y);
        float south = Mathf.SmoothStep(132f, 238f, -p.y) * (1f - Mathf.SmoothStep(-42f, 92f, p.x));
        return Mathf.Clamp01(Mathf.Max(Mathf.Max(north, west), Mathf.Max(eastChurch, south)));
    }

    private static bool IsBlockedForLargeVegetation(Vector2 p)
    {
        return DistanceToPathNetwork(p) < 8.5f || IsInsideCoreBuildingArea(p);
    }

    private static bool IsInsideCoreBuildingArea(Vector2 p)
    {
        return Vector2.Distance(p, new Vector2(-35f, -48f)) < 58f
            || Vector2.Distance(p, new Vector2(2f, 98f)) < 56f
            || Vector2.Distance(p, new Vector2(126f, 42f)) < 46f
            || Vector2.Distance(p, new Vector2(124f, -112f)) < 42f;
    }

    private static float Next01(System.Random random)
    {
        return (float)random.NextDouble();
    }

    private static float NextRange(System.Random random, float min, float max)
    {
        return min + (max - min) * Next01(random);
    }

    private static Material CreateTransparentMaterial(string name, Color color, float smoothness)
    {
        Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
        Material material = new Material(shader)
        {
            name = name,
            renderQueue = 3000
        };

        if (material.HasProperty("_BaseColor"))
        {
            material.SetColor("_BaseColor", color);
        }
        else if (material.HasProperty("_Color"))
        {
            material.SetColor("_Color", color);
        }

        if (material.HasProperty("_Smoothness"))
        {
            material.SetFloat("_Smoothness", smoothness);
        }

        if (material.HasProperty("_Surface"))
        {
            material.SetFloat("_Surface", 1f);
        }

        if (material.HasProperty("_AlphaClip"))
        {
            material.SetFloat("_AlphaClip", 0f);
        }

        material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        return material;
    }

    private static void ApplyCinematicMaterialTone(GameObject root)
    {
        Dictionary<Material, Material> toned = new Dictionary<Material, Material>();
        int tonedCount = 0;

        foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(includeInactive: true))
        {
            Material[] materials = renderer.sharedMaterials;
            bool changed = false;

            for (int i = 0; i < materials.Length; i++)
            {
                Material source = materials[i];
                if (source == null || !TryGetCinematicTone(source, out Color tint, out float tintStrength, out float smoothness, out bool transparent))
                {
                    continue;
                }

                if (!toned.TryGetValue(source, out Material material))
                {
                    material = new Material(source)
                    {
                        name = $"{source.name}_FloodedVillageTone"
                    };

                    Color original = FindSourceColor(source, "_BaseColor", "_Color", "_Tint");
                    Color final = Color.Lerp(original, tint, tintStrength);
                    final.a = transparent ? tint.a : Mathf.Max(original.a, 1f);
                    SetTargetColor(material, final, "_BaseColor", "_Color", "_Tint");

                    if (material.HasProperty("_Smoothness"))
                    {
                        material.SetFloat("_Smoothness", smoothness);
                    }

                    if (transparent)
                    {
                        material.renderQueue = 3000;
                        if (material.HasProperty("_Surface"))
                        {
                            material.SetFloat("_Surface", 1f);
                        }

                        material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                    }

                    toned[source] = material;
                }

                materials[i] = material;
                changed = true;
                tonedCount++;
            }

            if (changed)
            {
                renderer.sharedMaterials = materials;
            }
        }

        Debug.Log($"[ArenaBrawlFloodedVillageMapBuilder] Applied cinematic wet palette to {tonedCount} scene material slots.");
    }

    private static bool TryGetCinematicTone(Material material, out Color tint, out float tintStrength, out float smoothness, out bool transparent)
    {
        string name = material.name.ToLowerInvariant();
        tint = Color.white;
        tintStrength = 0f;
        smoothness = 0.12f;
        transparent = false;

        if (name.Contains("water"))
        {
            tint = new Color(0.14f, 0.28f, 0.30f, 0.66f);
            tintStrength = 0.62f;
            smoothness = 0.72f;
            transparent = true;
            return true;
        }

        if (name.Contains("grass") || name.Contains("bush") || name.Contains("moss") || name.Contains("leaf") || name.Contains("nat_"))
        {
            tint = new Color(0.22f, 0.33f, 0.22f, 1f);
            tintStrength = 0.56f;
            smoothness = 0.18f;
            return true;
        }

        if (name.Contains("tree") || name.Contains("branch"))
        {
            tint = new Color(0.28f, 0.36f, 0.24f, 1f);
            tintStrength = 0.46f;
            smoothness = 0.16f;
            return true;
        }

        if (name.Contains("rock") || name.Contains("cobble") || name.Contains("rubble"))
        {
            tint = new Color(0.36f, 0.39f, 0.36f, 1f);
            tintStrength = 0.50f;
            smoothness = 0.10f;
            return true;
        }

        if (name.Contains("bld_") || name.Contains("villa") || name.Contains("cabin") || name.Contains("church") || name.Contains("brick") || name.Contains("structure") || name.Contains("barn"))
        {
            tint = new Color(0.48f, 0.49f, 0.44f, 1f);
            tintStrength = 0.42f;
            smoothness = 0.11f;
            return true;
        }

        if (name.Contains("prop_") || name.Contains("rusty") || name.Contains("grave"))
        {
            tint = new Color(0.42f, 0.41f, 0.35f, 1f);
            tintStrength = 0.36f;
            smoothness = 0.12f;
            return true;
        }

        return false;
    }

    private static void FixSceneMaterials(GameObject root)
    {
        Shader lit = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
        if (lit == null)
        {
            return;
        }

        int fixedCount = 0;
        foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>(includeInactive: true))
        {
            Material[] materials = renderer.sharedMaterials;
            bool changed = false;

            for (int i = 0; i < materials.Length; i++)
            {
                Material source = materials[i];
                if (!ShouldConvertSceneMaterial(source))
                {
                    continue;
                }

                materials[i] = ConvertSceneMaterial(source, lit);
                changed = true;
                fixedCount++;
            }

            if (changed)
            {
                renderer.sharedMaterials = materials;
            }
        }

        Debug.Log($"[ArenaBrawlFloodedVillageMapBuilder] Converted {fixedCount} embedded scene materials to URP.");
    }

    private static bool ShouldConvertSceneMaterial(Material material)
    {
        if (material == null || material.shader == null)
        {
            return false;
        }

        string shaderName = material.shader.name;
        if (shaderName.StartsWith("Universal Render Pipeline/", StringComparison.Ordinal) || shaderName.StartsWith("Skybox/", StringComparison.Ordinal))
        {
            return false;
        }

        return shaderName.IndexOf("InternalError", StringComparison.OrdinalIgnoreCase) >= 0
            || shaderName.IndexOf("Tree", StringComparison.OrdinalIgnoreCase) >= 0
            || shaderName.StartsWith("Nature/", StringComparison.Ordinal)
            || material.name.IndexOf("leaf", StringComparison.OrdinalIgnoreCase) >= 0
            || material.name.IndexOf("branch", StringComparison.OrdinalIgnoreCase) >= 0
            || material.name.IndexOf("trunk", StringComparison.OrdinalIgnoreCase) >= 0
            || material.name.IndexOf("tree", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static Material ConvertSceneMaterial(Material source, Shader lit)
    {
        bool leafLike = IsLeafLike(source);
        Texture mainTexture = FindSourceTexture(source, "_BaseMap", "_MainTex", "_Tex", "_Diffuse", "_Albedo", "_LeafTex");
        Texture normalTexture = FindSourceTexture(source, "_BumpMap", "_NormalMap", "_BumpSpecMap");
        Color color = FindSourceColor(source, "_BaseColor", "_Color", "_Tint");
        if (leafLike)
        {
            color = new Color(0.31f, 0.43f, 0.26f, 1f);
        }
        else if (IsBarkLike(source) && color == Color.white)
        {
            color = new Color(0.34f, 0.27f, 0.20f, 1f);
        }

        Material material = new Material(lit)
        {
            name = $"{source.name}_URPScene",
            renderQueue = leafLike ? 2450 : -1
        };

        SetTargetTexture(material, mainTexture, "_BaseMap", "_MainTex");
        SetTargetTexture(material, normalTexture, "_BumpMap", "_NormalMap");
        SetTargetColor(material, color, "_BaseColor", "_Color");

        if (normalTexture != null)
        {
            material.EnableKeyword("_NORMALMAP");
        }

        if (leafLike)
        {
            if (material.HasProperty("_AlphaClip"))
            {
                material.SetFloat("_AlphaClip", 1f);
            }

            if (material.HasProperty("_Cutoff"))
            {
                material.SetFloat("_Cutoff", 0.36f);
            }

            if (material.HasProperty("_Cull"))
            {
                material.SetFloat("_Cull", 0f);
            }

            material.EnableKeyword("_ALPHATEST_ON");
        }

        return material;
    }

    private static bool IsLeafLike(Material material)
    {
        string name = material.name;
        string shaderName = material.shader != null ? material.shader.name : string.Empty;
        return name.IndexOf("leaf", StringComparison.OrdinalIgnoreCase) >= 0
            || name.IndexOf("branch", StringComparison.OrdinalIgnoreCase) >= 0
            || name.IndexOf("bush", StringComparison.OrdinalIgnoreCase) >= 0
            || shaderName.IndexOf("Leaves", StringComparison.OrdinalIgnoreCase) >= 0
            || shaderName.IndexOf("Branch", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static bool IsBarkLike(Material material)
    {
        string name = material.name;
        string shaderName = material.shader != null ? material.shader.name : string.Empty;
        return name.IndexOf("bark", StringComparison.OrdinalIgnoreCase) >= 0
            || name.IndexOf("trunk", StringComparison.OrdinalIgnoreCase) >= 0
            || shaderName.IndexOf("Bark", StringComparison.OrdinalIgnoreCase) >= 0
            || shaderName.IndexOf("Trunk", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static Texture FindSourceTexture(Material material, params string[] names)
    {
        foreach (string name in names)
        {
            if (material.HasProperty(name))
            {
                Texture texture = material.GetTexture(name);
                if (texture != null)
                {
                    return texture;
                }
            }
        }

        return null;
    }

    private static Color FindSourceColor(Material material, params string[] names)
    {
        foreach (string name in names)
        {
            if (material.HasProperty(name))
            {
                return material.GetColor(name);
            }
        }

        return Color.white;
    }

    private static void SetTargetTexture(Material material, Texture texture, params string[] names)
    {
        if (texture == null)
        {
            return;
        }

        foreach (string name in names)
        {
            if (material.HasProperty(name))
            {
                material.SetTexture(name, texture);
            }
        }
    }

    private static void SetTargetColor(Material material, Color color, params string[] names)
    {
        foreach (string name in names)
        {
            if (material.HasProperty(name))
            {
                material.SetColor(name, color);
            }
        }
    }

    private static void FrameGeneratedMap()
    {
        Selection.activeObject = null;
        SceneView sceneView = SceneView.lastActiveSceneView;
        if (sceneView == null)
        {
            return;
        }

        sceneView.LookAt(new Vector3(0f, 18f, -6f), Quaternion.Euler(54f, 0f, 0f), 260f);
        sceneView.Repaint();
    }
}
#endif
