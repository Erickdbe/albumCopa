using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class ArenaBrawlForestMapBuilder
{
    private const string OutputScenePath = "Assets/Scenes/ArenaBrawl_Forest_RPGPoly.unity";
    private const float HalfSize = 168f;

    private static readonly Dictionary<string, GameObject> PrefabCache = new Dictionary<string, GameObject>();

    [MenuItem("Tools/Arena Brawl/Build RPG Poly Forest Scene")]
    public static void BuildForestScene()
    {
        PrefabCache.Clear();

        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        scene.name = "ArenaBrawl_Forest_RPGPoly";

        var root = new GameObject("ArenaBrawl_Forest_RPGPoly");
        var terrain = Group(root, "01_Terrain_Relief");
        var paths = Group(root, "02_Paths_Bridges");
        var structures = Group(root, "03_Cabins_Treehouses");
        var vegetation = Group(root, "04_Trees_Bushes_Flowers");
        var props = Group(root, "05_Props_Collision_Dressing");
        var gameplay = Group(root, "06_Gameplay_Markers");
        var lighting = Group(root, "07_Lighting_Camera");

        BuildTerrain(terrain.transform);
        BuildMountainRing(terrain.transform);
        BuildPaths(paths.transform);
        BuildVillage(structures.transform, props.transform);
        BuildTreeHouses(structures.transform, paths.transform);
        BuildVegetation(vegetation.transform);
        BuildProps(props.transform);
        BuildGameplayMarkers(gameplay.transform);
        BuildLighting(lighting.transform);

        EditorSceneManager.MarkSceneDirty(scene);
        EditorSceneManager.SaveScene(scene, OutputScenePath);
        AssetDatabase.Refresh();
        Debug.Log($"Arena Brawl forest scene generated at {OutputScenePath}");
    }

    private static GameObject Group(GameObject parent, string name)
    {
        var group = new GameObject(name);
        group.transform.SetParent(parent.transform);
        return group;
    }

    private static GameObject Prefab(string path)
    {
        if (!PrefabCache.TryGetValue(path, out var prefab))
        {
            prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) Debug.LogWarning($"Missing prefab: {path}");
            PrefabCache[path] = prefab;
        }
        return prefab;
    }

    private static GameObject Spawn(Transform parent, string prefabPath, Vector3 position, Vector3 rotation, Vector3 scale, string name = null)
    {
        var prefab = Prefab(prefabPath);
        GameObject instance;
        if (prefab != null)
        {
            instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            instance.name = name ?? prefab.name;
        }
        else
        {
            instance = GameObject.CreatePrimitive(PrimitiveType.Cube);
            instance.name = name ?? "MissingPrefab_Proxy";
        }

        instance.transform.SetParent(parent);
        instance.transform.position = position;
        instance.transform.eulerAngles = rotation;
        instance.transform.localScale = scale;
        EnsureCollider(instance);
        return instance;
    }

    private static void EnsureCollider(GameObject instance)
    {
        if (instance.GetComponentInChildren<Collider>() != null) return;
        foreach (var renderer in instance.GetComponentsInChildren<Renderer>())
        {
            var collider = renderer.gameObject.AddComponent<BoxCollider>();
            collider.center = renderer.localBounds.center;
            collider.size = renderer.localBounds.size;
        }
    }

    private static void BuildTerrain(Transform parent)
    {
        var grassA = "Assets/RPGPP_LT/Prefabs/Nature/Terrain/rpgpp_lt_terrain_grass_01.prefab";
        var grassB = "Assets/RPGPP_LT/Prefabs/Nature/Terrain/rpgpp_lt_terrain_grass_02.prefab";
        var pathA = "Assets/RPGPP_LT/Prefabs/Nature/Terrain/rpgpp_lt_terrain_path_01a.prefab";
        var hillA = "Assets/RPGPP_LT/Prefabs/Nature/Terrain/rpgpp_lt_hill_small_01.prefab";
        var hillB = "Assets/RPGPP_LT/Prefabs/Nature/Terrain/rpgpp_lt_hill_small_02.prefab";

        for (var x = -144; x <= 144; x += 24)
        {
            for (var z = -144; z <= 144; z += 24)
            {
                var nearTrail = Mathf.Abs(x) < 13 || Mathf.Abs(z) < 13 || Mathf.Abs(x - z * 0.55f) < 12;
                var prefab = nearTrail ? pathA : (((x + z) / 24) % 2 == 0 ? grassA : grassB);
                Spawn(parent, prefab, new Vector3(x, 0, z), Vector3.zero, Vector3.one * 2.0f, "terrain_tile");
            }
        }

        var hills = new[]
        {
            new Vector3(-118,0,-72), new Vector3(-104,0,64), new Vector3(-58,0,116),
            new Vector3(60,0,-118), new Vector3(112,0,-48), new Vector3(96,0,86),
            new Vector3(-22,0,-126), new Vector3(18,0,128)
        };
        for (var i = 0; i < hills.Length; i++)
        {
            Spawn(parent, i % 2 == 0 ? hillA : hillB, hills[i], new Vector3(0, i * 31, 0), Vector3.one * (0.2f + (i % 3) * 0.035f), "playable_relief_hill");
        }
    }

    private static void BuildMountainRing(Transform parent)
    {
        var mountain = "Assets/RPGPP_LT/Prefabs/Nature/Terrain/rpgpp_lt_mountain_01.prefab";
        var points = new[]
        {
            new Vector3(-150,0,-150), new Vector3(-92,0,-160), new Vector3(-35,0,-166), new Vector3(28,0,-164), new Vector3(94,0,-158), new Vector3(152,0,-138),
            new Vector3(160,0,-80), new Vector3(166,0,-18), new Vector3(158,0,48), new Vector3(132,0,112), new Vector3(76,0,152), new Vector3(8,0,164),
            new Vector3(-58,0,158), new Vector3(-122,0,128), new Vector3(-160,0,68), new Vector3(-166,0,-8), new Vector3(-160,0,-78)
        };
        for (var i = 0; i < points.Length; i++)
        {
            Spawn(parent, mountain, points[i], new Vector3(0, i * 23, 0), Vector3.one * (0.34f + (i % 4) * 0.04f), "mountain_border");
        }
    }

    private static void BuildPaths(Transform parent)
    {
        var plankA = "Assets/RPGPP_LT/Prefabs/Exterior/Wood_path/rpgpp_lt_wood_path_01a.prefab";
        var plankB = "Assets/RPGPP_LT/Prefabs/Exterior/Wood_path/rpgpp_lt_wood_path_01b.prefab";
        var fenceA = "Assets/RPGPP_LT/Prefabs/Exterior/Wood_path/rpgpp_lt_fence_wood_01a.prefab";
        var fenceB = "Assets/RPGPP_LT/Prefabs/Exterior/Wood_path/rpgpp_lt_fence_wood_02a.prefab";

        for (var i = -11; i <= 11; i++)
        {
            Spawn(parent, i % 2 == 0 ? plankA : plankB, new Vector3(i * 8, 0.08f, 0), new Vector3(0, 90, 0), Vector3.one * 1.6f, "central_wood_bridge");
            Spawn(parent, i % 2 == 0 ? plankB : plankA, new Vector3(0, 0.08f, i * 8), Vector3.zero, Vector3.one * 1.55f, "north_south_wood_bridge");
        }

        for (var i = -9; i <= 9; i++)
        {
            Spawn(parent, fenceA, new Vector3(i * 9, 0, 19), Vector3.zero, Vector3.one * 1.25f, "village_fence");
            Spawn(parent, fenceB, new Vector3(i * 9, 0, -19), Vector3.zero, Vector3.one * 1.25f, "village_fence");
        }
    }

    private static void BuildVillage(Transform structures, Transform props)
    {
        var buildings = new[]
        {
            "Assets/RPGPP_LT/Prefabs/Buildings/Bld_closed/rpgpp_lt_building_01.prefab",
            "Assets/RPGPP_LT/Prefabs/Buildings/Bld_closed/rpgpp_lt_building_02.prefab",
            "Assets/RPGPP_LT/Prefabs/Buildings/Bld_closed/rpgpp_lt_building_03.prefab",
            "Assets/RPGPP_LT/Prefabs/Buildings/Bld_closed/rpgpp_lt_building_04.prefab",
            "Assets/RPGPP_LT/Prefabs/Buildings/Bld_closed/rpgpp_lt_building_05.prefab"
        };
        var positions = new[]
        {
            new Vector3(-62,0,-36), new Vector3(62,0,36), new Vector3(-68,0,42),
            new Vector3(70,0,-42), new Vector3(0,0,-62), new Vector3(0,0,62)
        };
        for (var i = 0; i < positions.Length; i++)
        {
            Spawn(structures, buildings[i % buildings.Length], positions[i], new Vector3(0, i * 37 + 18, 0), Vector3.one * 1.08f, "forest_cabin");
        }

        var well = "Assets/RPGPP_LT/Prefabs/Props/Misc/rpgpp_lt_well_01.prefab";
        var wagon = "Assets/RPGPP_LT/Prefabs/Props/Misc/rpgpp_lt_wagon_01.prefab";
        var barrel = "Assets/RPGPP_LT/Prefabs/Props/Containers/rpgpp_lt_barrel_01.prefab";
        var crate = "Assets/RPGPP_LT/Prefabs/Props/Containers/rpgpp_lt_crate_01.prefab";
        Spawn(props, well, new Vector3(-16, 0, 18), Vector3.zero, Vector3.one * 1.2f, "village_well");
        Spawn(props, wagon, new Vector3(22, 0, -22), new Vector3(0, -35, 0), Vector3.one * 1.2f, "wagon_cover");
        for (var i = 0; i < 12; i++)
        {
            var a = i * 31f * Mathf.Deg2Rad;
            var p = new Vector3(Mathf.Cos(a) * (28 + i % 3 * 8), 0, Mathf.Sin(a) * (24 + i % 4 * 7));
            Spawn(props, i % 2 == 0 ? barrel : crate, p, new Vector3(0, i * 29, 0), Vector3.one * 1.3f, "village_cover_prop");
        }
    }

    private static void BuildTreeHouses(Transform structures, Transform paths)
    {
        var shedA = "Assets/RPGPP_LT/Prefabs/Exterior/Wood_path/rpgpp_lt_shed_wood_01.prefab";
        var shedB = "Assets/RPGPP_LT/Prefabs/Exterior/Wood_path/rpgpp_lt_shed_wood_02.prefab";
        var ladder = "Assets/RPGPP_LT/Prefabs/Props/Items/rpgpp_lt_ladder_01.prefab";
        var tree = "Assets/RPGPP_LT/Prefabs/Nature/Vegetation/Trees/rpgpp_lt_tree_01.prefab";
        var sites = new[]
        {
            new Vector3(-102,0,-68), new Vector3(102,0,68), new Vector3(-96,0,72), new Vector3(96,0,-72)
        };
        for (var i = 0; i < sites.Length; i++)
        {
            var site = sites[i];
            Spawn(structures, tree, site, Vector3.zero, Vector3.one * 2.35f, "treehouse_support_tree");
            Spawn(structures, i % 2 == 0 ? shedA : shedB, site + Vector3.up * 7.2f, new Vector3(0, i * 90, 0), Vector3.one * 1.35f, "treehouse_platform");
            Spawn(structures, ladder, site + new Vector3(2.8f, 1.35f, 2.8f), new Vector3(0, 45 + i * 90, 15), Vector3.one * 1.85f, "treehouse_ladder");
        }
    }

    private static void BuildVegetation(Transform parent)
    {
        var treeA = "Assets/RPGPP_LT/Prefabs/Nature/Vegetation/Trees/rpgpp_lt_tree_01.prefab";
        var treeB = "Assets/RPGPP_LT/Prefabs/Nature/Vegetation/Trees/rpgpp_lt_tree_02.prefab";
        var pine = "Assets/RPGPP_LT/Prefabs/Nature/Vegetation/Trees/rpgpp_lt_tree_pine_01.prefab";
        var bushA = "Assets/RPGPP_LT/Prefabs/Nature/Vegetation/Bushes/rpgpp_lt_bush_01.prefab";
        var bushB = "Assets/RPGPP_LT/Prefabs/Nature/Vegetation/Bushes/rpgpp_lt_bush_02.prefab";
        var flowerA = "Assets/RPGPP_LT/Prefabs/Nature/Vegetation/Flowers/rpgpp_lt_flower_01.prefab";
        var flowerB = "Assets/RPGPP_LT/Prefabs/Nature/Vegetation/Flowers/rpgpp_lt_flower_02.prefab";
        var grass = "Assets/RPGPP_LT/Prefabs/Nature/Vegetation/Grass/rpgpp_lt_grass_small_01a.prefab";

        for (var ring = 0; ring < 4; ring++)
        {
            var radius = 54 + ring * 25;
            var count = 22 + ring * 10;
            for (var i = 0; i < count; i++)
            {
                var angle = (i / (float)count) * Mathf.PI * 2f + ring * 0.21f;
                var x = Mathf.Cos(angle) * radius + Mathf.Sin(i * 1.9f) * 5f;
                var z = Mathf.Sin(angle) * radius + Mathf.Cos(i * 1.7f) * 5f;
                if (Mathf.Abs(x) < 20 || Mathf.Abs(z) < 20) continue;
                var prefab = i % 5 == 0 ? pine : (i % 2 == 0 ? treeA : treeB);
                Spawn(parent, prefab, new Vector3(x, 0, z), new Vector3(0, i * 17, 0), Vector3.one * (2.1f + (i % 4) * 0.22f), "forest_tree");
            }
        }

        for (var i = 0; i < 90; i++)
        {
            var x = Mathf.Sin(i * 12.9898f) * 138f;
            var z = Mathf.Cos(i * 78.233f) * 138f;
            if (Mathf.Abs(x) < 11 || Mathf.Abs(z) < 11) continue;
            var pick = i % 4;
            var prefab = pick == 0 ? bushA : pick == 1 ? bushB : pick == 2 ? grass : (i % 2 == 0 ? flowerA : flowerB);
            Spawn(parent, prefab, new Vector3(x, 0, z), new Vector3(0, i * 23, 0), Vector3.one * (1.15f + (i % 3) * 0.18f), "forest_underbrush");
        }
    }

    private static void BuildProps(Transform parent)
    {
        var rockA = "Assets/RPGPP_LT/Prefabs/Nature/Rocks/rpgpp_lt_rock_01.prefab";
        var rockB = "Assets/RPGPP_LT/Prefabs/Nature/Rocks/rpgpp_lt_rock_02.prefab";
        var rockC = "Assets/RPGPP_LT/Prefabs/Nature/Rocks/rpgpp_lt_rock_03.prefab";
        var logA = "Assets/RPGPP_LT/Prefabs/Props/Wood/rpgpp_lt_log_wood_01.prefab";
        var logB = "Assets/RPGPP_LT/Prefabs/Props/Wood/rpgpp_lt_log_wood_02a.prefab";
        var bench = "Assets/RPGPP_LT/Prefabs/Props/Benches/rpgpp_lt_bench_wood_01.prefab";

        var cover = new[]
        {
            new Vector3(-42,0,86), new Vector3(42,0,-86), new Vector3(-82,0,-12),
            new Vector3(82,0,12), new Vector3(-22,0,-108), new Vector3(22,0,108),
            new Vector3(-118,0,20), new Vector3(118,0,-20)
        };
        for (var i = 0; i < cover.Length; i++)
        {
            Spawn(parent, i % 3 == 0 ? rockA : i % 3 == 1 ? rockB : rockC, cover[i], new Vector3(0, i * 27, 0), Vector3.one * (2.0f + (i % 2) * 0.35f), "rock_cover_cluster");
            Spawn(parent, i % 2 == 0 ? logA : logB, cover[i] + new Vector3(5, 0, -4), new Vector3(0, i * 39, 0), Vector3.one * 1.6f, "fallen_log_cover");
        }

        Spawn(parent, bench, new Vector3(-8, 0, -28), new Vector3(0, 8, 0), Vector3.one * 1.55f, "central_bench");
        Spawn(parent, bench, new Vector3(12, 0, 30), new Vector3(0, 188, 0), Vector3.one * 1.55f, "central_bench");
    }

    private static void BuildGameplayMarkers(Transform parent)
    {
        var spawnRoot = Group(parent.gameObject, "Spawn_Markers");
        var positions = new[]
        {
            new Vector3(-104,0,-92), new Vector3(104,0,-92), new Vector3(-108,0,88), new Vector3(108,0,88),
            new Vector3(0,0,-130), new Vector3(0,0,128), new Vector3(-136,0,0), new Vector3(136,0,0)
        };
        for (var i = 0; i < positions.Length; i++)
        {
            var marker = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            marker.name = $"spawn_{i + 1:00}";
            marker.transform.SetParent(spawnRoot.transform);
            marker.transform.position = positions[i] + Vector3.up * 0.05f;
            marker.transform.localScale = new Vector3(2.2f, 0.06f, 2.2f);
            Object.DestroyImmediate(marker.GetComponent<Collider>());
        }
    }

    private static void BuildLighting(Transform parent)
    {
        var sun = new GameObject("Sun_Key_Light");
        sun.transform.SetParent(parent);
        var light = sun.AddComponent<Light>();
        light.type = LightType.Directional;
        light.intensity = 1.15f;
        light.color = new Color(1f, 0.92f, 0.78f);
        sun.transform.eulerAngles = new Vector3(48, -32, 0);

        var fill = new GameObject("Soft_Forest_Fill");
        fill.transform.SetParent(parent);
        var fillLight = fill.AddComponent<Light>();
        fillLight.type = LightType.Point;
        fillLight.range = 95f;
        fillLight.intensity = 1.35f;
        fillLight.color = new Color(0.48f, 0.8f, 0.56f);
        fill.transform.position = new Vector3(0, 18, 0);

        var cameraObject = new GameObject("Overview_Camera");
        cameraObject.transform.SetParent(parent);
        var camera = cameraObject.AddComponent<Camera>();
        camera.transform.position = new Vector3(0, 118, -176);
        camera.transform.rotation = Quaternion.Euler(58, 0, 0);
        camera.fieldOfView = 48;
        camera.nearClipPlane = 0.1f;
        camera.farClipPlane = 650f;
        RenderSettings.fog = true;
        RenderSettings.fogColor = new Color(0.58f, 0.75f, 0.82f);
        RenderSettings.fogDensity = 0.006f;
        RenderSettings.ambientLight = new Color(0.52f, 0.64f, 0.54f);
    }
}
