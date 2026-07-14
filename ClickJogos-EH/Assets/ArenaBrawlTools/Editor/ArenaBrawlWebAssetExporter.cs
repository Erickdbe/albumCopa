using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class ArenaBrawlWebAssetExporter
{
    private const string TexturePath = "Assets/RPGPP_LT/Textures/rpgpp_lt_tex_a.tga";
    private const string ModelsSearchPath = "Assets/RPGPP_LT/Models";

    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    private sealed class ExportItem
    {
        public string asset;
        public string name;
        public string group;
        public Vector3 position;
        public Vector3 rotation;
        public Vector3 scale;
    }

    private sealed class ExportCollider
    {
        public string kind;
        public string source;
        public Bounds bounds;
    }

    [MenuItem("Tools/Arena Brawl/Export RPG Poly Forest To Web")]
    public static void ExportForestToArenaBrawl()
    {
        ArenaBrawlForestMapBuilder.BuildForestScene();

        var projectDir = Directory.GetParent(Application.dataPath)?.FullName;
        if (string.IsNullOrEmpty(projectDir)) throw new InvalidOperationException("Could not resolve Unity project directory.");
        var repoRoot = Directory.GetParent(projectDir)?.FullName;
        if (string.IsNullOrEmpty(repoRoot)) throw new InvalidOperationException("Could not resolve repository root.");

        var webRoot = Path.Combine(repoRoot, "ArenaBrawl", "public");
        var modelOutput = Path.Combine(webRoot, "assets", "models", "rpg-poly-lite");
        var jsOutput = Path.Combine(webRoot, "js", "forest-rpg-poly-data.js");
        Directory.CreateDirectory(modelOutput);
        Directory.CreateDirectory(Path.Combine(modelOutput, "models"));

        ExportTextureAtlas(Path.Combine(modelOutput, "rpgpp_lt_tex_a.png"));

        var modelPaths = BuildModelPathMap();
        var copiedAssets = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var items = new List<ExportItem>();
        var colliders = new List<ExportCollider>();

        foreach (var root in SceneManager.GetActiveScene().GetRootGameObjects())
        {
            foreach (var transform in root.GetComponentsInChildren<Transform>(true))
            {
                var gameObject = transform.gameObject;
                if (PrefabUtility.GetNearestPrefabInstanceRoot(gameObject) != gameObject) continue;

                var source = PrefabUtility.GetCorrespondingObjectFromSource(gameObject);
                var prefabPath = source ? AssetDatabase.GetAssetPath(source) : "";
                if (!prefabPath.StartsWith("Assets/RPGPP_LT/", StringComparison.OrdinalIgnoreCase)) continue;

                var assetName = Path.GetFileNameWithoutExtension(prefabPath);
                if (!modelPaths.TryGetValue(assetName, out var sourceModelPath))
                {
                    Debug.LogWarning($"No FBX model found for {assetName} from {prefabPath}");
                    continue;
                }

                var targetModelPath = Path.Combine(modelOutput, "models", $"{assetName}.fbx");
                File.Copy(Path.Combine(projectDir, sourceModelPath), targetModelPath, true);
                copiedAssets.Add(assetName);

                items.Add(new ExportItem
                {
                    asset = assetName,
                    name = gameObject.name,
                    group = gameObject.transform.parent ? gameObject.transform.parent.name : "",
                    position = gameObject.transform.position,
                    rotation = gameObject.transform.eulerAngles,
                    scale = gameObject.transform.lossyScale
                });

                if (TryBuildCollider(gameObject, assetName, out var collider))
                {
                    colliders.Add(collider);
                }
            }
        }

        WriteDataModule(jsOutput, items, colliders);
        AssetDatabase.Refresh();
        Debug.Log($"Exported {items.Count} RPG Poly forest items, {colliders.Count} colliders and {copiedAssets.Count} FBX assets to Arena Brawl.");
    }

    private static Dictionary<string, string> BuildModelPathMap()
    {
        return AssetDatabase.FindAssets("t:Model", new[] { ModelsSearchPath })
            .Select(AssetDatabase.GUIDToAssetPath)
            .Where(path => path.EndsWith(".fbx", StringComparison.OrdinalIgnoreCase))
            .GroupBy(path => Path.GetFileNameWithoutExtension(path), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
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

    private static bool TryBuildCollider(GameObject gameObject, string assetName, out ExportCollider collider)
    {
        collider = null;

        var lower = assetName.ToLowerInvariant();
        if (lower.Contains("terrain") || lower.Contains("grass_small") || lower.Contains("flower") ||
            lower.Contains("bush") || lower.Contains("plant") || lower.Contains("cloud"))
        {
            return false;
        }

        var bounds = CalculateRendererBounds(gameObject);
        if (bounds.size.x < 0.08f || bounds.size.z < 0.08f || bounds.size.y < 0.04f) return false;

        var kind = "solid";
        if (lower.Contains("wood_path") && bounds.center.y > 0.25f) kind = "platform";
        if (lower.Contains("ladder")) kind = "ladder";
        if (lower.Contains("tree_") || lower.Contains("tree_pine"))
        {
            var trunkWidth = Mathf.Clamp(Mathf.Max(gameObject.transform.lossyScale.x, gameObject.transform.lossyScale.z) * 0.9f, 0.8f, 3.2f);
            bounds = new Bounds(
                new Vector3(gameObject.transform.position.x, bounds.center.y * 0.5f, gameObject.transform.position.z),
                new Vector3(trunkWidth, Mathf.Max(2.4f, bounds.size.y * 0.72f), trunkWidth)
            );
        }

        collider = new ExportCollider { kind = kind, source = assetName, bounds = bounds };
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

    private static void WriteDataModule(string path, IReadOnlyList<ExportItem> items, IReadOnlyList<ExportCollider> colliders)
    {
        var builder = new StringBuilder();
        builder.AppendLine("// Auto-generated by Unity: Tools > Arena Brawl > Export RPG Poly Forest To Web");
        builder.AppendLine("// Do not edit placements by hand; edit the Unity scene/generator and export again.");
        builder.AppendLine("export const RPG_POLY_BASE_PATH = \"./assets/models/rpg-poly-lite/\";");
        builder.AppendLine("export const RPG_POLY_TEXTURE = \"rpgpp_lt_tex_a.png\";");
        builder.AppendLine("export const RPG_POLY_FOREST_ITEMS = [");
        foreach (var item in items.OrderBy(item => item.group).ThenBy(item => item.asset).ThenBy(item => item.name))
        {
            builder.Append("  ");
            builder.Append("{ asset: ").Append(Q(item.asset));
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
            builder.Append(", source: ").Append(Q(collider.source));
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
