using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    public sealed class SurvivalLootPickup : MonoBehaviour, IInteractable
    {
        [SerializeField] private SurvivalItemDefinition definition;
        [SerializeField] private int quantity = 1;

        public SurvivalItemDefinition Definition => definition;
        public int Quantity => Mathf.Max(1, quantity);

        public string InteractionPrompt
        {
            get
            {
                var itemName = definition == null ? "item" : definition.DisplayName;
                return $"Pick up {itemName} x{Quantity}";
            }
        }

        public bool CanInteract(SurvivalPlayerInteractor interactor)
        {
            return definition != null && interactor != null && interactor.Inventory != null;
        }

        public void Interact(SurvivalPlayerInteractor interactor)
        {
            if (!CanInteract(interactor))
            {
                return;
            }

            if (!interactor.Inventory.TryAdd(definition, Quantity))
            {
                interactor.ShowMessage("Backpack full");
                return;
            }

            if (definition.ItemType == SurvivalItemType.Weapon && interactor.WeaponController != null)
            {
                interactor.WeaponController.Equip(definition);
            }
            else if (definition.ItemType == SurvivalItemType.Container && definition.SlotBonus > 0)
            {
                interactor.Inventory.AddSlots(definition.SlotBonus);
            }

            interactor.ShowMessage($"Picked up {definition.DisplayName}");
            Destroy(gameObject);
        }
    }
}
