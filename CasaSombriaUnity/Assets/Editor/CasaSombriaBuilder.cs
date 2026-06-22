using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.AI;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

public static class CasaSombriaBuilder
{
    private const string ScenePath = "Assets/Scenes/CasaSombria.unity";
    private const string GeneratedPath = "Assets/Generated";
    private const string ModelRoot = "Assets/GameAssets/Models/";
    private const string TextureRoot = "Assets/GameAssets/Textures/";
    private const string AudioRoot = "Assets/GameAssets/Audio/";
    private const string EnemyRoot = "Assets/GameAssets/Enemy/";

    private static readonly Dictionary<string, Material> Materials = new Dictionary<string, Material>();

    [MenuItem("Casa Sombria/Rebuild Scene")]
    public static void RebuildScene()
    {
        ConfigureProject();
        ConfigureImports();
        PrepareGeneratedFolder();

        Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        ConfigureEnvironment();
        HorrorGameManager manager = CreateManager();
        FirstPersonPlayer player = CreatePlayer();
        manager.player = player;

        CreateHouse();
        CreateLights(player.playerCamera);
        CreateGameplayObjects(manager);
        GrannyAI granny = CreateEnemy(player);
        manager.granny = granny;
        CreateInterface(manager);

        if (!AssetDatabase.IsValidFolder("Assets/Scenes")) AssetDatabase.CreateFolder("Assets", "Scenes");
        EditorSceneManager.SaveScene(scene, ScenePath);
        UnityEditor.AI.NavMeshBuilder.BuildNavMesh();
        EditorSceneManager.SaveScene(scene, ScenePath);

        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log("CASA_SOMBRIA_SCENE_READY");
    }

    [MenuItem("Casa Sombria/Build WebGL")]
    public static void BuildWebGL()
    {
        RebuildScene();
        string projectRoot = Directory.GetParent(Application.dataPath).FullName;
        string output = Path.GetFullPath(Path.Combine(Path.Combine(Path.Combine(projectRoot, ".."), "casaSombria"), "Build"));
        Directory.CreateDirectory(output);

        BuildPlayerOptions options = new BuildPlayerOptions();
        options.scenes = new[] { ScenePath };
        options.locationPathName = output;
        options.target = BuildTarget.WebGL;
        options.options = BuildOptions.None;
        BuildReportCompat(options);
        Debug.Log("CASA_SOMBRIA_WEBGL_READY: " + output);
    }

    [MenuItem("Casa Sombria/Validate Scene")]
    public static void ValidateScene()
    {
        Scene scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        HorrorGameManager manager = UnityEngine.Object.FindObjectOfType<HorrorGameManager>();
        FirstPersonPlayer player = UnityEngine.Object.FindObjectOfType<FirstPersonPlayer>();
        GrannyAI granny = UnityEngine.Object.FindObjectOfType<GrannyAI>();
        int colliderCount = UnityEngine.Object.FindObjectsOfType<Collider>().Length;
        int rendererCount = UnityEngine.Object.FindObjectsOfType<Renderer>().Length;
        int pickupCount = UnityEngine.Object.FindObjectsOfType<PickupItem>().Length;
        int doorCount = UnityEngine.Object.FindObjectsOfType<LockedDoor>().Length;
        int hidingCount = UnityEngine.Object.FindObjectsOfType<HidingSpot>().Length;
        NavMeshTriangulation navMesh = NavMesh.CalculateTriangulation();

        if (!scene.IsValid() || manager == null || player == null || granny == null) throw new InvalidOperationException("Core scene objects are missing.");
        if (manager.player != player || manager.granny != granny) throw new InvalidOperationException("Game manager references are incomplete.");
        if (manager.startOverlay == null || manager.endOverlay == null || manager.objectiveText == null || manager.damageFlash == null) throw new InvalidOperationException("Game interface references are incomplete.");
        if (granny.animator == null || granny.animator.runtimeAnimatorController == null) throw new InvalidOperationException("Enemy animation controller is missing.");
        if (colliderCount < 20 || rendererCount < 15 || pickupCount < 8 || doorCount < 7 || hidingCount < 3) throw new InvalidOperationException("The generated gameplay scene is incomplete.");
        if (navMesh.vertices == null || navMesh.vertices.Length < 3) throw new InvalidOperationException("Navigation mesh was not baked.");

        Debug.Log(string.Format(
            "CASA_SOMBRIA_VALIDATED colliders={0} renderers={1} pickups={2} doors={3} hiding={4} navVertices={5}",
            colliderCount,
            rendererCount,
            pickupCount,
            doorCount,
            hidingCount,
            navMesh.vertices.Length
        ));
    }

    private static void BuildReportCompat(BuildPlayerOptions options)
    {
        BuildPipeline.BuildPlayer(options);
    }

    private static void ConfigureProject()
    {
        PlayerSettings.companyName = "Album Copa Online";
        PlayerSettings.productName = "Casa Sombria";
        PlayerSettings.bundleVersion = "1.0.0";
        PlayerSettings.colorSpace = ColorSpace.Linear;
        PlayerSettings.runInBackground = true;
        PlayerSettings.defaultScreenWidth = 1280;
        PlayerSettings.defaultScreenHeight = 720;
        PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.WebGL, false);
        PlayerSettings.SetGraphicsAPIs(BuildTarget.WebGL, new[] { GraphicsDeviceType.OpenGLES3, GraphicsDeviceType.OpenGLES2 });
        PlayerSettings.WebGL.memorySize = 512;
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;

    }

    private static void ConfigureEnvironment()
    {
        RenderSettings.ambientMode = AmbientMode.Trilight;
        RenderSettings.ambientSkyColor = new Color(0.075f, 0.08f, 0.085f);
        RenderSettings.ambientEquatorColor = new Color(0.035f, 0.038f, 0.04f);
        RenderSettings.ambientGroundColor = new Color(0.012f, 0.013f, 0.014f);
        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.ExponentialSquared;
        RenderSettings.fogColor = new Color(0.012f, 0.014f, 0.015f);
        RenderSettings.fogDensity = 0.022f;
    }

    private static void ConfigureImports()
    {
        string[] modelGuids = AssetDatabase.FindAssets("t:Model", new[] { "Assets/GameAssets" });
        for (int i = 0; i < modelGuids.Length; i++)
        {
            string path = AssetDatabase.GUIDToAssetPath(modelGuids[i]);
            ModelImporter importer = AssetImporter.GetAtPath(path) as ModelImporter;
            if (importer == null) continue;
            importer.importMaterials = false;
            importer.isReadable = true;
            if (path.StartsWith(EnemyRoot, StringComparison.OrdinalIgnoreCase))
            {
                importer.importAnimation = true;
                importer.animationType = ModelImporterAnimationType.Generic;
            }
            importer.SaveAndReimport();
        }

        string[] textureGuids = AssetDatabase.FindAssets("t:Texture", new[] { "Assets/GameAssets/Textures", "Assets/GameAssets/Enemy" });
        for (int i = 0; i < textureGuids.Length; i++)
        {
            string path = AssetDatabase.GUIDToAssetPath(textureGuids[i]);
            TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer == null) continue;
            importer.maxTextureSize = 2048;
            importer.textureCompression = TextureImporterCompression.Compressed;
            importer.SaveAndReimport();
        }
    }

    private static void PrepareGeneratedFolder()
    {
        if (AssetDatabase.IsValidFolder(GeneratedPath)) AssetDatabase.DeleteAsset(GeneratedPath);
        AssetDatabase.CreateFolder("Assets", "Generated");
        Materials.Clear();
    }

    private static HorrorGameManager CreateManager()
    {
        GameObject root = new GameObject("Casa Sombria");
        HorrorGameManager manager = root.AddComponent<HorrorGameManager>();
        manager.playerSpawn = new Vector3(55f, 8f, 18f);
        manager.playerSpawnEuler = new Vector3(0f, -90f, 0f);
        manager.ambientClip = LoadAudio("granny_house_music.mp3");
        manager.chaseClip = LoadAudio("chased.mp3");
        manager.footstepClip = LoadAudio("walking-on-a-wooden-floor-14743.mp3");
        manager.captureClip = LoadAudio("scream.mp3");
        manager.secretClip = LoadAudio("secret.mp3");
        manager.atmosphereClips = new[]
        {
            LoadAudio("14. Spotted.mp3"),
            LoadAudio("29. Another Evil.mp3"),
            LoadAudio("baby-crying-64996.mp3"),
            LoadAudio("baby_badroom.mp3"),
            LoadAudio("heart.mp3"),
            LoadAudio("panic-stricken-screaming-1-6880.mp3"),
            LoadAudio("screaming.mp3")
        }.Where(clip => clip != null).ToArray();
        return manager;
    }

    private static FirstPersonPlayer CreatePlayer()
    {
        GameObject root = new GameObject("Player");
        root.transform.position = new Vector3(55f, 8f, 18f);
        root.transform.rotation = Quaternion.Euler(0f, -90f, 0f);
        root.layer = LayerMask.NameToLayer("Default");

        CharacterController controller = root.AddComponent<CharacterController>();
        controller.radius = 0.32f;
        controller.height = 1.75f;
        controller.center = new Vector3(0f, 0.875f, 0f);
        controller.stepOffset = 0.42f;
        controller.slopeLimit = 48f;
        controller.skinWidth = 0.045f;

        GameObject cameraObject = new GameObject("Player Camera");
        cameraObject.transform.SetParent(root.transform, false);
        cameraObject.transform.localPosition = new Vector3(0f, 1.58f, 0f);
        Camera camera = cameraObject.AddComponent<Camera>();
        camera.fieldOfView = 72f;
        camera.nearClipPlane = 0.04f;
        camera.farClipPlane = 80f;
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color(0.008f, 0.009f, 0.01f);
        cameraObject.AddComponent<AudioListener>();

        FirstPersonPlayer player = root.AddComponent<FirstPersonPlayer>();
        player.playerCamera = camera;
        return player;
    }

    private static void CreateHouse()
    {
        Material material = CreateMaterial("House", "granny/house2.png", new Color(0.72f, 0.69f, 0.64f));
        GameObject house = InstantiateModel(
            "Granny House",
            ModelRoot + "granny_1_house.obj",
            new Vector3(50f, 0f, 20f),
            Vector3.zero,
            new Vector3(50f, 50f, 50f),
            material
        );

        foreach (MeshFilter filter in house.GetComponentsInChildren<MeshFilter>(true))
        {
            if (filter.sharedMesh == null) continue;
            MeshCollider collider = filter.gameObject.GetComponent<MeshCollider>();
            if (collider == null) collider = filter.gameObject.AddComponent<MeshCollider>();
            collider.sharedMesh = filter.sharedMesh;
            StaticEditorFlags flags = StaticEditorFlags.NavigationStatic | StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccluderStatic | StaticEditorFlags.OccludeeStatic;
            GameObjectUtility.SetStaticEditorFlags(filter.gameObject, flags);
        }
    }

    private static void CreateLights(Camera camera)
    {
        GameObject moon = new GameObject("Cold Moonlight");
        Light directional = moon.AddComponent<Light>();
        directional.type = LightType.Directional;
        directional.color = new Color(0.43f, 0.5f, 0.58f);
        directional.intensity = 0.16f;
        directional.shadows = LightShadows.Soft;
        moon.transform.rotation = Quaternion.Euler(42f, -28f, 0f);

        GameObject flashlight = new GameObject("Flashlight");
        flashlight.transform.SetParent(camera.transform, false);
        flashlight.transform.localPosition = new Vector3(0.08f, -0.04f, 0.15f);
        flashlight.transform.localRotation = Quaternion.identity;
        Light spot = flashlight.AddComponent<Light>();
        spot.type = LightType.Spot;
        spot.color = new Color(1f, 0.78f, 0.55f);
        spot.intensity = 1.65f;
        spot.range = 16f;
        spot.spotAngle = 52f;
        spot.shadows = LightShadows.Soft;
        spot.shadowStrength = 0.62f;

        CreateRoomLight("Upstairs Hall", new Vector3(50.3f, 11.6f, 26.8f), new Color(0.95f, 0.66f, 0.36f), 0.72f, 8f, true);
        CreateRoomLight("Bedroom", new Vector3(45.2f, 10.9f, 18.5f), new Color(0.6f, 0.78f, 1f), 0.52f, 7f, true);
        CreateRoomLight("Main Hall", new Vector3(54.7f, 7.6f, 22.5f), new Color(0.95f, 0.69f, 0.42f), 0.6f, 8f, false);
        CreateRoomLight("Cellar", new Vector3(50.4f, 4.9f, 28.5f), new Color(0.58f, 0.67f, 0.88f), 0.54f, 7f, true);
    }

    private static void CreateRoomLight(string name, Vector3 position, Color color, float intensity, float range, bool flicker)
    {
        GameObject root = new GameObject(name);
        root.transform.position = position;
        Light light = root.AddComponent<Light>();
        light.type = LightType.Point;
        light.color = color;
        light.intensity = intensity;
        light.range = range;
        light.shadows = LightShadows.Soft;
        light.shadowStrength = 0.45f;
        if (flicker)
        {
            FlickerLight effect = root.AddComponent<FlickerLight>();
            effect.minimum = intensity * 0.35f;
            effect.maximum = intensity * 1.18f;
        }
    }

    private static void CreateGameplayObjects(HorrorGameManager manager)
    {
        Material doorMaterial = CreateMaterial("Door", "door.png", Color.white);
        AudioClip doorSound = LoadAudio("openDoor.mp3");

        CreateDoor("Door Screw", new Vector3(53.7f, 11.4f, 25.7f), new Vector3(0f, 180f, 0f), new Vector3(0.05f, 0.03f, 0.04f), "screw", "Porta com parafuso", new Vector3(52.8f, 11.4f, 26.5f), new Vector3(0f, 90f, 0f), false, false, doorMaterial, doorSound);
        CreateDoor("Door Bedroom", new Vector3(46.85f, 11.4f, 20.2f), new Vector3(0f, 180f, 180f), new Vector3(0.035f, 0.03f, 0.035f), "key3", "Porta do quarto", new Vector3(45.85f, 11.4f, 21.2f), new Vector3(0f, 90f, 180f), false, false, doorMaterial, doorSound);
        CreateDoor("Door Upstairs", new Vector3(52f, 11.4f, 19.1f), new Vector3(0f, 90f, 180f), new Vector3(0.035f, 0.03f, 0.035f), "key2", "Porta do segundo andar", new Vector3(53f, 11.4f, 20f), new Vector3(0f, 180f, 180f), false, false, doorMaterial, doorSound);
        CreateDoor("Door Main", new Vector3(48.45f, 7.8f, 20.2f), new Vector3(0f, 180f, 180f), new Vector3(0.028f, 0.032f, 0.028f), "key4", "Porta da sala", new Vector3(49.2f, 7.8f, 21f), new Vector3(0f, 90f, 180f), false, false, doorMaterial, doorSound);
        CreateDoor("Door Inner", new Vector3(53f, 7.8f, 23.3f), new Vector3(0f, 90f, 180f), new Vector3(0.03f, 0.032f, 0.03f), "key1", "Porta interna", new Vector3(53.5f, 7.8f, 24.2f), new Vector3(0f, 180f, 180f), false, false, doorMaterial, doorSound);
        CreateDoor("Exit Door", new Vector3(50.25f, 7.8f, 27f), new Vector3(0f, 270f, 180f), new Vector3(0.03f, 0.032f, 0.03f), "key6", "Porta principal", new Vector3(50.25f, 7.8f, 27f), new Vector3(0f, 360f, 180f), true, false, doorMaterial, doorSound);

        Material keyMaterial = CreateMaterial("RustKey", "KeyRust_A.png", Color.white);
        Material masterKeyMaterial = CreateMaterial("MasterKey", "MK.jpg", Color.white);
        PickupItem key1 = CreatePickup("Key 1", "key1", "Chave enferrujada", "key_low.obj", keyMaterial, new Vector3(45.7f, 11.25f, 15f), new Vector3(90f, 0f, 0f), new Vector3(0.03f, 0.03f, 0.09f), false);
        CreatePickup("Key 2", "key2", "Chave azul", "key_low.obj", keyMaterial, new Vector3(44.7f, 10.1f, 25.45f), new Vector3(90f, 0f, 0f), new Vector3(0.03f, 0.03f, 0.09f), true);
        CreatePickup("Key 3", "key3", "Chave do quarto", "key_low.obj", keyMaterial, new Vector3(57f, 10.8f, 19.63f), new Vector3(90f, 0f, 0f), new Vector3(0.03f, 0.03f, 0.06f), true);
        CreatePickup("Key 4", "key4", "Chave da sala", "key_low.obj", keyMaterial, new Vector3(57.8f, 7.16f, 18.2f), new Vector3(90f, 0f, 0f), new Vector3(0.03f, 0.03f, 0.06f), true);
        CreatePickup("Prison Key", "key5", "Chave da cela", "key_low.obj", keyMaterial, new Vector3(47.7f, 6.65f, 21.45f), new Vector3(90f, 0f, 0f), new Vector3(0.03f, 0.03f, 0.09f), true);
        CreatePickup("Master Key", "key6", "Chave mestra", "key_low.obj", masterKeyMaterial, new Vector3(50.7f, 3.85f, 23.45f), new Vector3(90f, 0f, 0f), new Vector3(0.03f, 0.03f, 0.09f), true);
        CreatePickup("Hammer", "hammer", "Martelo", "hummer.obj", CreateMaterial("Hammer", "hummer.png", Color.white), new Vector3(54.8f, 11.2f, 18.7f), new Vector3(0f, 0f, 90f), new Vector3(0.0003f, 0.0003f, 0.0003f), true);
        CreatePickup("Screw", "screw", "Ferramenta de parafuso", "screw.obj", CreateMaterial("Screw", "screw.png", Color.white), new Vector3(54f, 7.3f, 23f), Vector3.zero, new Vector3(0.05f, 0.05f, 0.05f), true);

        GameObject drawer = InstantiateModel("Locked Drawer", ModelRoot + "drawer.obj", new Vector3(45.7f, 11.25f, 14.45f), new Vector3(-180f, -180f, 180f), new Vector3(1.1f, 0.55f, 0.65f), CreateMaterial("Drawer", "drawer.jpeg", Color.white));
        AddBoundsCollider(drawer, false);
        DrawerInteractable drawerInteraction = drawer.AddComponent<DrawerInteractable>();
        drawerInteraction.label = "Gaveta pesada";
        drawerInteraction.hiddenItem = key1;

        CreatePrisonAndBoy(doorSound);
        CreateScenery();
        CreateHidingSpot("Under Bed", "Debaixo da cama", new Vector3(44.8f, 11.25f, 18.9f), new Vector3(44.8f, 10.7f, 18.9f), new Vector3(46.2f, 11.39f, 20.2f), 90f);
        CreateHidingSpot("Wardrobe", "Dentro do armario", new Vector3(51.2f, 8.05f, 16.35f), new Vector3(51.2f, 7.28f, 16.35f), new Vector3(50.2f, 8f, 17.6f), -27f);
        CreateHidingSpot("Cellar Cabinet", "Atras do movel", new Vector3(49f, 5f, 21f), new Vector3(49f, 4.48f, 21f), new Vector3(50.1f, 5.07f, 22.1f), 153f);
    }

    private static void CreatePrisonAndBoy(AudioClip doorSound)
    {
        Material prisonMaterial = CreateMaterial("Prison", "prison.png", Color.white);
        InstantiateModel("Prison Bars", ModelRoot + "prison.obj", new Vector3(54.8f, 4.7f, 28.4f), new Vector3(0f, -90f, 0f), new Vector3(0.01f, 0.01f, 0.01f), prisonMaterial);
        GameObject cell = InstantiateModel("Prison Door", ModelRoot + "prison.obj", new Vector3(49.8f, 4.7f, 28.4f), new Vector3(0f, -90f, 0f), new Vector3(0.01f, 0.01f, 0.01f), prisonMaterial);
        AddBoundsCollider(cell, false);
        LockedDoor door = cell.AddComponent<LockedDoor>();
        door.label = "Abrir a cela";
        door.requiredItem = "key5";
        door.rescuesBoy = true;
        door.openLocalPosition = new Vector3(50.8f, 4.7f, 29.5f);
        door.openLocalEuler = new Vector3(0f, -90f, 0f);
        door.openSound = doorSound;

        InstantiateModel("Prisoner", ModelRoot + "boy.obj", new Vector3(50.8f, 3.7f, 23.8f), new Vector3(0f, -90f, 0f), new Vector3(0.01f, 0.01f, 0.01f), CreateMaterial("Boy", "boy.png", Color.white));
    }

    private static void CreateScenery()
    {
        InstantiateModel("Upstairs Table", ModelRoot + "table.obj", new Vector3(39.6f, 10.1f, 26f), new Vector3(0f, 180f, 0f), new Vector3(0.09f, 0.06f, 0.08f), CreateMaterial("Wood", "wood.jpg", Color.white));
        Vector3[] spiders =
        {
            new Vector3(47f, 6.6f, 15f), new Vector3(48f, 6.6f, 15f), new Vector3(55f, 6.6f, 13f),
            new Vector3(50f, 6.6f, 15f), new Vector3(45f, 6.6f, 15f)
        };
        Material spiderMaterial = CreateMaterial("Spider", "spider.png", Color.white);
        for (int i = 0; i < spiders.Length; i++)
        {
            GameObject spider = InstantiateModel("Spider " + (i + 1), ModelRoot + "Spider.obj", spiders[i], Vector3.zero, new Vector3(0.003f, 0.003f, 0.003f), spiderMaterial);
            BoxCollider trigger = AddBoundsCollider(spider, true);
            trigger.isTrigger = true;
            spider.AddComponent<SpiderHazard>();
        }
    }

    private static LockedDoor CreateDoor(string name, Vector3 position, Vector3 euler, Vector3 scale, string required, string label, Vector3 openPosition, Vector3 openEuler, bool exit, bool rescue, Material material, AudioClip sound)
    {
        GameObject root = InstantiateModel(name, ModelRoot + "door.obj", position, euler, scale, material);
        AddBoundsCollider(root, false);
        LockedDoor door = root.AddComponent<LockedDoor>();
        door.label = label;
        door.requiredItem = required;
        door.openLocalPosition = openPosition;
        door.openLocalEuler = openEuler;
        door.isExit = exit;
        door.rescuesBoy = rescue;
        door.openSound = sound;
        return door;
    }

    private static PickupItem CreatePickup(string name, string id, string label, string model, Material material, Vector3 position, Vector3 euler, Vector3 scale, bool active)
    {
        GameObject root = InstantiateModel(name, ModelRoot + model, position, euler, scale, material);
        AddBoundsCollider(root, false);
        PickupItem item = root.AddComponent<PickupItem>();
        item.itemId = id;
        item.label = label;
        root.SetActive(active);
        return item;
    }

    private static void CreateHidingSpot(string name, string label, Vector3 interactionPosition, Vector3 hidePosition, Vector3 exitPosition, float yaw)
    {
        GameObject root = new GameObject(name);
        root.transform.position = interactionPosition;
        BoxCollider collider = root.AddComponent<BoxCollider>();
        collider.size = new Vector3(1.35f, 1.5f, 1.35f);
        collider.isTrigger = true;
        HidingSpot spot = root.AddComponent<HidingSpot>();
        spot.label = label;

        GameObject hide = new GameObject("Hide Point");
        hide.transform.position = hidePosition;
        hide.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
        hide.transform.SetParent(root.transform, true);
        spot.hidePoint = hide.transform;

        GameObject exit = new GameObject("Exit Point");
        exit.transform.position = exitPosition;
        exit.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
        exit.transform.SetParent(root.transform, true);
        spot.exitPoint = exit.transform;
    }

    private static GrannyAI CreateEnemy(FirstPersonPlayer player)
    {
        string basePath = EnemyRoot + "Meshy_AI_Ragged_Wraith_biped_Animation_Elderly_Shaky_Walk_inplace_withSkin.fbx";
        GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(basePath);
        GameObject enemy = prefab == null ? GameObject.CreatePrimitive(PrimitiveType.Capsule) : (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        enemy.name = "Granny";
        enemy.transform.position = new Vector3(49.5f, 5.76f, 24.5f);
        enemy.transform.rotation = Quaternion.Euler(0f, 180f, 0f);

        Bounds bounds = CalculateBounds(enemy);
        if (bounds.size.y > 0.001f)
        {
            float normalizedScale = 1.82f / bounds.size.y;
            enemy.transform.localScale = Vector3.one * normalizedScale;
        }

        Material enemyMaterial = CreateMaterial("GrannyAnimated", "../Enemy/Meshy_AI_Ragged_Wraith_biped_texture_0.png", new Color(0.88f, 0.84f, 0.8f));
        ApplyMaterial(enemy, enemyMaterial);

        NavMeshAgent agent = enemy.GetComponent<NavMeshAgent>();
        if (agent == null) agent = enemy.AddComponent<NavMeshAgent>();
        agent.radius = 0.3f;
        agent.height = 1.75f;
        agent.speed = 1.55f;
        agent.acceleration = 9f;
        agent.angularSpeed = 440f;
        agent.stoppingDistance = 0.72f;
        agent.autoBraking = true;

        CapsuleCollider body = enemy.GetComponent<CapsuleCollider>();
        if (body == null) body = enemy.AddComponent<CapsuleCollider>();
        body.radius = 0.3f;
        body.height = 1.75f;
        body.center = new Vector3(0f, 0.875f, 0f);

        Animator animator = enemy.GetComponent<Animator>();
        if (animator == null) animator = enemy.AddComponent<Animator>();
        animator.runtimeAnimatorController = CreateEnemyAnimator();
        animator.applyRootMotion = false;

        GrannyAI ai = enemy.AddComponent<GrannyAI>();
        ai.player = player;
        ai.animator = animator;
        ai.patrolPoints = new[]
        {
            new Vector3(49.5f, 5.76f, 24.5f),
            new Vector3(49.5f, 5.76f, 20.2f),
            new Vector3(48.45f, 5.76f, 20.2f),
            new Vector3(47.5f, 6.05f, 24.5f),
            new Vector3(53.4f, 5.76f, 23.2f)
        };
        return ai;
    }

    private static RuntimeAnimatorController CreateEnemyAnimator()
    {
        string controllerPath = GeneratedPath + "/Granny.controller";
        AnimatorController controller = AnimatorController.CreateAnimatorControllerAtPath(controllerPath);
        AnimatorStateMachine machine = controller.layers[0].stateMachine;
        AnimationClip walk = FindClip(EnemyRoot + "Meshy_AI_Ragged_Wraith_biped_Animation_Elderly_Shaky_Walk_inplace_withSkin.fbx");
        AnimationClip run = FindClip(EnemyRoot + "Meshy_AI_Ragged_Wraith_biped_Animation_run_fast_8_inplace_withSkin.fbx");
        if (run == null) run = FindClip(EnemyRoot + "Meshy_AI_Ragged_Wraith_biped_Animation_Running_withSkin.fbx");

        AnimatorState walkState = machine.AddState("Walk");
        walkState.motion = walk;
        walkState.speed = 1f;
        AnimatorState runState = machine.AddState("Run");
        runState.motion = run == null ? walk : run;
        runState.speed = 1f;
        machine.defaultState = walkState;
        return controller;
    }

    private static AnimationClip FindClip(string path)
    {
        UnityEngine.Object[] assets = AssetDatabase.LoadAllAssetsAtPath(path);
        for (int i = 0; i < assets.Length; i++)
        {
            AnimationClip clip = assets[i] as AnimationClip;
            if (clip != null && !clip.name.StartsWith("__preview__", StringComparison.OrdinalIgnoreCase)) return clip;
        }
        return null;
    }

    private static void CreateInterface(HorrorGameManager manager)
    {
        Font font = Resources.GetBuiltinResource<Font>("Arial.ttf");
        GameObject canvasObject = new GameObject("Interface");
        Canvas canvas = canvasObject.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        CanvasScaler scaler = canvasObject.AddComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1920f, 1080f);
        scaler.matchWidthOrHeight = 0.5f;
        canvasObject.AddComponent<GraphicRaycaster>();

        Text day = CreateText(canvasObject.transform, "Day", "DIA 1 / 5", font, 24, TextAnchor.UpperLeft, new Vector2(0f, 1f), new Vector2(0f, 1f), new Vector2(32f, -28f), new Vector2(320f, 50f));
        Text objective = CreateText(canvasObject.transform, "Objective", "ENCONTRE A CRIANCA", font, 23, TextAnchor.UpperCenter, new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0f, -28f), new Vector2(620f, 50f));
        Text inventory = CreateText(canvasObject.transform, "Inventory", "MAO VAZIA", font, 22, TextAnchor.UpperRight, new Vector2(1f, 1f), new Vector2(1f, 1f), new Vector2(-32f, -28f), new Vector2(420f, 50f));
        Text presence = CreateText(canvasObject.transform, "Presence", "Escutando...", font, 19, TextAnchor.LowerLeft, new Vector2(0f, 0f), new Vector2(0f, 0f), new Vector2(32f, 30f), new Vector2(320f, 45f));
        presence.color = new Color(0.72f, 0.76f, 0.75f, 0.86f);
        Text prompt = CreateText(canvasObject.transform, "Prompt", "", font, 25, TextAnchor.MiddleCenter, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, -105f), new Vector2(520f, 55f));
        Text eventText = CreateText(canvasObject.transform, "Event", "", font, 25, TextAnchor.LowerCenter, new Vector2(0.5f, 0f), new Vector2(0.5f, 0f), new Vector2(0f, 76f), new Vector2(840f, 60f));
        Text crosshair = CreateText(canvasObject.transform, "Crosshair", "+", font, 24, TextAnchor.MiddleCenter, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(36f, 36f));
        crosshair.color = new Color(0.92f, 0.9f, 0.82f, 0.72f);

        GameObject hidden = CreatePanel(canvasObject.transform, "Hidden", new Color(0.02f, 0.03f, 0.028f, 0.78f), new Vector2(0.5f, 0f), new Vector2(0.5f, 0f), new Vector2(0f, 34f), new Vector2(260f, 54f));
        CreateText(hidden.transform, "Hidden Text", "ESCONDIDO", font, 21, TextAnchor.MiddleCenter, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(240f, 44f));

        GameObject start = CreatePanel(canvasObject.transform, "Start Overlay", new Color(0.005f, 0.006f, 0.007f, 0.88f), Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
        GameObject menuBackground = new GameObject("Menu Background");
        menuBackground.transform.SetParent(start.transform, false);
        RectTransform menuRect = menuBackground.AddComponent<RectTransform>();
        menuRect.anchorMin = Vector2.zero;
        menuRect.anchorMax = Vector2.one;
        menuRect.offsetMin = Vector2.zero;
        menuRect.offsetMax = Vector2.zero;
        RawImage menuImage = menuBackground.AddComponent<RawImage>();
        menuImage.texture = AssetDatabase.LoadAssetAtPath<Texture2D>(TextureRoot + "menu.png");
        menuImage.color = new Color(0.44f, 0.44f, 0.44f, 0.5f);
        menuImage.raycastTarget = false;
        CreateText(start.transform, "Title", "CASA SOMBRIA", font, 64, TextAnchor.MiddleCenter, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, 72f), new Vector2(900f, 110f));
        Text enter = CreateText(start.transform, "Enter", "ENTRAR NA CASA", font, 25, TextAnchor.MiddleCenter, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, -34f), new Vector2(420f, 70f));
        enter.color = new Color(0.84f, 0.15f, 0.12f, 1f);

        GameObject end = CreatePanel(canvasObject.transform, "End Overlay", new Color(0.005f, 0.006f, 0.007f, 0.94f), Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
        Text endTitle = CreateText(end.transform, "End Title", "", font, 58, TextAnchor.MiddleCenter, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, 52f), new Vector2(900f, 100f));
        Text endCopy = CreateText(end.transform, "End Copy", "", font, 24, TextAnchor.MiddleCenter, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, -48f), new Vector2(900f, 80f));

        GameObject flashObject = CreatePanel(canvasObject.transform, "Damage Flash", new Color(0.55f, 0f, 0f, 0f), Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
        Image flash = flashObject.GetComponent<Image>();
        flash.raycastTarget = false;

        manager.dayText = day;
        manager.objectiveText = objective;
        manager.inventoryText = inventory;
        manager.presenceText = presence;
        manager.promptText = prompt;
        manager.eventText = eventText;
        manager.hiddenIndicator = hidden;
        manager.startOverlay = start;
        manager.endOverlay = end;
        manager.endTitleText = endTitle;
        manager.endCopyText = endCopy;
        manager.damageFlash = flash;
    }

    private static Text CreateText(Transform parent, string name, string value, Font font, int size, TextAnchor alignment, Vector2 anchorMin, Vector2 anchorMax, Vector2 anchoredPosition, Vector2 dimensions)
    {
        GameObject root = new GameObject(name);
        root.transform.SetParent(parent, false);
        RectTransform rect = root.AddComponent<RectTransform>();
        rect.anchorMin = anchorMin;
        rect.anchorMax = anchorMax;
        rect.pivot = anchorMin == anchorMax ? anchorMin : new Vector2(0.5f, 0.5f);
        rect.anchoredPosition = anchoredPosition;
        rect.sizeDelta = dimensions;
        Text text = root.AddComponent<Text>();
        text.text = value;
        text.font = font;
        text.fontSize = size;
        text.alignment = alignment;
        text.color = new Color(0.92f, 0.91f, 0.86f, 1f);
        text.raycastTarget = false;
        text.horizontalOverflow = HorizontalWrapMode.Wrap;
        text.verticalOverflow = VerticalWrapMode.Overflow;
        return text;
    }

    private static GameObject CreatePanel(Transform parent, string name, Color color, Vector2 anchorMin, Vector2 anchorMax, Vector2 anchoredPosition, Vector2 dimensions)
    {
        GameObject root = new GameObject(name);
        root.transform.SetParent(parent, false);
        RectTransform rect = root.AddComponent<RectTransform>();
        rect.anchorMin = anchorMin;
        rect.anchorMax = anchorMax;
        rect.pivot = anchorMin == anchorMax ? anchorMin : new Vector2(0.5f, 0.5f);
        rect.anchoredPosition = anchoredPosition;
        rect.sizeDelta = dimensions;
        Image image = root.AddComponent<Image>();
        image.color = color;
        return root;
    }

    private static GameObject InstantiateModel(string name, string path, Vector3 position, Vector3 euler, Vector3 scale, Material material)
    {
        GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        GameObject root = prefab == null ? GameObject.CreatePrimitive(PrimitiveType.Cube) : (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        root.name = name;
        root.transform.position = position;
        root.transform.rotation = Quaternion.Euler(euler);
        root.transform.localScale = scale;
        ApplyMaterial(root, material);
        return root;
    }

    private static void ApplyMaterial(GameObject root, Material material)
    {
        if (material == null) return;
        Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
        for (int i = 0; i < renderers.Length; i++)
        {
            Material[] replacements = new Material[Mathf.Max(1, renderers[i].sharedMaterials.Length)];
            for (int j = 0; j < replacements.Length; j++) replacements[j] = material;
            renderers[i].sharedMaterials = replacements;
            renderers[i].shadowCastingMode = ShadowCastingMode.On;
            renderers[i].receiveShadows = true;
        }
    }

    private static BoxCollider AddBoundsCollider(GameObject root, bool padded)
    {
        Bounds bounds = CalculateBounds(root);
        BoxCollider collider = root.AddComponent<BoxCollider>();
        collider.center = root.transform.InverseTransformPoint(bounds.center);
        Vector3 scale = root.transform.lossyScale;
        collider.size = new Vector3(
            bounds.size.x / Mathf.Max(0.00001f, Mathf.Abs(scale.x)),
            bounds.size.y / Mathf.Max(0.00001f, Mathf.Abs(scale.y)),
            bounds.size.z / Mathf.Max(0.00001f, Mathf.Abs(scale.z))
        );
        if (padded) collider.size *= 1.25f;
        return collider;
    }

    private static Bounds CalculateBounds(GameObject root)
    {
        Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
        if (renderers.Length == 0) return new Bounds(root.transform.position, Vector3.one);
        Bounds bounds = renderers[0].bounds;
        for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
        return bounds;
    }

    private static Material CreateMaterial(string name, string textureRelativePath, Color color)
    {
        Material existing;
        if (Materials.TryGetValue(name, out existing)) return existing;
        Shader shader = Shader.Find("Standard");
        Material material = new Material(shader);
        material.name = name;
        material.color = color;
        string texturePath = textureRelativePath.StartsWith("../", StringComparison.Ordinal)
            ? "Assets/GameAssets/" + textureRelativePath.Substring(3)
            : TextureRoot + textureRelativePath;
        Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath);
        if (texture != null) material.mainTexture = texture;
        material.SetFloat("_Glossiness", 0.12f);
        material.SetFloat("_Metallic", 0.02f);
        string assetPath = GeneratedPath + "/" + Sanitize(name) + ".mat";
        AssetDatabase.CreateAsset(material, assetPath);
        Materials[name] = material;
        return material;
    }

    private static string Sanitize(string value)
    {
        foreach (char invalid in Path.GetInvalidFileNameChars()) value = value.Replace(invalid, '_');
        return value.Replace(' ', '_');
    }

    private static AudioClip LoadAudio(string fileName)
    {
        return AssetDatabase.LoadAssetAtPath<AudioClip>(AudioRoot + fileName);
    }
}
