using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    [RequireComponent(typeof(Rigidbody))]
    public sealed class SurvivalVehicle : MonoBehaviour, IInteractable
    {
        [SerializeField] private float maxFuel = 100f;
        [SerializeField] private float fuel = 12f;
        [SerializeField] private float fuelFromGasCan = 35f;
        [SerializeField] private float driveSpeed = 16f;
        [SerializeField] private float turnSpeed = 92f;
        [SerializeField] private float fuelConsumptionPerSecond = 2.2f;
        [SerializeField] private string gasCanItemId = "gas_can";
        [SerializeField] private Transform seat;
        [SerializeField] private Transform exitPoint;

        private Rigidbody body;
        private SurvivalPlayerInteractor driver;
        private ArenaPreviewController disabledController;
        private CharacterController disabledCharacterController;

        public float Fuel => fuel;
        public string InteractionPrompt
        {
            get
            {
                if (driver != null)
                {
                    return "Exit vehicle";
                }

                return fuel > 0.5f ? $"Drive vehicle ({Mathf.RoundToInt(fuel)} fuel)" : "Refuel vehicle";
            }
        }

        private void Awake()
        {
            body = GetComponent<Rigidbody>();
            body.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;

            if (seat == null)
            {
                var seatObject = new GameObject("Seat");
                seatObject.transform.SetParent(transform, false);
                seatObject.transform.localPosition = new Vector3(0f, 1.4f, -0.4f);
                seat = seatObject.transform;
            }

            if (exitPoint == null)
            {
                var exitObject = new GameObject("ExitPoint");
                exitObject.transform.SetParent(transform, false);
                exitObject.transform.localPosition = new Vector3(2.8f, 0.4f, -1f);
                exitPoint = exitObject.transform;
            }
        }

        private void Update()
        {
            if (driver == null)
            {
                return;
            }

            if (Input.GetKeyDown(KeyCode.E))
            {
                Exit();
                return;
            }

            Drive();
        }

        public bool CanInteract(SurvivalPlayerInteractor interactor)
        {
            return interactor != null && (driver == null || driver == interactor);
        }

        public void Interact(SurvivalPlayerInteractor interactor)
        {
            if (!CanInteract(interactor))
            {
                return;
            }

            if (driver == interactor)
            {
                Exit();
                return;
            }

            if (fuel <= 0.5f)
            {
                TryRefuel(interactor);
                return;
            }

            Enter(interactor);
        }

        private void TryRefuel(SurvivalPlayerInteractor interactor)
        {
            if (interactor.Inventory == null || !interactor.Inventory.TryConsume(gasCanItemId, 1))
            {
                interactor.ShowMessage("Needs gasoline");
                return;
            }

            fuel = Mathf.Min(maxFuel, fuel + fuelFromGasCan);
            interactor.ShowMessage("Vehicle refueled");
        }

        private void Enter(SurvivalPlayerInteractor interactor)
        {
            driver = interactor;
            disabledController = driver.GetComponent<ArenaPreviewController>();
            disabledCharacterController = driver.GetComponent<CharacterController>();

            if (disabledController != null)
            {
                disabledController.enabled = false;
            }

            if (disabledCharacterController != null)
            {
                disabledCharacterController.enabled = false;
            }

            driver.transform.SetParent(seat, false);
            driver.transform.localPosition = Vector3.zero;
            driver.transform.localRotation = Quaternion.identity;
            driver.enabled = false;
        }

        private void Exit()
        {
            if (driver == null)
            {
                return;
            }

            var exiting = driver;
            exiting.transform.SetParent(null);
            exiting.transform.position = exitPoint.position;
            exiting.transform.rotation = Quaternion.Euler(0f, transform.eulerAngles.y, 0f);
            exiting.enabled = true;

            if (disabledCharacterController != null)
            {
                disabledCharacterController.enabled = true;
            }

            if (disabledController != null)
            {
                disabledController.enabled = true;
            }

            driver = null;
            disabledController = null;
            disabledCharacterController = null;
        }

        private void Drive()
        {
            if (fuel <= 0f)
            {
                fuel = 0f;
                return;
            }

            var throttle = Input.GetAxisRaw("Vertical");
            var steer = Input.GetAxisRaw("Horizontal");
            var moving = Mathf.Abs(throttle) > 0.01f;

            if (moving)
            {
                var movement = transform.forward * throttle * driveSpeed * Time.deltaTime;
                body.MovePosition(body.position + movement);
                fuel = Mathf.Max(0f, fuel - Mathf.Abs(throttle) * fuelConsumptionPerSecond * Time.deltaTime);
            }

            if (Mathf.Abs(steer) > 0.01f)
            {
                var rotation = Quaternion.Euler(0f, steer * turnSpeed * Time.deltaTime, 0f);
                body.MoveRotation(body.rotation * rotation);
            }
        }
    }
}
