using System.Collections.Generic;
using System.IO;
using System.Linq;
using AventuraMundo;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class AdventureWorldBuilder
{
    const string ScenePath = "Assets/Game/Scenes/AventuraMundo3D.unity";
    const string MaterialsPath = "Assets/Game/Materials";
    const string PrefabsPath = "Assets/Game/Prefabs";
    const string CharacterSourcePath = "Assets/Game/Characters/Source";
    const string CreatureSourcePath = "Assets/Game/Creatures/Source";
    const string BossSourcePath = "Assets/Game/Bosses/Source";

    struct Zone
    {
        public string name;
        public Vector3 position;
        public Vector3 scale;
        public Color color;
        public Color accent;
        public string kind;

        public Zone(string name, Vector3 position, Vector3 scale, Color color, Color accent, string kind)
        {
            this.name = name;
            this.position = position;
            this.scale = scale;
            this.color = color;
            this.accent = accent;
            this.kind = kind;
        }
    }

    [MenuItem("Aventura/Build Prototype World")]
    public static void BuildPrototypeWorld()
    {
        Directory.CreateDirectory(MaterialsPath);
        Directory.CreateDirectory(PrefabsPath);
        Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));

        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        scene.name = "AventuraMundo3D";

        var root = new GameObject("Aventura Mundo Aberto - Prototype");
        var mats = CreateMaterials();
        var projectilePrefab = CreateProjectilePrefab(mats["Projectile"]);

        CreateLighting();
        CreateOcean(mats["Ocean"]);
        CreateWorld(root.transform, mats);
        CreateCreatures(root.transform, mats);
        var player = CreateCharacterShowcase(root.transform, mats, projectilePrefab);
        CreateCamera(player);
        CreateSceneNotes(root.transform);

        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        PlayerSettings.productName = "Aventura Mundo 3D";
        PlayerSettings.companyName = "AlbumCopaOnline";
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.dataCaching = true;
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log("Aventura Mundo 3D prototype scene generated at " + ScenePath);
    }

    [MenuItem("Aventura/Optimize Assets For WebGL")]
    public static void OptimizeAssetsForWebGL()
    {
        var textureGuids = AssetDatabase.FindAssets("t:Texture2D", new[] { CharacterSourcePath });
        foreach (var guid in textureGuids)
        {
            var path = AssetDatabase.GUIDToAssetPath(guid);
            var importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (!importer) continue;
            importer.maxTextureSize = 1024;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.crunchedCompression = true;
            importer.compressionQuality = 70;
            if (path.ToLowerInvariant().Contains("_normal"))
            {
                importer.textureType = TextureImporterType.NormalMap;
            }
            importer.SaveAndReimport();
        }

        var modelGuids = AssetDatabase.FindAssets("t:Model", new[] { CharacterSourcePath });
        foreach (var guid in modelGuids)
        {
            var path = AssetDatabase.GUIDToAssetPath(guid);
            var importer = AssetImporter.GetAtPath(path) as ModelImporter;
            if (!importer) continue;
            importer.importCameras = false;
            importer.importLights = false;
            importer.importVisibility = false;
            importer.meshCompression = ModelImporterMeshCompression.Medium;
            importer.isReadable = false;
            importer.animationType = ModelImporterAnimationType.Generic;
            importer.SaveAndReimport();
        }

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log("Aventura Mundo 3D assets optimized for WebGL.");
    }

    [MenuItem("Aventura/Build WebGL")]
    public static void BuildWebGL()
    {
        OptimizeAssetsForWebGL();
        BuildPrototypeWorld();

        var outputPath = Path.GetFullPath(Path.Combine(Application.dataPath, "../../aventura3d"));
        Directory.CreateDirectory(outputPath);
        EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);
        var report = BuildPipeline.BuildPlayer(EditorBuildSettings.scenes, outputPath, BuildTarget.WebGL, BuildOptions.None);
        Debug.Log("Aventura Mundo 3D WebGL build result: " + report.summary.result + " at " + outputPath);
    }

    static Dictionary<string, Material> CreateMaterials()
    {
        var result = new Dictionary<string, Material>();
        result["Ocean"] = MakeMaterial("MAT_Ocean", new Color(0.24f, 0.64f, 0.78f));
        result["Grass"] = MakeMaterial("MAT_CamposVerdes", new Color(0.46f, 0.72f, 0.35f));
        result["Candy"] = MakeMaterial("MAT_ReinoDoce", new Color(1f, 0.52f, 0.67f));
        result["Ice"] = MakeMaterial("MAT_ReinoGelo", new Color(0.62f, 0.88f, 1f));
        result["Fire"] = MakeMaterial("MAT_ReinoFogo", new Color(0.21f, 0.17f, 0.15f));
        result["Slime"] = MakeMaterial("MAT_ReinoGosma", new Color(0.4f, 0.75f, 0.22f));
        result["Forest"] = MakeMaterial("MAT_FlorestaGalhos", new Color(0.21f, 0.42f, 0.25f));
        result["Desert"] = MakeMaterial("MAT_DesertoDunas", new Color(0.82f, 0.67f, 0.43f));
        result["Swamp"] = MakeMaterial("MAT_PantanoMurkfen", new Color(0.28f, 0.43f, 0.25f));
        result["Ruins"] = MakeMaterial("MAT_RuinasCidade", new Color(0.34f, 0.34f, 0.36f));
        result["Crystal"] = MakeMaterial("MAT_CavernasCristal", new Color(0.48f, 0.34f, 0.82f));
        result["Night"] = MakeMaterial("MAT_Nightosfera", new Color(0.16f, 0.1f, 0.24f));
        result["Mountain"] = MakeMaterial("MAT_MontanhasArruinadas", new Color(0.47f, 0.43f, 0.36f));
        result["Final"] = MakeMaterial("MAT_ErmoFinal", new Color(0.18f, 0.17f, 0.15f));
        result["Wood"] = MakeMaterial("MAT_Wood", new Color(0.45f, 0.29f, 0.16f));
        result["Stone"] = MakeMaterial("MAT_Stone", new Color(0.54f, 0.56f, 0.54f));
        result["Lava"] = MakeMaterial("MAT_Lava", new Color(1f, 0.24f, 0.06f));
        result["Projectile"] = MakeMaterial("MAT_Projectile", new Color(1f, 0.86f, 0.22f));
        return result;
    }

    static Material MakeMaterial(string name, Color color)
    {
        var path = $"{MaterialsPath}/{name}.mat";
        var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (!mat)
        {
            var shader = Shader.Find("Standard") ?? Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Diffuse");
            mat = new Material(shader) { name = name };
            AssetDatabase.CreateAsset(mat, path);
        }
        mat.color = color;
        if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", color);
        if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", 0.35f);
        return mat;
    }

    static GameObject CreateProjectilePrefab(Material material)
    {
        var path = $"{PrefabsPath}/AdventureProjectile.prefab";
        var existing = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        if (existing) return existing;

        var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        go.name = "AdventureProjectile";
        go.transform.localScale = Vector3.one * 0.35f;
        go.GetComponent<Renderer>().sharedMaterial = material;
        go.AddComponent<AdventureProjectile>();
        var prefab = PrefabUtility.SaveAsPrefabAsset(go, path);
        Object.DestroyImmediate(go);
        return prefab;
    }

    static void CreateLighting()
    {
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.66f, 0.72f, 0.8f);
        RenderSettings.fog = true;
        RenderSettings.fogColor = new Color(0.64f, 0.78f, 0.83f);
        RenderSettings.fogDensity = 0.006f;

        var sun = new GameObject("Sun - soft cartoon key light");
        var light = sun.AddComponent<Light>();
        light.type = LightType.Directional;
        light.intensity = 1.35f;
        light.color = new Color(1f, 0.94f, 0.82f);
        sun.transform.rotation = Quaternion.Euler(48f, -38f, 0f);
    }

    static void CreateOcean(Material material)
    {
        var ocean = GameObject.CreatePrimitive(PrimitiveType.Cube);
        ocean.name = "Ocean Plane";
        ocean.transform.position = new Vector3(0f, -0.22f, 0f);
        ocean.transform.localScale = new Vector3(115f, 0.12f, 95f);
        ocean.GetComponent<Renderer>().sharedMaterial = material;
        Object.DestroyImmediate(ocean.GetComponent<Collider>());
    }

    static void CreateWorld(Transform root, Dictionary<string, Material> mats)
    {
        var zones = new[]
        {
            new Zone("Campos Verdes - zona inicial", new Vector3(0f, 0f, 0f), new Vector3(20f, 0.35f, 16f), mats["Grass"].color, Color.white, "green"),
            new Zone("Reino Doce", new Vector3(-26f, 0f, 8f), new Vector3(18f, 0.45f, 15f), mats["Candy"].color, new Color(1f, .85f, .93f), "candy"),
            new Zone("Reino de Gelo", new Vector3(-6f, 0f, 25f), new Vector3(17f, 0.42f, 14f), mats["Ice"].color, Color.white, "ice"),
            new Zone("Reino de Fogo", new Vector3(21f, 0f, 22f), new Vector3(19f, 0.48f, 15f), mats["Fire"].color, mats["Lava"].color, "fire"),
            new Zone("Reino de Gosma", new Vector3(31f, 0f, 2f), new Vector3(17f, 0.38f, 16f), mats["Slime"].color, new Color(.7f, 1f, .22f), "slime"),
            new Zone("Floresta dos Galhos", new Vector3(-11f, 0f, -19f), new Vector3(19f, 0.45f, 15f), mats["Forest"].color, new Color(.18f, .55f, .24f), "forest"),
            new Zone("Deserto das Dunas", new Vector3(14f, 0f, -21f), new Vector3(18f, 0.4f, 15f), mats["Desert"].color, new Color(.95f, .77f, .42f), "desert"),
            new Zone("Ruinas da Cidade", new Vector3(35f, 0f, -21f), new Vector3(16f, 0.46f, 14f), mats["Ruins"].color, new Color(.58f, .35f, .82f), "ruins"),
            new Zone("Cavernas de Cristal", new Vector3(-35f, 0f, -23f), new Vector3(16f, 0.5f, 13f), mats["Crystal"].color, new Color(.7f, .95f, 1f), "crystal"),
            new Zone("Pantano Murkfen", new Vector3(-20f, 0f, -38f), new Vector3(18f, 0.36f, 12f), mats["Swamp"].color, new Color(.55f, .9f, .45f), "swamp"),
            new Zone("Nightosfera", new Vector3(2f, 0f, -40f), new Vector3(22f, 0.5f, 12f), mats["Night"].color, new Color(.82f, .35f, 1f), "night"),
            new Zone("Montanhas Arruinadas", new Vector3(29f, 0f, -42f), new Vector3(17f, 0.56f, 12f), mats["Mountain"].color, new Color(.76f, .68f, .48f), "mountain"),
            new Zone("Ermo Final", new Vector3(4f, 0f, -57f), new Vector3(28f, 0.6f, 11f), mats["Final"].color, mats["Lava"].color, "final"),
        };

        foreach (var zone in zones)
        {
            var zoneGo = Cube(zone.name, zone.position, zone.scale, MaterialForZone(zone, mats), root);
            zoneGo.layer = 0;
            Label(zone.name, zone.position + new Vector3(0f, 0.45f, -zone.scale.z * 0.42f), root, 1.1f);
            DecorateZone(zone, root, mats);
        }

        Bridge("Ponte Campos -> Doce", new Vector3(-13f, 0.05f, 4f), new Vector3(8f, .24f, 2.2f), mats["Wood"], root);
        Bridge("Ponte Campos -> Gelo", new Vector3(-3f, 0.05f, 13.5f), new Vector3(2.2f, .24f, 8f), mats["Wood"], root);
        Bridge("Ponte Gelo -> Fogo", new Vector3(8f, 0.05f, 23f), new Vector3(9f, .24f, 2.2f), mats["Wood"], root);
        Bridge("Ponte Fogo -> Gosma", new Vector3(27f, 0.05f, 12f), new Vector3(2.2f, .24f, 8f), mats["Wood"], root);
        Bridge("Ponte Campos -> Floresta", new Vector3(-5f, 0.05f, -10f), new Vector3(2.2f, .24f, 8f), mats["Wood"], root);
        Bridge("Ponte Floresta -> Deserto", new Vector3(1f, 0.05f, -20f), new Vector3(8f, .24f, 2.2f), mats["Wood"], root);
        Bridge("Ponte Deserto -> Ruinas", new Vector3(24f, 0.05f, -21f), new Vector3(6f, .24f, 2.2f), mats["Wood"], root);
        Bridge("Ponte Deserto -> Nightosfera", new Vector3(8f, 0.05f, -31f), new Vector3(2.2f, .24f, 8f), mats["Wood"], root);
        Bridge("Ponte Floresta -> Pantano", new Vector3(-16f, 0.05f, -29f), new Vector3(2.2f, .24f, 8f), mats["Wood"], root);
        Bridge("Ponte Nightosfera -> Ermo", new Vector3(2f, 0.05f, -49f), new Vector3(2.2f, .24f, 8f), mats["Wood"], root);
        Bridge("Ponte Ruinas -> Montanhas", new Vector3(32f, 0.05f, -31f), new Vector3(2.2f, .24f, 8f), mats["Wood"], root);
        Bridge("Ponte Montanhas -> Ermo", new Vector3(19f, 0.05f, -49f), new Vector3(8f, .24f, 2.2f), mats["Wood"], root);
    }

    static Material MaterialForZone(Zone zone, Dictionary<string, Material> mats)
    {
        if (zone.kind == "candy") return mats["Candy"];
        if (zone.kind == "ice") return mats["Ice"];
        if (zone.kind == "fire") return mats["Fire"];
        if (zone.kind == "slime") return mats["Slime"];
        if (zone.kind == "forest") return mats["Forest"];
        if (zone.kind == "desert") return mats["Desert"];
        if (zone.kind == "swamp") return mats["Swamp"];
        if (zone.kind == "ruins") return mats["Ruins"];
        if (zone.kind == "crystal") return mats["Crystal"];
        if (zone.kind == "night") return mats["Night"];
        if (zone.kind == "mountain") return mats["Mountain"];
        if (zone.kind == "final") return mats["Final"];
        return mats["Grass"];
    }

    static void DecorateZone(Zone zone, Transform root, Dictionary<string, Material> mats)
    {
        var seed = Mathf.Abs(zone.name.GetHashCode());
        Random.InitState(seed);
        for (var i = 0; i < 16; i++)
        {
            var x = Random.Range(-zone.scale.x * 0.43f, zone.scale.x * 0.43f);
            var z = Random.Range(-zone.scale.z * 0.38f, zone.scale.z * 0.38f);
            var pos = zone.position + new Vector3(x, 0.5f, z);
            switch (zone.kind)
            {
                case "candy":
                    CandyProp(pos, root, mats);
                    break;
                case "ice":
                    Crystal(pos, root, mats["Ice"], Random.Range(0.8f, 2.1f));
                    break;
                case "fire":
                    LavaRock(pos, root, mats);
                    break;
                case "slime":
                    SlimeBubble(pos, root, mats);
                    break;
                case "forest":
                case "green":
                    Tree(pos, root, mats);
                    break;
                case "desert":
                    Cactus(pos, root, mats);
                    break;
                case "ruins":
                    Ruin(pos, root, mats);
                    break;
                case "crystal":
                    Crystal(pos, root, mats["Crystal"], Random.Range(1.2f, 2.7f));
                    break;
                case "swamp":
                    SlimeBubble(pos, root, mats);
                    Tree(pos + new Vector3(.45f, 0f, .3f), root, mats);
                    break;
                case "night":
                    PortalShard(pos, root, mats);
                    break;
                case "mountain":
                    Ruin(pos, root, mats);
                    Crystal(pos + Vector3.right * .35f, root, mats["Stone"], Random.Range(.8f, 1.8f));
                    break;
                case "final":
                    LavaRock(pos, root, mats);
                    PortalShard(pos + Vector3.forward * .3f, root, mats);
                    break;
            }
        }
    }

    static void CreateCreatures(Transform root, Dictionary<string, Material> mats)
    {
        var modelGuids = AssetDatabase.FindAssets("t:Model", new[] { CreatureSourcePath, BossSourcePath });
        var modelPaths = modelGuids.Select(AssetDatabase.GUIDToAssetPath).OrderBy(p => p).ToList();
        if (modelPaths.Count == 0)
        {
            Creature("Gomasaltante", new Vector3(-29f, 1f, 6f), mats["Candy"], 35f, root);
            Creature("Ursogoma", new Vector3(-22f, 1f, 12f), mats["Candy"], 80f, root, 1.6f);
            Creature("Lombricadoce", new Vector3(-31f, 1f, 13f), mats["Candy"], 52f, root, 1.25f);
            Creature("Frostling", new Vector3(-7f, 1f, 27f), mats["Ice"], 44f, root);
            Creature("Magmaworm", new Vector3(21f, 1f, 23f), mats["Lava"], 70f, root, 1.4f);
            Creature("Gosma Saltadora", new Vector3(31f, 1f, 1f), mats["Slime"], 46f, root);
            Creature("Sentinela Sucata", new Vector3(35f, 1f, -21f), mats["Ruins"], 68f, root, 1.35f);
            Creature("Nyxel Fragment", new Vector3(2f, 1f, -40f), mats["Night"], 75f, root, 1.45f);
            return;
        }

        for (var i = 0; i < modelPaths.Count; i++)
        {
            var path = modelPaths[i];
            var id = path.ToLowerInvariant();
            var boss = path.StartsWith(BossSourcePath) || id.Contains("boss") || id.Contains("goliath") || id.Contains("giant") || id.Contains("sentinel") || id.Contains("stalker");
            var spawn = CreatureSpawnForPath(id, i);
            var height = boss ? 3.55f : 2.25f;
            var health = boss ? 240f : 72f;
            var speed = boss ? 1.25f : 1.85f;
            CreateCreatureFromModel(path, CreatureDisplayName(path), spawn, height, health, speed, root);
        }
    }

    static Vector3 CreatureSpawnForPath(string id, int index)
    {
        var jitter = new Vector3((index % 3 - 1) * 2.1f, 0f, ((index / 3) % 3 - 1) * 1.8f);
        if (id.Contains("candy") || id.Contains("doce")) return new Vector3(-27f, 1f, 8f) + jitter;
        if (id.Contains("ice") || id.Contains("gelo") || id.Contains("frost")) return new Vector3(-7f, 1f, 26f) + jitter;
        if (id.Contains("fire") || id.Contains("fogo") || id.Contains("ember") || id.Contains("pyromancer")) return new Vector3(21f, 1f, 22f) + jitter;
        if (id.Contains("slime") || id.Contains("goo") || id.Contains("quagmire") || id.Contains("goliath")) return new Vector3(31f, 1f, 2f) + jitter;
        if (id.Contains("leaf") || id.Contains("bosque") || id.Contains("creatures_of_the_leaf")) return new Vector3(-11f, 1f, -19f) + jitter;
        if (id.Contains("pantano") || id.Contains("mossbound") || id.Contains("swamp")) return new Vector3(-20f, 1f, -38f) + jitter;
        if (id.Contains("zombie") || id.Contains("city")) return new Vector3(35f, 1f, -21f) + jitter;
        if (id.Contains("assassino") || id.Contains("stalker") || id.Contains("dark")) return new Vector3(2f, 1f, -40f) + jitter;
        if (id.Contains("realms") || id.Contains("giants")) return new Vector3(4f, 1f, -57f) + jitter;
        return new Vector3(0f, 1f, -10f) + jitter;
    }

    static string CreatureDisplayName(string path)
    {
        var id = path.ToLowerInvariant();
        if (id.Contains("candy_monster")) return "Reino Doce - parada de monstros";
        if (id.Contains("ex_rcito") || id.Contains("exercito") || id.Contains("gelo")) return "Reino de Gelo - exercito";
        if (id.Contains("besti")) return "Reino de Fogo - bestiario";
        if (id.Contains("abandoned_city")) return "Ruinas - zumbi da cidade";
        if (id.Contains("slime_compendium")) return "Reino de Gosma - compendio";
        if (id.Contains("quagmire")) return "Pantano - quarteto lamacento";
        if (id.Contains("one_eyed")) return "Reino de Gosma - olho unico";
        if (id.Contains("gooey")) return "Reino de Gosma - pals";
        if (id.Contains("leaf")) return "Floresta - criaturas folha";
        if (id.Contains("bosque")) return "Floresta - criaturas do bosque";
        if (id.Contains("mossbound")) return "Pantano - monstro ceifador";
        if (id.Contains("pyromancer")) return "Chefe - piromante";
        if (id.Contains("sludge")) return "Chefe - goliath de gosma";
        if (id.Contains("icebound")) return "Chefe - sentinela de gelo";
        if (id.Contains("stalker")) return "Chefe - assassino das trevas";
        if (id.Contains("realms")) return "Chefes - gigantes dos reinos";
        return Path.GetFileNameWithoutExtension(path).Replace("_", " ");
    }

    static void CreateCreatureFromModel(string modelPath, string displayName, Vector3 position, float targetHeight, float health, float speed, Transform root)
    {
        var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
        if (!model) return;

        var wrapper = new GameObject("Creature - " + displayName);
        wrapper.transform.SetParent(root);
        wrapper.transform.position = position;
        wrapper.transform.rotation = Quaternion.Euler(0f, Random.Range(0f, 360f), 0f);

        var instance = (GameObject)PrefabUtility.InstantiatePrefab(model);
        instance.name = "Model - " + displayName;
        instance.transform.SetParent(wrapper.transform, false);
        instance.transform.localPosition = Vector3.zero;
        instance.transform.localRotation = Quaternion.identity;
        NormalizeModel(instance.transform, targetHeight);

        var controller = wrapper.AddComponent<CharacterController>();
        controller.height = targetHeight;
        controller.radius = Mathf.Max(0.35f, targetHeight * 0.22f);
        controller.center = Vector3.up * (targetHeight * 0.5f);

        var creature = wrapper.AddComponent<CreatureWanderer>();
        creature.creatureName = displayName;
        creature.maxHealth = health;
        creature.moveSpeed = speed;
        creature.aggroRange = targetHeight > 3f ? 10f : 7f;
        creature.attackDamage = targetHeight > 3f ? 18f : 8f;

        Label(displayName, position + Vector3.up * (targetHeight + .75f), root, targetHeight > 3f ? .46f : .34f);
    }

    static GameObject CreateCharacterShowcase(Transform root, Dictionary<string, Material> mats, GameObject projectilePrefab)
    {
        var modelGuids = AssetDatabase.FindAssets("t:Model", new[] { CharacterSourcePath });
        var modelPaths = modelGuids.Select(AssetDatabase.GUIDToAssetPath).OrderBy(p => p).ToList();
        var spawnOrigin = new Vector3(-9f, 0.55f, -3.5f);
        GameObject player = null;

        for (var i = 0; i < modelPaths.Count; i++)
        {
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPaths[i]);
            if (!model) continue;
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(model);
            instance.name = PrettyCharacterName(modelPaths[i]);
            instance.transform.SetParent(root);
            instance.transform.position = spawnOrigin + new Vector3(i * 3f, 0f, 0f);
            NormalizeModel(instance.transform, 2.05f);
            Label(instance.name, instance.transform.position + new Vector3(0f, 2.45f, 0f), root, 0.42f);

            if (i == 0)
            {
                player = new GameObject("Player - " + instance.name);
                player.transform.SetParent(root);
                player.transform.position = new Vector3(0f, 1.05f, 0f);
                instance.transform.SetParent(player.transform, true);
                instance.transform.localPosition = Vector3.zero;

                var controller = player.AddComponent<CharacterController>();
                controller.height = 2.15f;
                controller.radius = 0.38f;
                controller.center = new Vector3(0f, 1.05f, 0f);
                var adventure = player.AddComponent<AdventureCharacterController>();
                adventure.projectilePrefab = projectilePrefab;
                adventure.walkSpeed = 4.5f;
                adventure.runSpeed = 6.8f;
                adventure.maxHealth = 140f;
            }
        }

        return player;
    }

    static string PrettyCharacterName(string path)
    {
        path = path.ToLowerInvariant();
        if (path.Contains("little_trail_scout")) return "Arlo - Aventureiro";
        if (path.Contains("patchwork_explorer")) return "Mira - Aventureira";
        if (path.Contains("sporebound")) return "Mossy - Maga da Floresta";
        if (path.Contains("steampunk")) return "Rust - Sucata";
        if (path.Contains("frostbound")) return "Frostell - Bruxa de Gelo";
        if (path.Contains("emberbound")) return "Spark - Principe de Fogo";
        if (path.Contains("lollipop")) return "Bonbon - Bruxa Doce";
        return Path.GetFileNameWithoutExtension(path);
    }

    static void NormalizeModel(Transform root, float targetHeight)
    {
        var renderers = root.GetComponentsInChildren<Renderer>();
        if (renderers.Length == 0) return;
        var bounds = renderers[0].bounds;
        foreach (var renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
        if (bounds.size.y <= 0.001f) return;
        var factor = targetHeight / bounds.size.y;
        root.localScale *= factor;

        renderers = root.GetComponentsInChildren<Renderer>();
        bounds = renderers[0].bounds;
        foreach (var renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
        root.position += Vector3.up * (0.02f - bounds.min.y);
    }

    static void CreateCamera(GameObject player)
    {
        var cameraGo = new GameObject("Main Camera");
        var camera = cameraGo.AddComponent<Camera>();
        cameraGo.tag = "MainCamera";
        camera.fieldOfView = 43f;
        camera.nearClipPlane = 0.03f;
        camera.farClipPlane = 220f;
        cameraGo.transform.position = new Vector3(0f, 10.5f, -10f);
        cameraGo.transform.rotation = Quaternion.Euler(52f, 0f, 0f);
        var follow = cameraGo.AddComponent<AdventureCameraFollow>();
        if (player)
        {
            follow.target = player.transform;
            var controller = player.GetComponent<AdventureCharacterController>();
            if (controller) controller.cameraTransform = cameraGo.transform;
        }

        var listener = cameraGo.AddComponent<AudioListener>();
        listener.enabled = true;
    }

    static void CreateSceneNotes(Transform root)
    {
        Label("Aventura Mundo 3D - prototipo jogavel\nWASD move | mouse mira | click ataca | Q/Shift dash | E defende | R projetil | X ultimate", new Vector3(0f, 0.7f, 8f), root, 0.55f);
    }

    static GameObject Cube(string name, Vector3 position, Vector3 scale, Material material, Transform root)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        go.name = name;
        go.transform.SetParent(root);
        go.transform.position = position;
        go.transform.localScale = scale;
        go.GetComponent<Renderer>().sharedMaterial = material;
        return go;
    }

    static void Bridge(string name, Vector3 position, Vector3 scale, Material material, Transform root)
    {
        Cube(name, position, scale, material, root);
    }

    static void Label(string text, Vector3 position, Transform root, float size)
    {
        var label = new GameObject("Label - " + text.Split('\n')[0]);
        label.transform.SetParent(root);
        label.transform.position = position;
        label.transform.rotation = Quaternion.Euler(68f, 0f, 0f);
        var mesh = label.AddComponent<TextMesh>();
        mesh.text = text;
        mesh.anchor = TextAnchor.MiddleCenter;
        mesh.alignment = TextAlignment.Center;
        mesh.fontSize = 46;
        mesh.characterSize = size * 0.1f;
        mesh.color = new Color(0.08f, 0.13f, 0.18f);
    }

    static void Tree(Vector3 pos, Transform root, Dictionary<string, Material> mats)
    {
        var trunk = Cube("Tree Trunk", pos + Vector3.up * 0.45f, new Vector3(.32f, .9f, .32f), mats["Wood"], root);
        trunk.transform.rotation = Quaternion.Euler(0f, Random.Range(0f, 360f), 0f);
        Sphere("Tree Crown", pos + Vector3.up * 1.18f, Vector3.one * Random.Range(1.1f, 1.7f), mats["Forest"], root);
    }

    static void CandyProp(Vector3 pos, Transform root, Dictionary<string, Material> mats)
    {
        var stick = Cube("Candy Stick", pos + Vector3.up * 0.45f, new Vector3(.15f, .9f, .15f), mats["Wood"], root);
        stick.transform.rotation = Quaternion.Euler(Random.Range(-8f, 8f), Random.Range(0f, 360f), Random.Range(-8f, 8f));
        Sphere("Candy Head", pos + Vector3.up * 1.1f, Vector3.one * Random.Range(.55f, 1.05f), mats["Candy"], root);
    }

    static void Crystal(Vector3 pos, Transform root, Material material, float height)
    {
        var crystal = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        crystal.name = "Crystal";
        crystal.transform.SetParent(root);
        crystal.transform.position = pos + Vector3.up * height * 0.5f;
        crystal.transform.localScale = new Vector3(.36f, height * 0.5f, .36f);
        crystal.transform.rotation = Quaternion.Euler(Random.Range(-5f, 5f), Random.Range(0f, 360f), Random.Range(-5f, 5f));
        crystal.GetComponent<Renderer>().sharedMaterial = material;
    }

    static void LavaRock(Vector3 pos, Transform root, Dictionary<string, Material> mats)
    {
        Sphere("Charred Rock", pos + Vector3.up * .35f, new Vector3(1.1f, .7f, 1.1f), mats["Stone"], root);
        Sphere("Lava Glow", pos + Vector3.up * .78f, Vector3.one * .35f, mats["Lava"], root);
    }

    static void SlimeBubble(Vector3 pos, Transform root, Dictionary<string, Material> mats)
    {
        Sphere("Slime Bubble", pos + Vector3.up * .35f, new Vector3(1.1f, .45f, 1.1f), mats["Slime"], root);
    }

    static void Cactus(Vector3 pos, Transform root, Dictionary<string, Material> mats)
    {
        var cactus = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        cactus.name = "Cactus";
        cactus.transform.SetParent(root);
        cactus.transform.position = pos + Vector3.up * .8f;
        cactus.transform.localScale = new Vector3(.38f, .8f, .38f);
        cactus.GetComponent<Renderer>().sharedMaterial = mats["Forest"];
    }

    static void Ruin(Vector3 pos, Transform root, Dictionary<string, Material> mats)
    {
        Cube("Broken Wall", pos + Vector3.up * .7f, new Vector3(1.5f, 1.4f, .35f), mats["Stone"], root);
        Cube("Purple Window", pos + Vector3.up * .9f + Vector3.forward * .2f, new Vector3(.45f, .45f, .08f), mats["Night"], root);
    }

    static void PortalShard(Vector3 pos, Transform root, Dictionary<string, Material> mats)
    {
        Crystal(pos, root, mats["Night"], Random.Range(1.2f, 2.2f));
        Sphere("Portal Glow", pos + Vector3.up * 1.3f, Vector3.one * .5f, mats["Crystal"], root);
    }

    static void Creature(string name, Vector3 pos, Material material, float health, Transform root, float scale = 1f)
    {
        var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        body.name = "Creature - " + name;
        body.transform.SetParent(root);
        body.transform.position = pos;
        body.transform.localScale = Vector3.one * scale;
        body.GetComponent<Renderer>().sharedMaterial = material;
        var controller = body.AddComponent<CharacterController>();
        controller.height = 2f * scale;
        controller.radius = .42f * scale;
        controller.center = Vector3.up * scale;
        var creature = body.AddComponent<CreatureWanderer>();
        creature.creatureName = name;
        creature.maxHealth = health;
        creature.biomeColor = material.color;
    }

    static GameObject Sphere(string name, Vector3 position, Vector3 scale, Material material, Transform root)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        go.name = name;
        go.transform.SetParent(root);
        go.transform.position = position;
        go.transform.localScale = scale;
        go.GetComponent<Renderer>().sharedMaterial = material;
        return go;
    }
}
