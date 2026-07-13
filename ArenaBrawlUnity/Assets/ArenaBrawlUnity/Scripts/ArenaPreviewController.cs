using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    [RequireComponent(typeof(CharacterController))]
    public sealed class ArenaPreviewController : MonoBehaviour
    {
        [SerializeField] private Transform cameraPivot;
        [SerializeField] private Camera playerCamera;
        [SerializeField] private float walkSpeed = 7f;
        [SerializeField] private float sprintSpeed = 12f;
        [SerializeField] private float acceleration = 18f;
        [SerializeField] private float jumpHeight = 1.8f;
        [SerializeField] private float gravity = -28f;
        [SerializeField] private float mouseSensitivity = 0.14f;
        [SerializeField] private float thirdPersonDistance = 5.5f;
        [SerializeField] private Vector3 thirdPersonOffset = new Vector3(0f, 1.4f, 0f);

        private CharacterController controller;
        private Vector3 velocity;
        private Vector3 horizontalVelocity;
        private float pitch;
        private float yaw;
        private bool thirdPerson = true;

        private void Awake()
        {
            controller = GetComponent<CharacterController>();

            if (cameraPivot == null)
            {
                var pivot = new GameObject("CameraPivot");
                pivot.transform.SetParent(transform, false);
                pivot.transform.localPosition = new Vector3(0f, 1.55f, 0f);
                cameraPivot = pivot.transform;
            }

            if (playerCamera == null)
            {
                playerCamera = GetComponentInChildren<Camera>();
            }

            yaw = transform.eulerAngles.y;
            ApplyCameraMode();
        }

        private void Update()
        {
            if (Input.GetMouseButtonDown(0))
            {
                Cursor.lockState = CursorLockMode.Locked;
                Cursor.visible = false;
            }

            if (Input.GetKeyDown(KeyCode.Escape))
            {
                Cursor.lockState = CursorLockMode.None;
                Cursor.visible = true;
            }

            if (Input.GetKeyDown(KeyCode.V))
            {
                thirdPerson = !thirdPerson;
                ApplyCameraMode();
            }

            Look();
            Move();
            ApplyCameraMode();
        }

        private void Look()
        {
            if (Cursor.lockState != CursorLockMode.Locked)
            {
                return;
            }

            yaw += Input.GetAxisRaw("Mouse X") * mouseSensitivity * 12f;
            pitch = Mathf.Clamp(pitch - Input.GetAxisRaw("Mouse Y") * mouseSensitivity * 12f, -78f, 78f);
            transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            cameraPivot.localRotation = Quaternion.Euler(pitch, 0f, 0f);
        }

        private void Move()
        {
            var input = new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical"));
            input = Vector2.ClampMagnitude(input, 1f);

            var targetSpeed = Input.GetKey(KeyCode.LeftShift) ? sprintSpeed : walkSpeed;
            var wishDirection = transform.right * input.x + transform.forward * input.y;
            var targetVelocity = wishDirection * targetSpeed;
            horizontalVelocity = Vector3.MoveTowards(horizontalVelocity, targetVelocity, acceleration * Time.deltaTime);

            if (controller.isGrounded && velocity.y < 0f)
            {
                velocity.y = -2f;
            }

            if (controller.isGrounded && Input.GetKeyDown(KeyCode.Space))
            {
                velocity.y = Mathf.Sqrt(jumpHeight * -2f * gravity);
            }

            velocity.y += gravity * Time.deltaTime;
            controller.Move((horizontalVelocity + velocity) * Time.deltaTime);
        }

        private void ApplyCameraMode()
        {
            if (playerCamera == null || cameraPivot == null)
            {
                return;
            }

            if (thirdPerson)
            {
                playerCamera.transform.SetParent(cameraPivot, false);
                playerCamera.transform.localPosition = thirdPersonOffset + Vector3.back * thirdPersonDistance;
                playerCamera.transform.localRotation = Quaternion.identity;
                playerCamera.nearClipPlane = 0.05f;
            }
            else
            {
                playerCamera.transform.SetParent(cameraPivot, false);
                playerCamera.transform.localPosition = new Vector3(0f, 0.1f, 0.1f);
                playerCamera.transform.localRotation = Quaternion.identity;
                playerCamera.nearClipPlane = 0.03f;
            }
        }
    }
}
