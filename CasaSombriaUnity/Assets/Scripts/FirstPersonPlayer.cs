using UnityEngine;

[RequireComponent(typeof(CharacterController))]
public class FirstPersonPlayer : MonoBehaviour
{
    public Camera playerCamera;
    public float walkSpeed = 3.2f;
    public float sprintSpeed = 5.2f;
    public float crouchSpeed = 1.8f;
    public float mouseSensitivity = 2.1f;
    public float jumpHeight = 1.05f;
    public float gravity = 18f;
    public float interactionDistance = 3.1f;

    private CharacterController controller;
    private float pitch;
    private float verticalSpeed;
    private float stepTimer;
    private bool hidden;
    private HidingSpot hidingSpot;
    private HorrorInteractable focused;

    public bool IsHidden
    {
        get { return hidden; }
    }

    public Vector3 EyePosition
    {
        get { return playerCamera.transform.position; }
    }

    private void Awake()
    {
        controller = GetComponent<CharacterController>();
    }

    private void Update()
    {
        if (HorrorGameManager.Instance == null || !HorrorGameManager.Instance.IsPlaying) return;

        if (hidden)
        {
            UpdateHiddenState();
            return;
        }

        UpdateLook();
        UpdateMovement();
        UpdateInteraction();

        if (Input.GetKeyDown(KeyCode.G)) HorrorGameManager.Instance.DropHeldItem();
    }

    private void UpdateLook()
    {
        if (Cursor.lockState != CursorLockMode.Locked) return;

        float yaw = Input.GetAxis("Mouse X") * mouseSensitivity;
        float look = Input.GetAxis("Mouse Y") * mouseSensitivity;
        transform.Rotate(0f, yaw, 0f);
        pitch = Mathf.Clamp(pitch - look, -82f, 82f);
        playerCamera.transform.localRotation = Quaternion.Euler(pitch, 0f, 0f);
    }

    private void UpdateMovement()
    {
        float horizontal = Input.GetAxisRaw("Horizontal");
        float vertical = Input.GetAxisRaw("Vertical");
        Vector3 input = new Vector3(horizontal, 0f, vertical);
        input = Vector3.ClampMagnitude(input, 1f);

        bool crouching = Input.GetKey(KeyCode.LeftControl) || Input.GetKey(KeyCode.C);
        bool sprinting = !crouching && Input.GetKey(KeyCode.LeftShift) && vertical > 0.1f;
        float speed = crouching ? crouchSpeed : sprinting ? sprintSpeed : walkSpeed;
        Vector3 planar = transform.TransformDirection(input) * speed;

        if (controller.isGrounded)
        {
            verticalSpeed = -1.5f;
            if (Input.GetButtonDown("Jump") && !crouching)
            {
                verticalSpeed = Mathf.Sqrt(2f * gravity * jumpHeight);
                HorrorGameManager.Instance.EmitNoise(transform.position, 7f);
            }
        }
        else
        {
            verticalSpeed -= gravity * Time.deltaTime;
        }

        planar.y = verticalSpeed;
        CollisionFlags flags = controller.Move(planar * Time.deltaTime);
        if ((flags & CollisionFlags.Below) != 0 && verticalSpeed < 0f) verticalSpeed = -1.5f;

        float targetHeight = crouching ? 1.1f : 1.75f;
        controller.height = Mathf.Lerp(controller.height, targetHeight, Time.deltaTime * 10f);
        controller.center = new Vector3(0f, controller.height * 0.5f, 0f);
        playerCamera.transform.localPosition = Vector3.Lerp(
            playerCamera.transform.localPosition,
            new Vector3(0f, crouching ? 0.92f : 1.58f, 0f),
            Time.deltaTime * 10f
        );

        if (input.sqrMagnitude > 0.05f && controller.isGrounded)
        {
            stepTimer -= Time.deltaTime;
            if (stepTimer <= 0f)
            {
                stepTimer = sprinting ? 0.34f : crouching ? 0.78f : 0.52f;
                HorrorGameManager.Instance.PlayFootstep();
                HorrorGameManager.Instance.EmitNoise(transform.position, sprinting ? 10f : crouching ? 2.5f : 5f);
            }
        }
        else
        {
            stepTimer = Mathf.Min(stepTimer, 0.12f);
        }
    }

    private void UpdateInteraction()
    {
        focused = null;
        RaycastHit hit;
        Ray ray = new Ray(playerCamera.transform.position, playerCamera.transform.forward);
        if (Physics.Raycast(ray, out hit, interactionDistance, ~0, QueryTriggerInteraction.Collide))
        {
            focused = hit.collider.GetComponentInParent<HorrorInteractable>();
        }

        HorrorGameManager.Instance.SetPrompt(focused == null ? "" : focused.Prompt);
        if (focused != null && (Input.GetKeyDown(KeyCode.E) || Input.GetMouseButtonDown(0)))
        {
            focused.Interact(this);
        }
    }

    private void UpdateHiddenState()
    {
        HorrorGameManager.Instance.SetPrompt("Sair do esconderijo");
        if (Input.GetKeyDown(KeyCode.E) || Input.GetMouseButtonDown(0)) ExitHidingSpot();
    }

    public void EnterHidingSpot(HidingSpot spot)
    {
        if (HorrorGameManager.Instance.HasHeldItem)
        {
            HorrorGameManager.Instance.ShowEvent("Solte o item antes de se esconder.");
            return;
        }

        hidingSpot = spot;
        hidden = true;
        controller.enabled = false;
        transform.position = spot.hidePoint.position;
        transform.rotation = spot.hidePoint.rotation;
        controller.enabled = true;
        HorrorGameManager.Instance.SetHidden(true);
        HorrorGameManager.Instance.ShowEvent("Voce se escondeu.");
    }

    public void ExitHidingSpot()
    {
        if (!hidden || hidingSpot == null) return;
        controller.enabled = false;
        transform.position = hidingSpot.exitPoint.position;
        transform.rotation = hidingSpot.exitPoint.rotation;
        controller.enabled = true;
        hidden = false;
        hidingSpot = null;
        HorrorGameManager.Instance.SetHidden(false);
        HorrorGameManager.Instance.EmitNoise(transform.position, 4f);
    }

    public void ResetForDay(Vector3 position, Quaternion rotation)
    {
        hidden = false;
        hidingSpot = null;
        pitch = 0f;
        verticalSpeed = 0f;
        controller.enabled = false;
        transform.position = position;
        transform.rotation = rotation;
        playerCamera.transform.localRotation = Quaternion.identity;
        controller.enabled = true;
    }
}
