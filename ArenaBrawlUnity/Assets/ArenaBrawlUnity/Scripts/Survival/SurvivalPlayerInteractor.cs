using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    public sealed class SurvivalPlayerInteractor : MonoBehaviour
    {
        [SerializeField] private Camera playerCamera;
        [SerializeField] private float interactionDistance = 4f;
        [SerializeField] private LayerMask interactionMask = ~0;
        [SerializeField] private float messageDuration = 2.4f;

        private IInteractable currentInteractable;
        private string currentMessage;
        private float messageUntil;

        public SurvivalInventory Inventory { get; private set; }
        public SurvivalWeaponController WeaponController { get; private set; }
        public SurvivalHealth Health { get; private set; }
        public string CurrentPrompt => currentInteractable != null ? currentInteractable.InteractionPrompt : "";
        public string CurrentMessage => Time.time < messageUntil ? currentMessage : "";
        public Camera PlayerCamera => playerCamera;

        private void Awake()
        {
            Inventory = GetComponent<SurvivalInventory>();
            WeaponController = GetComponent<SurvivalWeaponController>();
            Health = GetComponent<SurvivalHealth>();

            if (playerCamera == null)
            {
                playerCamera = GetComponentInChildren<Camera>();
            }

            if (playerCamera == null)
            {
                playerCamera = Camera.main;
            }
        }

        private void Update()
        {
            FindInteractable();

            if (Input.GetKeyDown(KeyCode.E) && currentInteractable != null && currentInteractable.CanInteract(this))
            {
                currentInteractable.Interact(this);
            }

            if (Input.GetKeyDown(KeyCode.Alpha1) && Inventory != null && Inventory.TryFindFirst(SurvivalItemType.Weapon, out var weapon))
            {
                WeaponController?.Equip(weapon);
            }

            if (Input.GetKeyDown(KeyCode.Alpha2) && Inventory != null && Inventory.TryFindFirst(SurvivalItemType.Consumable, out var consumable))
            {
                Inventory.TryUseConsumable(consumable, Health);
            }
        }

        public void ShowMessage(string message)
        {
            currentMessage = message;
            messageUntil = Time.time + messageDuration;
        }

        private void FindInteractable()
        {
            currentInteractable = null;

            if (playerCamera == null)
            {
                return;
            }

            var ray = new Ray(playerCamera.transform.position, playerCamera.transform.forward);
            if (!Physics.Raycast(ray, out var hit, interactionDistance, interactionMask, QueryTriggerInteraction.Collide))
            {
                return;
            }

            currentInteractable = hit.collider.GetComponentInParent<IInteractable>();
            if (currentInteractable != null && !currentInteractable.CanInteract(this))
            {
                currentInteractable = null;
            }
        }
    }
}
