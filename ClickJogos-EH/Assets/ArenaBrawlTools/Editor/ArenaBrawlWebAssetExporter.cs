using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class ArenaBrawlWebAssetExporter
{
    private const string ScenePath = "Assets/Scenes/ArenaBrawl_Forest_RPGPoly.unity";
    private const string TexturePath = "Assets/RPGPP_LT/Textures/rpgpp_lt_tex_a.tga";
    private const string ModelsSearchPath = "Assets/RPGPP_LT/Models";
    private const string HolotnaRoot = "Assets/Holotna/Mountain";
    private const string HolotnaModelsSearchPath = HolotnaRoot + "/Models";
    private const int TerrainResolution = 97;
    private static readonly string[] GroundSurfaceTokens = { "rpgpp_lt_terrain_", "rpgpp_lt_hill_", "rpgpp_lt_mountain_" };

    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    private sealed class ExportItem
    {
        public string asset;
        public string model;
        public string pack;
        public string name;
        public string group;
        public Vector3 position;
        public Vector3 rotation;
        public Vector3 scale;
    }

    private sealed class ExportCollider
    {
        public string kind;
        public string pack;
        public string source;
        public string destructibleId;
        public Bounds bounds;
    }

    private sealed class ExportTerrain
    {
        public string name;
        public Vector3 position;
        public Vector3 size;
        public int resolution;
        public float minY;
        public float maxY;
        public float[] heights;
        public float[] surface;
    }

    [MenuItem("Tools/Arena Brawl/Export RPG Poly Forest To Web")]
    public static void ExportForestToArenaBrawl()
    {
        var activeScene = SceneManager.GetActiveScene();
        if (!activeScene.IsValid() || string.IsNullOrEmpty(activeScene.path))
        {
            activeScene = EditorSceneManager.OpenScene(ResolveExportScenePath(), OpenSceneMode.Single);
        }
        Debug.Log($"Exporting Arena Brawl forest from Unity scene: {activeScene.path}");

        var projectDir = Directory.GetParent(Application.dataPath)?.FullName;
        if (string.IsNullOrEmpty(projectDir)) throw new InvalidOperationException("Could not resolve Unity project directory.");
        var repoRoot = Directory.GetParent(projectDir)?.FullName;
        if (string.IsNullOrEmpty(repoRoot)) throw new InvalidOperationException("Could not resolve repository root.");

        var webRoot = Path.Combine(repoRoot, "ArenaBrawl", "public");
        var modelOutput = Path.Combine(webRoot, "assets", "models", "rpg-poly-lite");
        var fantasyOutput = Path.Combine(webRoot, "assets", "models", "fantasy-mountain");
        var jsOutput = Path.Combine(webRoot, "js", "forest-rpg-poly-data.js");
        Directory.CreateDirectory(modelOutput);
        Directory.CreateDirectory(Path.Combine(modelOutput, "models"));
        Directory.CreateDirectory(Path.Combine(fantasyOutput, "models"));
        Directory.CreateDirectory(Path.Combine(fantasyOutput, "textures"));

        ExportTextureAtlas(Path.Combine(modelOutput, "rpgpp_lt_tex_a.png"));
        ExportFantasyTextures(projectDir, fantasyOutput);

        var rpgModelPaths = BuildModelPathMap(ModelsSearchPath);
        var fantasyModelPaths = BuildModelPathMap(HolotnaModelsSearchPath);
        var copiedAssets = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var items = new List<ExportItem>();
        var colliders = new List<ExportCollider>();
        var terrains = new List<ExportTerrain>();

        foreach (var root in SceneManager.GetActiveScene().GetRootGameObjects())
        {
            foreach (var terrain in root.GetComponentsInChildren<Terrain>(true))
            {
                var exported = BuildTerrainExport(terrain);
                if (exported != null) terrains.Add(exported);
            }

            foreach (var transform in root.GetComponentsInChildren<Transform>(true))
            {
                var gameObject = transform.gameObject;
                if (gameObject.GetComponent<Terrain>() != null) continue;
                if (!gameObject.activeInHierarchy) continue;
                if (PrefabUtility.GetNearestPrefabInstanceRoot(gameObject) != gameObject) continue;

                var source = PrefabUtility.GetCorrespondingObjectFromSource(gameObject);
                var prefabPath = source ? AssetDatabase.GetAssetPath(source) : "";
                var pack = prefabPath.StartsWith("Assets/RPGPP_LT/", StringComparison.OrdinalIgnoreCase) ? "rpg"
                    : prefabPath.StartsWith(HolotnaRoot + "/", StringComparison.OrdinalIgnoreCase) ? "holotna"
                    : null;
                if (pack == null) continue;

                var assetName = Path.GetFileNameWithoutExtension(prefabPath);
                var modelName = pack == "holotna" ? HolotnaModelName(assetName) : assetName;
                var modelPaths = pack == "holotna" ? fantasyModelPaths : rpgModelPaths;
                if (!modelPaths.TryGetValue(modelName, out var sourceModelPath))
                {
                    Debug.LogWarning($"No FBX model found for {assetName} from {prefabPath}");
                    continue;
                }

                var outputRoot = pack == "holotna" ? fantasyOutput : modelOutput;
                var targetModelPath = Path.Combine(outputRoot, "models", $"{modelName}.fbx");
                File.Copy(Path.Combine(projectDir, sourceModelPath), targetModelPath, true);
                copiedAssets.Add($"{pack}:{modelName}");

                items.Add(new ExportItem
                {
                    asset = assetName,
                    model = modelName,
                    pack = pack,
                    name = gameObject.name,
                    group = gameObject.transform.parent ? gameObject.transform.parent.name : "",
                    position = gameObject.transform.position,
                    rotation = gameObject.transform.eulerAngles,
                    scale = gameObject.transform.lossyScale
                });

                if (TryBuildCollider(gameObject, assetName, pack, out var collider))
                {
                    colliders.Add(collider);
                }
            }
        }

        if (items.Count == 0 && terrains.Count == 0)
        {
            throw new InvalidOperationException(
                $"No RPG Poly prefabs or Unity terrains found in scene '{SceneManager.GetActiveScene().path}'. Save the map scene or open the correct scene before exporting."
            );
        }

        WriteDataModule(jsOutput, items, colliders, terrains);
        AssetDatabase.Refresh();
        Debug.Log($"Exported {items.Count} RPG Poly forest items, {colliders.Count} colliders, {terrains.Count} terrains and {copiedAssets.Count} FBX assets to Arena Brawl.");
    }

    [MenuItem("Tools/Arena Brawl/Snap Forest Objects To Ground")]
    public static void SnapForestObjectsToGround()
    {
        var activeScene = SceneManager.GetActiveScene();
        if (!activeScene.IsValid() || string.IsNullOrEmpty(activeScene.path))
        {
            activeScene = EditorSceneManager.OpenScene(ResolveExportScenePath(), OpenSceneMode.Single);
        }

        var groundColliders = new List<Collider>();
        var candidates = new List<Transform>();
        foreach (var root in SceneManager.GetActiveScene().GetRootGameObjects())
        {
            foreach (var transform in root.GetComponentsInChildren<Transform>(true))
            {
                var gameObject = transform.gameObject;
                if (gameObject.GetComponent<Terrain>() != null) continue;
                if (PrefabUtility.GetNearestPrefabInstanceRoot(gameObject) != gameObject) continue;

                var source = PrefabUtility.GetCorrespondingObjectFromSource(gameObject);
                var prefabPath = source ? AssetDatabase.GetAssetPath(source) : "";
                if (!prefabPath.StartsWith("Assets/RPGPP_LT/", StringComparison.OrdinalIgnoreCase)) continue;

                var assetName = Path.GetFileNameWithoutExtension(prefabPath);
                if (IsGroundSurfaceAsset(assetName))
                {
                    groundColliders.AddRange(gameObject.GetComponentsInChildren<Collider>(true));
                }
                else
                {
                    candidates.Add(transform);
                }
            }
        }

        Physics.SyncTransforms();
        var snapped = 0;
        foreach (var transform in candidates)
        {
            if (!TryFindGroundY(transform.position, groundColliders, out var groundY)) continue;

            var position = transform.position;
            var desiredY = groundY + 0.015f;
            if (desiredY <= position.y + 0.04f && position.y >= groundY - 0.12f) continue;

            Undo.RecordObject(transform, "Snap Arena Brawl object to ground");
            transform.position = new Vector3(position.x, desiredY, position.z);
            snapped++;
        }

        if (snapped > 0)
        {
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            EditorSceneManager.SaveScene(SceneManager.GetActiveScene());
        }

        Debug.Log($"Arena Brawl forest snap complete. Adjusted {snapped} objects using {groundColliders.Count} ground colliders.");
    }

    private static Dictionary<string, string> BuildModelPathMap(string searchPath)
    {
        return AssetDatabase.FindAssets("t:Model", new[] { searchPath })
            .Select(AssetDatabase.GUIDToAssetPath)
            .Where(path => path.EndsWith(".fbx", StringComparison.OrdinalIgnoreCase))
            .GroupBy(path => Path.GetFileNameWithoutExtension(path), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
    }

    private static string HolotnaModelName(string prefabName)
    {
        if (prefabName.StartsWith("Tree01", StringComparison.OrdinalIgnoreCase)) return "Tree01";
        if (prefabName.StartsWith("Grass01", StringComparison.OrdinalIgnoreCase)) return "Grass01";
        if (prefabName.StartsWith("Flowers01", StringComparison.OrdinalIgnoreCase)) return "Flowers01";
        if (prefabName.StartsWith("Flower01", StringComparison.OrdinalIgnoreCase)) return "Flower01";
        return prefabName;
    }

    private static string ResolveExportScenePath()
    {
        if (File.Exists(Path.Combine(Application.dataPath, ScenePath.Substring("Assets/".Length))))
        {
            return ScenePath;
        }

        var buildScene = EditorBuildSettings.scenes
            .Where(scene => scene.enabled && !string.IsNullOrEmpty(scene.path))
            .Select(scene => scene.path)
            .FirstOrDefault();
        return string.IsNullOrEmpty(buildScene) ? ScenePath : buildScene;
    }

    private static bool IsGroundSurfaceAsset(string assetName)
    {
        var lower = assetName.ToLowerInvariant();
        return GroundSurfaceTokens.Any(token => lower.Contains(token));
    }

    private static bool TryFindGroundY(Vector3 position, IReadOnlyList<Collider> groundColliders, out float groundY)
    {
        groundY = 0;
        if (groundColliders.Count == 0) return false;

        var ray = new Ray(new Vector3(position.x, Mathf.Max(96f, position.y + 48f), position.z), Vector3.down);
        var best = float.NegativeInfinity;
        foreach (var collider in groundColliders)
        {
            if (collider == null || !collider.enabled) continue;
            if (!collider.Raycast(ray, out var hit, 180f)) continue;
            if (hit.point.y > best) best = hit.point.y;
        }

        if (float.IsNegativeInfinity(best)) return false;
        groundY = best;
        return true;
    }

    private static void ExportTextureAtlas(string outputPath)
    {
        var importer = AssetImporter.GetAtPath(TexturePath) as TextureImporter;
        if (importer == null) throw new FileNotFoundException("RPG Poly texture importer not found.", TexturePath);

        var wasReadable = importer.isReadable;
        var oldCompression = importer.textureCompression;
        try
        {
            importer.isReadable = true;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.SaveAndReimport();

            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(TexturePath);
            if (texture == null) throw new FileNotFoundException("RPG Poly texture not found.", TexturePath);
            File.WriteAllBytes(outputPath, texture.EncodeToPNG());
        }
        finally
        {
            importer.isReadable = wasReadable;
            importer.textureCompression = oldCompression;
            importer.SaveAndReimport();
        }
    }

    private static void ExportFantasyTextures(string projectDir, string outputRoot)
    {
        var textureOutput = Path.Combine(outputRoot, "textures");
        var textureNames = new[] { "Bridge01", "Bush01", "Flower01", "Grass01", "Leaf01", "Rock01", "Trunk01" };
        foreach (var name in textureNames)
        {
            var colored = $"{HolotnaRoot}/Textures/Colored/{name}_ALB.png";
            var regular = $"{HolotnaRoot}/Textures/{name}_ALB.png";
            var source = File.Exists(Path.Combine(projectDir, colored)) ? colored : regular;
            var absoluteSource = Path.Combine(projectDir, source);
            if (!File.Exists(absoluteSource)) throw new FileNotFoundException($"Holotna texture is missing: {source}");
            File.Copy(absoluteSource, Path.Combine(textureOutput, $"{name}_ALB.png"), true);
        }

        for (var i = 1; i <= 3; i++)
        {
            var source = Path.Combine(projectDir, HolotnaRoot, "Misc", $"Ground0{i}.png");
            if (!File.Exists(source)) throw new FileNotFoundException($"Holotna ground texture is missing: Ground0{i}.png");
            File.Copy(source, Path.Combine(textureOutput, $"Ground0{i}.png"), true);
        }
    }

    private static bool TryBuildCollider(GameObject gameObject, string assetName, string pack, out ExportCollider collider)
    {
        collider = null;

        var lower = assetName.ToLowerInvariant();
        if (lower.Contains("terrain") || lower.Contains("grass_small") || lower.Contains("flower") ||
            lower.Contains("bush") || lower.Contains("plant") || lower.Contains("cloud"))
        {
            return false;
        }
        if (pack == "holotna" && (lower.Contains("grass") || lower.Contains("pebbles") || lower.Contains("mountain"))) return false;

        var bounds = CalculateRendererBounds(gameObject);
        if (bounds.size.x < 0.08f || bounds.size.z < 0.08f || bounds.size.y < 0.04f) return false;

        var kind = "solid";
        if ((lower.Contains("wood_path") || lower.Contains("bridge")) && bounds.center.y > 0.25f) kind = "platform";
        if (lower.Contains("ladder")) kind = "ladder";
        if (pack == "holotna" && lower.Contains("bridge"))
        {
            var size = bounds.size;
            size.x *= 0.82f;
            size.z *= 0.94f;
            size.y = 0.34f;
            bounds = new Bounds(new Vector3(bounds.center.x, bounds.min.y + 0.34f, bounds.center.z), size);
        }
        else if (lower.Contains("tree_") || lower.Contains("tree_pine") || (pack == "holotna" && lower.StartsWith("tree")))
        {
            var trunkWidth = Mathf.Clamp(Mathf.Max(gameObject.transform.lossyScale.x, gameObject.transform.lossyScale.z) * 0.68f, 0.58f, 2.5f);
            var trunkHeight = Mathf.Max(2.4f, bounds.size.y * 0.72f);
            bounds = new Bounds(
                new Vector3(gameObject.transform.position.x, bounds.min.y + trunkHeight * 0.5f, gameObject.transform.position.z),
                new Vector3(trunkWidth, trunkHeight, trunkWidth)
            );
        }
        else if (pack == "holotna" && lower.StartsWith("rock"))
        {
            var size = bounds.size;
            size.x *= 0.72f;
            size.z *= 0.72f;
            bounds.size = size;
        }
        else if (lower.Contains("fence"))
        {
            var size = bounds.size;
            if (size.x >= size.z)
            {
                size.x *= 0.88f;
                size.z *= 0.46f;
            }
            else
            {
                size.x *= 0.46f;
                size.z *= 0.88f;
            }
            bounds.size = size;
        }
        else if (lower.Contains("barrel") || lower.Contains("crate") || lower.Contains("bench") || lower.Contains("sign"))
        {
            var size = bounds.size;
            size.x *= 0.78f;
            size.z *= 0.78f;
            bounds.size = size;
        }

        collider = new ExportCollider
        {
            kind = kind,
            pack = pack,
            source = assetName,
            destructibleId = lower.Contains("bridge") && gameObject.name.Contains("destructible") ? gameObject.name : "",
            bounds = bounds
        };
        return true;
    }

    private static Bounds CalculateRendererBounds(GameObject gameObject)
    {
        var renderers = gameObject.GetComponentsInChildren<Renderer>();
        if (renderers.Length == 0) return new Bounds(gameObject.transform.position, Vector3.zero);
        var bounds = renderers[0].bounds;
        for (var i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
        return bounds;
    }

    private static ExportTerrain BuildTerrainExport(Terrain terrain)
    {
        var data = terrain.terrainData;
        if (data == null) return null;

        var resolution = TerrainResolution;
        var heights = new float[resolution * resolution];
        var surface = new float[resolution * resolution * 3];
        var minY = float.PositiveInfinity;
        var maxY = float.NegativeInfinity;
        var origin = terrain.transform.position;
        var size = data.size;
        var alphaWidth = data.alphamapWidth;
        var alphaHeight = data.alphamapHeight;
        var alpha = data.alphamapLayers > 0 ? data.GetAlphamaps(0, 0, alphaWidth, alphaHeight) : null;

        for (var z = 0; z < resolution; z++)
        {
            var nz = z / (float)(resolution - 1);
            for (var x = 0; x < resolution; x++)
            {
                var nx = x / (float)(resolution - 1);
                var worldX = origin.x + nx * size.x;
                var worldZ = origin.z + nz * size.z;
                var worldY = terrain.SampleHeight(new Vector3(worldX, origin.y + 100f, worldZ)) + origin.y;
                var index = z * resolution + x;
                heights[index] = worldY;
                var alphaX = Mathf.Clamp(Mathf.RoundToInt(nx * (alphaWidth - 1)), 0, Mathf.Max(0, alphaWidth - 1));
                var alphaZ = Mathf.Clamp(Mathf.RoundToInt(nz * (alphaHeight - 1)), 0, Mathf.Max(0, alphaHeight - 1));
                var grass = alpha != null && data.alphamapLayers > 0 ? alpha[alphaZ, alphaX, 0] : 1f;
                var rock = alpha != null && data.alphamapLayers > 1 ? alpha[alphaZ, alphaX, 1] : 0f;
                var dirt = alpha != null && data.alphamapLayers > 2 ? alpha[alphaZ, alphaX, 2] : 0f;
                var surfaceIndex = index * 3;
                surface[surfaceIndex] = grass;
                surface[surfaceIndex + 1] = rock;
                surface[surfaceIndex + 2] = dirt;
                minY = Mathf.Min(minY, worldY);
                maxY = Mathf.Max(maxY, worldY);
            }
        }

        return new ExportTerrain
        {
            name = terrain.name,
            position = origin,
            size = size,
            resolution = resolution,
            minY = minY,
            maxY = maxY,
            heights = heights,
            surface = surface
        };
    }

    private static void WriteDataModule(string path, IReadOnlyList<ExportItem> items, IReadOnlyList<ExportCollider> colliders, IReadOnlyList<ExportTerrain> terrains)
    {
        var builder = new StringBuilder();
        builder.AppendLine("// Auto-generated by Unity: Tools > Arena Brawl > Export RPG Poly Forest To Web");
        builder.AppendLine("// Do not edit placements by hand; edit the Unity scene and export again.");
        builder.AppendLine("export const RPG_POLY_BASE_PATH = \"./assets/models/rpg-poly-lite/\";");
        builder.AppendLine("export const RPG_POLY_TEXTURE = \"rpgpp_lt_tex_a.png\";");
        builder.AppendLine("export const FANTASY_MOUNTAIN_BASE_PATH = \"./assets/models/fantasy-mountain/\";");
        builder.AppendLine("export const FANTASY_MOUNTAIN_TEXTURES = { bridge: \"Bridge01_ALB.png\", bush: \"Bush01_ALB.png\", flower: \"Flower01_ALB.png\", grass: \"Grass01_ALB.png\", leaf: \"Leaf01_ALB.png\", rock: \"Rock01_ALB.png\", trunk: \"Trunk01_ALB.png\", ground: [\"Ground01.png\", \"Ground02.png\", \"Ground03.png\"] };");
        builder.AppendLine("export const RPG_POLY_FOREST_TERRAINS = [");
        foreach (var terrain in terrains.OrderBy(terrain => terrain.name))
        {
            builder.Append("  ");
            builder.Append("{ name: ").Append(Q(terrain.name));
            builder.Append(", position: ").Append(Vec(terrain.position));
            builder.Append(", size: ").Append(Vec(terrain.size));
            builder.Append(", resolution: ").Append(terrain.resolution);
            builder.Append(", minY: ").Append(F(terrain.minY));
            builder.Append(", maxY: ").Append(F(terrain.maxY));
            builder.Append(", heights: [");
            for (var i = 0; i < terrain.heights.Length; i++)
            {
                if (i > 0) builder.Append(", ");
                builder.Append(F(terrain.heights[i]));
            }
            builder.Append("], surface: [");
            for (var i = 0; i < terrain.surface.Length; i++)
            {
                if (i > 0) builder.Append(", ");
                builder.Append(F(terrain.surface[i]));
            }
            builder.AppendLine("] },");
        }
        builder.AppendLine("];");
        builder.AppendLine("export const RPG_POLY_FOREST_ITEMS = [");
        foreach (var item in items.OrderBy(item => item.group).ThenBy(item => item.asset).ThenBy(item => item.name))
        {
            builder.Append("  ");
            builder.Append("{ asset: ").Append(Q(item.asset));
            builder.Append(", model: ").Append(Q(item.model));
            builder.Append(", pack: ").Append(Q(item.pack));
            builder.Append(", name: ").Append(Q(item.name));
            builder.Append(", group: ").Append(Q(item.group));
            builder.Append(", position: ").Append(Vec(item.position));
            builder.Append(", rotation: ").Append(Vec(item.rotation));
            builder.Append(", scale: ").Append(Vec(item.scale));
            builder.AppendLine(" },");
        }
        builder.AppendLine("];");
        builder.AppendLine("export const RPG_POLY_FOREST_COLLIDERS = [");
        foreach (var collider in colliders.OrderBy(collider => collider.kind).ThenBy(collider => collider.source))
        {
            var bounds = collider.bounds;
            builder.Append("  ");
            builder.Append("{ kind: ").Append(Q(collider.kind));
            builder.Append(", pack: ").Append(Q(collider.pack));
            builder.Append(", source: ").Append(Q(collider.source));
            builder.Append(", destructibleId: ").Append(Q(collider.destructibleId ?? ""));
            builder.Append(", minX: ").Append(F(bounds.min.x));
            builder.Append(", maxX: ").Append(F(bounds.max.x));
            builder.Append(", minY: ").Append(F(bounds.min.y));
            builder.Append(", maxY: ").Append(F(bounds.max.y));
            builder.Append(", minZ: ").Append(F(bounds.min.z));
            builder.Append(", maxZ: ").Append(F(bounds.max.z));
            builder.AppendLine(" },");
        }
        builder.AppendLine("];");
        File.WriteAllText(path, builder.ToString(), Encoding.UTF8);
    }

    private static string Vec(Vector3 value)
    {
        return $"[{F(value.x)}, {F(value.y)}, {F(value.z)}]";
    }

    private static string F(float value)
    {
        return value.ToString("0.#####", Invariant);
    }

    private static string Q(string value)
    {
        return $"\"{value.Replace("\\", "\\\\").Replace("\"", "\\\"")}\"";
    }
}
