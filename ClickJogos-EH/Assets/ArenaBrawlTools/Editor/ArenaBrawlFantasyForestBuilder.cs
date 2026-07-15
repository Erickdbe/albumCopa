using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class ArenaBrawlFantasyForestBuilder
{
    private const string ScenePath = "Assets/Scenes/ArenaBrawl_Forest_RPGPoly.unity";
    private const string GeneratedRootName = "08_Holotna_Fantasy_Pass";
    private const string HolotnaRoot = "Assets/Holotna/Mountain";
    private const int Seed = 20260714;

    private static readonly Vector2[] SpawnClearings =
    {
        new Vector2(-64, -72), new Vector2(-84, -28), new Vector2(-38, -92), new Vector2(-96, 12),
        new Vector2(64, 72), new Vector2(84, 28), new Vector2(38, 92), new Vector2(96, -12),
        new Vector2(0, -106), new Vector2(0, 106), new Vector2(-102, 0), new Vector2(102, 0)
    };

    private struct BridgeSite
    {
        public string name;
        public Vector3 position;
        public float yaw;
        public float length;

        public BridgeSite(string name, Vector3 position, float yaw, float length)
        {
            this.name = name;
            this.position = position;
            this.yaw = yaw;
            this.length = length;
        }
    }

    private static readonly BridgeSite[] BridgeSites =
    {
        new BridgeSite("fantasy_bridge_destructible_01", new Vector3(-35, 0, 42), 0, 22),
        new BridgeSite("fantasy_bridge_destructible_02", new Vector3(54, 0, -38), 90, 20),
        new BridgeSite("fantasy_bridge_destructible_03", new Vector3(18, 0, 112), 90, 18)
    };

    [MenuItem("Tools/Arena Brawl/Build Fantasy Forest Pass")]
    public static void BuildFantasyForest()
    {
        var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        var terrains = UnityEngine.Object.FindObjectsByType<Terrain>(FindObjectsInactive.Include, FindObjectsSortMode.None)
            .Where(terrain => terrain.gameObject.scene == scene && terrain.terrainData != null)
            .OrderBy(terrain => terrain.transform.position.z)
            .ThenBy(terrain => terrain.transform.position.x)
            .ToArray();

        if (terrains.Length == 0)
        {
            throw new InvalidOperationException("No Unity Terrain was found in the Arena Brawl forest scene.");
        }

        DisableLegacyGeneratedDressing(scene);
        RemoveGeneratedRoot(scene);
        var root = new GameObject(GeneratedRootName);
        var mountains = Group(root.transform, "01_Soft_Mountain_Backdrop");
        var trees = Group(root.transform, "02_Trees_And_Bushes");
        var meadow = Group(root.transform, "03_Grass_And_Flowers");
        var rocks = Group(root.transform, "04_Rock_Clusters");
        var bridges = Group(root.transform, "05_Destructible_Bridges");

        var terrainLayers = LoadTerrainLayers();
        foreach (var terrain in terrains)
        {
            SculptTerrain(terrain);
            PaintTerrain(terrain, terrainLayers);
            terrain.drawInstanced = true;
            terrain.detailObjectDistance = 95;
            terrain.treeDistance = 260;
            terrain.heightmapPixelError = 7;
        }

        var randomState = UnityEngine.Random.state;
        UnityEngine.Random.InitState(Seed);
        try
        {
            BuildMountainBackdrop(mountains, terrains);
            ScatterTrees(trees, terrains, 86);
            ScatterBushes(trees, terrains, 46);
            ScatterMeadow(meadow, terrains, 1500, "Grass01", "low", 0.24f, 0.58f, 4.2f);
            ScatterMeadow(meadow, terrains, 620, "Grass01", "tall", 0.78f, 1.45f, 5.2f);
            ScatterMeadow(meadow, terrains, 220, "Flowers01", "cluster", 0.38f, 0.78f, 5.5f);
            ScatterMeadow(meadow, terrains, 120, "Flower01", "single", 0.35f, 0.74f, 5.5f);
            ScatterRocks(rocks, terrains, 44);
            BuildBridges(bridges, terrains);
        }
        finally
        {
            UnityEngine.Random.state = randomState;
        }

        EditorSceneManager.MarkSceneDirty(scene);
        EditorSceneManager.SaveScene(scene);
        AssetDatabase.SaveAssets();
        Debug.Log($"Arena Brawl fantasy forest pass complete: {terrains.Length} terrain chunks, 3 bridges and curated Holotna dressing.");
    }

    public static void BuildAndExport()
    {
        BuildFantasyForest();
        ArenaBrawlWebAssetExporter.ExportForestToArenaBrawl();
    }

    private static Transform Group(Transform parent, string name)
    {
        var group = new GameObject(name).transform;
        group.SetParent(parent, false);
        return group;
    }

    private static void RemoveGeneratedRoot(Scene scene)
    {
        foreach (var root in scene.GetRootGameObjects())
        {
            if (root.name == GeneratedRootName) UnityEngine.Object.DestroyImmediate(root);
        }
    }

    private static void DisableLegacyGeneratedDressing(Scene scene)
    {
        foreach (var root in scene.GetRootGameObjects())
        {
            foreach (var transform in root.GetComponentsInChildren<Transform>(true))
            {
                if (transform.name == "04_Trees_Bushes_Flowers")
                {
                    transform.gameObject.SetActive(true);
                    foreach (var legacy in transform.GetComponentsInChildren<Transform>(true))
                    {
                        if (PrefabUtility.GetNearestPrefabInstanceRoot(legacy.gameObject) != legacy.gameObject) continue;
                        var legacySource = PrefabUtility.GetCorrespondingObjectFromSource(legacy.gameObject);
                        var legacyAsset = legacySource ? legacySource.name.ToLowerInvariant() : "";
                        var keepBroadleaf = legacyAsset.Contains("tree_01") || legacyAsset.Contains("tree_02");
                        legacy.gameObject.SetActive(keepBroadleaf && !legacyAsset.Contains("pine"));
                    }
                    continue;
                }

                if (transform.gameObject.GetComponent<Terrain>() != null) continue;
                if (PrefabUtility.GetNearestPrefabInstanceRoot(transform.gameObject) != transform.gameObject) continue;
                var source = PrefabUtility.GetCorrespondingObjectFromSource(transform.gameObject);
                var path = source ? AssetDatabase.GetAssetPath(source) : "";
                if (!path.StartsWith("Assets/RPGPP_LT/", StringComparison.OrdinalIgnoreCase)) continue;
                var asset = source.name.ToLowerInvariant();
                if (asset.Contains("terrain_") || asset.Contains("hill_") || asset.Contains("mountain_"))
                {
                    transform.gameObject.SetActive(false);
                }
            }
        }
    }

    private static TerrainLayer[] LoadTerrainLayers()
    {
        var paths = new[]
        {
            $"{HolotnaRoot}/Misc/Ground01.terrainlayer",
            $"{HolotnaRoot}/Misc/Ground02.terrainlayer",
            $"{HolotnaRoot}/Misc/Ground03.terrainlayer"
        };
        var layers = paths.Select(AssetDatabase.LoadAssetAtPath<TerrainLayer>).ToArray();
        if (layers.Any(layer => layer == null))
        {
            throw new FileNotFoundException("Holotna terrain layers are missing. Reimport the Mountain asset before building the forest.");
        }
        return layers;
    }

    private static void SculptTerrain(Terrain terrain)
    {
        var data = terrain.terrainData;
        var resolution = data.heightmapResolution;
        var heights = new float[resolution, resolution];
        var origin = terrain.transform.position;
        var size = data.size;

        for (var z = 0; z < resolution; z++)
        {
            var nz = z / (float)(resolution - 1);
            for (var x = 0; x < resolution; x++)
            {
                var nx = x / (float)(resolution - 1);
                var worldX = origin.x + nx * size.x;
                var worldZ = origin.z + nz * size.z;
                heights[z, x] = Mathf.Clamp01(FantasyHeight(worldX, worldZ) / size.y);
            }
        }

        data.SetHeights(0, 0, heights);
        terrain.Flush();
        EditorUtility.SetDirty(data);
    }

    private static float FantasyHeight(float x, float z)
    {
        var absEdge = Mathf.Max(Mathf.Abs(x), Mathf.Abs(z));
        var edge = Smooth01((absEdge - 104f) / 42f);
        var height = 0.55f + edge * edge * 15.5f;

        height += Gaussian(x, z, -118, 92, 41, 12.5f);
        height += Gaussian(x, z, 112, 88, 48, 16.5f);
        height += Gaussian(x, z, -108, -104, 50, 13.5f);
        height += Gaussian(x, z, 112, -100, 45, 14.5f);
        height += Gaussian(x, z, -18, 143, 38, 10.5f);
        height += Gaussian(x, z, 18, -143, 42, 9.5f);
        height += Gaussian(x, z, -56, 28, 31, 4.2f);
        height += Gaussian(x, z, 54, 42, 34, 4.8f);
        height += Gaussian(x, z, -48, -48, 32, 3.8f);
        height += Gaussian(x, z, 52, -58, 34, 4.4f);

        var broadNoise = Mathf.PerlinNoise((x + 320f) * 0.012f, (z - 170f) * 0.012f) - 0.5f;
        var detailNoise = Mathf.PerlinNoise((x - 70f) * 0.032f, (z + 260f) * 0.032f) - 0.5f;
        height += broadNoise * 2.2f + detailNoise * 0.48f;

        // Two shallow ravines create readable elevated routes without turning the arena into sharp cliffs.
        height -= Gaussian(x, z, -35, 42, 11, 2.8f);
        height -= Gaussian(x, z, 54, -38, 10, 2.5f);

        foreach (var clearing in SpawnClearings)
        {
            var distance = Vector2.Distance(new Vector2(x, z), clearing);
            var blend = 1f - Smooth01((distance - 8f) / 10f);
            height = Mathf.Lerp(height, 0.7f, blend * 0.94f);
        }

        var point = new Vector2(x, z);
        var laneBlend = 0f;
        foreach (var spawn in SpawnClearings)
        {
            var inner = spawn.normalized * 22f;
            var distance = DistanceToSegment(point, spawn, inner);
            laneBlend = Mathf.Max(laneBlend, 1f - Smooth01((distance - 4.5f) / 9f));
        }
        height = Mathf.Lerp(height, 0.82f + broadNoise * 0.18f, laneBlend * 0.82f);

        var centerBlend = 1f - Smooth01((new Vector2(x, z).magnitude - 26f) / 20f);
        height = Mathf.Lerp(height, 0.7f + broadNoise * 0.28f, centerBlend * 0.84f);
        return Mathf.Max(0.18f, height);
    }

    private static float Gaussian(float x, float z, float cx, float cz, float radius, float amplitude)
    {
        var dx = x - cx;
        var dz = z - cz;
        return Mathf.Exp(-(dx * dx + dz * dz) / (2f * radius * radius)) * amplitude;
    }

    private static float DistanceToSegment(Vector2 point, Vector2 start, Vector2 end)
    {
        var segment = end - start;
        var denominator = Mathf.Max(0.0001f, Vector2.Dot(segment, segment));
        var t = Mathf.Clamp01(Vector2.Dot(point - start, segment) / denominator);
        return Vector2.Distance(point, start + segment * t);
    }

    private static float Smooth01(float value)
    {
        value = Mathf.Clamp01(value);
        return value * value * (3f - 2f * value);
    }

    private static void PaintTerrain(Terrain terrain, TerrainLayer[] layers)
    {
        var data = terrain.terrainData;
        data.terrainLayers = layers;
        var resolution = data.alphamapResolution;
        var alpha = new float[resolution, resolution, layers.Length];
        var origin = terrain.transform.position;

        for (var z = 0; z < resolution; z++)
        {
            var nz = z / (float)(resolution - 1);
            for (var x = 0; x < resolution; x++)
            {
                var nx = x / (float)(resolution - 1);
                var worldX = origin.x + nx * data.size.x;
                var worldZ = origin.z + nz * data.size.z;
                var worldY = FantasyHeight(worldX, worldZ);
                var slope = data.GetSteepness(nx, nz) / 55f;
                var path = Mathf.Max(
                    1f - Smooth01((Mathf.Abs(worldX) - 5f) / 12f),
                    1f - Smooth01((Mathf.Abs(worldZ) - 5f) / 12f)
                ) * (1f - Smooth01((new Vector2(worldX, worldZ).magnitude - 118f) / 18f));
                var breakup = Mathf.PerlinNoise(worldX * 0.045f + 18f, worldZ * 0.045f - 7f);
                var rock = Mathf.Clamp01((slope - 0.25f) * 1.8f + Mathf.Max(0, worldY - 12f) / 15f);
                var dirt = Mathf.Clamp01(0.06f + path * 0.5f + (breakup - 0.72f) * 0.22f) * (1f - rock * 0.7f);
                var grass = Mathf.Max(0.05f, 1f - rock - dirt);
                var sum = grass + rock + dirt;
                alpha[z, x, 0] = grass / sum;
                alpha[z, x, 1] = rock / sum;
                alpha[z, x, 2] = dirt / sum;
            }
        }

        data.SetAlphamaps(0, 0, alpha);
        EditorUtility.SetDirty(data);
    }

    private static void BuildMountainBackdrop(Transform parent, Terrain[] terrains)
    {
        var prefab = LoadPrefab("Mountain01");
        var sites = new[]
        {
            new Vector3(-142, 0, 112), new Vector3(-112, 0, 145), new Vector3(-25, 0, 148),
            new Vector3(62, 0, 148), new Vector3(139, 0, 106), new Vector3(148, 0, 20),
            new Vector3(145, 0, -86), new Vector3(102, 0, -145), new Vector3(10, 0, -148),
            new Vector3(-74, 0, -147), new Vector3(-144, 0, -104), new Vector3(-148, 0, -18)
        };

        for (var i = 0; i < sites.Length; i++)
        {
            var targetHeight = 18f + (i % 4) * 4.5f;
            var instance = PlacePrefab(prefab, parent, $"fantasy_mountain_{i + 1:00}", sites[i], UnityEngine.Random.Range(0f, 360f));
            ScaleToHeight(instance, targetHeight);
            var scale = instance.transform.localScale;
            instance.transform.localScale = new Vector3(scale.x * 1.22f, scale.y * 0.78f, scale.z * 1.22f);
            SnapBottomToTerrain(instance, terrains, 0.05f);
        }
    }

    private static void ScatterTrees(Transform parent, Terrain[] terrains, int count)
    {
        var treeA = LoadPrefab("Tree01A");
        var treeB = LoadPrefab("Tree01B");
        Scatter(parent, terrains, count, 32f, 142f, 11f, (index, position) =>
        {
            var instance = PlacePrefab(index % 3 == 0 ? treeB : treeA, parent, $"fantasy_tree_{index + 1:000}", position, UnityEngine.Random.Range(0f, 360f));
            ScaleToHeight(instance, UnityEngine.Random.Range(6.8f, 11.8f));
            SnapBottomToTerrain(instance, terrains);
        });
    }

    private static void ScatterBushes(Transform parent, Terrain[] terrains, int count)
    {
        var prefab = LoadPrefab("Bush01");
        Scatter(parent, terrains, count, 22f, 138f, 8f, (index, position) =>
        {
            var instance = PlacePrefab(prefab, parent, $"fantasy_bush_{index + 1:000}", position, UnityEngine.Random.Range(0f, 360f));
            ScaleToHeight(instance, UnityEngine.Random.Range(0.85f, 1.65f));
            SnapBottomToTerrain(instance, terrains, 0.02f);
        });
    }

    private static void ScatterMeadow(
        Transform parent,
        Terrain[] terrains,
        int count,
        string prefix,
        string layer,
        float minHeight,
        float maxHeight,
        float clearingRadius)
    {
        var variants = prefix == "Grass01" ? new[] { "Grass01A", "Grass01B", "Grass01C" }
            : prefix == "Flowers01" ? new[] { "Flowers01A", "Flowers01B" }
            : new[] { "Flower01A", "Flower01B" };
        var prefabs = variants.Select(LoadPrefab).ToArray();
        Scatter(
            parent,
            terrains,
            count,
            18f,
            135f,
            clearingRadius,
            (index, position) =>
            {
                var instance = PlacePrefab(
                    prefabs[index % prefabs.Length],
                    parent,
                    $"fantasy_{prefix.ToLowerInvariant()}_{layer}_{index + 1:000}",
                    position,
                    UnityEngine.Random.Range(0f, 360f));
                ScaleToHeight(instance, UnityEngine.Random.Range(minHeight, maxHeight));
                SnapBottomToTerrain(instance, terrains, 0.015f);
            },
            position =>
            {
                var broadPatch = Mathf.PerlinNoise((position.x + 180f) * 0.026f, (position.z + 180f) * 0.026f);
                var detailPatch = Mathf.PerlinNoise((position.x + 71f) * 0.071f, (position.z + 93f) * 0.071f);
                var threshold = prefix == "Grass01"
                    ? (layer == "tall" ? 0.47f : 0.31f)
                    : 0.54f;
                return broadPatch * 0.72f + detailPatch * 0.28f >= threshold;
            });
    }

    private static void ScatterRocks(Transform parent, Terrain[] terrains, int count)
    {
        var prefabs = new[] { LoadPrefab("Rock01"), LoadPrefab("Rock02"), LoadPrefab("Pebbles01") };
        Scatter(parent, terrains, count, 25f, 145f, 7f, (index, position) =>
        {
            var instance = PlacePrefab(prefabs[index % prefabs.Length], parent, $"fantasy_rock_{index + 1:000}", position, UnityEngine.Random.Range(0f, 360f));
            ScaleToHeight(instance, index % 3 == 2 ? UnityEngine.Random.Range(0.3f, 0.75f) : UnityEngine.Random.Range(0.75f, 2.6f));
            SnapBottomToTerrain(instance, terrains, -0.04f);
        });
    }

    private static void Scatter(
        Transform parent,
        Terrain[] terrains,
        int count,
        float minRadius,
        float maxRadius,
        float clearingRadius,
        Action<int, Vector3> place,
        Func<Vector3, bool> placementFilter = null)
    {
        var placed = 0;
        var attempts = 0;
        while (placed < count && attempts++ < count * 45)
        {
            var position = new Vector3(UnityEngine.Random.Range(-145f, 145f), 0, UnityEngine.Random.Range(-145f, 145f));
            var radius = new Vector2(position.x, position.z).magnitude;
            if (radius < minRadius || radius > maxRadius || IsProtected(position, clearingRadius)) continue;
            if (!TrySampleTerrain(terrains, position.x, position.z, out var y, out var normal)) continue;
            if (normal.y < 0.74f) continue;
            position.y = y;
            if (placementFilter != null && !placementFilter(position)) continue;
            place(placed++, position);
        }
    }

    private static bool IsProtected(Vector3 position, float radius)
    {
        var point = new Vector2(position.x, position.z);
        if (SpawnClearings.Any(spawn => Vector2.Distance(point, spawn) < radius)) return true;
        return BridgeSites.Any(site => Vector2.Distance(point, new Vector2(site.position.x, site.position.z)) < radius + 7f);
    }

    private static void BuildBridges(Transform parent, Terrain[] terrains)
    {
        var prefab = LoadPrefab("Bridge01");
        for (var i = 0; i < BridgeSites.Length; i++)
        {
            var site = BridgeSites[i];
            var instance = PlacePrefab(prefab, parent, site.name, site.position, site.yaw);
            ScaleToHorizontalLength(instance, site.length);
            var forward = Quaternion.Euler(0, site.yaw, 0) * Vector3.forward;
            var left = site.position - forward * (site.length * 0.43f);
            var right = site.position + forward * (site.length * 0.43f);
            TrySampleTerrain(terrains, left.x, left.z, out var leftY, out _);
            TrySampleTerrain(terrains, right.x, right.z, out var rightY, out _);
            var deckY = Mathf.Max(leftY, rightY) + 0.65f;
            instance.transform.position = new Vector3(site.position.x, deckY, site.position.z);
        }
    }

    private static GameObject LoadPrefab(string name)
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"{HolotnaRoot}/Prefabs/{name}.prefab");
        if (prefab == null) throw new InvalidOperationException($"Holotna prefab '{name}' was not found.");
        return prefab;
    }

    private static GameObject PlacePrefab(GameObject prefab, Transform parent, string name, Vector3 position, float yaw)
    {
        var instance = PrefabUtility.InstantiatePrefab(prefab, parent) as GameObject;
        if (instance == null) throw new InvalidOperationException($"Could not instantiate prefab {prefab.name}.");
        instance.name = name;
        instance.transform.SetPositionAndRotation(position, Quaternion.Euler(0, yaw, 0));
        return instance;
    }

    private static void ScaleToHeight(GameObject instance, float targetHeight)
    {
        var bounds = RendererBounds(instance);
        if (bounds.size.y <= 0.001f) return;
        instance.transform.localScale *= targetHeight / bounds.size.y;
    }

    private static void ScaleToHorizontalLength(GameObject instance, float targetLength)
    {
        var bounds = RendererBounds(instance);
        var length = Mathf.Max(bounds.size.x, bounds.size.z);
        if (length <= 0.001f) return;
        instance.transform.localScale *= targetLength / length;
    }

    private static void SnapBottomToTerrain(GameObject instance, Terrain[] terrains, float inset = 0)
    {
        if (!TrySampleTerrain(terrains, instance.transform.position.x, instance.transform.position.z, out var y, out _)) return;
        var bounds = RendererBounds(instance);
        instance.transform.position += Vector3.up * (y - bounds.min.y + inset);
    }

    private static Bounds RendererBounds(GameObject instance)
    {
        var renderers = instance.GetComponentsInChildren<Renderer>(true);
        if (renderers.Length == 0) return new Bounds(instance.transform.position, Vector3.one);
        var bounds = renderers[0].bounds;
        for (var i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
        return bounds;
    }

    private static bool TrySampleTerrain(Terrain[] terrains, float x, float z, out float y, out Vector3 normal)
    {
        foreach (var terrain in terrains)
        {
            var origin = terrain.transform.position;
            var size = terrain.terrainData.size;
            if (x < origin.x || x > origin.x + size.x || z < origin.z || z > origin.z + size.z) continue;
            var nx = Mathf.Clamp01((x - origin.x) / size.x);
            var nz = Mathf.Clamp01((z - origin.z) / size.z);
            y = terrain.SampleHeight(new Vector3(x, origin.y + size.y, z)) + origin.y;
            normal = terrain.terrainData.GetInterpolatedNormal(nx, nz);
            return true;
        }
        y = 0;
        normal = Vector3.up;
        return false;
    }
}
