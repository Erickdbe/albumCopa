#if UNITY_EDITOR
using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

[InitializeOnLoad]
public static class FloodedGroundsUrpAutoFix
{
    private const string FloodedGroundsRoot = "Assets/Flooded_Grounds";
    private const string SessionKey = "ArenaBrawl.FloodedGroundsUrpAutoFix.v1";

    static FloodedGroundsUrpAutoFix()
    {
        EditorApplication.delayCall += RunOnce;
    }

    [MenuItem("Arena Brawl/Fix Flooded Grounds URP Materials")]
    public static void RunFromMenu()
    {
        ConvertMaterials(force: true);
    }

    private static void RunOnce()
    {
        if (SessionState.GetBool(SessionKey, false))
        {
            return;
        }

        SessionState.SetBool(SessionKey, true);
        ConvertMaterials(force: false);
    }

    private static void ConvertMaterials(bool force)
    {
        if (EditorApplication.isCompiling || EditorApplication.isUpdating)
        {
            EditorApplication.delayCall += () => ConvertMaterials(force);
            return;
        }

        Shader lit = Shader.Find("Universal Render Pipeline/Lit");
        Shader unlit = Shader.Find("Universal Render Pipeline/Unlit");
        Shader particleUnlit = Shader.Find("Universal Render Pipeline/Particles/Unlit");
        Shader skybox = Shader.Find("Skybox/Procedural");

        if (lit == null)
        {
            Debug.LogWarning("[FloodedGroundsUrpAutoFix] URP Lit shader not found. Materials were not converted.");
            return;
        }

        string[] materialGuids = AssetDatabase.FindAssets("t:Material", new[] { FloodedGroundsRoot });
        int converted = 0;
        Material skyMaterial = null;

        foreach (string guid in materialGuids)
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                continue;
            }

            string currentShader = material.shader != null ? material.shader.name : string.Empty;
            if (!force && (currentShader.StartsWith("Universal Render Pipeline/", StringComparison.Ordinal) || currentShader.StartsWith("Skybox/", StringComparison.Ordinal)))
            {
                continue;
            }

            MaterialSnapshot snapshot = MaterialSnapshot.Capture(material);
            Shader targetShader = PickShader(material.name, lit, unlit, particleUnlit, skybox);
            material.shader = targetShader != null ? targetShader : lit;

            snapshot.ApplyTo(material);
            ApplySurfaceSettings(material);

            if (IsSkyMaterial(material.name))
            {
                skyMaterial = material;
            }

            EditorUtility.SetDirty(material);
            converted++;
        }

        if (skyMaterial != null)
        {
            RenderSettings.skybox = skyMaterial;
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
        }

        AssetDatabase.SaveAssets();
        SceneView.RepaintAll();
        Debug.Log($"[FloodedGroundsUrpAutoFix] Converted {converted} Flooded Grounds materials to URP-compatible shaders.");
    }

    private static Shader PickShader(string materialName, Shader lit, Shader unlit, Shader particleUnlit, Shader skybox)
    {
        if (IsSkyMaterial(materialName) && skybox != null)
        {
            return skybox;
        }

        if (IsParticleMaterial(materialName))
        {
            return particleUnlit != null ? particleUnlit : unlit;
        }

        return lit;
    }

    private static void ApplySurfaceSettings(Material material)
    {
        bool transparent = IsTransparentMaterial(material.name);
        bool water = material.name.IndexOf("Water", StringComparison.OrdinalIgnoreCase) >= 0;

        if (water && material.HasProperty("_BaseColor"))
        {
            Color color = material.GetColor("_BaseColor");
            color.a = Mathf.Clamp(color.a <= 0.01f ? 0.58f : color.a, 0.45f, 0.72f);
            material.SetColor("_BaseColor", color);
        }

        if (!transparent && !water)
        {
            material.renderQueue = -1;
            return;
        }

        if (material.HasProperty("_Surface"))
        {
            material.SetFloat("_Surface", 1f);
        }

        if (material.HasProperty("_Blend"))
        {
            material.SetFloat("_Blend", 0f);
        }

        if (material.HasProperty("_SrcBlend"))
        {
            material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
        }

        if (material.HasProperty("_DstBlend"))
        {
            material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
        }

        if (material.HasProperty("_ZWrite"))
        {
            material.SetFloat("_ZWrite", 0f);
        }

        material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        material.renderQueue = (int)RenderQueue.Transparent;
    }

    private static bool IsSkyMaterial(string name)
    {
        return name.IndexOf("Sky", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static bool IsParticleMaterial(string name)
    {
        return name.IndexOf("Particle", StringComparison.OrdinalIgnoreCase) >= 0
            || name.IndexOf("Dust", StringComparison.OrdinalIgnoreCase) >= 0
            || name.IndexOf("Halo", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static bool IsTransparentMaterial(string name)
    {
        return IsParticleMaterial(name)
            || name.IndexOf("Water", StringComparison.OrdinalIgnoreCase) >= 0
            || name.IndexOf("Glass", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private readonly struct MaterialSnapshot
    {
        private readonly Texture mainTexture;
        private readonly Texture normalTexture;
        private readonly Color color;
        private readonly bool hasColor;

        private MaterialSnapshot(Texture mainTexture, Texture normalTexture, Color color, bool hasColor)
        {
            this.mainTexture = mainTexture;
            this.normalTexture = normalTexture;
            this.color = color;
            this.hasColor = hasColor;
        }

        public static MaterialSnapshot Capture(Material material)
        {
            return new MaterialSnapshot(
                FindTexture(material, "_BaseMap", "_MainTex", "_Tex", "_Albedo", "_DiffuseMap"),
                FindTexture(material, "_BumpMap", "_NormalMap"),
                FindColor(material, out bool hasColor, "_BaseColor", "_Color", "_Tint", "_ColorTint"),
                hasColor);
        }

        public void ApplyTo(Material material)
        {
            if (mainTexture != null)
            {
                SetTexture(material, mainTexture, "_BaseMap", "_MainTex", "_Tex");
            }

            if (normalTexture != null)
            {
                SetTexture(material, normalTexture, "_BumpMap", "_NormalMap");
            }

            if (hasColor)
            {
                SetColor(material, color, "_BaseColor", "_Color", "_Tint");
            }
        }

        private static Texture FindTexture(Material material, params string[] names)
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

        private static Color FindColor(Material material, out bool hasColor, params string[] names)
        {
            foreach (string name in names)
            {
                if (material.HasProperty(name))
                {
                    hasColor = true;
                    return material.GetColor(name);
                }
            }

            hasColor = false;
            return Color.white;
        }

        private static void SetTexture(Material material, Texture texture, params string[] names)
        {
            foreach (string name in names)
            {
                if (material.HasProperty(name))
                {
                    material.SetTexture(name, texture);
                }
            }
        }

        private static void SetColor(Material material, Color color, params string[] names)
        {
            foreach (string name in names)
            {
                if (material.HasProperty(name))
                {
                    material.SetColor(name, color);
                }
            }
        }
    }
}
#endif
