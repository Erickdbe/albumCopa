using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    [CreateAssetMenu(menuName = "Arena Brawl/Survival/Item Definition", fileName = "SurvivalItem")]
    public sealed class SurvivalItemDefinition : ScriptableObject
    {
        [SerializeField] private string itemId = "item";
        [SerializeField] private string displayName = "Item";
        [SerializeField] private SurvivalItemType itemType;
        [SerializeField] private int maxStack = 1;
        [SerializeField] private float weight = 0.1f;
        [SerializeField] private GameObject worldModel;
        [SerializeField] private Sprite icon;

        [Header("Consumable")]
        [SerializeField] private float healAmount;
        [SerializeField] private float thirstAmount;
        [SerializeField] private float hungerAmount;

        [Header("Weapon")]
        [SerializeField] private float damage = 15f;
        [SerializeField] private float range = 65f;
        [SerializeField] private float fireRate = 0.25f;
        [SerializeField] private int magazineSize;
        [SerializeField] private string compatibleAmmoId = "";

        [Header("Resource")]
        [SerializeField] private float fuelAmount;

        [Header("Container")]
        [SerializeField] private int slotBonus;

        public string ItemId => itemId;
        public string DisplayName => displayName;
        public SurvivalItemType ItemType => itemType;
        public int MaxStack => Mathf.Max(1, maxStack);
        public float Weight => Mathf.Max(0f, weight);
        public GameObject WorldModel => worldModel;
        public Sprite Icon => icon;
        public float HealAmount => Mathf.Max(0f, healAmount);
        public float ThirstAmount => Mathf.Max(0f, thirstAmount);
        public float HungerAmount => Mathf.Max(0f, hungerAmount);
        public float Damage => Mathf.Max(0f, damage);
        public float Range => Mathf.Max(0.5f, range);
        public float FireRate => Mathf.Max(0.02f, fireRate);
        public int MagazineSize => Mathf.Max(0, magazineSize);
        public string CompatibleAmmoId => compatibleAmmoId;
        public float FuelAmount => Mathf.Max(0f, fuelAmount);
        public int SlotBonus => Mathf.Max(0, slotBonus);
    }
}
