using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    public sealed class SurvivalHud : MonoBehaviour
    {
        [SerializeField] private SurvivalPlayerInteractor player;
        [SerializeField] private SurvivalInventory inventory;
        [SerializeField] private SurvivalWeaponController weaponController;
        [SerializeField] private SurvivalHealth health;
        [SerializeField] private SurvivalGameManager gameManager;

        private GUIStyle panelStyle;
        private GUIStyle labelStyle;
        private GUIStyle promptStyle;

        private void Awake()
        {
            if (player == null)
            {
                player = FindObjectOfType<SurvivalPlayerInteractor>();
            }

            if (player != null)
            {
                inventory = inventory == null ? player.Inventory : inventory;
                weaponController = weaponController == null ? player.WeaponController : weaponController;
                health = health == null ? player.Health : health;
            }

            if (gameManager == null)
            {
                gameManager = SurvivalGameManager.Instance ?? FindObjectOfType<SurvivalGameManager>();
            }
        }

        private void OnGUI()
        {
            BuildStyles();

            GUILayout.BeginArea(new Rect(16f, 16f, 310f, Screen.height - 32f), panelStyle);
            GUILayout.Label(gameManager != null && gameManager.IsNight ? "Night: threats aggressive" : "Day: scavenge and craft", labelStyle);
            GUILayout.Label($"Health: {FormatHealth()}", labelStyle);
            GUILayout.Label($"Backpack: {FormatInventory()}", labelStyle);
            GUILayout.Space(6f);
            DrawWeapon();
            GUILayout.Space(8f);
            DrawInventory();
            GUILayout.EndArea();

            if (player != null && !string.IsNullOrEmpty(player.CurrentPrompt))
            {
                GUI.Label(new Rect(Screen.width * 0.5f - 180f, Screen.height - 96f, 360f, 32f), $"E - {player.CurrentPrompt}", promptStyle);
            }

            if (player != null && !string.IsNullOrEmpty(player.CurrentMessage))
            {
                GUI.Label(new Rect(Screen.width * 0.5f - 180f, Screen.height - 138f, 360f, 32f), player.CurrentMessage, promptStyle);
            }
        }

        private void DrawWeapon()
        {
            if (weaponController == null || weaponController.EquippedWeapon == null)
            {
                GUILayout.Label("Weapon: none", labelStyle);
                return;
            }

            var weapon = weaponController.EquippedWeapon;
            var reserveAmmo = inventory != null ? inventory.GetQuantity(weapon.CompatibleAmmoId) : 0;
            var ammo = weapon.MagazineSize > 0 ? $"{weaponController.AmmoInMagazine}/{reserveAmmo}" : "melee";
            GUILayout.Label($"Weapon: {weapon.DisplayName} ({ammo})", labelStyle);
        }

        private void DrawInventory()
        {
            if (inventory == null)
            {
                return;
            }

            GUILayout.Label("Loot", labelStyle);
            for (var i = 0; i < inventory.Stacks.Count; i++)
            {
                var stack = inventory.Stacks[i];
                if (stack.Definition != null)
                {
                    GUILayout.Label($"- {stack.Definition.DisplayName} x{stack.Quantity}", labelStyle);
                }
            }

            GUILayout.Space(6f);
            GUILayout.Label("1 equip weapon | 2 use heal | R reload", labelStyle);
        }

        private string FormatHealth()
        {
            return health == null ? "--" : $"{Mathf.RoundToInt(health.CurrentHealth)}/{Mathf.RoundToInt(health.MaxHealth)}";
        }

        private string FormatInventory()
        {
            return inventory == null ? "--" : $"{inventory.UsedSlots}/{inventory.SlotCapacity} slots  {inventory.CurrentWeight:0.0}/{inventory.WeightCapacity:0.0}kg";
        }

        private void BuildStyles()
        {
            if (panelStyle != null)
            {
                return;
            }

            panelStyle = new GUIStyle(GUI.skin.box)
            {
                padding = new RectOffset(12, 12, 10, 10),
                alignment = TextAnchor.UpperLeft
            };

            labelStyle = new GUIStyle(GUI.skin.label)
            {
                fontSize = 14,
                normal = { textColor = Color.white }
            };

            promptStyle = new GUIStyle(GUI.skin.box)
            {
                fontSize = 16,
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = Color.white }
            };
        }
    }
}
