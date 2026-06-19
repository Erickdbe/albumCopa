using System;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;

public static class CardWarsWebGLBuilder
{
    public static void Build()
    {
        string outputPath = GetArgument("-outputPath");
        if (string.IsNullOrEmpty(outputPath))
        {
            outputPath = Environment.GetEnvironmentVariable("CARDWARS_WEBGL_OUTPUT");
        }

        if (string.IsNullOrEmpty(outputPath))
        {
            outputPath = Path.GetFullPath(Path.Combine(Path.Combine(Path.Combine(Environment.CurrentDirectory, ".."), ".."), "cardwars-unity"));
        }

        if (Directory.Exists(outputPath))
        {
            Directory.Delete(outputPath, true);
        }

        Directory.CreateDirectory(outputPath);
        ConfigureWebGL();
        PrepareStreamingAssetResources();

        try
        {
            string[] scenes = EditorBuildSettings.scenes
                .Where(scene => scene.enabled)
                .Select(scene => scene.path)
                .ToArray();

            if (scenes.Length == 0)
            {
                throw new InvalidOperationException("No enabled scenes found in EditorBuildSettings.");
            }

            string error = BuildPipeline.BuildPlayer(scenes, outputPath, BuildTarget.WebGL, BuildOptions.None);
            if (!string.IsNullOrEmpty(error))
            {
                throw new InvalidOperationException(error);
            }
        }
        finally
        {
            RemoveStreamingAssetResources();
        }
    }

    private static void ConfigureWebGL()
    {
        Type webGLSettings = typeof(PlayerSettings).GetNestedType("WebGL", BindingFlags.Public);
        if (webGLSettings == null)
        {
            return;
        }

        SetStaticProperty(webGLSettings, "compressionFormat", "Disabled");
        SetStaticProperty(webGLSettings, "memorySize", 512);
        SetStaticProperty(webGLSettings, "useWasm", true);
    }

    private static void PrepareStreamingAssetResources()
    {
        string sourceRoot = Path.Combine(Application.dataPath, "StreamingAssets");
        string destinationRoot = Path.Combine(Application.dataPath, "Resources/WebGLStreamingAssets");
        RemoveStreamingAssetResources();
        Directory.CreateDirectory(destinationRoot);

        foreach (string sourceFile in Directory.GetFiles(sourceRoot, "*", SearchOption.AllDirectories))
        {
            if (sourceFile.EndsWith(".meta", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            string relativePath = sourceFile.Substring(sourceRoot.Length)
                .TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string destinationFile = Path.Combine(destinationRoot, relativePath + ".bytes");
            Directory.CreateDirectory(Path.GetDirectoryName(destinationFile));
            File.Copy(sourceFile, destinationFile, true);
        }

        AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
    }

    private static void RemoveStreamingAssetResources()
    {
        string assetPath = "Assets/Resources/WebGLStreamingAssets";
        FileUtil.DeleteFileOrDirectory(assetPath);
        FileUtil.DeleteFileOrDirectory(assetPath + ".meta");
        AssetDatabase.Refresh();
    }

    private static void SetStaticProperty(Type type, string propertyName, object value)
    {
        PropertyInfo property = type.GetProperty(propertyName, BindingFlags.Public | BindingFlags.Static);
        if (property == null || !property.CanWrite)
        {
            return;
        }

        object typedValue = value;
        if (property.PropertyType.IsEnum && value is string)
        {
            typedValue = Enum.Parse(property.PropertyType, (string)value);
        }

        property.SetValue(null, typedValue, null);
    }

    private static string GetArgument(string name)
    {
        string[] args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
            {
                return args[i + 1];
            }
        }

        return null;
    }
}
